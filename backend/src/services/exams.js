import {
  EXAM_STATUS, RESULT_STATUS, STARTER_EXAM_TYPES, SUBJECT_TYPE_LABEL, attendancePct, checkMark, clashes, computeResult, countMarks, gradeFor, paperScore, rankBy, sectionLabel,
} from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, GradingScheme, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Exam, ExamCandidate, ExamPaper, ExamType, MarkSheet, newCandidateCode } from '../models/exams.js'
import { Tenant } from '../models/platform.js'
import { runAsSystem, runAsTenant } from '../platform/context.js'
import { holdOf, holdsOf, onHold } from './examHolds.js'
import { ExamSeatPlan } from '../models/examSeating.js'
import { hallAbsentees } from './examSeating.js'
import { Student, studentName } from '../models/students.js'
import { User } from '../models/tenant.js'
import { can, scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'
import { familyLink } from './familyLink.js'

// Exams & report cards (module `exams`). An exam belongs to a year and some classes; each class has
// a paper per subject (date, time, max / pass marks). Once scheduled, every student of those classes
// is a candidate (their hall ticket). Teachers enter marks per paper and section and lock the sheet
// when final; unlocking needs `exams.marks.unlock`. Publishing works out every candidate's result
// (total, %, grade from the grading scheme, rank in the section) and freezes the marks; sending the
// report cards tells each family. Which sections someone sees follows the role's data scope for
// `exams`; with the CLASS scope a teacher enters marks only for the subjects they teach (or any
// subject of a section they are class teacher of).

const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const today = async () => (await institutionNow()).date
const examSettings = async () => ({ roundMarks: true, showRank: false, lockAfterDays: 0, ...(await getSettings('exams')) })
const byRoll = { locale: 'en', numericOrdering: true }

async function examById(id) {
  if (!isOid(id)) throw notFound('Exam')
  const e = await Exam.findById(id).lean()
  if (!e) throw notFound('Exam')
  return e
}

/** Sections of the exam's classes in its year, limited to the caller's scope, with labels. */
async function examSections(exam, auth) {
  const [sections, classes, allowed] = await Promise.all([
    Section.find({ academicYearId: exam.academicYearId, classId: { $in: exam.classIds }, active: { $ne: false } }).sort({ name: 1 }).lean(),
    ClassLevel.find({ _id: { $in: exam.classIds } }).select('name code order gradingSchemeId').lean(),
    auth ? sectionsInScope(auth, 'exams') : null,
  ])
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  return sections
    .filter((s) => cls.has(String(s.classId)) && (!allowed || allowed.includes(String(s._id))))
    .sort((a, b) => (cls.get(String(a.classId)).order - cls.get(String(b.classId)).order) || a.name.localeCompare(b.name))
    .map((s) => ({ ...s, cls: cls.get(String(s.classId)), label: sectionLabel(cls.get(String(s.classId)), s), short: sectionLabel(cls.get(String(s.classId)), s, { short: true }) }))
}

async function sectionInExam(exam, sectionId, auth) {
  const sec = (await examSections(exam, auth)).find((s) => String(s._id) === String(sectionId))
  if (!sec) throw notFound('Section')
  return sec
}

/** May the caller enter marks of this subject for this section? (on top of the section being in scope) */
async function mayEnter(auth, section, subjectId) {
  if (!can(auth, 'exams.marks.create') && !can(auth, 'exams.marks.edit')) return false
  if (!['CLASS', 'DEPARTMENT', 'OWN'].includes(scopeOf(auth, 'exams'))) return true
  if (String(section.classTeacherId) === String(auth.userId)) return true
  const [alloc, user] = await Promise.all([
    TeacherAllocation.exists({ sectionId: section._id, subjectId, teacherId: auth.userId }),
    User.findById(auth.userId).select('sectionIds').lean(),
  ])
  return !!alloc || (user?.sectionIds ?? []).some((id) => String(id) === String(section._id))
}

/** The grading bands for a class in an exam: the exam's scheme, else the class's, else the default. */
async function bandsFor(exam) {
  const classes = await ClassLevel.find({ _id: { $in: exam.classIds } }).select('gradingSchemeId').lean()
  const ids = [exam.gradingSchemeId, ...classes.map((c) => c.gradingSchemeId)].filter(Boolean)
  const schemes = await GradingScheme.find({ $or: [{ _id: { $in: ids } }, { isDefault: true }] }).lean()
  const byId = new Map(schemes.map((s) => [String(s._id), s]))
  const fallback = schemes.find((s) => s.isDefault) ?? null
  const forClass = new Map(classes.map((c) => [String(c._id), byId.get(String(exam.gradingSchemeId)) ?? byId.get(String(c.gradingSchemeId)) ?? fallback]))
  return (classId) => forClass.get(String(classId)) ?? fallback
}

const paperDto = (p, subjects) => {
  const s = subjects.get(String(p.subjectId))
  return { ...clean(p), examId: String(p.examId), classId: String(p.classId), subjectId: String(p.subjectId), subject: s?.name ?? '?', subjectCode: s?.code ?? null }
}

async function papersOf(examId, classIds) {
  const papers = await ExamPaper.find({ examId, ...(classIds && { classId: { $in: classIds } }) }).sort({ date: 1, startTime: 1, order: 1 }).lean()
  const subjects = new Map((await Subject.find({ _id: { $in: papers.map((p) => p.subjectId) } }).select('name code type').lean()).map((s) => [String(s._id), s]))
  return papers.map((p) => paperDto(p, subjects))
}

// ───────────────────────────────────────────────────────── setup: exam types

/** Every new institution starts with the usual exam types. */
export async function ensureExamSetup() {
  if (await ExamType.exists({})) return
  await ExamType.insertMany(STARTER_EXAM_TYPES)
}

export async function listTypes() {
  await ensureExamSetup() // institutions made before the starter types existed get them now
  return clean(await ExamType.find().sort({ active: -1, name: 1 }).lean())
}

export async function saveType(id, input, req) {
  if (input.code && await ExamType.exists({ code: input.code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: `Another exam type uses ${input.code}` })
  const t = id ? await ExamType.findById(id) : new ExamType()
  if (!t) throw notFound('Exam type')
  Object.assign(t, input)
  await t.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'exams', entityType: 'exam_type', entityId: String(t._id), entityName: t.name, summary: `${id ? 'Updated' : 'Added'} exam type ${t.name}` }, req)
  return clean(t.toObject())
}

