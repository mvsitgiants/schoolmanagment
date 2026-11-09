import {
  CLASS_PRESET_BY, DEFAULT_GRADING_BANDS, SUBJECT_PRESET, academicYearFor, attendancePct, checkGradingBands, checkYearDates, defaultTerms, sectionLabel, sectionNames,
  normSeating, seatCapacity, weekdayCode,
} from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, GradingScheme, Section, Subject, TeacherAllocation } from '../models/academics.js'
import { AttendanceSheet } from '../models/attendance.js'
import { Holiday } from '../models/hrms.js'
import { Student } from '../models/students.js'
import { Branch, Department, User } from '../models/tenant.js'
import { scopeOf } from '../platform/access.js'
import { audit, diffFields } from '../platform/audit.js'
import { clean, isOid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { checkRow, compact, cell } from '../platform/importRows.js'
import { getSetting, getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'

// Academic setup (module `academics`). Everything is per institution (tenant plugin); sections
// and allocations also belong to one academic year, so next year's classes are set up without
// touching this year's. Deletes are refused while something still points at the record — the
// screens offer "make inactive" instead.

const AUDIT = (entityType, entity, summary, extra = {}) => ({ action: extra.action ?? 'UPDATE', module: 'academics', entityType, entityId: String(entity._id), entityName: entity.name, summary, ...extra })
const idStr = (v) => (v ? String(v) : null)
const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })

/** Students' directory sort key ("<class order>|<section>") after a class order or section name changes. */
async function refreshPlaceKeys(sectionFilter) {
  const sections = await Section.find(sectionFilter).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((x) => x.classId) } }).select('order').lean()).map((c) => [String(c._id), c]))
  for (const sec of sections) await Student.updateMany({ sectionId: sec._id }, { $set: { placeKey: `${classes.get(String(sec.classId))?.order ?? 999}|${sec.name}` } })
}

// ───────────────────────────────────────────────────────── starter data

/** Every new institution starts with the current academic year (two terms) and a grading scheme. */
export async function ensureAcademicSetup() {
  if (!await AcademicYear.exists({})) {
    const startMonth = Number(await getSetting('core', 'academicYearStartMonth')) || 4
    const year = academicYearFor((await institutionNow()).date, startMonth)
    await AcademicYear.create({ ...year, terms: defaultTerms(year), isCurrent: true })
  }
  if (!await GradingScheme.exists({})) {
    await GradingScheme.create({ name: 'Standard (9-point)', kind: 'GRADES', bands: DEFAULT_GRADING_BANDS, isDefault: true })
  }
}

// ───────────────────────────────────────────────────────── years

/** The current academic year (or the latest one when none is marked current). */
export async function currentYear() {
  return (await AcademicYear.findOne({ isCurrent: true }).lean())
    ?? AcademicYear.findOne().sort({ startDate: -1 }).lean()
}

/** The year asked for by id, or the current one. */
export async function yearOrCurrent(id) {
  if (id) {
    if (!isOid(id)) throw notFound('Academic year')
    const y = await AcademicYear.findById(id).lean()
    if (!y) throw notFound('Academic year')
    return y
  }
  const y = await currentYear()
  if (!y) throw conflict('Add an academic year first (Academic setup › Academic years & terms).')
  return y
}

export async function listYears() {
  const [rows, counts] = await Promise.all([
    AcademicYear.find().sort({ startDate: -1 }).lean(),
    Section.aggregate([{ $group: { _id: '$academicYearId', n: { $sum: 1 } } }]),
  ])
  const n = new Map(counts.map((c) => [String(c._id), c.n]))
  return rows.map((y) => ({ ...clean(y), terms: (y.terms ?? []).map(clean), sectionCount: n.get(String(y._id)) ?? 0 }))
}

export async function saveYear(id, input, req) {
  const errors = checkYearDates(input)
  if (Object.keys(errors).length) throw fieldsError(errors)
  const taken = await AcademicYear.findOne({ name: new RegExp(`^${escapeRegex(input.name)}$`, 'i'), ...(id && { _id: { $ne: id } }) }).lean()
  if (taken) throw fieldsError({ name: 'Already used for another year' })
  const others = await AcademicYear.find(id ? { _id: { $ne: id } } : {}).select('name startDate endDate').lean()
  const clash = others.find((y) => input.startDate <= y.endDate && input.endDate >= y.startDate)
  if (clash) throw fieldsError({ startDate: `Overlaps ${clash.name}` })
  if (!id) {
    const first = !await AcademicYear.exists({})
    const year = await AcademicYear.create({ ...input, isCurrent: first })
    await audit(AUDIT('academic_year', year, `Added academic year ${year.name}`, { action: 'CREATE' }), req)
    return clean(year.toObject())
  }
  const year = await AcademicYear.findById(id)
  if (!year) throw notFound('Academic year')
  const before = year.toObject()
  Object.assign(year, input)
  await year.save()
  const changes = diffFields(before, year.toObject(), ['name', 'startDate', 'endDate', 'closed'])
  await audit(AUDIT('academic_year', year, `Updated academic year ${year.name}`, { changes }), req)
  return clean(year.toObject())
}

