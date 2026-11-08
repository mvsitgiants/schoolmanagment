import { randomInt } from 'node:crypto'
import { HISTORY_EVENTS, LEAVING_REASONS, TC_STATUS, ageYears, isValidAadhaar, sectionLabel } from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { Student, TransferCertificate, studentName } from '../models/students.js'
import { Tenant } from '../models/platform.js'
import { can } from '../platform/access.js'
import { audit, diffFields } from '../platform/audit.js'
import { blindIndex, decrypt, encrypt } from '../platform/crypto.js'
import { clean, isOid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { cell, checkRow, compact } from '../platform/importRows.js'
import { nextNumber } from '../platform/numbering.js'
import { institutionNow } from '../platform/time.js'
import { getSettings } from '../platform/settings.js'
import { runAsSystem } from '../platform/context.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { currentYear, sectionsInScope } from './academics.js'
import { assertWithinLimit } from './subscription.js'

// Students (module `students`): admission, the directory, Student 360, guardians, promotion at
// year end and transfer certificates. Who sees which students follows the role's data scope for
// `students`: CLASS = the sections the user teaches (services/academics.js mySectionIds), BRANCH =
// sections on the user's campus, ALL = every student.

const fieldsError = (fields, message = 'Some details need fixing.') => badRequest(message, { fields })
const idStr = (v) => (v ? String(v) : null)
const digits = (v) => String(v ?? '').replace(/\D/g, '')
/** Sort key for the directory: class order, then section. Compared with numeric collation. */
const placeKey = (cls, section) => `${cls?.order ?? 999}|${section?.name ?? ''}`
const NUMERIC = { locale: 'en', numericOrdering: true }

// ───────────────────────────────────────────────────────── scope

/** Mongo filter limiting students to the caller's data scope (null = no limit). */
export async function scopeFilter(auth) {
  const ids = await sectionsInScope(auth, 'students')
  return ids ? { sectionId: { $in: ids } } : null
}

async function assertInScope(student, auth) {
  const f = await scopeFilter(auth)
  if (!f) return
  if (!f.sectionId.$in.some((id) => String(id) === String(student.sectionId))) throw notFound('Student')
}

// ───────────────────────────────────────────────────────── shaping

/** Section and class labels for many students at once. */
async function placeMap(students) {
  const ids = [...new Set(students.map((s) => idStr(s.sectionId)).filter(Boolean))]
  const sections = await Section.find({ _id: { $in: ids } }).lean()
  const classes = await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()
  const years = await AcademicYear.find({ _id: { $in: sections.map((s) => s.academicYearId) } }).select('name').lean()
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  const yr = new Map(years.map((y) => [String(y._id), y.name]))
  return new Map(sections.map((s) => {
    const c = cls.get(String(s.classId))
    return [String(s._id), { label: sectionLabel(c, s), short: sectionLabel(c, s, { short: true }), classId: String(s.classId), className: c?.name, classOrder: c?.order ?? 0, sectionName: s.name, yearName: yr.get(String(s.academicYearId)), academicYearId: String(s.academicYearId) }]
  }))
}

const primaryGuardian = (s) => s.guardians?.find((g) => g.isPrimary) ?? s.guardians?.[0] ?? null

function rowDto(s, place) {
  const p = place.get(idStr(s.sectionId))
  const g = primaryGuardian(s)
  return {
    id: String(s._id), admissionNo: s.admissionNo, name: studentName(s), firstName: s.firstName, lastName: s.lastName,
    gender: s.gender ?? null, dob: s.dob ?? null, age: ageYears(s.dob), rollNo: s.rollNo ?? null, status: s.status,
    sectionId: idStr(s.sectionId), classId: idStr(s.classId), classLabel: p?.label ?? null, classShort: p?.short ?? null, yearName: p?.yearName ?? null,
    guardianName: g?.name ?? null, guardianMobile: g?.mobile ?? null,
  }
}

function fullDto(s, place, { reveal = false } = {}) {
  const base = rowDto(s, place)
  const { aadhaarEnc, aadhaarIndex, aadhaarLast4, ...rest } = clean(s)
  return {
    ...rest, ...base,
    guardians: (s.guardians ?? []).map((g) => ({ ...clean(g) })),
    history: (s.history ?? []).map((h) => ({ ...h, sectionId: idStr(h.sectionId), academicYearId: idStr(h.academicYearId) })),
    aadhaar: aadhaarLast4 ? (reveal ? decrypt(aadhaarEnc) : `•••• •••• ${aadhaarLast4}`) : null,
    aadhaarSet: !!aadhaarLast4,
    branchId: idStr(s.branchId),
  }
}

// ───────────────────────────────────────────────────────── list and read

export async function listStudents(q, paging, auth) {
  const filter = {}
  const scope = await scopeFilter(auth)
  if (q.status !== 'ALL') filter.status = q.status || 'ACTIVE'
  if (q.sectionId) filter.sectionId = q.sectionId
  else if (q.classId) filter.classId = q.classId
  if (q.gender) filter.gender = q.gender
  if (paging.search) {
    const s = paging.search.trim()
    const re = new RegExp(escapeRegex(s), 'i')
    const d = digits(s)
    filter.$or = [{ firstName: re }, { lastName: re }, { admissionNo: re }, { 'guardians.name': re }, ...(d.length >= 4 ? [{ 'guardians.mobile': new RegExp(escapeRegex(d)) }, { mobile: new RegExp(escapeRegex(d)) }] : [])]
  }
  const where = scope ? { $and: [filter, scope] } : filter
  const [rows, total] = await Promise.all([
    Student.find(where).collation(NUMERIC).sort({ placeKey: 1, rollNo: 1, firstName: 1, lastName: 1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Student.countDocuments(where),
  ])
  const place = await placeMap(rows)
  return listResponse(rows.map((s) => rowDto(s, place)), total, paging)
}

export async function getStudent(id, auth, req, { reveal = false, quiet = false } = {}) {
  if (!isOid(id)) throw notFound('Student')
  const s = await Student.findById(id).lean()
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  if (reveal && !can(auth, 'students.profile.view_sensitive')) throw forbidden('Your role can’t see unmasked ID numbers.')
  const place = await placeMap([s])
  const mobiles = (s.guardians ?? []).map((g) => g.mobile).filter(Boolean)
  const siblings = mobiles.length ? await Student.find({ _id: { $ne: s._id }, 'guardians.mobile': { $in: mobiles }, status: 'ACTIVE' }).select('firstName middleName lastName sectionId admissionNo').lean() : []
  const sibPlace = await placeMap(siblings)
  const tcs = await TransferCertificate.find({ studentId: s._id }).sort({ createdAt: -1 }).lean()
  if (!quiet) await audit({ action: reveal ? 'VIEW_SENSITIVE' : 'VIEW', module: 'students', entityType: 'student', entityId: String(s._id), entityName: studentName(s), studentId: s._id, summary: reveal ? `Saw the unmasked Aadhaar of ${studentName(s)}` : `Opened ${studentName(s)}` }, req)
  return {
    ...fullDto(s, place, { reveal }),
    siblings: siblings.map((x) => ({ id: String(x._id), name: studentName(x), admissionNo: x.admissionNo, classShort: sibPlace.get(idStr(x.sectionId))?.short ?? null })),
    tcs: tcs.map(tcDto),
  }
}

// ───────────────────────────────────────────────────────── admit and edit

/** A section the student can be put in: exists, open year, and (for staff with a scope) theirs. */
async function placeIn(sectionId) {
  const section = await Section.findById(sectionId).lean()
  if (!section) throw fieldsError({ sectionId: 'Pick a class and section' })
  const year = await AcademicYear.findById(section.academicYearId).lean()
  if (year?.closed) throw fieldsError({ sectionId: `${year.name} is closed` })
  const cls = await ClassLevel.findById(section.classId).lean()
  return { section, year, cls, label: sectionLabel(cls, section) }
}

/** Normalise the guardians list: names trimmed, exactly one primary (the first, if none chosen). */
function guardiansIn(list = []) {
  const out = list.filter((g) => g?.name?.trim()).map((g) => ({ ...g, mobile: g.mobile ? digits(g.mobile).slice(-10) || g.mobile : g.mobile }))
  if (!out.length) return out
  const firstPrimary = out.findIndex((g) => g.isPrimary)
  return out.map((g, i) => ({ ...g, isPrimary: i === (firstPrimary < 0 ? 0 : firstPrimary) }))
}

async function aadhaarFields(raw, exceptId) {
  if (raw === undefined) return {}
  const v = digits(raw)
  if (!v) return { aadhaarEnc: undefined, aadhaarLast4: undefined, aadhaarIndex: undefined }
  if (!isValidAadhaar(v)) throw fieldsError({ aadhaar: 'Not a valid Aadhaar number' })
  const index = blindIndex(v)
  const dup = await Student.findOne({ aadhaarIndex: index, ...(exceptId && { _id: { $ne: exceptId } }) }).select('firstName lastName admissionNo').lean()
  if (dup) throw fieldsError({ aadhaar: `Already on ${studentName(dup)} (${dup.admissionNo})` })
  return { aadhaarEnc: encrypt(v), aadhaarLast4: v.slice(-4), aadhaarIndex: index }
}

export async function admitStudent(input, auth, req) {
  await assertWithinLimit(auth.tenantId, 'students', 1)
  const { section, year, cls, label } = await placeIn(input.sectionId)
  const { aadhaar, guardians, ...rest } = input
  const g = guardiansIn(guardians)
  if (!g.length) throw fieldsError({ guardians: 'Add at least one parent or guardian' })
  if (rest.admissionNo && await Student.exists({ admissionNo: rest.admissionNo })) throw fieldsError({ admissionNo: 'Another student has this admission number' })
  const today = (await institutionNow()).date
  const doc = await withTransaction(async () => {
    const admissionNo = rest.admissionNo || await nextNumber('ADMISSION_NO', { branchId: section.branchId })
    return Student.create({
      ...rest, ...(await aadhaarFields(aadhaar)), admissionNo, guardians: g,
      classId: cls._id, placeKey: placeKey(cls, section), branchId: section.branchId, admissionDate: rest.admissionDate || today, status: 'ACTIVE',
      history: [{ event: 'ADMITTED', academicYearId: year._id, yearName: year.name, sectionId: section._id, classLabel: label, by: auth.user?.name }],
    })
  })
  await audit({ action: 'CREATE', module: 'students', entityType: 'student', entityId: String(doc._id), entityName: studentName(doc), studentId: doc._id, summary: `Admitted ${studentName(doc)} (${doc.admissionNo}) to ${label}` }, req)
  await emit('students.admitted', { studentId: String(doc._id), admissionNo: doc.admissionNo, section: label })
  return getStudent(doc._id, auth, null, { quiet: true })
}

const EDIT_FIELDS = ['firstName', 'middleName', 'lastName', 'gender', 'dob', 'bloodGroup', 'category', 'religion', 'nationality', 'motherTongue', 'admissionDate', 'rollNo', 'mobile', 'email', 'apaarId', 'pen', 'language']

export async function updateStudent(id, input, auth, req) {
  const s = await Student.findById(id)
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  const before = s.toObject()
  const { aadhaar, guardians, sectionId, address, previousSchool, medical, consents, ...rest } = input
  for (const f of EDIT_FIELDS) if (rest[f] !== undefined) s[f] = rest[f]
  if (address) s.address = { ...before.address, ...address }
  if (previousSchool) s.previousSchool = { ...before.previousSchool, ...previousSchool }
  if (medical) s.medical = { ...before.medical, ...medical }
  if (consents) s.consents = { communication: { ...before.consents?.communication, ...consents.communication } }
  if (guardians) {
    const g = guardiansIn(guardians)
    if (!g.length) throw fieldsError({ guardians: 'Keep at least one parent or guardian' })
    s.guardians = g
  }
  Object.assign(s, await aadhaarFields(aadhaar, s._id))
  if (sectionId && String(sectionId) !== String(s.sectionId)) {
    const to = await placeIn(sectionId)
    s.sectionId = to.section._id
    s.classId = to.cls._id
    s.placeKey = placeKey(to.cls, to.section)
    s.branchId = to.section.branchId
    s.history.push({ event: 'MOVED', academicYearId: to.year._id, yearName: to.year.name, sectionId: to.section._id, classLabel: to.label, by: auth.user?.name })
  }
  await s.save()
  const changes = diffFields(before, s.toObject(), [...EDIT_FIELDS, 'sectionId', 'status'])
  if (aadhaar !== undefined) changes.push({ field: 'aadhaar', from: before.aadhaarLast4 ? `••••${before.aadhaarLast4}` : null, to: s.aadhaarLast4 ? `••••${s.aadhaarLast4}` : null })
  if (guardians) changes.push({ field: 'guardians', from: (before.guardians ?? []).map((g) => g.name).join(', '), to: s.guardians.map((g) => g.name).join(', ') })
  await audit({ action: 'UPDATE', module: 'students', entityType: 'student', entityId: String(s._id), entityName: studentName(s), studentId: s._id, summary: `Updated ${studentName(s)}`, changes }, req)
  return getStudent(s._id, auth, null, { quiet: true })
}

/** Back to studying (an inactive student, or one who left and returns without a TC). */
export async function setStudentStatus(id, status, auth, req) {
  const s = await Student.findById(id)
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  if (status === 'ACTIVE' && s.status !== 'ACTIVE') await assertWithinLimit(auth.tenantId, 'students', 1)
  if (s.leaving?.tcNo && status === 'ACTIVE') {
    s.history.push({ event: 'READMITTED', note: `TC ${s.leaving.tcNo} stays on record`, by: auth.user?.name })
    s.leaving = undefined
  }
  const from = s.status
  s.status = status
  await s.save()
  await audit({ action: 'UPDATE', module: 'students', entityType: 'student', entityId: String(s._id), entityName: studentName(s), studentId: s._id, summary: `${studentName(s)}: ${from} → ${status}` }, req)
  return getStudent(s._id, auth, null, { quiet: true })
}

// ───────────────────────────────────────────────────────── guardians directory

/** Parents and guardians across students, one row per mobile number (or name when there is none). */
export async function listGuardians({ search }, auth) {
  const scope = await scopeFilter(auth)
  const match = { status: 'ACTIVE', ...(scope ?? {}) }
  const rows = await Student.find(match).select('firstName middleName lastName admissionNo sectionId guardians').lean()
  const place = await placeMap(rows)
  const byKey = new Map()
  for (const s of rows) {
    for (const g of s.guardians ?? []) {
      const key = g.mobile ? `m:${g.mobile}` : `n:${g.name.toLowerCase()}:${s._id}`
      const row = byKey.get(key) ?? { id: key, name: g.name, relation: g.relation ?? null, mobile: g.mobile ?? null, email: g.email ?? null, occupation: g.occupation ?? null, primaryFor: 0, children: [] }
      row.children.push({ id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, classShort: place.get(idStr(s.sectionId))?.short ?? null })
      if (g.isPrimary) row.primaryFor++
      if (!row.email && g.email) row.email = g.email
      byKey.set(key, row)
    }
  }
  let out = [...byKey.values()]
  if (search?.trim()) {
    const q = search.trim().toLowerCase()
    const d = digits(q)
    out = out.filter((g) => g.name.toLowerCase().includes(q) || (d.length >= 4 && g.mobile?.includes(d)) || g.children.some((c) => c.name.toLowerCase().includes(q) || c.admissionNo.toLowerCase().includes(q)))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2000)
}

// ───────────────────────────────────────────────────────── import

/**
 * Bulk admission from a spreadsheet. Columns: admissionNo (blank = next number), firstName, lastName,
 * gender, dob, class (code or name), section, rollNo, guardianName, guardianRelation, guardianMobile,
 * guardianEmail, admissionDate. Rows are checked like the admission form; the real run stops at the
 * plan's student limit.
 */
export async function importStudents(rows, { dryRun, schema }, auth, req) {
  const year = await currentYear()
  if (!year) throw conflict('Add an academic year first (Academic setup).')
  const [classes, sections, taken] = await Promise.all([
    ClassLevel.find().select('name code').lean(),
    Section.find({ academicYearId: year._id }).select('classId name branchId').lean(),
    Student.find().select('admissionNo').lean(),
  ])
  const takenNos = new Set(taken.map((s) => s.admissionNo))
  const classOf = (v) => classes.find((c) => c.code === cell(v).toUpperCase() || c.name.toLowerCase() === cell(v).toLowerCase())
  const seen = new Set()
  const out = rows.map((f, i) => {
    const cls = classOf(f.class)
    const sec = cls && sections.find((s) => String(s.classId) === String(cls._id) && s.name === cell(f.section).toUpperCase())
    const { doc, errors } = checkRow(schema, compact({
      admissionNo: cell(f.admissionNo) || undefined, firstName: cell(f.firstName), lastName: cell(f.lastName) || undefined,
      gender: cell(f.gender).toUpperCase() || undefined, dob: cell(f.dob) || undefined, rollNo: cell(f.rollNo) || undefined,
      admissionDate: cell(f.admissionDate) || undefined, sectionId: sec ? String(sec._id) : undefined,
      guardians: cell(f.guardianName) ? [compact({ name: cell(f.guardianName), relation: cell(f.guardianRelation).toUpperCase() || undefined, mobile: cell(f.guardianMobile) || undefined, email: cell(f.guardianEmail) || undefined, isPrimary: true })] : [],
    }), { sectionId: 'section', guardians: 'guardianName' })
    if (!cls) errors.push({ field: 'class', message: cell(f.class) ? `No class "${cell(f.class)}"` : 'Enter the class' })
    else if (!sec) errors.push({ field: 'section', message: `${cls.name} has no section "${cell(f.section)}" in ${year.name}` })
    if (!cell(f.guardianName)) errors.push({ field: 'guardianName', message: 'Enter a parent or guardian' })
    const no = cell(f.admissionNo)
    if (no && (takenNos.has(no) || seen.has(no))) errors.push({ field: 'admissionNo', message: takenNos.has(no) ? 'Already used' : 'Twice in this file' })
    if (no) seen.add(no)
    return { row: i + 1, fields: f, errors: errors.filter((e, k, all) => all.findIndex((x) => x.field === e.field) === k), doc }
  })
  if (dryRun) return { rows: out.map(({ doc, ...r }) => r) }
  let imported = 0
  const errors = []
  for (const r of out) {
    if (r.errors.length) { errors.push(...r.errors.map((e) => ({ ...e, row: r.row }))); continue }
    try {
      await admitStudent(r.doc, auth, req)
      imported++
    } catch (e) {
      errors.push({ row: r.row, field: Object.keys(e.details?.fields ?? {})[0] ?? 'firstName', message: e.message })
      if (e.status === 422) break // plan limit: stop, the rest would fail the same way
    }
  }
  await audit({ action: 'IMPORT', module: 'students', entityType: 'student', entityId: 'import', entityName: 'Students', summary: `Imported ${imported} student(s) from a file` }, req)
  return { imported, errors }
}

// ───────────────────────────────────────────────────────── promotion

/** The students of a section and a suggested next section for each outcome. */
export async function promotionPreview({ fromSectionId, toYearId }) {
  const from = await Section.findById(fromSectionId).lean()
  if (!from) throw notFound('Section')
  const [fromYear, cls, toYear] = await Promise.all([AcademicYear.findById(from.academicYearId).lean(), ClassLevel.findById(from.classId).lean(), toYearId ? AcademicYear.findById(toYearId).lean() : null])
  const target = toYear ?? await AcademicYear.findOne({ startDate: { $gt: fromYear.endDate } }).sort({ startDate: 1 }).lean()
  const classes = await ClassLevel.find({ active: true }).sort({ order: 1 }).lean()
  const next = classes[classes.findIndex((c) => String(c._id) === String(cls._id)) + 1] ?? null
  const targetSections = target ? await Section.find({ academicYearId: target._id, classId: { $in: [cls._id, next?._id].filter(Boolean) } }).sort({ name: 1 }).lean() : []
  const byClass = (c) => targetSections.filter((s) => String(s.classId) === String(c?._id)).map((s) => ({ id: String(s._id), label: sectionLabel(c, s), name: s.name }))
  const students = await Student.find({ sectionId: from._id, status: 'ACTIVE' }).sort({ rollNo: 1, firstName: 1 }).lean()
  const suggest = (list) => list.find((s) => s.name === from.name)?.id ?? list[0]?.id ?? null
  return {
    from: { id: String(from._id), label: sectionLabel(cls, from), yearName: fromYear.name },
    toYear: target ? { id: String(target._id), name: target.name } : null,
    nextClass: next ? { id: String(next._id), name: next.name, sections: byClass(next), suggested: suggest(byClass(next)) } : null,
    sameClass: { id: String(cls._id), name: cls.name, sections: byClass(cls), suggested: suggest(byClass(cls)) },
    students: students.map((s) => ({ id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, rollNo: s.rollNo ?? null })),
  }
}

/**
 * Year-end move of one section: per student PROMOTE / DETAIN (into `toSectionId` of a later year),
 * PASS_OUT or LEAVE (status changes, no section). Everything in one transaction; each student's
 * history gets the year's outcome.
 */
export async function runPromotion({ fromSectionId, decisions }, auth, req) {
  const from = await Section.findById(fromSectionId).lean()
  if (!from) throw notFound('Section')
  const [fromYear, fromCls] = await Promise.all([AcademicYear.findById(from.academicYearId).lean(), ClassLevel.findById(from.classId).lean()])
  const fromLabel = sectionLabel(fromCls, from)
  const targets = new Map()
  for (const d of decisions.filter((x) => ['PROMOTE', 'DETAIN'].includes(x.outcome))) {
    if (!d.toSectionId) throw badRequest('Pick the section each promoted or detained student goes to.')
    if (!targets.has(d.toSectionId)) {
      const to = await placeIn(d.toSectionId)
      if (to.year.startDate <= fromYear.startDate) throw badRequest(`${to.label} is not in a later year than ${fromYear.name}.`)
      if (d.outcome === 'DETAIN' && String(to.cls._id) !== String(fromCls._id)) throw badRequest(`A detained student stays in ${fromCls.name}.`)
      targets.set(d.toSectionId, to)
    }
  }
  const counts = { PROMOTE: 0, DETAIN: 0, PASS_OUT: 0, LEAVE: 0 }
  await withTransaction(async () => {
    for (const d of decisions) {
      const s = await Student.findOne({ _id: d.studentId, sectionId: from._id, status: 'ACTIVE' })
      if (!s) continue // already moved or not in this section
      const entry = { event: d.outcome, academicYearId: fromYear._id, yearName: fromYear.name, sectionId: from._id, classLabel: fromLabel, by: auth.user?.name }
      if (d.outcome === 'PROMOTE' || d.outcome === 'DETAIN') {
        const to = targets.get(d.toSectionId)
        s.sectionId = to.section._id
        s.classId = to.cls._id
        s.placeKey = placeKey(to.cls, to.section)
        s.branchId = to.section.branchId
        s.rollNo = undefined
        entry.note = `→ ${to.label} (${to.year.name})`
      } else if (d.outcome === 'PASS_OUT') {
        s.status = 'PASSED_OUT'
      } else {
        s.status = 'LEFT'
        s.leaving = { date: fromYear.endDate, reason: 'OTHER' }
      }
      s.history.push(entry)
      await s.save()
      counts[d.outcome]++
    }
  })
  await audit({ action: 'UPDATE', module: 'students', entityType: 'promotion', entityId: String(from._id), entityName: fromLabel, summary: `Year-end for ${fromLabel} (${fromYear.name}): ${counts.PROMOTE} promoted, ${counts.DETAIN} detained, ${counts.PASS_OUT} passed out, ${counts.LEAVE} left` }, req)
  return counts
}

// ───────────────────────────────────────────────────────── transfer certificates

function tcDto(t) {
  return { ...clean(t), studentId: String(t.studentId), statusLabel: TC_STATUS[t.status]?.label ?? t.status, reasonLabel: LEAVING_REASONS.find((r) => r.value === t.reason)?.label ?? t.reasonText ?? null }
}

export async function listTcs({ status }, auth) {
  const scope = await scopeFilter(auth)
  const filter = status ? { status } : {}
  if (scope) filter.studentId = { $in: (await Student.find(scope).select('_id').lean()).map((s) => s._id) }
  const rows = await TransferCertificate.find(filter).sort({ createdAt: -1 }).limit(500).lean()
  return rows.map(tcDto)
}

export async function requestTc(input, auth, req) {
  const s = await Student.findById(input.studentId).lean()
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  if (s.status === 'LEFT' && s.leaving?.tcNo) throw conflict(`${studentName(s)} already has TC ${s.leaving.tcNo}.`)
  if (await TransferCertificate.exists({ studentId: s._id, status: 'REQUESTED' })) throw conflict(`A TC for ${studentName(s)} is already waiting for approval.`)
  const place = await placeMap([s])
  const p = place.get(idStr(s.sectionId))
  const tc = await TransferCertificate.create({
    ...input, studentId: s._id, status: 'REQUESTED', lastClassLabel: p?.label ?? null,
    snapshot: {
      name: studentName(s), admissionNo: s.admissionNo, dob: s.dob, gender: s.gender, category: s.category, nationality: s.nationality, religion: s.religion,
      admissionDate: s.admissionDate, father: s.guardians?.find((g) => g.relation === 'FATHER')?.name ?? null, mother: s.guardians?.find((g) => g.relation === 'MOTHER')?.name ?? null,
      guardian: primaryGuardian(s)?.name ?? null, apaarId: s.apaarId ?? null, pen: s.pen ?? null, firstClass: s.history?.[0]?.classLabel ?? null,
    },
    requestedBy: auth.user?.name, requestedById: auth.userId,
  })
  await audit({ action: 'CREATE', module: 'students', entityType: 'tc', entityId: String(tc._id), entityName: studentName(s), studentId: s._id, summary: `Asked for a transfer certificate for ${studentName(s)}` }, req)
  return tcDto(tc.toObject())
}

/** Approve and issue: the TC gets its number, the student is marked as left. */
export async function issueTc(id, auth, req) {
  const tc = await TransferCertificate.findById(id)
  if (!tc) throw notFound('Transfer certificate')
  if (tc.status !== 'REQUESTED') throw conflict(`This TC is ${TC_STATUS[tc.status]?.label.toLowerCase()}.`)
  if (String(tc.requestedById) === String(auth.userId) && !auth.fullAccess) throw forbidden('Someone other than the person who asked for it must approve a TC.')
  const s = await Student.findById(tc.studentId)
  await assertInScope(s, auth)
  await withTransaction(async () => {
    tc.tcNo = await nextNumber('TC', { branchId: s.branchId })
    tc.status = 'ISSUED'
    tc.issuedAt = new Date()
    tc.issuedBy = auth.user?.name
    await tc.save()
    s.status = 'LEFT'
    s.leaving = { date: tc.leavingDate, reason: tc.reason, tcId: tc._id, tcNo: tc.tcNo }
    s.history.push({ event: 'TC_ISSUED', sectionId: s.sectionId, classLabel: tc.lastClassLabel, note: `TC ${tc.tcNo}`, by: auth.user?.name })
    await s.save()
  })
  await audit({ action: 'APPROVE', module: 'students', entityType: 'tc', entityId: String(tc._id), entityName: studentName(s), studentId: s._id, summary: `Issued TC ${tc.tcNo} to ${studentName(s)}` }, req)
  await emit('students.left', { studentId: String(s._id), tcNo: tc.tcNo })
  return tcDto(tc.toObject())
}

export async function cancelTc(id, reason, auth, req) {
  const tc = await TransferCertificate.findById(id)
  if (!tc) throw notFound('Transfer certificate')
  if (tc.status === 'CANCELLED') throw conflict('This TC is already cancelled.')
  const s = await Student.findById(tc.studentId)
  await assertInScope(s, auth)
  const wasIssued = tc.status === 'ISSUED'
  if (wasIssued && !can(auth, 'students.transfer.approve')) throw forbidden('Only someone who approves TCs can cancel an issued one.')
  await withTransaction(async () => {
    Object.assign(tc, { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.user?.name, cancelReason: reason })
    await tc.save()
    if (wasIssued && String(s.leaving?.tcId) === String(tc._id)) {
      s.status = 'ACTIVE'
      s.leaving = undefined
      s.history.push({ event: 'READMITTED', note: `TC ${tc.tcNo} cancelled: ${reason}`, by: auth.user?.name })
      await s.save()
    }
  })
  await audit({ action: 'CANCEL', module: 'students', entityType: 'tc', entityId: String(tc._id), entityName: studentName(s), studentId: s._id, summary: `Cancelled ${wasIssued ? `TC ${tc.tcNo}` : 'the TC request'} of ${studentName(s)}: ${reason}` }, req)
  return tcDto(tc.toObject())
}

/** The data a TC prints from (documents/registry.js TRANSFER_CERTIFICATE). */
export async function tcPrintData(id, auth) {
  const tc = await TransferCertificate.findById(id).lean()
  if (!tc) throw notFound('Transfer certificate')
  const s = await Student.findById(tc.studentId).lean()
  await assertInScope(s, auth)
  return { tc, student: s }
}

// ───────────────────────────────────────────────────────── ID cards and photos

const CARD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCardCode = () => Array.from({ length: 10 }, () => CARD_ALPHABET[randomInt(CARD_ALPHABET.length)]).join('')

/** Give each student a card check code the first time their card is printed; kept, so reprints carry the same link. */
async function ensureCardCodes(rows) {
  for (const s of rows.filter((x) => !x.cardCode && x.status === 'ACTIVE')) {
    for (let tries = 0; tries < 3 && !s.cardCode; tries++) {
      try {
        await Student.updateOne({ _id: s._id, cardCode: { $exists: false } }, { $set: { cardCode: newCardCode() } })
      } catch (err) {
        if (err?.code !== 11000) throw err // another card has that code already: make a new one
      }
      s.cardCode = (await Student.findById(s._id).select('cardCode').lean())?.cardCode
    }
  }
}

/** What the student ID card prints for each of `ids` (in the caller's scope, in the order asked). */
export async function studentIdCards(ids, auth) {
  const f = await scopeFilter(auth)
  const [rows, s, tenant, year, now] = await Promise.all([
    Student.find({ _id: { $in: ids }, ...(f ?? {}) }).select('+photo admissionNo firstName middleName lastName rollNo dob bloodGroup sectionId status guardians address cardCode').lean(),
    getSettings('students'),
    Tenant.findById(auth.tenantId).select('name profile').lean(),
    currentYear(),
    institutionNow(),
  ])
  await ensureCardCodes(rows)
  const sections = await Section.find({ _id: { $in: rows.map((r) => r.sectionId).filter(Boolean) } }).lean()
  const classes = new Map((await ClassLevel.find({ _id: { $in: sections.map((x) => x.classId) } }).select('name code').lean()).map((c) => [String(c._id), c]))
  const label = new Map(sections.map((x) => [String(x._id), sectionLabel(classes.get(String(x.classId)), x)]))
  const byId = new Map(rows.map((r) => [String(r._id), r]))
  const p = tenant?.profile ?? {}
  return {
    students: ids.map((id) => byId.get(String(id))).filter(Boolean).map((x) => {
      const g = x.guardians?.find((y) => y.isPrimary) ?? x.guardians?.[0]
      return {
        id: String(x._id), name: studentName(x), admissionNo: x.admissionNo, class: label.get(String(x.sectionId)) ?? '', rollNo: x.rollNo ?? null, dob: x.dob ?? null,
        bloodGroup: x.bloodGroup ?? null, guardian: g?.name ?? null, guardianRelation: g?.relation ?? null, guardianPhone: g?.mobile ?? null,
        address: [x.address?.line, x.address?.city, x.address?.pincode].filter(Boolean).join(', ') || null,
        photo: x.photo ?? null, status: x.status, cardCode: x.cardCode ?? null,
      }
    }),
    settings: { orientation: s.idCardOrientation, title: s.idCardTitle, color: s.idCardColor, fields: s.idCardFields, back: s.idCardBack, backText: s.idCardBackText, returnText: s.idCardReturnText, signatory: s.idCardSignatory },
    institution: {
      name: tenant?.name ?? '', logoUrl: p.logoUrl || null, color: p.primaryColor || null,
      address: [p.addressLine, p.city, [p.state, p.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: p.phone || null, email: p.email || null, website: p.website || null,
    },
    today: now.date, validUntil: year?.endDate ?? null, yearName: year?.name ?? null,
  }
}

/** A section's students for the ID cards screen: who has a photo, who has had a card. */
export async function idCardList(sectionId, auth) {
  if (!isOid(sectionId)) throw notFound('Section')
  const allowed = await sectionsInScope(auth, 'students')
  if (allowed && !allowed.includes(String(sectionId))) throw notFound('Section')
  const rows = await Student.find({ sectionId, status: 'ACTIVE' }).collation({ locale: 'en', numericOrdering: true }).sort({ rollNo: 1, firstName: 1 })
    .select('admissionNo firstName middleName lastName rollNo cardCode bloodGroup').lean()
  const withPhoto = new Set((await Student.find({ _id: { $in: rows.map((r) => r._id) }, photo: { $exists: true, $ne: '' } }).select('_id').lean()).map((r) => String(r._id)))
  return rows.map((r) => ({ id: String(r._id), name: studentName(r), admissionNo: r.admissionNo, rollNo: r.rollNo ?? null, bloodGroup: r.bloodGroup ?? null, hasPhoto: withPhoto.has(String(r._id)), printed: !!r.cardCode }))
}

export async function getStudentPhoto(id, auth) {
  if (!isOid(id)) throw notFound('Student')
  const s = await Student.findById(id).select('+photo sectionId').lean()
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  return { photo: s.photo || null }
}

export async function setStudentPhoto(id, photo, auth, req) {
  if (!isOid(id)) throw notFound('Student')
  const s = await Student.findById(id)
  if (!s) throw notFound('Student')
  await assertInScope(s, auth)
  s.photo = photo || undefined
  await s.save()
  await audit({ action: 'UPDATE', module: 'students', entityType: 'student', entityId: String(s._id), entityName: `${studentName(s)} (${s.admissionNo})`, studentId: s._id, summary: photo ? 'Updated the student’s photo' : 'Removed the student’s photo' }, req)
  return { photo: photo || null }
}

/** Public: the card's QR. Only what the card itself shows — name and class — and whether the holder studies here now. */
export async function verifyStudentCard(code) {
  const want = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{8,14}$/.test(want)) return { found: false }
  return runAsSystem(async () => {
    const s = await Student.findOne({ cardCode: want }).setOptions({ allTenants: true }).select('firstName middleName lastName status sectionId tenantId').lean()
    if (!s) return { found: false }
    const [t, sec] = await Promise.all([Tenant.findById(s.tenantId).select('name profile.city').lean(), s.sectionId ? Section.findById(s.sectionId).setOptions({ allTenants: true }).lean() : null])
    const cls = sec ? await ClassLevel.findById(sec.classId).setOptions({ allTenants: true }).select('name code').lean() : null
    return { found: true, valid: s.status === 'ACTIVE', name: studentName(s), class: s.status === 'ACTIVE' && sec ? sectionLabel(cls, sec) : null, institution: { name: t?.name ?? null, city: t?.profile?.city ?? null } }
  })
}