/** Delete an exam type that no exam uses yet; one already used stays (switch it off instead). */
export async function deleteType(id, req) {
  const t = isOid(id) ? await ExamType.findById(id) : null
  if (!t) throw notFound('Exam type')
  const used = await Exam.countDocuments({ examTypeId: t._id })
  if (used) throw conflict(`${used} exam${used === 1 ? ' uses' : 's use'} the type "${t.name}". Switch it off instead so it can't be picked again.`)
  await t.deleteOne()
  await audit({ action: 'DELETE', module: 'exams', entityType: 'exam_type', entityId: String(t._id), entityName: t.name, summary: `Deleted exam type ${t.name}` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── exams

/** A year's exams with how far each has got: papers set, mark sheets locked. */
export async function listExams({ yearId } = {}, auth) {
  const year = await yearOrCurrent(yearId)
  const [exams, types, classes] = await Promise.all([
    Exam.find({ academicYearId: year._id }).sort({ startDate: 1, createdAt: 1 }).lean(),
    ExamType.find().select('name code').lean(),
    ClassLevel.find().select('name code order').lean(),
  ])
  const type = new Map(types.map((t) => [String(t._id), t]))
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const ids = exams.map((e) => e._id)
  const [papers, sheets, sections] = await Promise.all([
    ExamPaper.aggregate([{ $match: { examId: { $in: ids } } }, { $group: { _id: { examId: '$examId', classId: '$classId' }, n: { $sum: 1 } } }]),
    MarkSheet.aggregate([{ $match: { examId: { $in: ids } } }, { $group: { _id: '$examId', locked: { $sum: { $cond: [{ $eq: ['$status', 'LOCKED'] }, 1, 0] } }, started: { $sum: 1 } } }]),
    Section.aggregate([{ $match: { academicYearId: year._id, active: { $ne: false } } }, { $group: { _id: '$classId', n: { $sum: 1 } } }]),
  ])
  const sectionsOf = new Map(sections.map((s) => [String(s._id), s.n]))
  const sheetStat = new Map(sheets.map((s) => [String(s._id), s]))
  const scope = auth ? await sectionsInScope(auth, 'exams') : null
  return {
    year: { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate, closed: !!year.closed, terms: year.terms ?? [] },
    exams: exams.map((e) => {
      const mine = papers.filter((p) => String(p._id.examId) === String(e._id))
      const expected = mine.reduce((n, p) => n + p.n * (sectionsOf.get(String(p._id.classId)) ?? 0), 0)
      return {
        ...clean(e), academicYearId: String(e.academicYearId), examTypeId: idStr(e.examTypeId), classIds: e.classIds.map(String), gradingSchemeId: idStr(e.gradingSchemeId),
        typeName: type.get(String(e.examTypeId))?.name ?? null, statusLabel: EXAM_STATUS[e.status]?.label,
        classes: e.classIds.map((id) => cls.get(String(id))).filter(Boolean).sort((a, b) => a.order - b.order).map((c) => ({ id: String(c._id), name: c.name, code: c.code })),
        papers: mine.reduce((n, p) => n + p.n, 0), sheetsExpected: expected, sheetsStarted: sheetStat.get(String(e._id))?.started ?? 0, sheetsLocked: sheetStat.get(String(e._id))?.locked ?? 0,
        limited: !!scope,
      }
    }),
  }
}

/** One exam: its classes with their papers, and the sections the caller may work with. */
export async function getExam(id, auth) {
  const e = await examById(id)
  const [papers, sections, classes] = await Promise.all([
    papersOf(e._id),
    examSections(e, auth),
    ClassLevel.find({ _id: { $in: e.classIds } }).select('name code order').sort({ order: 1 }).lean(),
  ])
  return {
    ...clean(e), academicYearId: String(e.academicYearId), examTypeId: idStr(e.examTypeId), classIds: e.classIds.map(String), gradingSchemeId: idStr(e.gradingSchemeId),
    statusLabel: EXAM_STATUS[e.status]?.label,
    classes: classes.map((c) => ({ id: String(c._id), name: c.name, code: c.code, papers: papers.filter((p) => p.classId === String(c._id)) })),
    sections: sections.map((s) => ({ id: String(s._id), classId: String(s.classId), label: s.label, short: s.short })),
  }
}

async function papersWithMarks(examId, filter = {}) {
  const sheets = await MarkSheet.find({ examId, 'entries.0': { $exists: true }, ...filter }).select('paperId').lean()
  return new Set(sheets.map((s) => String(s.paperId)))
}

export async function saveExam(id, input, req) {
  const before = id ? await examById(id) : null
  const year = await yearOrCurrent(before ? String(before.academicYearId) : input.academicYearId)
  if (year.closed) throw conflict(`${year.name} is closed.`)
  if (await Exam.exists({ academicYearId: year._id, name: input.name, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: `${year.name} already has an exam called ${input.name}` })
  const classCount = await ClassLevel.countDocuments({ _id: { $in: input.classIds } })
  if (classCount !== input.classIds.length) throw fieldsError({ classIds: 'Pick classes from the list' })
  if (input.examTypeId && !await ExamType.exists({ _id: input.examTypeId })) throw fieldsError({ examTypeId: 'Pick an exam type' })
  const exam = id ? await Exam.findById(id) : new Exam({ academicYearId: year._id, createdBy: req?.auth?.user?.name })
  if (!exam) throw notFound('Exam')
  if (exam.status === 'PUBLISHED') throw conflict('The results of this exam are published. Unpublish them to change the exam.')
  const dropped = exam.classIds.map(String).filter((c) => !input.classIds.includes(c))
  if (dropped.length) {
    const marked = await papersWithMarks(exam._id)
    const droppedPapers = await ExamPaper.find({ examId: exam._id, classId: { $in: dropped } }).select('_id').lean()
    if (droppedPapers.some((p) => marked.has(String(p._id)))) throw conflict('Marks have been entered for a class you took off. Keep the class, or clear its marks first.')
  }
  await withTransaction(async () => {
    Object.assign(exam, { name: input.name, examTypeId: input.examTypeId || undefined, term: input.term || undefined, classIds: input.classIds, gradingSchemeId: input.gradingSchemeId || undefined, instructions: input.instructions || undefined })
    await exam.save()
    if (dropped.length) {
      const gone = (await ExamPaper.find({ examId: exam._id, classId: { $in: dropped } }).select('_id').lean()).map((p) => p._id)
      await ExamPaper.deleteMany({ _id: { $in: gone } })
      await MarkSheet.deleteMany({ paperId: { $in: gone } })
    }
  })
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'exams', entityType: 'exam', entityId: String(exam._id), entityName: exam.name, summary: `${id ? 'Updated' : 'Added'} exam ${exam.name}` }, req)
  return getExam(exam._id, req?.auth)
}

export async function deleteExam(id, req) {
  const e = await examById(id)
  if (e.status === 'PUBLISHED') throw conflict('Results of this exam are published; it can’t be deleted.')
  if ((await papersWithMarks(e._id)).size) throw conflict('Marks have been entered for this exam, so it can’t be deleted.')
  await withTransaction(async () => {
    await Promise.all([ExamPaper.deleteMany({ examId: e._id }), MarkSheet.deleteMany({ examId: e._id }), ExamCandidate.deleteMany({ examId: e._id })])
    await Exam.deleteOne({ _id: e._id })
  })
  await audit({ action: 'DELETE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Deleted exam ${e.name}` }, req)
  return { deleted: true }
}

/** Papers to start a class's timetable from: the class's subjects, with the exam type's usual max marks. */
export async function suggestPapers(examId, classId) {
  const e = await examById(examId)
  if (!e.classIds.map(String).includes(String(classId))) throw notFound('Class')
  const [cls, type] = await Promise.all([ClassLevel.findById(classId).lean(), e.examTypeId ? ExamType.findById(e.examTypeId).lean() : null])
  let subjectIds = cls?.subjectIds ?? []
  if (!subjectIds.length) {
    const sections = await Section.find({ academicYearId: e.academicYearId, classId }).select('_id').lean()
    subjectIds = await TeacherAllocation.distinct('subjectId', { sectionId: { $in: sections.map((s) => s._id) } })
  }
  const subjects = await Subject.find({ _id: { $in: subjectIds }, active: true }).sort({ name: 1 }).lean()
  const max = type?.defaultMaxMarks ?? 100
  return subjects.map((s, i) => ({
    subjectId: String(s._id), subject: s.name, type: s.type, typeLabel: SUBJECT_TYPE_LABEL[s.type], gradeOnly: s.type === 'ACTIVITY',
    maxMarks: max, passMarks: Math.ceil(max * 0.33), countsInTotal: s.type !== 'ACTIVITY', order: i,
  }))
}

/** Replace a class's papers in an exam. Papers that already have marks can be changed but not removed. */
export async function savePapers(examId, classId, papers, req) {
  const e = await examById(examId)
  if (e.status === 'PUBLISHED') throw conflict('The results of this exam are published. Unpublish them to change the papers.')
  if (!e.classIds.map(String).includes(String(classId))) throw notFound('Class')
  const year = await AcademicYear.findById(e.academicYearId).lean()
  const errors = {}
  const seen = new Set()
  papers.forEach((p, i) => {
    if (seen.has(p.subjectId)) errors[`papers.${i}.subjectId`] = 'This subject is already in the list'
    seen.add(p.subjectId)
    if (!p.gradeOnly && !(p.maxMarks > 0)) errors[`papers.${i}.maxMarks`] = 'More than 0'
    if (!p.gradeOnly && p.passMarks > p.maxMarks) errors[`papers.${i}.passMarks`] = 'Can’t be more than the max marks'
    if (p.date && (p.date < year.startDate || p.date > year.endDate)) errors[`papers.${i}.date`] = `Inside ${year.name}`
    if (p.startTime && p.endTime && p.endTime <= p.startTime) errors[`papers.${i}.endTime`] = 'After the start time'
  })
  for (const [a, b] of clashes(papers)) errors[`papers.${b}.startTime`] = `Clashes with paper ${a + 1}`
  if (Object.keys(errors).length) throw fieldsError(errors)
  if (await Subject.countDocuments({ _id: { $in: [...seen] } }) !== seen.size) throw fieldsError({ papers: 'Pick subjects from the list' })

  const existing = await ExamPaper.find({ examId: e._id, classId }).lean()
  const marked = await papersWithMarks(e._id)
  const keep = new Set(papers.map((p) => p.subjectId))
  const removed = existing.filter((p) => !keep.has(String(p.subjectId)))
  if (removed.some((p) => marked.has(String(p._id)))) throw conflict('Marks have been entered for a paper you removed. Keep it, or clear its marks first.')
  await withTransaction(async () => {
    await ExamPaper.deleteMany({ _id: { $in: removed.map((p) => p._id) } })
    await MarkSheet.deleteMany({ paperId: { $in: removed.map((p) => p._id) } })
    await ExamPaper.bulkWrite(papers.map((p, i) => ({
      updateOne: {
        filter: { examId: e._id, classId, subjectId: p.subjectId },
        update: { $set: { date: p.date || undefined, startTime: p.startTime || undefined, endTime: p.endTime || undefined, maxMarks: p.gradeOnly ? 0 : p.maxMarks, passMarks: p.gradeOnly ? 0 : p.passMarks, gradeOnly: !!p.gradeOnly, countsInTotal: p.gradeOnly ? false : p.countsInTotal !== false, order: i } },
        upsert: true,
      },
    })))
    const dates = (await ExamPaper.find({ examId: e._id, date: { $exists: true, $ne: null } }).select('date').lean()).map((p) => p.date).sort()
    await Exam.updateOne({ _id: e._id }, { $set: { startDate: dates[0], endDate: dates.at(-1) } })
  })
  const cls = await ClassLevel.findById(classId).select('name').lean()
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Set ${papers.length} paper(s) of ${cls?.name} in ${e.name}` }, req)
  return getExam(e._id, req?.auth)
}

/** Every active student of the exam's classes becomes a candidate (idempotent; new admissions join). */
async function ensureCandidates(exam) {
  const sections = await examSections(exam, null)
  const students = await Student.find({ sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' }).select('sectionId rollNo').lean()
  const classOf = new Map(sections.map((s) => [String(s._id), s.classId]))
  if (!students.length) return 0
  await ExamCandidate.bulkWrite(students.map((s) => ({
    updateOne: { filter: { examId: exam._id, studentId: s._id }, update: { $set: { sectionId: s.sectionId, classId: classOf.get(String(s.sectionId)), rollNo: s.rollNo } }, upsert: true },
  })))
  return students.length
}

/** Publish the timetable: every class needs papers, every paper a date. Students become candidates. */
export async function scheduleExam(id, auth, req) {
  const e = await examById(id)
  if (e.status !== 'DRAFT') throw conflict('This exam is already scheduled.')
  const papers = await ExamPaper.find({ examId: e._id }).lean()
  const without = e.classIds.filter((c) => !papers.some((p) => String(p.classId) === String(c)))
  if (without.length) {
    const names = (await ClassLevel.find({ _id: { $in: without } }).select('name').lean()).map((c) => c.name)
    throw conflict(`Add the papers of ${names.join(', ')} first.`)
  }
  if (papers.some((p) => !p.date)) throw conflict('Give every paper a date first.')
  const candidates = await ensureCandidates(e)
  await Exam.updateOne({ _id: e._id }, { $set: { status: 'SCHEDULED', scheduledAt: new Date(), scheduledBy: auth.user?.name } })
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Scheduled ${e.name} (${papers.length} papers, ${candidates} students)` }, req)
  return getExam(e._id, auth)
}

/** Back to set-up, while no marks have been entered. */
export async function unscheduleExam(id, auth, req) {
  const e = await examById(id)
  if (e.status !== 'SCHEDULED') throw conflict('Only a scheduled exam can go back to set-up.')
  if ((await papersWithMarks(e._id)).size) throw conflict('Marks have been entered, so the exam stays scheduled.')
  await Exam.updateOne({ _id: e._id }, { $set: { status: 'DRAFT' } })
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Took ${e.name} back to set-up` }, req)
  return getExam(e._id, auth)
}

// ───────────────────────────────────────────────────────── hall tickets

export async function listCandidates(examId, sectionId, auth) {
  const e = await examById(examId)
  if (e.status === 'DRAFT') throw conflict('Schedule the exam first; hall tickets come from its timetable.')
  const sec = await sectionInExam(e, sectionId, auth)
  await ensureCandidates(e)
  const rows = await ExamCandidate.find({ examId: e._id, sectionId: sec._id }).lean()
  const holds = await holdsOf(e, rows)
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName admissionNo rollNo status').lean()).map((s) => [String(s._id), s]))
  return rows
    .map((r) => {
      const s = students.get(String(r.studentId))
      return {
        id: String(r._id), studentId: String(r.studentId), name: s ? studentName(s) : '?', admissionNo: s?.admissionNo, rollNo: s?.rollNo ?? r.rollNo ?? null, studentStatus: s?.status,
        total: r.total ?? null, max: r.max ?? null, pct: r.pct ?? null, grade: r.grade ?? null, rank: r.rank ?? null, result: r.result ?? null,
        resultLabel: RESULT_STATUS[r.result]?.label ?? null, remark: r.remark ?? '', remarkBy: r.remarkBy ?? null, notifiedAt: r.notifiedAt ?? null,
        hold: holds.get(String(r._id)) ?? null,
      }
    })
    .sort((a, b) => String(a.rollNo ?? '').localeCompare(String(b.rollNo ?? ''), 'en', { numeric: true }) || a.name.localeCompare(b.name))
}

export async function candidateInScope(id, auth) {
  if (!isOid(id)) throw notFound('Student')
  const c = await ExamCandidate.findById(id).lean()
  if (!c) throw notFound('Student')
  const allowed = await sectionsInScope(auth, 'exams')
  if (allowed && !allowed.includes(String(c.sectionId))) throw notFound('Student')
  if (!c.verifyCode) { // candidates from before check codes get one the first time their hall ticket or report card prints
    c.verifyCode = newCandidateCode()
    await ExamCandidate.updateOne({ _id: c._id }, { $set: { verifyCode: c.verifyCode } })
  }
  return c
}

export async function hallTicketData(candidateId, auth, { ignoreHold = false } = {}) {
  const c = await candidateInScope(candidateId, auth)
  if (!ignoreHold && (await holdOf(c)).admitCard.held) throw onHold('admitCard')
  const [exam, student, section] = await Promise.all([Exam.findById(c.examId).lean(), Student.findById(c.studentId).lean(), Section.findById(c.sectionId).lean()])
  const cls = await ClassLevel.findById(c.classId).lean()
  const [papers, year] = await Promise.all([papersOf(c.examId, [c.classId]), AcademicYear.findById(exam.academicYearId).select('name').lean()])
  // the room and seat of each paper, from the published seating plans of its session (date + start time)
  const plans = await ExamSeatPlan.find({ examId: c.examId, status: 'PUBLISHED', 'seats.studentId': c.studentId }).select('date startTime rooms.roomId rooms.code rooms.name seats').lean()
  const seatOf = new Map(plans.map((pl) => {
    const s = pl.seats.find((x) => String(x.studentId) === String(c.studentId))
    const room = pl.rooms.find((r) => String(r.roomId) === String(s?.roomId))
    return [`${pl.date}|${pl.startTime}`, s && { room: room?.code || room?.name || '', seat: s.seat }]
  }))
  const seated = papers.map((p) => ({ ...p, seat: seatOf.get(`${p.date}|${p.startTime}`) ?? null }))
  // the admit card's photo box and class teacher (photo is left out of ordinary reads)
  const [photo, teacher] = await Promise.all([
    Student.findById(c.studentId).select('+photo').lean().then((x) => x?.photo || null),
    section?.classTeacherId ? User.findById(section.classTeacherId).select('name').lean() : null,
  ])
  return { candidate: c, exam, year, student: { ...student, photo }, place: sectionLabel(cls, section), papers: seated, classTeacher: teacher?.name ?? null }
}

// ───────────────────────────────────────────────────────── marks entry

const sheetState = (sheet) => (!sheet ? 'NOT_STARTED' : sheet.status === 'LOCKED' ? 'LOCKED' : 'OPEN')

/** The mark sheets the caller may fill for an exam: every paper × section in scope they teach. */
export async function marksBoard(examId, auth) {
  const e = await examById(examId)
  if (e.status === 'DRAFT') throw conflict('Schedule the exam first.')
  const [sections, papers] = await Promise.all([examSections(e, auth), papersOf(e._id)])
  const [sheets, strength] = await Promise.all([
    MarkSheet.find({ examId: e._id, sectionId: { $in: sections.map((s) => s._id) } }).select('paperId sectionId status entries enteredBy enteredAt').lean(),
    Student.aggregate([{ $match: { sectionId: { $in: sections.map((s) => s._id) }, status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
  ])
  const sheetOf = new Map(sheets.map((s) => [`${s.paperId}:${s.sectionId}`, s]))
  const size = new Map(strength.map((s) => [String(s._id), s.n]))
  const rows = []
  for (const sec of sections) {
    for (const p of papers.filter((x) => x.classId === String(sec.classId))) {
      if (!await mayEnter(auth, sec, p.subjectId) && !can(auth, 'exams.results.view')) continue
      const sh = sheetOf.get(`${p.id}:${sec._id}`)
      rows.push({
        key: `${p.id}:${sec._id}`, paperId: p.id, sectionId: String(sec._id), section: sec.label, sectionShort: sec.short, subject: p.subject, date: p.date ?? null,
        maxMarks: p.maxMarks, gradeOnly: !!p.gradeOnly, status: sheetState(sh), entered: (sh?.entries ?? []).filter((x) => x.marks !== null || x.absent || x.exempt || x.grade).length,
        strength: size.get(String(sec._id)) ?? 0, enteredBy: sh?.enteredBy ?? null, enteredAt: sh?.enteredAt ?? null,
      })
    }
  }
  return { exam: { id: String(e._id), name: e.name, status: e.status }, sheets: rows }
}

async function sheetContext(paperId, sectionId, auth) {
  if (!isOid(paperId)) throw notFound('Paper')
  const paper = await ExamPaper.findById(paperId).lean()
  if (!paper) throw notFound('Paper')
  const exam = await examById(paper.examId)
  const sec = await sectionInExam(exam, sectionId, auth)
  if (String(sec.classId) !== String(paper.classId)) throw notFound('Section')
  const subject = await Subject.findById(paper.subjectId).select('name code').lean()
  return { paper, exam, sec, subject }
}

/** What stops the caller changing this sheet, or null. */
async function editBlock({ paper, exam, sec }, sheet, auth) {
  if (exam.status === 'PUBLISHED') return 'PUBLISHED'
  if (exam.status !== 'SCHEDULED') return 'NOT_SCHEDULED'
  if (sheet?.status === 'LOCKED') return 'LOCKED'
  if (!await mayEnter(auth, sec, paper.subjectId)) return 'NO_PERMISSION'
  const cfg = await examSettings()
  const days = Number(cfg.lockAfterDays) || 0
  if (days && paper.date && !can(auth, 'exams.marks.unlock')) {
    const last = new Date(Date.parse(`${paper.date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10)
    if (await today() > last) return 'TOO_LATE'
  }
  return null
}

export async function getMarkSheet({ paperId, sectionId }, auth) {
  const ctx = await sheetContext(paperId, sectionId, auth)
  const { paper, exam, sec, subject } = ctx
  const [sheet, students] = await Promise.all([
    MarkSheet.findOne({ paperId: paper._id, sectionId: sec._id }).lean(),
    Student.find({ sectionId: sec._id, status: 'ACTIVE' }).collation(byRoll).sort({ rollNo: 1, firstName: 1 }).select('firstName middleName lastName admissionNo rollNo').lean(),
  ])
  const saved = new Map((sheet?.entries ?? []).map((x) => [String(x.studentId), x]))
  const block = await editBlock(ctx, sheet, auth)
  // absent in the exam hall (Seating & invigilation): starts as absent until marks are saved, and is flagged
  const hall = await hallAbsentees(exam._id, paper.date, paper.startTime)
  return {
    exam: { id: String(exam._id), name: exam.name, status: exam.status },
    paper: { id: String(paper._id), subject: subject?.name ?? '?', date: paper.date ?? null, maxMarks: paper.maxMarks, passMarks: paper.passMarks, gradeOnly: !!paper.gradeOnly },
    section: { id: String(sec._id), label: sec.label },
    status: sheetState(sheet), enteredBy: sheet?.enteredBy ?? null, enteredAt: sheet?.enteredAt ?? null, lockedBy: sheet?.lockedBy ?? null, lockedAt: sheet?.lockedAt ?? null,
    canEdit: !block, blockedBy: block, canLock: !block && sheet?.status !== 'LOCKED', canUnlock: sheet?.status === 'LOCKED' && exam.status === 'SCHEDULED' && can(auth, 'exams.marks.unlock'),
    students: students.map((s) => {
      const x = saved.get(String(s._id))
      const hallAbsent = hall.has(String(s._id))
      return { id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null, marks: x?.marks ?? null, grade: x?.grade ?? '', absent: x ? !!x.absent : hallAbsent, exempt: !!x?.exempt, hallAbsent }
    }),
  }
}

export async function saveMarkSheet({ paperId, sectionId, entries }, auth, req) {
  const ctx = await sheetContext(paperId, sectionId, auth)
  const { paper, exam, sec, subject } = ctx
  const sheet = await MarkSheet.findOne({ paperId: paper._id, sectionId: sec._id })
  const block = await editBlock(ctx, sheet, auth)
  if (block === 'LOCKED') throw conflict('These marks are locked. Ask someone who can unlock them.')
  if (block === 'PUBLISHED') throw conflict('The results of this exam are published.')
  if (block === 'TOO_LATE') throw conflict('Marks entry for this paper has closed. Ask someone who can unlock marks.')
  if (block) throw forbidden('You can’t enter marks for this paper.')
  const roster = new Set((await Student.find({ sectionId: sec._id, status: 'ACTIVE' }).select('_id').lean()).map((s) => String(s._id)))
  const errors = {}
  entries.forEach((x, i) => {
    if (!roster.has(x.studentId)) errors[`entries.${i}.studentId`] = 'Not in this section'
    const problem = checkMark(x, paper)
    if (problem) errors[`entries.${i}.marks`] = problem
  })
  if (Object.keys(errors).length) throw fieldsError(errors, 'Some marks need fixing.')
  const rows = entries.map((x) => ({
    studentId: x.studentId, absent: !!x.absent, exempt: !!x.exempt,
    marks: x.absent || x.exempt || paper.gradeOnly || x.marks === null || x.marks === undefined || x.marks === '' ? null : Number(x.marks),
    grade: paper.gradeOnly && !x.absent && !x.exempt ? (String(x.grade ?? '').trim().toUpperCase() || undefined) : undefined,
  }))
  const doc = sheet ?? new MarkSheet({ examId: exam._id, paperId: paper._id, sectionId: sec._id })
  Object.assign(doc, { entries: rows, enteredBy: auth.user?.name, enteredById: auth.userId, enteredAt: new Date() })
  await doc.save()
  await audit({ action: sheet ? 'UPDATE' : 'CREATE', module: 'exams', entityType: 'mark_sheet', entityId: String(doc._id), entityName: `${exam.name} · ${subject?.name} · ${sec.short}`, summary: `Entered ${subject?.name} marks of ${sec.short} for ${exam.name}` }, req)
  return getMarkSheet({ paperId, sectionId }, auth)
}

/** Lock a sheet when every student has marks (or is marked absent / not taking the subject). */
export async function lockMarkSheet({ paperId, sectionId }, auth, req) {
  const ctx = await sheetContext(paperId, sectionId, auth)
  const { paper, exam, sec, subject } = ctx
  const sheet = await MarkSheet.findOne({ paperId: paper._id, sectionId: sec._id })
  if (!sheet) throw conflict('Enter the marks first.')
  const block = await editBlock(ctx, sheet, auth)
  if (block === 'LOCKED') throw conflict('Already locked.')
  if (block && block !== 'TOO_LATE') throw forbidden('You can’t lock these marks.')
  const students = await Student.find({ sectionId: sec._id, status: 'ACTIVE' }).select('_id').lean()
  const have = new Map(sheet.entries.map((x) => [String(x.studentId), x]))
  const blank = students.filter((s) => {
    const x = have.get(String(s._id))
    return !x || (!x.absent && !x.exempt && (paper.gradeOnly ? !x.grade : x.marks === null || x.marks === undefined))
  }).length
  if (blank) throw conflict(`${blank} student${blank === 1 ? ' has' : 's have'} no marks yet. Enter them, or mark them absent.`)
  Object.assign(sheet, { status: 'LOCKED', lockedBy: auth.user?.name, lockedAt: new Date() })
  await sheet.save()
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'mark_sheet', entityId: String(sheet._id), entityName: `${exam.name} · ${subject?.name} · ${sec.short}`, summary: `Locked ${subject?.name} marks of ${sec.short} for ${exam.name}` }, req)
  return getMarkSheet({ paperId, sectionId }, auth)
}

