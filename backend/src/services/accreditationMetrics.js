import { RESEARCH_FUNDED_STATUSES, accrRound, accrYearRange, isElectiveType } from '@schoolgiant/shared'
import { AcademicYear } from '../models/academics.js'
import { CoeResult, CoeRevaluation, CoeSemesterResult, CoeSession } from '../models/coe.js'
import { Employee } from '../models/hrms.js'
import { LibraryCopy, LibraryLoan, LibraryTitle } from '../models/library.js'
import { Program, ProgramCourse, ProgramEnrolment } from '../models/programs.js'
import { ResearchProject, ResearchPublication, ResearchScholar } from '../models/research.js'
import { Student } from '../models/students.js'
import { Department } from '../models/tenant.js'
import { logger } from '../platform/logger.js'

// Accreditation metrics computed from SchoolGiant's own records, for one assessment year ("2025-26"). Each calculation
// (the `auto` key of a metric in packages/shared/src/accreditation.js) returns
//   { value, detail: [{ key, value }] }       value null → no data to compute from (the metric is entered by hand)
// `detail` explains the figure (numerator, denominator …); the screen labels each key (accreditation.detail.<key>).
//
// The year's dates are the institution's academic year of that name (Academic setup), else June to May. Calendar-year
// counts (publications) use the year the assessment year starts in. Staff on roll in the year: joined by its end and not
// left before its start. Full-time teachers: teaching staff who are not part-time or visiting.

const PART_TIME = ['PART_TIME', 'VISITING']
const ELECTIVE_TYPES = ['ELECTIVE', 'OPEN_ELECTIVE', 'LAB', 'PROJECT', 'CORE'].filter(isElectiveType)
const PAISE_PER_LAKH = 1e7
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null)
const ratio = (a, b) => (b > 0 ? a / b : null)
const D = (key, value) => ({ key, value })

/** Placements are optional (another module): its offers when it is there, else nothing. */
async function placementModels() {
  const mod = await import('../models/placements.js').catch(() => null)
  return mod?.PlacementOffer ? mod : null
}

/** A lazy, memoised set of the figures the calculations share. */
function figures(year) {
  const memo = new Map()
  const once = (key, fn) => () => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key) }
  const f = {}

  f.range = once('range', async () => {
    const ay = await AcademicYear.findOne({ name: year }).select('name startDate endDate').lean()
    const base = accrYearRange(year)
    return ay ? { from: ay.startDate, to: ay.endDate, startYear: base?.startYear ?? Number(ay.startDate.slice(0, 4)), ayId: ay._id } : { ...base, ayId: null }
  })
  f.programs = once('programs', () => Program.find({ active: true }).select('code semesters intake durationYears').lean())
  f.staff = once('staff', async () => {
    const { from, to } = await f.range()
    const rows = await Employee.find({ joiningDate: { $lte: to } }).select('category employmentType status exit.lastWorkingDate qualifications experienceYears joiningDate').lean()
    return rows.filter((e) => !(e.status === 'EXITED' && e.exit?.lastWorkingDate && e.exit.lastWorkingDate < from))
  })
  f.teachers = once('teachers', async () => (await f.staff()).filter((e) => e.category === 'TEACHING'))
  f.fullTime = once('fullTime', async () => (await f.teachers()).filter((e) => !PART_TIME.includes(e.employmentType)))
  f.enrolments = once('enrolments', () => ProgramEnrolment.find({ status: { $in: ['ACTIVE', 'DETAINED'] } }).select('studentId programId batch advisorId currentSemester').lean())
  f.students = once('students', async () => {
    const enr = await f.enrolments()
    if (enr.length) return enr.length
    return Student.countDocuments({ status: 'ACTIVE' })
  })
  f.scholars = once('scholars', () => ResearchScholar.find().select('guideId status registrationDate awardedOn').lean())
  f.activeScholars = once('activeScholars', async () => {
    const { to } = await f.range()
    return (await f.scholars()).filter((s) => s.registrationDate <= to && !['DISCONTINUED', 'AWARDED'].includes(s.status))
  })
  f.sessions = once('sessions', async () => {
    const { from, to, ayId } = await f.range()
    const or = [{ examMonth: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) } }]
    if (ayId) or.push({ academicYearId: ayId })
    return (await CoeSession.find({ $or: or }).select('_id').lean()).map((s) => s._id)
  })
  /** Final-semester results of the year's sessions, the latest per student. */
  f.finalResults = once('finalResults', async () => {
    const sessions = await f.sessions()
    if (!sessions.length) return []
    const finalSem = new Map((await f.programs()).map((p) => [String(p._id), p.semesters]))
    const rows = await CoeSemesterResult.find({ sessionId: { $in: sessions }, published: true }).select('studentId programId semester result updatedAt').sort({ updatedAt: 1 }).lean()
    const latest = new Map()
    for (const r of rows) if (r.semester && r.semester === finalSem.get(String(r.programId))) latest.set(String(r.studentId), r)
    return [...latest.values()]
  })
  f.pubs = once('pubs', async () => {
    const { startYear } = await f.range()
    return ResearchPublication.find({ year: { $gte: startYear - 2, $lte: startYear } }).select('type year indexing citations').lean()
  })
  f.pubsOfYear = once('pubsOfYear', async () => { const { startYear } = await f.range(); return (await f.pubs()).filter((p) => p.year === startYear) })
  f.placement = once('placement', async () => {
    const mod = await placementModels()
    const { ayId } = await f.range()
    if (!mod || !ayId) return null
    try {
      const offers = await mod.PlacementOffer.find({ academicYearId: ayId, status: 'ACCEPTED' }).select('studentId ctc').lean()
      const best = new Map()
      for (const o of offers) { const k = String(o.studentId); if (!best.has(k) || (o.ctc ?? 0) > best.get(k)) best.set(k, o.ctc ?? 0) }
      return { placed: best.size, ctcs: [...best.values()].filter((v) => v > 0).sort((a, b) => a - b) }
    } catch (err) {
      logger.warn({ err }, 'accreditation: placement offers could not be read')
      return null
    }
  })
  f.outgoing = once('outgoing', async () => {
    const results = await f.finalResults()
    if (results.length) return results.length
    const finalSem = new Map((await f.programs()).map((p) => [String(p._id), p.semesters]))
    return (await f.enrolments()).filter((e) => e.currentSemester === finalSem.get(String(e.programId))).length
  })
  return f
}

