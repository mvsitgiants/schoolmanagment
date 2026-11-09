import { attendancePct, pctOf, sectionLabel } from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Exam, ExamCandidate } from '../models/exams.js'
import { FeeInvoice } from '../models/fees.js'
import { Employee } from '../models/hrms.js'
import { Student, studentName } from '../models/students.js'
import { Branch, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { clean, oid } from '../platform/db.js'
import { institutionNow } from '../platform/time.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'

// Analytics (module `analytics`): management dashboards over what the other modules store —
// results (exams), attendance, fees, campuses. Nothing is written here. Every figure follows the
// caller's data scope for `analytics`: ALL → the institution · BRANCH → their campus (sections and
// fee records without a campus belong to the main campus) · CLASS / OWN → the sections they teach.

export const today = async () => (await institutionNow()).date
export const idStr = (v) => (v ? String(v) : null)

/** The main campus id (records without a campus belong to it). */
export async function mainBranchId() {
  return idStr((await Branch.findOne({ isDefault: true }).select('_id').lean())?._id)
}

/**
 * The caller's reach for analytics:
 *   { all: true }                                   — the whole institution
 *   { branchId, onMain, sectionIds }                — one campus
 *   { sectionIds }                                  — only the sections they teach
 * `sectionIds` are strings (null = every section).
 */
export async function analyticsScope(auth) {
  const scope = scopeOf(auth, 'analytics')
  if (scope === 'ALL' || (scope === 'BRANCH' && !auth.user?.branchId)) return { all: true, sectionIds: null }
  const sectionIds = await sectionsInScope(auth, 'analytics')
  if (scope === 'BRANCH') {
    const main = await mainBranchId()
    return { branchId: String(auth.user.branchId), onMain: String(auth.user.branchId) === main, sectionIds }
  }
  return { sectionIds: sectionIds ?? [] }
}

/** A filter on a record's `branchId` (campus scope), `sectionId` (class scope) or nothing. */
export function recordMatch(scope, { sectionField = 'sectionId' } = {}) {
  if (scope.all) return {}
  if (scope.branchId) return { branchId: scope.onMain ? { $in: [oid(scope.branchId), null] } : oid(scope.branchId) }
  return { [sectionField]: { $in: (scope.sectionIds ?? []).map(oid) } }
}

/** Sections of a year within the scope, with class and label, in class order. */
export async function scopedSections(scope, yearId) {
  const sections = await Section.find({ academicYearId: yearId, ...(scope.sectionIds && { _id: { $in: scope.sectionIds.map(oid) } }) })
    .select('classId name branchId').lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()).map((c) => [String(c._id), c]))
  return sections.filter((s) => classes.has(String(s.classId))).map((s) => {
    const c = classes.get(String(s.classId))
    return { ...s, cls: c, label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }) }
  }).sort((a, b) => (a.cls.order - b.cls.order) || a.name.localeCompare(b.name))
}

/** The years to pick from, newest first. */
export async function yearOptions() {
  return (await AcademicYear.find().select('name startDate endDate isCurrent').sort({ startDate: -1 }).lean()).map(clean)
}

/** Names, admission numbers and the class of students, by id. */
export async function studentCards(ids, sectionsById) {
  if (!ids.length) return new Map()
  const rows = await Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo sectionId classId gender').lean()
  return new Map(rows.map((s) => {
    const sec = sectionsById?.get(String(s.sectionId))
    return [String(s._id), { name: studentName(s), admissionNo: s.admissionNo ?? null, gender: s.gender ?? null, classShort: sec?.short ?? null, classId: idStr(s.classId ?? sec?.classId) }]
  }))
}

// ───────────────────────────────────────────────────────── campus comparison

const zero = () => ({ students: 0, sections: 0, staff: 0, att: { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 }, results: { n: 0, sumPct: 0, pass: 0 }, billed: 0, outstanding: 0, overdue: 0 })

/**
 * Each campus side by side for a year: students, staff, attendance %, average result % (every
 * published exam of the year), fee collection % and what is outstanding. A campus-scoped caller
 * sees only their campus.
 */