export async function unlockMarkSheet({ paperId, sectionId, reason }, auth, req) {
  const { paper, exam, sec, subject } = await sheetContext(paperId, sectionId, auth)
  if (exam.status === 'PUBLISHED') throw conflict('The results are published. Unpublish them before changing marks.')
  const sheet = await MarkSheet.findOne({ paperId: paper._id, sectionId: sec._id })
  if (sheet?.status !== 'LOCKED') throw conflict('These marks are not locked.')
  Object.assign(sheet, { status: 'OPEN', unlockedBy: auth.user?.name, unlockedAt: new Date(), unlockReason: reason })
  await sheet.save()
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'mark_sheet', entityId: String(sheet._id), entityName: `${exam.name} · ${subject?.name} · ${sec.short}`, summary: `Unlocked ${subject?.name} marks of ${sec.short} for ${exam.name}: ${reason}` }, req)
  return getMarkSheet({ paperId, sectionId }, auth)
}

// ───────────────────────────────────────────────────────── results

/**
 * Work out (and store) each candidate's result in the given sections: total, %, grade, PASS / FAIL /
 * INCOMPLETE, and rank in the section (on percentage). Returns the rows with each paper's entry.
 */
async function computeSections(exam, sections) {
  const cfg = await examSettings()
  const bandsOf = await bandsFor(exam)
  const papers = await papersOf(exam._id)
  const sheets = await MarkSheet.find({ examId: exam._id, sectionId: { $in: sections.map((s) => s._id) } }).lean()
  const candidates = await ExamCandidate.find({ examId: exam._id, sectionId: { $in: sections.map((s) => s._id) } }).lean()
  const entry = new Map()
  for (const sh of sheets) for (const x of sh.entries) entry.set(`${sh.paperId}:${x.studentId}`, x)
  const out = []
  for (const sec of sections) {
    const mine = papers.filter((p) => p.classId === String(sec.classId))
    const bands = bandsOf(sec.classId)?.bands ?? []
    const rows = candidates.filter((c) => String(c.sectionId) === String(sec._id)).map((c) => {
      const byPaper = Object.fromEntries(mine.map((p) => [p.id, entry.get(`${p.id}:${c.studentId}`)]).filter(([, x]) => x))
      const r = computeResult(mine, byPaper, { round: cfg.roundMarks !== false })
      return { c, byPaper, ...r, grade: r.pct === null ? null : gradeFor(bands, r.pct)?.grade ?? null }
    })
    const ranks = rankBy(rows.map((r) => ({ pct: r.result === 'INCOMPLETE' ? null : r.pct })), 'pct')
    rows.forEach((r, i) => { r.rank = ranks[i] })
    if (rows.length) {
      await ExamCandidate.bulkWrite(rows.map((r) => ({
        updateOne: {
          filter: { _id: r.c._id },
          update: { $set: { total: r.total, max: r.max, pct: r.pct, grade: r.grade, rank: r.rank, result: r.result, failedSubjects: r.failed.map((id) => mine.find((p) => p.id === id)?.subject ?? '?'), computedAt: new Date() } },
        },
      })))
    }
    out.push({ sec, papers: mine, rows, bands })
  }
  return out
}