export async function setCurrentYear(id, req) {
  const year = await AcademicYear.findById(id)
  if (!year) throw notFound('Academic year')
  if (year.closed) throw conflict('Reopen this year before making it current.')
  await withTransaction(async () => {
    await AcademicYear.updateMany({ isCurrent: true }, { $set: { isCurrent: false } })
    year.isCurrent = true
    await year.save()
  })
  await audit(AUDIT('academic_year', year, `Made ${year.name} the current academic year`), req)
  return clean(year.toObject())
}

export async function deleteYear(id, req) {
  const year = await AcademicYear.findById(id)
  if (!year) throw notFound('Academic year')
  if (year.isCurrent) throw conflict('This is the current year. Make another year current first.')
  const sections = await Section.countDocuments({ academicYearId: year._id })
  if (sections) throw conflict(`${sections} section(s) belong to ${year.name}. Remove them first, or close the year instead.`)
  await year.deleteOne()
  await audit(AUDIT('academic_year', year, `Deleted academic year ${year.name}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── subjects

export async function listSubjects() {
  const [rows, classes, allocs, depts] = await Promise.all([
    Subject.find().sort({ active: -1, name: 1 }).lean(),
    ClassLevel.find().select('subjectIds').lean(),
    TeacherAllocation.aggregate([{ $group: { _id: '$subjectId', n: { $sum: 1 } } }]),
    Department.find().select('name').lean(),
  ])
  const classCount = new Map()
  for (const c of classes) for (const s of c.subjectIds ?? []) classCount.set(String(s), (classCount.get(String(s)) ?? 0) + 1)
  const allocCount = new Map(allocs.map((a) => [String(a._id), a.n]))
  const deptName = new Map(depts.map((d) => [String(d._id), d.name]))
  return rows.map((s) => ({
    ...clean(s), classCount: classCount.get(String(s._id)) ?? 0, teacherCount: allocCount.get(String(s._id)) ?? 0,
    departmentName: s.departmentId ? deptName.get(String(s.departmentId)) ?? null : null,
  }))
}

async function assertCodeFree(Model, code, id, label) {
  if (await Model.exists({ code, ...(id && { _id: { $ne: id } }) })) throw fieldsError({ code: `Another ${label} already uses ${code}` })
}

export async function saveSubject(id, input, req) {
  await assertCodeFree(Subject, input.code, id, 'subject')
  if (!id) {
    const s = await Subject.create(input)
    await audit(AUDIT('subject', s, `Added subject ${s.name}`, { action: 'CREATE' }), req)
    return clean(s.toObject())
  }
  const s = await Subject.findById(id)
  if (!s) throw notFound('Subject')
  const before = s.toObject()
  Object.assign(s, input)
  await s.save()
  await audit(AUDIT('subject', s, `Updated subject ${s.name}`, { changes: diffFields(before, s.toObject(), ['name', 'code', 'type', 'departmentId', 'active']) }), req)
  return clean(s.toObject())
}

export async function deleteSubject(id, req) {
  const s = await Subject.findById(id)
  if (!s) throw notFound('Subject')
  const [classes, allocs] = await Promise.all([ClassLevel.countDocuments({ subjectIds: s._id }), TeacherAllocation.countDocuments({ subjectId: s._id })])
  if (classes || allocs) throw conflict(`${s.name} is taught in ${classes} class(es). Take it off those classes first, or make it inactive instead.`)
  await s.deleteOne()
  await audit(AUDIT('subject', s, `Deleted subject ${s.name}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

export async function importSubjects(rows, { dryRun, schema }, req) {
  const depts = await Department.find().select('name code').lean()
  const deptOf = (v) => depts.find((d) => d.code === cell(v).toUpperCase() || d.name.toLowerCase() === cell(v).toLowerCase())
  const seen = new Set()
  const out = rows.map((f, i) => {
    const dept = cell(f.department) ? deptOf(f.department) : null
    const { doc, errors } = checkRow(schema, compact({
      name: cell(f.name), code: cell(f.code), type: cell(f.type).toUpperCase() || undefined, departmentId: dept ? String(dept._id) : undefined,
    }), { departmentId: 'department' })
    if (cell(f.department) && !dept) errors.push({ field: 'department', message: `No department "${cell(f.department)}"` })
    const code = cell(f.code).toUpperCase()
    if (code && seen.has(code)) errors.push({ field: 'code', message: 'Twice in this file' })
    seen.add(code)
    return { row: i + 1, fields: f, errors, doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let created = 0
  let updated = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    const existing = await Subject.findOne({ code: r.doc.code })
    if (existing) { Object.assign(existing, r.doc); await existing.save(); updated++ } else { await Subject.create(r.doc); created++ }
  }
  await audit({ action: 'IMPORT', module: 'academics', entityType: 'subject', entityId: 'import', entityName: 'Subjects', summary: `Imported subjects from a file: ${created} added, ${updated} updated` }, req)
  return { imported: created + updated, errors }
}

// ───────────────────────────────────────────────────────── grading schemes

export async function listGrading() {
  const [rows, used] = await Promise.all([
    GradingScheme.find().sort({ isDefault: -1, name: 1 }).lean(),
    ClassLevel.aggregate([{ $match: { gradingSchemeId: { $ne: null } } }, { $group: { _id: '$gradingSchemeId', n: { $sum: 1 } } }]),
  ])
  const n = new Map(used.map((u) => [String(u._id), u.n]))
  return rows.map((g) => ({ ...clean(g), classCount: n.get(String(g._id)) ?? 0 }))
}

export async function saveGrading(id, input, req) {
  const errors = checkGradingBands(input.bands)
  if (Object.keys(errors).length) throw fieldsError(errors)
  if (await GradingScheme.exists({ name: new RegExp(`^${escapeRegex(input.name)}$`, 'i'), ...(id && { _id: { $ne: id } }) })) throw fieldsError({ name: 'Another scheme has this name' })
  const bands = [...input.bands].sort((a, b) => b.min - a.min)
  if (!id) {
    const first = !await GradingScheme.exists({})
    const g = await GradingScheme.create({ ...input, bands, isDefault: first })
    await audit(AUDIT('grading_scheme', g, `Added grading scheme ${g.name}`, { action: 'CREATE' }), req)
    return clean(g.toObject())
  }
  const g = await GradingScheme.findById(id)
  if (!g) throw notFound('Grading scheme')
  Object.assign(g, { ...input, bands })
  await g.save()
  await audit(AUDIT('grading_scheme', g, `Updated grading scheme ${g.name}`), req)
  return clean(g.toObject())
}

export async function setDefaultGrading(id, req) {
  const g = await GradingScheme.findById(id)
  if (!g) throw notFound('Grading scheme')
  await withTransaction(async () => {
    await GradingScheme.updateMany({ isDefault: true }, { $set: { isDefault: false } })
    g.isDefault = true
    g.active = true
    await g.save()
  })
  await audit(AUDIT('grading_scheme', g, `Made ${g.name} the default grading scheme`), req)
  return clean(g.toObject())
}

export async function deleteGrading(id, req) {
  const g = await GradingScheme.findById(id)
  if (!g) throw notFound('Grading scheme')
  if (g.isDefault) throw conflict('This is the default scheme. Make another scheme the default first.')
  const classes = await ClassLevel.countDocuments({ gradingSchemeId: g._id })
  if (classes) throw conflict(`${classes} class(es) use ${g.name}. Move them to another scheme first.`)
  await g.deleteOne()
  await audit(AUDIT('grading_scheme', g, `Deleted grading scheme ${g.name}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── classes and sections

/** Classes in order, each with its sections in `year` (teacher, campus, student count). */
export async function listClasses(yearId) {
  const year = await yearOrCurrent(yearId)
  const [classes, sections, subjects, schemes, branches, depts] = await Promise.all([
    ClassLevel.find().sort({ order: 1, name: 1 }).lean(),
    Section.find({ academicYearId: year._id }).sort({ name: 1 }).lean(),
    Subject.find().select('name code').lean(),
    GradingScheme.find().select('name isDefault').lean(),
    Branch.find().select('name code').lean(),
    Department.find().select('name').lean(),
  ])
  const [teachers, counts] = await Promise.all([
    User.find({ _id: { $in: sections.map((s) => s.classTeacherId).filter(Boolean) } }).select('name').lean(),
    Student.aggregate([{ $match: { status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
  ])
  const nameOf = (rows) => new Map(rows.map((r) => [String(r._id), r.name]))
  const teacher = nameOf(teachers)
  const branch = nameOf(branches)
  const subject = new Map(subjects.map((s) => [String(s._id), s]))
  const scheme = nameOf(schemes)
  const dept = nameOf(depts)
  const students = new Map(counts.map((c) => [String(c._id), c.n]))
  const defaultScheme = schemes.find((s) => s.isDefault)
  return {
    year: { ...clean(year), terms: (year.terms ?? []).map(clean) },
    classes: classes.map((c) => ({
      ...clean(c),
      subjectIds: (c.subjectIds ?? []).map(String), optionalSubjectIds: (c.optionalSubjectIds ?? []).map(String),
      subjects: (c.subjectIds ?? []).map((id) => subject.get(String(id))).filter(Boolean).map((s) => ({ id: String(s._id), name: s.name, code: s.code })),
      gradingSchemeName: scheme.get(idStr(c.gradingSchemeId)) ?? (defaultScheme ? `${defaultScheme.name}` : null),
      gradingIsDefault: !c.gradingSchemeId,
      departmentName: dept.get(idStr(c.departmentId)) ?? null,
      sections: sections.filter((s) => String(s.classId) === String(c._id)).map((s) => ({
        ...clean(s), label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }),
        classTeacherName: teacher.get(idStr(s.classTeacherId)) ?? null, branchName: branch.get(idStr(s.branchId)) ?? null,
        studentCount: students.get(String(s._id)) ?? 0,
      })),
    })),
  }
}

/**
 * The Class board's extras for every section of `year` the caller may see (academics data scope):
 * the boys / girls split of active students and today's attendance (institution date).
 * attendance: null on a holiday, a weekly off, outside the year, or for an inactive section;
 * otherwise { taken, pct, counts, takenBy, takenAt } — in period-wise mode "taken" means any period
 * was marked, and the counts are the day sheet's, else the earliest period's.
 */
export async function classBoard(auth, yearId) {
  const year = await yearOrCurrent(yearId)
  const today = (await institutionNow()).date
  const allowed = await sectionsInScope(auth, 'academics')
  const sections = await Section.find({ academicYearId: year._id, ...(allowed && { _id: { $in: allowed } }) }).select('_id branchId active').lean()
  const ids = sections.map((s) => s._id)
  const [genders, sheets, holidays, core, att, main] = await Promise.all([
    Student.aggregate([
      { $match: { status: 'ACTIVE', sectionId: { $in: ids } } },
      { $group: { _id: { s: '$sectionId', g: { $ifNull: ['$gender', 'UNSET'] } }, n: { $sum: 1 } } },
    ]),
    AttendanceSheet.find({ date: today, sectionId: { $in: ids } }).select('sectionId period counts takenBy takenAt').sort({ period: 1 }).lean(),
    Holiday.find({ date: today, forStudents: true, optional: false }).select('name branchIds').lean(),
    getSettings('core'),
    getSettings('attendance'),
    Branch.findOne({ isDefault: true }).select('_id').lean(),
  ])
  const inYear = today >= year.startDate && today <= year.endDate
  const workingDay = (core.workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']).includes(weekdayCode(today))
  const holidayFor = (branchId) => holidays.find((h) => !h.branchIds?.length || h.branchIds.some((b) => String(b) === String(branchId ?? main?._id)))?.name ?? null
  const split = new Map()
  for (const g of genders) {
    const k = String(g._id.s)
    if (!split.has(k)) split.set(k, { MALE: 0, FEMALE: 0, OTHER: 0, UNSET: 0 })
    const row = split.get(k)
    row[row[g._id.g] == null ? 'UNSET' : g._id.g] += g.n
  }
  const bySection = new Map()
  for (const sh of sheets) {
    const k = String(sh.sectionId)
    if (!bySection.has(k)) bySection.set(k, [])
    bySection.get(k).push(sh)
  }
  return {
    date: today, yearId: String(year._id), inYear, workingDay, mode: att.mode ?? 'DAILY',
    holiday: holidayFor(null),
    sections: sections.map((s) => {
      const holiday = holidayFor(s.branchId)
      const own = bySection.get(String(s._id)) ?? []
      const sheet = own.find((x) => x.period === 0) ?? own[0]
      const off = !s.active || !inYear || !workingDay || !!holiday
      return {
        id: String(s._id),
        genders: split.get(String(s._id)) ?? { MALE: 0, FEMALE: 0, OTHER: 0, UNSET: 0 },
        holiday,
        attendance: off && !sheet ? null : {
          taken: !!sheet, pct: sheet ? attendancePct(sheet.counts) : null, counts: sheet?.counts ?? null,
          takenBy: sheet?.takenBy ?? null, takenAt: sheet?.takenAt ?? null,
        },
      }
    }),
  }
}

async function checkRefs({ subjectIds = [], optionalSubjectIds = [], gradingSchemeId, departmentId }) {
  const errors = {}
  if (subjectIds.length && await Subject.countDocuments({ _id: { $in: subjectIds } }) !== new Set(subjectIds).size) errors.subjectIds = 'Unknown subject'
  if (optionalSubjectIds.some((s) => !subjectIds.includes(s))) errors.optionalSubjectIds = 'An optional subject must also be one of the class’s subjects'
  if (gradingSchemeId && !await GradingScheme.exists({ _id: gradingSchemeId })) errors.gradingSchemeId = 'Unknown grading scheme'
  if (departmentId && !await Department.exists({ _id: departmentId })) errors.departmentId = 'Unknown department'
  if (Object.keys(errors).length) throw fieldsError(errors)
}

export async function saveClass(id, input, req) {
  await assertCodeFree(ClassLevel, input.code, id, 'class')
  await checkRefs(input)
  if (!id) {
    if (input.order === undefined) input.order = ((await ClassLevel.findOne().sort({ order: -1 }).select('order').lean())?.order ?? 0) + 1
    const c = await ClassLevel.create(input)
    await audit(AUDIT('class', c, `Added ${c.name}`, { action: 'CREATE' }), req)
    return clean(c.toObject())
  }
  const c = await ClassLevel.findById(id)
  if (!c) throw notFound('Class')
  const before = c.toObject()
  Object.assign(c, input)
  await c.save()
  if (before.order !== c.order) await refreshPlaceKeys({ classId: c._id })
  await audit(AUDIT('class', c, `Updated ${c.name}`, { changes: diffFields(before, c.toObject(), ['name', 'code', 'order', 'departmentId', 'gradingSchemeId', 'active']) }), req)
  return clean(c.toObject())
}

export async function deleteClass(id, req) {
  const c = await ClassLevel.findById(id)
  if (!c) throw notFound('Class')
  const sections = await Section.countDocuments({ classId: c._id })
  if (sections) throw conflict(`${c.name} has ${sections} section(s) across the years. Remove them first, or make the class inactive instead.`)
  await c.deleteOne()
  await audit(AUDIT('class', c, `Deleted ${c.name}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

async function checkSectionRefs({ branchId, classTeacherId }) {
  const errors = {}
  if (branchId && !await Branch.exists({ _id: branchId })) errors.branchId = 'Unknown campus'
  if (classTeacherId && !await User.exists({ _id: classTeacherId, active: true })) errors.classTeacherId = 'Pick an active user'
  if (Object.keys(errors).length) throw fieldsError(errors)
}

export async function saveSection(id, input, req) {
  await checkSectionRefs(input)
  // a set seating layout decides the capacity; clearing it (null) leaves the capacity as typed
  if (input.seating) { input = { ...input, seating: normSeating(input.seating) }; input.capacity = seatCapacity(input.seating) }
  else if (input.seating === null) input = { ...input, seating: undefined }
  if (!id) {
    const cls = await ClassLevel.findById(input.classId).lean()
    if (!cls) throw notFound('Class')
    const year = await yearOrCurrent(input.academicYearId)
    if (year.closed) throw conflict(`${year.name} is closed.`)
    if (await Section.exists({ classId: cls._id, academicYearId: year._id, name: input.name })) throw fieldsError({ name: `${cls.name} already has section ${input.name} in ${year.name}` })
    const s = await Section.create({ ...input, academicYearId: year._id, classId: cls._id })
    await audit(AUDIT('section', { _id: s._id, name: sectionLabel(cls, s) }, `Added section ${sectionLabel(cls, s)} (${year.name})`, { action: 'CREATE' }), req)
    return clean(s.toObject())
  }
  const s = await Section.findById(id)
  if (!s) throw notFound('Section')
  const cls = await ClassLevel.findById(s.classId).lean()
  const { classId, academicYearId, ...rest } = input // a section never moves class or year
  if (rest.name && rest.name !== s.name && await Section.exists({ classId: s.classId, academicYearId: s.academicYearId, name: rest.name, _id: { $ne: s._id } })) {
    throw fieldsError({ name: `${cls?.name} already has section ${rest.name}` })
  }
  const before = s.toObject()
  Object.assign(s, rest)
  await s.save()
  if (before.name !== s.name) await refreshPlaceKeys({ _id: s._id })
  await audit(AUDIT('section', { _id: s._id, name: sectionLabel(cls, s) }, `Updated section ${sectionLabel(cls, s)}`, { changes: diffFields(before, s.toObject(), ['name', 'branchId', 'classTeacherId', 'capacity', 'room', 'seating', 'active']) }), req)
  return clean(s.toObject())
}

export async function deleteSection(id, req) {
  const s = await Section.findById(id)
  if (!s) throw notFound('Section')
  const cls = await ClassLevel.findById(s.classId).lean()
  const students = await Student.countDocuments({ sectionId: s._id })
  if (students) throw conflict(`${students} student(s) are in ${sectionLabel(cls, s)}. Move them first, or make the section inactive instead.`)
  await TeacherAllocation.deleteMany({ sectionId: s._id })
  await s.deleteOne()
  await audit(AUDIT('section', { _id: s._id, name: sectionLabel(cls, s) }, `Deleted section ${sectionLabel(cls, s)}`, { action: 'DELETE' }), req)
  return { deleted: true }
}

/** Which subjects a class of a given preset code starts with (Quick setup). */
function presetSubjectsFor(code) {
  if (['NUR', 'LKG', 'UKG'].includes(code)) return ['ENG', 'HIN', 'MATH', 'EVS', 'ART', 'MUS']
  const n = Number(code)
  if (n >= 1 && n <= 5) return ['ENG', 'HIN', 'MATH', 'EVS', 'CS', 'PE', 'ART']
  if (n >= 6 && n <= 10) return ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS', 'PE', 'ART']
  return ['ENG', 'PE']
}

/**
 * Quick setup: the preset's classes (those not there yet, matched by code), `sectionsPerClass`
 * sections each in the year, and — with `addSubjects` — the common subjects, put on each class.
 * Re-running it only adds what is missing.
 */
export async function quickSetup({ preset, sectionsPerClass = 1, addSubjects = true, academicYearId, branchId }, req) {
  const p = CLASS_PRESET_BY[preset]
  if (!p) throw fieldsError({ preset: 'Pick a preset' })
  const year = await yearOrCurrent(academicYearId)
  if (year.closed) throw conflict(`${year.name} is closed.`)
  if (branchId && !await Branch.exists({ _id: branchId })) throw fieldsError({ branchId: 'Unknown campus' })
  const created = { classes: 0, sections: 0, subjects: 0 }
  const subjectByCode = new Map()
  if (addSubjects) {
    for (const [name, code, type] of SUBJECT_PRESET) {
      let s = await Subject.findOne({ code }).lean()
      if (!s) { s = (await Subject.create({ name, code, type })).toObject(); created.subjects++ }
      subjectByCode.set(code, s._id)
    }
  }
  let order = (await ClassLevel.findOne().sort({ order: -1 }).select('order').lean())?.order ?? 0
  for (const [name, code] of p.classes) {
    let cls = await ClassLevel.findOne({ code })
    if (!cls) {
      const subjectIds = addSubjects ? presetSubjectsFor(code).map((c) => subjectByCode.get(c)).filter(Boolean) : []
      cls = await ClassLevel.create({ name, code, order: ++order, subjectIds })
      created.classes++
    }
    for (const sec of sectionNames(sectionsPerClass)) {
      if (await Section.exists({ classId: cls._id, academicYearId: year._id, name: sec })) continue
      await Section.create({ classId: cls._id, academicYearId: year._id, name: sec, branchId: branchId || undefined })
      created.sections++
    }
  }
  await audit({ action: 'CREATE', module: 'academics', entityType: 'class', entityId: 'quick-setup', entityName: p.label, summary: `Quick setup (${p.label}, ${year.name}): ${created.classes} classes, ${created.sections} sections, ${created.subjects} subjects added` }, req)
  return created
}

export async function importClasses(rows, { dryRun, schema }, req) {
  const [subjects, depts] = await Promise.all([Subject.find().select('code').lean(), Department.find().select('name code').lean()])
  const subjectId = new Map(subjects.map((s) => [s.code, String(s._id)]))
  const deptOf = (v) => depts.find((d) => d.code === cell(v).toUpperCase() || d.name.toLowerCase() === cell(v).toLowerCase())
  const seen = new Set()
  const out = rows.map((f, i) => {
    const codes = cell(f.subjects).split(/[|;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean)
    const dept = cell(f.department) ? deptOf(f.department) : null
    const { doc, errors } = checkRow(schema, compact({
      name: cell(f.name), code: cell(f.code), order: cell(f.order) ? Number(cell(f.order)) : undefined,
      departmentId: dept ? String(dept._id) : undefined, subjectIds: codes.map((c) => subjectId.get(c)).filter(Boolean),
    }), { departmentId: 'department', subjectIds: 'subjects' })
    const missing = codes.find((c) => !subjectId.has(c))
    if (missing) errors.push({ field: 'subjects', message: `No subject with code "${missing}"` })
    if (cell(f.department) && !dept) errors.push({ field: 'department', message: `No department "${cell(f.department)}"` })
    const code = cell(f.code).toUpperCase()
    if (code && seen.has(code)) errors.push({ field: 'code', message: 'Twice in this file' })
    seen.add(code)
    return { row: i + 1, fields: f, errors, doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let created = 0
  let updated = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    const existing = await ClassLevel.findOne({ code: r.doc.code })
    if (existing) { Object.assign(existing, r.doc); await existing.save(); updated++ } else { await ClassLevel.create(r.doc); created++ }
  }
  await audit({ action: 'IMPORT', module: 'academics', entityType: 'class', entityId: 'import', entityName: 'Classes', summary: `Imported classes from a file: ${created} added, ${updated} updated` }, req)
  return { imported: created + updated, errors }
}

// ───────────────────────────────────────────────────────── teacher allocation

/** One class in one year: its sections × its subjects, with the teacher of each cell. */
export async function allocationGrid({ classId, academicYearId }) {
  const year = await yearOrCurrent(academicYearId)
  const cls = await ClassLevel.findById(classId).lean()
  if (!cls) throw notFound('Class')
  const [sections, subjects, allocs] = await Promise.all([
    Section.find({ classId: cls._id, academicYearId: year._id }).sort({ name: 1 }).lean(),
    Subject.find({ _id: { $in: cls.subjectIds ?? [] } }).lean(),
    TeacherAllocation.find({ academicYearId: year._id }).lean(),
  ])
  const sectionIds = new Set(sections.map((s) => String(s._id)))
  const order = new Map((cls.subjectIds ?? []).map((id, i) => [String(id), i]))
  return {
    year: { id: String(year._id), name: year.name, closed: !!year.closed },
    class: { id: String(cls._id), name: cls.name, code: cls.code },
    sections: sections.map((s) => ({ id: String(s._id), name: s.name, label: sectionLabel(cls, s), classTeacherId: idStr(s.classTeacherId) })),
    subjects: subjects.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id))).map((s) => ({ id: String(s._id), name: s.name, code: s.code, type: s.type })),
    allocations: allocs.filter((a) => sectionIds.has(String(a.sectionId))).map((a) => ({ sectionId: String(a.sectionId), subjectId: String(a.subjectId), teacherId: String(a.teacherId), periodsPerWeek: a.periodsPerWeek ?? null })),
  }
}

/** Set (teacherId) or clear (null) who teaches a subject to a section. */
export async function setAllocation({ sectionId, subjectId, teacherId, periodsPerWeek }, req) {
  const section = await Section.findById(sectionId).lean()
  if (!section) throw notFound('Section')
  const [cls, year] = await Promise.all([ClassLevel.findById(section.classId).lean(), AcademicYear.findById(section.academicYearId).lean()])
  if (year?.closed) throw conflict(`${year.name} is closed.`)
  if (!(cls?.subjectIds ?? []).some((id) => String(id) === String(subjectId))) throw badRequest(`This subject is not taught in ${cls?.name}. Add it to the class first.`)
  const subject = await Subject.findById(subjectId).lean()
  const label = `${subject?.name} · ${sectionLabel(cls, section)}`
  if (!teacherId) {
    await TeacherAllocation.deleteOne({ sectionId: section._id, subjectId })
    await audit({ action: 'DELETE', module: 'academics', entityType: 'allocation', entityId: `${sectionId}:${subjectId}`, entityName: label, summary: `No teacher set for ${label}` }, req)
    return { sectionId: String(sectionId), subjectId: String(subjectId), teacherId: null }
  }
  const teacher = await User.findOne({ _id: teacherId, active: true }).select('name').lean()
  if (!teacher) throw fieldsError({ teacherId: 'Pick an active user' })
  await TeacherAllocation.updateOne(
    { sectionId: section._id, subjectId },
    { $set: { teacherId: teacher._id, academicYearId: section.academicYearId, ...(periodsPerWeek !== undefined && { periodsPerWeek }) } },
    { upsert: true },
  )
  await audit({ action: 'UPDATE', module: 'academics', entityType: 'allocation', entityId: `${sectionId}:${subjectId}`, entityName: label, summary: `${teacher.name} teaches ${label}` }, req)
  return { sectionId: String(sectionId), subjectId: String(subjectId), teacherId: String(teacher._id) }
}

/** People who can be picked as teachers: every active user (designation shown to tell them apart). */
export async function teacherOptions() {
  const rows = await User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(2000).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null }))
}

/**
 * Sections a user teaches in a year: class teacher of, allocated to, or listed on their user
 * record. This is what the "My classes" (CLASS) data scope means for attendance, homework, marks.
 */
export async function mySectionIds(userId, academicYearId) {
  const year = await yearOrCurrent(academicYearId)
  const [own, allocs, user] = await Promise.all([
    Section.find({ academicYearId: year._id, classTeacherId: userId }).select('_id').lean(),
    TeacherAllocation.find({ academicYearId: year._id, teacherId: userId }).select('sectionId').lean(),
    User.findById(userId).select('sectionIds').lean(),
  ])
  const yearSections = new Set((await Section.find({ academicYearId: year._id, _id: { $in: user?.sectionIds ?? [] } }).select('_id').lean()).map((s) => String(s._id)))
  return [...new Set([...own.map((s) => String(s._id)), ...allocs.map((a) => String(a.sectionId)), ...yearSections])]
}

/**
 * Section ids a user may work with in a module, by the role's data scope for that module:
 * ALL → null (no limit) · BRANCH → sections on the user's campus · CLASS / DEPARTMENT / OWN → the
 * sections they teach (mySectionIds). Sections without a campus belong to the main campus.
 */
export async function sectionsInScope(auth, moduleId) {
  const scope = scopeOf(auth, moduleId)
  if (scope === 'ALL') return null
  if (scope === 'BRANCH') {
    if (!auth.user?.branchId) return null // on the main campus with no campus set: the whole institution
    const main = (await Branch.findOne({ isDefault: true }).select('_id').lean())?._id
    const onMain = String(auth.user.branchId) === String(main)
    const rows = await Section.find(onMain ? { $or: [{ branchId: auth.user.branchId }, { branchId: null }] } : { branchId: auth.user.branchId }).select('_id').lean()
    return rows.map((r) => String(r._id))
  }
  const year = await currentYear()
  return year ? mySectionIds(auth.userId, year._id) : []
}

/** The small picture every screen needs: years, the current one, its sections, subjects. */
export async function lookup(auth) {
  const year = await currentYear()
  const [years, classes, sections, subjects] = await Promise.all([
    AcademicYear.find().select('name startDate endDate isCurrent closed').sort({ startDate: -1 }).lean(),
    ClassLevel.find({ active: true }).select('name code order').sort({ order: 1, name: 1 }).lean(),
    year ? Section.find({ academicYearId: year._id, active: true }).select('classId name branchId classTeacherId').sort({ name: 1 }).lean() : [],
    Subject.find({ active: true }).select('name code type').sort({ name: 1 }).lean(),
  ])
  const clsById = new Map(classes.map((c) => [String(c._id), c]))
  const mine = year && auth?.userId ? new Set(await mySectionIds(auth.userId, year._id)) : new Set()
  return {
    currentYear: year ? { id: String(year._id), name: year.name, startDate: year.startDate, endDate: year.endDate } : null,
    years: years.map(clean),
    classes: classes.map(clean),
    sections: sections.filter((s) => clsById.has(String(s.classId))).sort((a, b) => (clsById.get(String(a.classId)).order - clsById.get(String(b.classId)).order) || a.name.localeCompare(b.name)).map((s) => ({
      id: String(s._id), classId: String(s.classId), name: s.name, branchId: idStr(s.branchId),
      label: sectionLabel(clsById.get(String(s.classId)), s), short: sectionLabel(clsById.get(String(s.classId)), s, { short: true }), mine: mine.has(String(s._id)),
    })),
    subjects: subjects.map(clean),
  }
}