export async function campusAnalytics({ yearId }, auth) {
  const [scope, year, t, main] = await Promise.all([analyticsScope(auth), yearOrCurrent(yearId), today(), mainBranchId()])
  const branches = (await Branch.find({ active: { $ne: false } }).select('name code city isDefault').lean())
    .filter((b) => !scope.branchId || String(b._id) === scope.branchId)
    .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name))
  const sections = await scopedSections(scope, year._id)
  const campusOfSection = new Map(sections.map((s) => [String(s._id), idStr(s.branchId) ?? main]))
  const sectionIds = sections.map((s) => s._id)
  const campusOf = (sectionId, branchId) => campusOfSection.get(String(sectionId)) ?? idStr(branchId) ?? main
  const upto = t < year.endDate ? t : year.endDate
  const exams = await Exam.find({ academicYearId: year._id, status: 'PUBLISHED' }).select('_id').lean()

  const staffMatch = { status: 'ACTIVE', ...(scope.branchId && { branchId: scope.onMain ? { $in: [oid(scope.branchId), null] } : oid(scope.branchId) }) }
  const [students, employees, att, results, fees] = await Promise.all([
    Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: sectionIds } } }, { $group: { _id: { sectionId: '$sectionId', branchId: '$branchId' }, n: { $sum: 1 } } }]),
    Employee.aggregate([{ $match: staffMatch }, { $group: { _id: '$branchId', n: { $sum: 1 } } }]),
    AttendanceSheet.aggregate([
      { $match: { academicYearId: year._id, period: 0, sectionId: { $in: sectionIds }, date: { $lte: upto } } },
      { $group: { _id: '$sectionId', P: { $sum: '$counts.P' }, A: { $sum: '$counts.A' }, L: { $sum: '$counts.L' }, HD: { $sum: '$counts.HD' }, LV: { $sum: '$counts.LV' }, total: { $sum: '$counts.total' } } },
    ]),
    exams.length ? ExamCandidate.aggregate([
      { $match: { examId: { $in: exams.map((e) => e._id) }, sectionId: { $in: sectionIds }, result: { $in: ['PASS', 'FAIL'] } } },
      { $group: { _id: '$sectionId', n: { $sum: 1 }, sumPct: { $sum: { $ifNull: ['$pct', 0] } }, pass: { $sum: { $cond: [{ $eq: ['$result', 'PASS'] }, 1, 0] } } } },
    ]) : [],
    FeeInvoice.aggregate([
      { $match: { academicYearId: year._id, status: { $ne: 'CANCELLED' }, ...recordMatch(scope) } },
      { $group: { _id: { branchId: '$branchId', sectionId: '$sectionId' }, billed: { $sum: '$net' }, outstanding: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', t] }, '$balance', 0] } } } },
    ]),
  ])
  // staff: HR's employees; an institution not using HR yet counts its active sign-in accounts
  const staffSource = employees.length ? 'EMPLOYEES' : 'USERS'
  const staff = employees.length ? employees : await User.aggregate([{ $match: { active: true, ...(scope.branchId && { branchId: staffMatch.branchId }) } }, { $group: { _id: '$branchId', n: { $sum: 1 } } }])

  const acc = new Map(branches.map((b) => [String(b._id), zero()]))
  const at = (id) => acc.get(id ?? main)
  for (const s of sections) { const a = at(campusOfSection.get(String(s._id))); if (a) a.sections += 1 }
  for (const r of students) { const a = at(campusOf(r._id.sectionId, r._id.branchId)); if (a) a.students += r.n }
  for (const r of staff) { const a = at(idStr(r._id)); if (a) a.staff += r.n }
  for (const r of att) { const a = at(campusOf(r._id)); if (a) for (const k of Object.keys(a.att)) a.att[k] += r[k] ?? 0 }
  for (const r of results) { const a = at(campusOf(r._id)); if (a) { a.results.n += r.n; a.results.sumPct += r.sumPct; a.results.pass += r.pass } }
  for (const r of fees) { const a = at(idStr(r._id.branchId) ?? campusOf(r._id.sectionId)); if (a) { a.billed += r.billed; a.outstanding += r.outstanding; a.overdue += r.overdue } }

  const rows = branches.map((b) => {
    const a = acc.get(String(b._id))
    return {
      id: String(b._id), name: b.name, code: b.code, city: b.city ?? null, isDefault: !!b.isDefault,
      students: a.students, sections: a.sections, staff: a.staff,
      attendancePct: attendancePct(a.att), daysMarked: a.att.total,
      resultPct: a.results.n ? Math.round((a.results.sumPct / a.results.n) * 10) / 10 : null, passPct: pctOf(a.results.pass, a.results.n), assessed: a.results.n,
      billed: a.billed, collected: a.billed - a.outstanding, outstanding: a.outstanding, overdue: a.overdue, collectionPct: pctOf(a.billed - a.outstanding, a.billed),
      studentsPerStaff: a.staff ? Math.round((a.students / a.staff) * 10) / 10 : null,
    }
  })
  const sum = (k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  const tAtt = [...acc.values()].reduce((m, a) => { for (const k of Object.keys(m)) m[k] += a.att[k]; return m }, { P: 0, A: 0, L: 0, HD: 0, LV: 0, total: 0 })
  const tRes = [...acc.values()].reduce((m, a) => ({ n: m.n + a.results.n, sumPct: m.sumPct + a.results.sumPct, pass: m.pass + a.results.pass }), { n: 0, sumPct: 0, pass: 0 })
  return {
    year: { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate },
    years: await yearOptions(),
    examsPublished: exams.length, staffSource,
    campuses: rows,
    totals: {
      campuses: rows.length, students: sum('students'), staff: sum('staff'), sections: sum('sections'),
      attendancePct: attendancePct(tAtt), resultPct: tRes.n ? Math.round((tRes.sumPct / tRes.n) * 10) / 10 : null, passPct: pctOf(tRes.pass, tRes.n),
      billed: sum('billed'), collected: sum('collected'), outstanding: sum('outstanding'), overdue: sum('overdue'), collectionPct: pctOf(sum('collected'), sum('billed')),
    },
  }
}