/** One section's result sheet: a column per paper, a row per student, and a summary. */
export async function listResults(examId, sectionId, auth) {
  const e = await examById(examId)
  if (e.status === 'DRAFT') throw conflict('Schedule the exam first.')
  const sec = await sectionInExam(e, sectionId, auth)
  await ensureCandidates(e)
  const [{ papers, rows, bands }] = e.status === 'PUBLISHED'
    ? await storedSection(e, sec)
    : await computeSections(e, [sec])
  const [students, sheets] = await Promise.all([
    Student.find({ _id: { $in: rows.map((r) => r.c.studentId) } }).select('firstName middleName lastName admissionNo rollNo').lean(),
    MarkSheet.find({ examId: e._id, sectionId: sec._id }).select('paperId status').lean(),
  ])
  const st = new Map(students.map((s) => [String(s._id), s]))
  const locked = new Set(sheets.filter((s) => s.status === 'LOCKED').map((s) => String(s.paperId)))
  const list = rows.map((r) => {
    const s = st.get(String(r.c.studentId))
    return {
      candidateId: String(r.c._id), studentId: String(r.c.studentId), name: s ? studentName(s) : '?', admissionNo: s?.admissionNo, rollNo: s?.rollNo ?? r.c.rollNo ?? null,
      marks: Object.fromEntries(papers.map((p) => {
        const x = r.byPaper[p.id]
        const sc = paperScore(x, p)
        return [p.id, x ? { marks: x.marks ?? null, grade: p.gradeOnly ? x.grade ?? null : (x.marks !== null && p.maxMarks ? gradeFor(bands, (x.marks / p.maxMarks) * 100)?.grade ?? null : null), absent: !!x.absent, exempt: !!x.exempt, pass: sc.pass } : null]
      })),
      total: r.total, max: r.max, pct: r.pct, grade: r.grade, rank: r.rank, result: r.result,
    }
  }).sort((a, b) => String(a.rollNo ?? '').localeCompare(String(b.rollNo ?? ''), 'en', { numeric: true }) || a.name.localeCompare(b.name))
  const done = list.filter((r) => r.result !== 'INCOMPLETE')
  return {
    exam: { id: String(e._id), name: e.name, status: e.status, publishedAt: e.publishedAt ?? null, publishedBy: e.publishedBy ?? null },
    section: { id: String(sec._id), label: sec.label },
    papers: papers.map((p) => ({ id: p.id, subject: p.subject, maxMarks: p.maxMarks, passMarks: p.passMarks, gradeOnly: !!p.gradeOnly, locked: locked.has(p.id) })),
    rows: list,
    summary: {
      students: list.length, passed: done.filter((r) => r.result === 'PASS').length, failed: done.filter((r) => r.result === 'FAIL').length, incomplete: list.length - done.length,
      highest: done.length ? Math.max(...done.map((r) => r.pct ?? 0)) : null,
      average: done.length ? Math.round((done.reduce((n, r) => n + (r.pct ?? 0), 0) / done.length) * 100) / 100 : null,
      sheetsLocked: locked.size, sheetsTotal: papers.length,
    },
  }
}