// ───────────────────────────────────────────────────────── calculations

const CALC = {
  async programmes(f) {
    const n = (await f.programs()).length
    return { value: n, detail: [] }
  },
  async cbcsPct(f) {
    const programs = await f.programs()
    if (!programs.length) return null
    const withElectives = await ProgramCourse.distinct('programId', { active: true, programId: { $in: programs.map((p) => p._id) }, type: { $in: ELECTIVE_TYPES } })
    return { value: pct(withElectives.length, programs.length), detail: [D('programsCbcs', withElectives.length), D('programs', programs.length)] }
  },
  async projectCoursesPct(f) {
    const programs = await f.programs()
    const courses = await ProgramCourse.find({ active: true, programId: { $in: programs.map((p) => p._id) } }).select('type').lean()
    if (!courses.length) return null
    const n = courses.filter((c) => c.type === 'PROJECT').length
    return { value: pct(n, courses.length), detail: [D('projectCourses', n), D('courses', courses.length)] }
  },
  async enrolmentPct(f) {
    const { startYear } = await f.range()
    const programs = await f.programs()
    const intake = programs.reduce((n, p) => n + (p.intake ?? 0), 0)
    if (!intake) return null
    const admitted = await ProgramEnrolment.countDocuments({ batch: startYear, programId: { $in: programs.filter((p) => p.intake > 0).map((p) => p._id) } })
    return { value: pct(admitted, intake), detail: [D('admitted', admitted), D('intake', intake)] }
  },
  async reservedPct(f) {
    const { startYear } = await f.range()
    const ids = await ProgramEnrolment.distinct('studentId', { batch: startYear })
    if (!ids.length) return null
    const reserved = await Student.countDocuments({ _id: { $in: ids }, category: { $in: ['OBC', 'SC', 'ST', 'EWS'] } })
    return { value: pct(reserved, ids.length), detail: [D('reservedAdmitted', reserved), D('admitted', ids.length)] }
  },
  async studentStrength(f) {
    const students = await f.students()
    const scholars = (await f.activeScholars()).length
    return { value: students + scholars, detail: [D('students', students), D('phdScholars', scholars)] }
  },
  async studentTeacherRatio(f) {
    const students = await f.students()
    const teachers = (await f.fullTime()).length
    if (!teachers) return null
    return { value: ratio(students, teachers), detail: [D('students', students), D('fullTimeTeachers', teachers)] }
  },
  async mentorRatio(f) {
    const enr = (await f.enrolments()).filter((e) => e.advisorId)
    const mentors = new Set(enr.map((e) => String(e.advisorId))).size
    if (!mentors) return null
    return { value: ratio(enr.length, mentors), detail: [D('mentees', enr.length), D('mentors', mentors)] }
  },
  async fullTimeTeachers(f) {
    const ft = (await f.fullTime()).length
    return { value: ft, detail: [D('fullTimeTeachers', ft), D('teachers', (await f.teachers()).length)] }
  },
  async teachersPhdPct(f) {
    const ft = await f.fullTime()
    if (!ft.length) return null
    const phd = ft.filter((e) => /\bph\.?\s*d\b|\bd\.?\s*phil\b|\bd\.?\s*sc\b|\bd\.?\s*litt?\b/i.test(e.qualifications ?? '')).length
    return { value: pct(phd, ft.length), detail: [D('teachersPhd', phd), D('fullTimeTeachers', ft.length)] }
  },
  async teachingExperience(f) {
    const ft = await f.fullTime()
    if (!ft.length) return null
    const { to } = await f.range()
    const yearsBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / (365.25 * 86_400_000))
    const total = ft.reduce((n, e) => n + (e.experienceYears ?? 0) + (e.joiningDate ? yearsBetween(e.joiningDate, to) : 0), 0)
    return { value: total / ft.length, detail: [D('fullTimeTeachers', ft.length)] }
  },
  async teachers(f) {
    const t = await f.teachers()
    return { value: t.length, detail: [D('fullTimeTeachers', t.filter((e) => !PART_TIME.includes(e.employmentType)).length)] }
  },
  async nonTeaching(f) {
    const n = (await f.staff()).filter((e) => e.category !== 'TEACHING').length
    return { value: n, detail: [] }
  },
  async passPct(f) {
    const results = await f.finalResults()
    if (!results.length) return null
    const passed = results.filter((r) => r.result === 'PASS').length
    return { value: pct(passed, results.length), detail: [D('passed', passed), D('appeared', results.length)] }
  },
  async passedOut(f) {
    const results = await f.finalResults()
    if (!results.length) return null
    return { value: results.filter((r) => r.result === 'PASS').length, detail: [D('appeared', results.length)] }
  },
  async revaluationPct(f) {
    const sessions = await f.sessions()
    if (!sessions.length) return null
    const [results, reval] = await Promise.all([CoeResult.countDocuments({ sessionId: { $in: sessions } }), CoeRevaluation.countDocuments({ sessionId: { $in: sessions } })])
    if (!results) return null
    return { value: pct(reval, results), detail: [D('revaluations', reval), D('papers', results)] }
  },
  async womenPct() {
    const [total, women] = await Promise.all([Student.countDocuments({ status: 'ACTIVE' }), Student.countDocuments({ status: 'ACTIVE', gender: 'FEMALE' })])
    if (!total) return null
    return { value: pct(women, total), detail: [D('womenStudents', women), D('students', total)] }
  },
  async femaleStudents() {
    const n = await Student.countDocuments({ status: 'ACTIVE', gender: 'FEMALE' })
    return { value: n, detail: [] }
  },
  // research
  async grantsLakh(f) {
    const { from, to } = await f.range()
    const rows = await ResearchProject.find({ status: { $in: RESEARCH_FUNDED_STATUSES }, sanctionedOn: { $gte: from, $lte: to } }).select('sanctioned received').lean()
    const sanctioned = rows.reduce((n, p) => n + (p.sanctioned ?? 0), 0)
    return { value: sanctioned / PAISE_PER_LAKH, detail: [D('projects', rows.length), D('receivedLakh', accrRound(rows.reduce((n, p) => n + (p.received ?? 0), 0) / PAISE_PER_LAKH, 'lakh'))] }
  },
  async guidesPct(f) {
    const ft = (await f.fullTime()).length
    if (!ft) return null
    const guides = new Set((await f.activeScholars()).map((s) => String(s.guideId))).size
    return { value: pct(guides, ft), detail: [D('guides', guides), D('fullTimeTeachers', ft)] }
  },
  async deptsWithProjectsPct(f) {
    const { from, to } = await f.range()
    const depts = await Department.countDocuments({ active: true, type: 'ACADEMIC' })
    if (!depts) return null
    const withProjects = await ResearchProject.distinct('departmentId', {
      status: { $in: RESEARCH_FUNDED_STATUSES }, sanctionedOn: { $lte: to }, departmentId: { $ne: null },
      $or: [{ endDate: { $gte: from } }, { endDate: null }],
    })
    return { value: pct(withProjects.length, depts), detail: [D('departmentsFunded', withProjects.length), D('departments', depts)] }
  },
  async phdPerGuide(f) {
    const { from, to } = await f.range()
    const all = await f.scholars()
    const registered = all.filter((s) => s.registrationDate >= from && s.registrationDate <= to).length
    const guides = new Set((await f.activeScholars()).map((s) => String(s.guideId))).size
    if (!guides) return registered ? { value: null, detail: [D('registered', registered)] } : null
    return { value: ratio(registered, guides), detail: [D('registered', registered), D('guides', guides)] }
  },
  async papersPerTeacher(f) {
    const ft = (await f.fullTime()).length
    const n = (await f.pubsOfYear()).filter((p) => p.type === 'JOURNAL' && p.indexing?.includes('UGC_CARE')).length
    if (!ft) return null
    return { value: ratio(n, ft), detail: [D('papers', n), D('fullTimeTeachers', ft)] }
  },
  async booksPerTeacher(f) {
    const ft = (await f.fullTime()).length
    const n = (await f.pubsOfYear()).filter((p) => ['BOOK', 'CHAPTER', 'CONFERENCE'].includes(p.type)).length
    if (!ft) return null
    return { value: ratio(n, ft), detail: [D('booksChapters', n), D('fullTimeTeachers', ft)] }
  },
  async publications3y(f) {
    const pubs = (await f.pubs()).filter((p) => p.type !== 'PATENT')
    return { value: pubs.length, detail: [D('indexed', pubs.filter((p) => p.indexing?.some((i) => i === 'SCOPUS' || i === 'WOS')).length)] }
  },
  async citations3y(f) {
    const pubs = (await f.pubs()).filter((p) => p.type !== 'PATENT')
    return { value: pubs.reduce((n, p) => n + (p.citations ?? 0), 0), detail: [D('papers', pubs.length)] }
  },
  async patents(f) {
    return { value: (await f.pubs()).filter((p) => p.type === 'PATENT').length, detail: [] }
  },
  async phdAwarded(f) {
    const { from, to } = await f.range()
    return { value: (await f.scholars()).filter((s) => s.status === 'AWARDED' && s.awardedOn >= from && s.awardedOn <= to).length, detail: [] }
  },
  async phdScholars(f) {
    return { value: (await f.activeScholars()).length, detail: [] }
  },
  // library
  async ebooks() {
    return { value: await LibraryTitle.countDocuments({ type: 'EBOOK', active: true }), detail: [] }
  },
  async libraryBooksLakh(f) {
    const { from, to } = await f.range()
    const copies = await LibraryCopy.find({ acquiredOn: { $gte: from, $lte: to } }).select('price').lean()
    if (!copies.length) return null
    return { value: copies.reduce((n, c) => n + (c.price ?? 0), 0) / PAISE_PER_LAKH, detail: [D('copies', copies.length)] }
  },
  async libraryUsePerDay(f) {
    const { from, to } = await f.range()
    const loans = await LibraryLoan.find({ issuedOn: { $gte: from, $lte: to } }).select('issuedOn').lean()
    if (!loans.length) return null
    const days = new Set(loans.map((l) => l.issuedOn)).size
    return { value: ratio(loans.length, days), detail: [D('loans', loans.length), D('days', days)] }
  },
  // placements
  async placementPct(f) {
    const p = await f.placement()
    if (!p) return null
    const outgoing = await f.outgoing()
    if (!outgoing) return p.placed ? { value: null, detail: [D('placed', p.placed)] } : null
    return { value: pct(p.placed, outgoing), detail: [D('placed', p.placed), D('outgoing', outgoing)] }
  },
  async medianSalaryLakh(f) {
    const p = await f.placement()
    if (!p?.ctcs.length) return null
    const c = p.ctcs
    const mid = Math.floor(c.length / 2)
    const median = c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2
    return { value: median / PAISE_PER_LAKH, detail: [D('placed', p.placed)] }
  },
}

export const ACCR_AUTO_KEYS = Object.keys(CALC)

/**
 * The computed values of a framework's metrics for one assessment year: Map code → { value, detail } (only metrics with
 * an `auto` key; a calculation that fails is logged and left out — the metric can still be entered by hand).
 */
export async function computeMetrics(metrics, year) {
  const f = figures(year)
  const out = new Map()
  for (const m of metrics) {
    if (!m.auto || !CALC[m.auto]) continue
    try {
      const r = await CALC[m.auto](f)
      if (r) out.set(m.code, { value: accrRound(r.value, m.unit), detail: r.detail.map((d) => ({ ...d, value: typeof d.value === 'number' ? accrRound(d.value, 'pct') : d.value })) })
    } catch (err) {
      logger.warn({ err, metric: m.code }, 'accreditation metric could not be computed')
    }
  }
  return { values: out, range: await f.range() }
}