/** A published section: the stored results (marks are frozen, nothing to work out). */
async function storedSection(exam, sec) {
  const bandsOf = await bandsFor(exam)
  const papers = (await papersOf(exam._id)).filter((p) => p.classId === String(sec.classId))
  const [sheets, candidates] = await Promise.all([MarkSheet.find({ examId: exam._id, sectionId: sec._id }).lean(), ExamCandidate.find({ examId: exam._id, sectionId: sec._id }).lean()])
  const entry = new Map()
  for (const sh of sheets) for (const x of sh.entries) entry.set(`${sh.paperId}:${x.studentId}`, x)
  const rows = candidates.map((c) => ({
    c, byPaper: Object.fromEntries(papers.map((p) => [p.id, entry.get(`${p.id}:${c.studentId}`)]).filter(([, x]) => x)),
    total: c.total ?? null, max: c.max ?? null, pct: c.pct ?? null, grade: c.grade ?? null, rank: c.rank ?? null, result: c.result ?? 'INCOMPLETE',
  }))
  return [{ sec, papers, rows, bands: bandsOf(sec.classId)?.bands ?? [] }]
}

/** Publish: every mark sheet of every section locked, then the results are worked out and frozen. */
export async function publishResults(examId, auth, req) {
  const e = await examById(examId)
  if (e.status === 'PUBLISHED') throw conflict('Already published.')
  if (e.status !== 'SCHEDULED') throw conflict('Schedule the exam first.')
  await ensureCandidates(e)
  const sections = await examSections(e, null)
  const papers = await ExamPaper.find({ examId: e._id }).select('classId').lean()
  const withStudents = new Set((await ExamCandidate.distinct('sectionId', { examId: e._id })).map(String))
  const expected = sections.filter((s) => withStudents.has(String(s._id))).reduce((n, s) => n + papers.filter((p) => String(p.classId) === String(s.classId)).length, 0)
  const locked = await MarkSheet.countDocuments({ examId: e._id, status: 'LOCKED' })
  if (locked < expected) throw conflict(`${expected - locked} mark sheet(s) are not locked yet. Every sheet must be locked before the results are published.`)
  const computed = await computeSections(e, sections)
  await Exam.updateOne({ _id: e._id }, { $set: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: auth.user?.name } })
  const students = computed.reduce((n, s) => n + s.rows.length, 0)
  await audit({ action: 'APPROVE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Published the results of ${e.name} (${students} students)` }, req)
  return { published: true, students }
}

export async function unpublishResults(examId, auth, req) {
  const e = await examById(examId)
  if (e.status !== 'PUBLISHED') throw conflict('The results are not published.')
  await Exam.updateOne({ _id: e._id }, { $set: { status: 'SCHEDULED' }, $unset: { publishedAt: 1, publishedBy: 1 } })
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Unpublished the results of ${e.name}` }, req)
  return { published: false }
}

// ───────────────────────────────────────────────────────── report cards

/** The class teacher's remark on each report card of a section. */
export async function saveRemarks(examId, sectionId, remarks, auth, req) {
  const e = await examById(examId)
  const sec = await sectionInExam(e, sectionId, auth)
  const ids = remarks.map((r) => r.candidateId)
  const found = await ExamCandidate.countDocuments({ _id: { $in: ids }, examId: e._id, sectionId: sec._id })
  if (found !== new Set(ids).size) throw badRequest('Some students are not in this section.')
  await ExamCandidate.bulkWrite(remarks.map((r) => ({ updateOne: { filter: { _id: r.candidateId }, update: r.remark ? { $set: { remark: r.remark, remarkBy: auth.user?.name } } : { $unset: { remark: 1, remarkBy: 1 } } } })))
  await audit({ action: 'UPDATE', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Wrote ${remarks.filter((r) => r.remark).length} report card remark(s) for ${sec.short}` }, req)
  return listCandidates(examId, sectionId, auth)
}

/** Tell each family their child's report card is ready (Notification rules › Results published). */
export async function sendReportCards(examId, { sectionId, resend = false }, auth, req) {
  const e = await examById(examId)
  if (e.status !== 'PUBLISHED') throw conflict('Publish the results first.')
  const sections = sectionId ? [await sectionInExam(e, sectionId, auth)] : await examSections(e, auth)
  const all = await ExamCandidate.find({ examId: e._id, sectionId: { $in: sections.map((s) => s._id) }, ...(!resend && { notifiedAt: null }) }).lean()
  const holds = await holdsOf(e, all)
  const rows = all.filter((r) => !holds.get(String(r._id))?.result.held)
  const held = all.length - rows.length
  const active = new Set((await Student.find({ _id: { $in: rows.map((r) => r.studentId) }, status: 'ACTIVE' }).select('_id').lean()).map((s) => String(s._id)))
  const label = new Map(sections.map((s) => [String(s._id), s.short]))
  let sent = 0
  const link = await familyLink('results')
  for (const r of rows) {
    if (!active.has(String(r.studentId))) continue
    await emit('exams.results_published', { studentId: String(r.studentId), entity: { type: 'exam_candidate', id: r._id }, data: { student: { class: label.get(String(r.sectionId)) ?? '' }, exam: { name: e.name }, result: { link } } })
    sent++
  }
  if (rows.length) await ExamCandidate.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { notifiedAt: new Date() } })
  await audit({ action: 'SEND', module: 'exams', entityType: 'exam', entityId: String(e._id), entityName: e.name, summary: `Sent ${sent} report card(s) of ${e.name} to families${held ? ` (${held} on hold, not sent)` : ''}` }, req)
  return { sent, held }
}

/** Everything a report card prints: marks per subject, co-scholastic grades, attendance, remark. */
export async function reportCardData(candidateId, auth) {
  const c = await candidateInScope(candidateId, auth)
  if ((await holdOf(c)).result.held) throw onHold('result')
  const exam = await Exam.findById(c.examId).lean()
  const [student, section, cls, year, cfg] = await Promise.all([
    Student.findById(c.studentId).lean(), Section.findById(c.sectionId).lean(), ClassLevel.findById(c.classId).lean(),
    AcademicYear.findById(exam.academicYearId).lean(), examSettings(),
  ])
  if (exam.status !== 'PUBLISHED') await computeSections(exam, [{ ...section, classId: c.classId }])
  const fresh = await ExamCandidate.findById(c._id).lean()
  const bands = (await bandsFor(exam))(c.classId)
  const papers = await papersOf(exam._id, [c.classId])
  const sheets = await MarkSheet.find({ examId: exam._id, sectionId: c.sectionId }).lean()
  const entry = new Map()
  for (const sh of sheets) for (const x of sh.entries) if (String(x.studentId) === String(c.studentId)) entry.set(String(sh.paperId), x)
  const to = exam.endDate && exam.endDate < year.endDate ? exam.endDate : year.endDate
  const att = await AttendanceSheet.aggregate([
    { $match: { sectionId: c.sectionId, period: 0, date: { $gte: year.startDate, $lte: to } } },
    { $unwind: '$entries' }, { $match: { 'entries.studentId': c.studentId } },
    { $group: { _id: '$entries.status', n: { $sum: 1 } } },
  ])
  const counts = countMarks(att.flatMap((a) => Array(a.n).fill({ status: a._id })))
  // the printed card's heading and signature line: the kind of exam (Half-yearly …) and the class teacher's name
  const [examType, teacher] = await Promise.all([
    exam.examTypeId ? ExamType.findById(exam.examTypeId).select('name code').lean() : null,
    section?.classTeacherId ? User.findById(section.classTeacherId).select('name').lean() : null,
  ])
  return { candidate: fresh, exam, year, student, place: sectionLabel(cls, section), papers, entry, bands, attendance: { ...counts, pct: attendancePct(counts) }, showRank: !!cfg.showRank, examType, classTeacher: teacher?.name ?? null }
}

// ───────────────────────────────────────────────────────── print sample helpers

export const latestCandidate = async (filter = {}) => (await ExamCandidate.findOne(filter).sort({ updatedAt: -1 }).select('_id').lean())?._id

/**
 * The QR on a hall ticket and a report card (/verify/exam/<code>), no sign-in: is this the school's own document —
 * the student, the exam, the class; and once results are published, the result it states (% · grade · pass).
 */
export async function verifyExamCode(code) {
  const want = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{12}$/.test(want)) return { found: false }
  return runAsSystem(async () => {
    const c = await ExamCandidate.findOne({ verifyCode: want }).setOptions({ allTenants: true }).lean()
    if (!c) return { found: false }
    const [exam, student, section, cls, t] = await Promise.all([
      Exam.findById(c.examId).setOptions({ allTenants: true }).select('name status startDate endDate').lean(),
      Student.findById(c.studentId).setOptions({ allTenants: true }).select('firstName middleName lastName admissionNo').lean(),
      Section.findById(c.sectionId).setOptions({ allTenants: true }).lean(),
      ClassLevel.findById(c.classId).setOptions({ allTenants: true }).select('name code').lean(),
      Tenant.findById(c.tenantId).select('name profile.city').lean(),
    ])
    const resultHeld = exam?.status === 'PUBLISHED' ? await runAsTenant(String(c.tenantId), async () => (await holdOf(c, await Exam.findById(c.examId).select('academicYearId').lean())).result.held) : false
    const published = exam?.status === 'PUBLISHED' && c.computedAt && !resultHeld
    return {
      held: !!resultHeld,
      found: true, exam: { name: exam?.name ?? '', startDate: exam?.startDate ?? null, endDate: exam?.endDate ?? null }, published: !!published,
      student: { name: student ? studentName(student) : '', admissionNo: student?.admissionNo ?? null, class: section ? sectionLabel(cls, section) : null },
      result: published ? { pct: c.pct ?? null, grade: c.grade ?? null, result: c.result ?? null, total: c.total ?? null, max: c.max ?? null } : null,
      institution: { name: t?.name ?? null, city: t?.profile?.city ?? null },
    }
  })
}

/** For the app's Scan: a hall ticket or report card scanned at the exam door — the student and today's room and seat. */
export async function candidateAtDoor(code, auth) {
  const c = await ExamCandidate.findOne({ verifyCode: String(code).toUpperCase() }).lean()
  if (!c) return null
  const allowed = await sectionsInScope(auth, 'exams')
  if (allowed && !allowed.includes(String(c.sectionId))) return null
  const d = await hallTicketData(c._id, auth, { ignoreHold: true })
  const today = (await institutionNow()).date
  return {
    admitCardHeld: (await holdOf(c)).admitCard.held,
    candidateId: String(c._id), studentId: String(c.studentId), examId: String(c.examId), exam: d.exam.name, examStatus: d.exam.status, student: studentName(d.student), class: d.place,
    today: d.papers.filter((p) => p.date === today).map((p) => ({ subject: p.subject, startTime: p.startTime, endTime: p.endTime, room: p.seat?.room ?? null, seat: p.seat?.seat ?? null })),
    nextDate: d.papers.map((p) => p.date).filter((x) => x && x >= today).sort()[0] ?? null,
  }
}
