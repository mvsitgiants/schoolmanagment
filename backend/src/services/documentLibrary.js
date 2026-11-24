import { once } from 'node:events'
import { Zip, ZipPassThrough } from 'fflate'
import {
  CERTIFICATE_KIND_BY, DEFAULT_ADMISSION_DOCS, DOCUMENT_RECORD_TYPES, FILE_CATEGORIES, FILE_CATEGORY_LABEL, RECORD_TYPES, SCHOLARSHIP_DOC_TYPE_BY, addDaysYmd, formatINR,
} from '@schoolgiant/shared'
import { Certificate } from '../models/certificates.js'
import { FeePayment } from '../models/fees.js'
import { Plan, Tenant } from '../models/platform.js'
import { ScholarshipDocument } from '../models/scholarships.js'
import { TransferCertificate } from '../models/students.js'
import { Branch } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { emit } from '../platform/events.js'
import { institutionNow } from '../platform/time.js'
import { limitsFor } from './subscription.js'
import { ClassLevel, Section } from '../models/academics.js'
import { Attachment } from '../models/engines.js'
import { Candidate, Employee } from '../models/hrms.js'
import { Application } from '../models/admissions.js'
import { AdmissionForm } from '../models/students.js'
import { Student } from '../models/students.js'
import { scopeOf } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { isOid, oid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { readStream } from '../platform/storage.js'
import { escapeRegex } from '../platform/validate.js'
import { sectionsInScope, yearOrCurrent } from './academics.js'
import { studentLabels } from './fees.js'
import { canSeeRecordType } from './files.js'

// Documents (module `documents`, always on): every file the institution keeps — students' papers, staff records,
// applicants', and the school's own (notices, homework sheets, bills…) — in one place to find, preview and download
// many at once. Nothing is copied: it reads the same `attachments` every screen uploads to (services/files.js).
//
// Who sees what: only record types the role may open (files.js RECORDS), and within them the role's data scope for
// `documents` — ALL; BRANCH (the campus's students, staff and school files); CLASS (the students they teach); OWN
// (their own staff record and what they uploaded). Staff chat files never show here.

const NEVER = ['chat_message']
const APPLICANT_TYPES = ['candidate', 'application', 'admission_form']
const PERSONAL_TYPES = [...DOCUMENT_RECORD_TYPES, 'scholarship_doc']
const MAX_ZIP_FILES = 2000
const MAX_ZIP_BYTES = 2 * 1024 ** 3 // 2 GB in one download

/** The files a person may see, as a filter. */
async function scopeMatch(auth) {
  const types = Object.keys(RECORD_TYPES).filter((t) => !NEVER.includes(t) && canSeeRecordType(auth, t))
  const base = { entityType: { $in: types }, 'deleted.at': null, linkOf: null } // a paper used again elsewhere shows once
  const scope = auth.fullAccess ? 'ALL' : scopeOf(auth, 'documents')
  if (scope === 'ALL') return base
  const me = auth.userId ? await Employee.findOne({ userId: auth.userId }).select('_id').lean() : null
  const own = [...(auth.userId ? [{ uploadedById: oid(auth.userId) }] : []), ...(me ? [{ entityType: 'employee', entityId: String(me._id) }] : [])]
  if (scope === 'OWN') return { ...base, $or: own.length ? own : [{ _id: null }] }
  const sections = await sectionsInScope(auth, 'documents') // BRANCH: the campus's sections · CLASS: the ones they teach
  const studentIds = sections ? (await Student.find({ sectionId: { $in: sections.map(oid) } }).select('_id').lean()).map((s) => s._id) : null
  const or = [...own, studentIds ? { studentId: { $in: studentIds } } : { studentId: { $ne: null } }]
  if (scope === 'BRANCH') {
    const staff = (await Employee.find(auth.user?.branchId ? { branchId: auth.user.branchId } : {}).select('_id').lean()).map((e) => String(e._id))
    or.push({ entityType: 'employee', entityId: { $in: staff } }, { studentId: null, entityType: { $nin: ['employee', ...APPLICANT_TYPES] } }, { studentId: null, entityType: { $in: APPLICANT_TYPES } })
  }
  return { ...base, $or: or }
}

const PERSON_FILTER = {
  STUDENT: { studentId: { $ne: null } },
  STAFF: { entityType: 'employee' },
  APPLICANT: { studentId: null, entityType: { $in: APPLICANT_TYPES } },
  SCHOOL: { studentId: null, entityType: { $nin: ['employee', ...APPLICANT_TYPES] } },
}
const personKind = (a) => (a.studentId ? 'STUDENT' : a.entityType === 'employee' ? 'STAFF' : APPLICANT_TYPES.includes(a.entityType) ? 'APPLICANT' : 'SCHOOL')

/** Students of a class or section (this year's sections). */
async function studentsOf({ classId, sectionId }) {
  if (sectionId) return (await Student.find({ sectionId: oid(sectionId) }).select('_id').lean()).map((s) => s._id)
  const year = await yearOrCurrent().catch(() => null)
  const sections = await Section.find({ classId: oid(classId), ...(year && { academicYearId: year._id }) }).select('_id').lean()
  return (await Student.find({ $or: [{ classId: oid(classId) }, { sectionId: { $in: sections.map((s) => s._id) } }] }).select('_id').lean()).map((s) => s._id)
}

/** The whole filter of a library query. */
async function filterFor(q, auth) {
  const and = [await scopeMatch(auth)]
  if (q.ids?.length) and.push({ _id: { $in: q.ids.map(oid) } })
  if (q.kinds?.length) and.push({ category: { $in: q.kinds } })
  if (q.kind) and.push({ category: q.kind })
  if (q.source) and.push({ entityType: q.source })
  if (q.person) and.push(PERSON_FILTER[q.person])
  if (q.checked === 'PENDING') and.push({ entityType: { $in: DOCUMENT_RECORD_TYPES }, 'verification.status': { $in: [null, 'PENDING'] } })
  else if (q.checked) and.push({ 'verification.status': q.checked })
  if (q.from || q.to) and.push({ createdAt: { ...(q.from && { $gte: new Date(`${q.from}T00:00:00`) }), ...(q.to && { $lte: new Date(`${q.to}T23:59:59`) }) } })
  if (q.studentId) and.push({ studentId: oid(q.studentId) })
  if (q.employeeId) and.push({ entityType: 'employee', entityId: String(q.employeeId) })
  if (q.classId || q.sectionId) and.push({ studentId: { $in: await studentsOf(q) } })
  const s = String(q.search ?? '').trim()
  if (s) {
    const re = new RegExp(escapeRegex(s), 'i')
    const [students, staff] = await Promise.all([
      Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).select('_id').limit(500).lean(),
      Employee.find({ $or: [{ name: re }, { employeeCode: re }] }).select('_id').limit(200).lean(),
    ])
    and.push({ $or: [{ fileName: re }, { title: re }, { studentId: { $in: students.map((x) => x._id) } }, { entityType: 'employee', entityId: { $in: staff.map((x) => String(x._id)) } }] })
  }
  return { $and: and }
}

/** Who each file is about, for showing and for ZIP folder names. */
async function peopleOf(rows) {
  const idsOf = (type) => rows.filter((a) => !a.studentId && a.entityType === type && isOid(a.entityId)).map((a) => oid(a.entityId))
  const [students, staff, forms, apps, candidates] = await Promise.all([
    studentLabels([...new Set(rows.filter((a) => a.studentId).map((a) => String(a.studentId)))].map(oid)),
    Employee.find({ _id: { $in: rows.filter((a) => a.entityType === 'employee' && isOid(a.entityId)).map((a) => oid(a.entityId)) } }).select('name employeeCode designation').lean()
      .then((x) => new Map(x.map((e) => [String(e._id), e]))),
    AdmissionForm.find({ _id: { $in: idsOf('admission_form') } }).select('childName data.firstName data.lastName').lean().then((x) => new Map(x.map((f) => [String(f._id), [f.data?.firstName, f.data?.lastName].filter(Boolean).join(' ') || f.childName || null]))),
    Application.find({ _id: { $in: idsOf('application') } }).select('applicationNo child.firstName child.lastName').lean().then((x) => new Map(x.map((a) => [String(a._id), { name: [a.child?.firstName, a.child?.lastName].filter(Boolean).join(' ') || null, no: a.applicationNo }]))),
    Candidate.find({ _id: { $in: idsOf('candidate') } }).select('name').lean().then((x) => new Map(x.map((c) => [String(c._id), c.name]))),
  ])
  return (a) => {
    const kind = personKind(a)
    if (kind === 'STUDENT') {
      const s = students.get(String(a.studentId))
      return { kind, id: String(a.studentId), name: s?.name ?? null, sub: s?.admissionNo ?? null, classShort: s?.classShort ?? null, classId: s?.classId ?? null }
    }
    if (kind === 'STAFF') {
      const e = staff.get(String(a.entityId))
      return { kind, id: String(a.entityId), name: e?.name ?? null, sub: [e?.employeeCode, e?.designation].filter(Boolean).join(' · ') || null }
    }
    if (kind === 'APPLICANT') {
      const id = String(a.entityId)
      if (a.entityType === 'application') { const x = apps.get(id); return { kind, id, name: x?.name ?? null, sub: x?.no ?? null } }
      return { kind, id, name: (a.entityType === 'candidate' ? candidates.get(id) : forms.get(id)) ?? null, sub: a.entityType === 'candidate' ? 'Job candidate' : 'Admission form' }
    }
    return { kind, id: null, name: null, sub: null }
  }
}

const dto = (a, person) => ({
  id: String(a._id), fileName: a.fileName, contentType: a.mime, size: a.size, title: a.title ?? null, side: a.side ?? null,
  category: a.category, categoryLabel: FILE_CATEGORY_LABEL[a.category] ?? a.category,
  source: a.entityType, sourceLabel: RECORD_TYPES[a.entityType] ?? a.entityType, entityId: a.entityId,
  verification: a.verification?.status ? { status: a.verification.status, by: a.verification.by ?? null, at: a.verification.at ?? null, note: a.verification.note ?? null } : null,
  personal: PERSONAL_TYPES.includes(a.entityType) || !!a.studentId,
  uploadedBy: a.uploadedBy ?? null, uploadedAt: a.createdAt, person: person(a),
})

/** The library: files a page at a time (newest first) and the picture of everything the filter covers. */
export async function listDocuments(q, auth) {
  const filter = await filterFor(q, auth)
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 50
  const [rows, [sum]] = await Promise.all([
    Attachment.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Attachment.aggregate([{ $match: filter }, { $facet: {
      total: [{ $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: '$size' } } }],
      byKind: [{ $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      people: [{ $match: { studentId: { $ne: null } } }, { $group: { _id: '$studentId' } }, { $count: 'n' }],
      unchecked: [{ $match: { entityType: { $in: DOCUMENT_RECORD_TYPES }, 'verification.status': { $in: [null, 'PENDING'] } } }, { $count: 'n' }],
    } }]),
  ])
  const person = await peopleOf(rows)
  return {
    rows: rows.map((a) => dto(a, person)),
    total: sum.total[0]?.n ?? 0, page, pageSize,
    summary: {
      files: sum.total[0]?.n ?? 0, bytes: sum.total[0]?.bytes ?? 0, students: sum.people[0]?.n ?? 0, unchecked: sum.unchecked[0]?.n ?? 0,
      byKind: sum.byKind.map((k) => ({ kind: k._id, label: FILE_CATEGORY_LABEL[k._id] ?? k._id, n: k.n })),
    },
  }
}

/** What the filters offer: the kinds of documents, the places they come from (that the person may see), the classes. */
export async function documentsMeta(auth) {
  const year = await yearOrCurrent().catch(() => null)
  const [classes, sections] = await Promise.all([
    ClassLevel.find().select('name order').sort({ order: 1, name: 1 }).lean(),
    year ? Section.find({ academicYearId: year._id }).select('name classId').lean() : [],
  ])
  const inScope = await sectionsInScope(auth, 'documents')
  const mine = inScope ? new Set(inScope) : null
  const visibleSections = sections.filter((s) => !mine || mine.has(String(s._id)))
  return {
    kinds: FILE_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    sources: Object.keys(RECORD_TYPES).filter((t) => !NEVER.includes(t) && canSeeRecordType(auth, t)).map((t) => ({ value: t, label: RECORD_TYPES[t] })),
    classes: classes.filter((c) => !mine || visibleSections.some((s) => String(s.classId) === String(c._id))).map((c) => ({ id: String(c._id), name: c.name })),
    sections: visibleSections.map((s) => ({ id: String(s._id), classId: String(s.classId), name: s.name })),
  }
}

// ───────────────────────────────────────────────────────── download many as one ZIP

const safe = (s, max = 80) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'file'

/**
 * Picked files, one student's everything, or a whole class (optionally only some kinds) as one ZIP, streamed: a
 * folder per person ("2026014 Aarav Sharma/Birth certificate - scan.pdf"), the school's own files by where they
 * came from. Only what the person may see goes in.
 */
export async function zipDocuments(q, auth, req, res) {
  if (!q.ids?.length && !q.studentId && !q.employeeId && !q.classId && !q.sectionId) throw badRequest('Pick files, a student or a class to download.')
  const filter = await filterFor(q, auth)
  const files = await Attachment.find(filter).sort({ studentId: 1, category: 1, createdAt: 1 }).limit(MAX_ZIP_FILES + 1).lean()
  if (!files.length) throw notFound('Documents')
  if (files.length > MAX_ZIP_FILES) throw badRequest(`That is more than ${MAX_ZIP_FILES} files. Download one class (or one kind of document) at a time.`)
  const bytes = files.reduce((n, a) => n + (a.size ?? 0), 0)
  if (bytes > MAX_ZIP_BYTES) throw badRequest('That is more than 2 GB. Download one class (or one kind of document) at a time.')
  const person = await peopleOf(files)
  const used = new Set()
  const pathOf = (a) => {
    const p = person(a)
    const folder = p.kind === 'STUDENT' || p.kind === 'STAFF' ? safe([p.sub?.split(' · ')[0], p.name].filter(Boolean).join(' '))
      : p.kind === 'APPLICANT' ? `Applicants/${safe(`${p.name ?? p.sub ?? 'Applicant'}${p.sub && p.name ? ` (${p.sub})` : ''}`)}`
        : safe(`School - ${RECORD_TYPES[a.entityType] ?? a.entityType}`)
    const kind = a.title || (a.category && a.category !== 'OTHER' ? FILE_CATEGORY_LABEL[a.category] : '')
    const base = safe(kind ? `${kind} - ${a.fileName}` : a.fileName, 120)
    let name = `${folder}/${base}`
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${folder}/${base.replace(/(\.[^.]+)?$/, ` (${i})$1`)}`
    used.add(name.toLowerCase())
    return name
  }
  const zipName = safe(q.name || 'documents', 60).replace(/\s+/g, '-')
  await audit({ action: 'EXPORT', module: 'documents', entityType: 'document_zip', entityId: 'zip', entityName: zipName, studentId: q.studentId ?? undefined, summary: `Downloaded ${files.length} document(s) as a ZIP (${Math.round(bytes / 1e5) / 10} MB)` }, req)

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`)
  const zip = new Zip()
  let failed = null
  zip.ondata = (err, chunk, final) => {
    if (err) { failed = err; return }
    res.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    if (final) res.end()
  }
  for (const a of files) {
    if (failed || res.destroyed) break
    const entry = new ZipPassThrough(pathOf(a)) // pictures and PDFs are already compressed: stored as they are
    entry.mtime = new Date(a.createdAt)
    zip.add(entry)
    try {
      const stream = await readStream(a.storageKey)
      for await (const chunk of stream) {
        entry.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
        if (res.writableNeedDrain) await once(res, 'drain')
      }
    } catch { /* a missing file: the entry ends empty rather than breaking the whole download */ }
    entry.push(new Uint8Array(0), true)
  }
  zip.end()
  if (failed) res.destroy(failed)
}

// ───────────────────────────────────────────────────────── what is still to come (the admission checklist)

const today = async () => (await institutionNow()).date

/** Students the person may see (their data scope for documents), optionally one class or section; current students only. */
async function studentsInScope(auth, { classId, sectionId } = {}) {
  const sections = await sectionsInScope(auth, 'documents')
  const filter = { status: 'ACTIVE' }
  if (sections) filter.sectionId = { $in: sections.map(oid) }
  if (sectionId) filter.sectionId = sections && !sections.includes(String(sectionId)) ? { $in: [] } : oid(sectionId)
  else if (classId) filter._id = { $in: await studentsOf({ classId }) }
  return Student.find(filter).select('_id branchId sectionId').lean()
}

/** "studentId|KIND" for every kind of paper held: files on the student, and the photo kept on the student's profile. */
async function papersHeld(studentIds) {
  const [held, photos] = await Promise.all([
    Attachment.aggregate([{ $match: { studentId: { $in: studentIds }, 'deleted.at': null } }, { $group: { _id: { s: '$studentId', c: '$category' } } }]),
    Student.find({ _id: { $in: studentIds }, photo: { $exists: true, $nin: [null, ''] } }).select('_id').lean(),
  ])
  return new Set([...held.map((h) => `${h._id.s}|${h._id.c}`), ...photos.map((p) => `${p._id}|PHOTO`)])
}

/** Each campus's admission checklist (Campuses › documents at admission), the default where a campus has none. */
async function checklists() {
  const branches = await Branch.find().select('admissionDocs isDefault').lean()
  const main = branches.find((b) => b.isDefault)
  const of = new Map(branches.map((b) => [String(b._id), b.admissionDocs?.length ? b.admissionDocs : DEFAULT_ADMISSION_DOCS]))
  return (branchId) => of.get(String(branchId ?? main?._id)) ?? DEFAULT_ADMISSION_DOCS
}

/**
 * Students still missing papers from their campus's admission checklist, the ones needed at admission (NOW) first:
 * [{ student, missing: [{ category, when }], have }]. A paper counts when any file of its kind is on the student.
 */
export async function missingDocuments({ classId, sectionId, kind, page = 1, pageSize = 50 } = {}, auth) {
  const students = await studentsInScope(auth, { classId, sectionId })
  const listOf = await checklists()
  const has = await papersHeld(students.map((x) => x._id))
  let rows = students.map((st) => {
    const list = listOf(st.branchId)
    const missing = list.filter((d) => !has.has(`${st._id}|${d.category}`)).map((d) => ({ category: d.category, when: d.when ?? 'LATER' }))
    return { id: String(st._id), missing, total: list.length }
  }).filter((r) => r.missing.length)
  const byKind = {}
  for (const r of rows) for (const m of r.missing) byKind[m.category] = (byKind[m.category] ?? 0) + 1
  if (kind) rows = rows.filter((r) => r.missing.some((m) => m.category === kind))
  rows.sort((a, b) => Number(b.missing.some((m) => m.when === 'NOW')) - Number(a.missing.some((m) => m.when === 'NOW')) || b.missing.length - a.missing.length)
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const names = await studentLabels(pageRows.map((r) => oid(r.id)))
  return {
    rows: pageRows.map((r) => ({ ...r, student: names.get(r.id) ?? null, missing: r.missing.map((m) => ({ ...m, label: FILE_CATEGORY_LABEL[m.category] ?? m.category })) })),
    total: rows.length, page, pageSize,
    summary: {
      students: students.length, missingStudents: rows.length, neededNow: rows.filter((r) => r.missing.some((m) => m.when === 'NOW')).length,
      byKind: Object.entries(byKind).map(([k, n]) => ({ kind: k, label: FILE_CATEGORY_LABEL[k] ?? k, n })).sort((a, b) => b.n - a.n),
    },
    ids: rows.slice(0, 2000).map((r) => r.id), // "tell all of them"
  }
}

/**
 * Checked scholarship documents (income certificate, mark sheet…) that run out within `days` — or have run out —
 * for current students in scope: the office asks for a new one before it is needed.
 */
export async function expiringDocuments({ days = 60, page = 1, pageSize = 50 } = {}, auth) {
  const t = await today()
  const students = await studentsInScope(auth)
  const docs = await ScholarshipDocument.find({ studentId: { $in: students.map((x) => x._id) }, status: 'ACCEPTED', validTill: { $lte: addDaysYmd(t, days) } }).sort({ validTill: 1 }).lean()
  const pageRows = docs.slice((page - 1) * pageSize, page * pageSize)
  const names = await studentLabels(pageRows.map((d) => d.studentId))
  return {
    rows: pageRows.map((d) => ({
      id: String(d._id), studentId: String(d.studentId), student: names.get(String(d.studentId)) ?? null, type: d.type, label: d.type === 'OTHER' ? d.label : SCHOLARSHIP_DOC_TYPE_BY[d.type]?.label ?? d.type,
      issuedOn: d.issuedOn ?? null, validTill: d.validTill, expired: d.validTill < t,
    })),
    total: docs.length, page, pageSize,
    summary: { expired: docs.filter((d) => d.validTill < t).length, soon: docs.filter((d) => d.validTill >= t).length },
    ids: [...new Set(docs.map((d) => String(d.studentId)))].slice(0, 2000),
  }
}

/** One message to each family: the papers still missing from the checklist, and any about to run out. */
export async function tellMissing(studentIds, auth, req) {
  const allowed = new Set((await studentsInScope(auth)).map((x) => String(x._id)))
  const listOf = await checklists()
  const t = await today()
  const ids = studentIds.filter((id) => allowed.has(String(id)))
  const [students, has, expiring, names] = await Promise.all([
    Student.find({ _id: { $in: ids.map(oid) } }).select('branchId').lean(),
    papersHeld(ids.map(oid)),
    ScholarshipDocument.find({ studentId: { $in: ids.map(oid) }, status: 'ACCEPTED', validTill: { $lte: addDaysYmd(t, 60) } }).lean(),
    studentLabels(ids.map(oid)),
  ])
  let sent = 0
  for (const st of students) {
    const lines = [
      ...listOf(st.branchId).filter((d) => !has.has(`${st._id}|${d.category}`)).map((d) => `• ${FILE_CATEGORY_LABEL[d.category] ?? d.category}`),
      ...expiring.filter((d) => String(d.studentId) === String(st._id)).map((d) => `• ${SCHOLARSHIP_DOC_TYPE_BY[d.type]?.label ?? d.label ?? d.type} — ${d.validTill < t ? 'the one we have has run out' : `runs out on ${d.validTill}`}; please send a new one`),
    ]
    if (!lines.length) continue
    await emit('documents.missing', { studentId: String(st._id), data: { student: { class: names.get(String(st._id))?.classShort ?? '' }, documents: { list: lines.join('\n') } } })
    sent++
  }
  await audit({ action: 'SEND', module: 'documents', entityType: 'documents_missing', entityId: 'missing', entityName: 'Papers still to give', summary: `Asked ${sent} famil${sent === 1 ? 'y' : 'ies'} for the papers still missing` }, req)
  return { sent }
}

// ───────────────────────────────────────────────────────── what the school has issued

/**
 * Everything the institution issued — certificates, transfer certificates, fee receipts, staff letters — newest first,
 * each kind only when the person's role may see it, students within their data scope. Reprint from the same list.
 */
export async function issuedDocuments({ type, from, to, search, page = 1, pageSize = 50 } = {}, auth) {
  const t = await today()
  const since = from ?? addDaysYmd(t, -365)
  const until = to ?? t
  const scoped = await studentsInScope(auth).then((x) => x.map((y) => y._id))
  const sections = await sectionsInScope(auth, 'documents')
  const studentFilter = sections ? { studentId: { $in: scoped } } : {}
  const re = search ? new RegExp(escapeRegex(String(search).trim()), 'i') : null
  const studentMatch = re ? (await Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).select('_id').limit(500).lean()).map((x) => x._id) : null
  const sm = (noField) => (re ? { $or: [{ [noField]: re }, { studentId: { $in: studentMatch } }] } : {})
  const want = (k) => !type || type === k
  const out = []
  if (want('CERTIFICATE') && can(auth, 'certificates.register.view')) {
    const rows = await Certificate.find({ ...studentFilter, issueDate: { $gte: since, $lte: until }, ...sm('certificateNo') }).sort({ issueDate: -1 }).limit(1000).lean()
    for (const c of rows) out.push({ type: 'CERTIFICATE', id: String(c._id), no: c.certificateNo, title: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, date: c.issueDate, studentId: String(c.studentId), status: c.status, print: { kind: 'CERTIFICATE', id: String(c._id) } })
  }
  if (want('TC') && can(auth, 'students.transfer.view')) {
    const rows = await TransferCertificate.find({ ...studentFilter, status: { $in: ['ISSUED', 'CANCELLED'] }, issuedAt: { $gte: new Date(`${since}T00:00:00`), $lte: new Date(`${until}T23:59:59`) }, ...sm('tcNo') }).sort({ issuedAt: -1 }).limit(1000).lean()
    for (const c of rows) out.push({ type: 'TC', id: String(c._id), no: c.tcNo, title: 'Transfer certificate', date: c.issuedAt?.toISOString().slice(0, 10), studentId: String(c.studentId), status: c.status, print: { kind: 'TRANSFER_CERTIFICATE', id: String(c._id) } })
  }
  if (want('RECEIPT') && can(auth, 'fees.invoices.view')) {
    const rows = await FeePayment.find({ ...studentFilter, date: { $gte: since, $lte: until }, ...sm('receiptNo') }).sort({ date: -1, at: -1 }).limit(2000).lean()
    for (const p of rows) out.push({ type: 'RECEIPT', id: String(p._id), no: p.receiptNo, title: `Fee receipt — ${formatINR(p.amount)}`, date: p.date, studentId: String(p.studentId), status: p.status === 'CANCELLED' ? 'CANCELLED' : 'ISSUED', print: { kind: 'FEE_RECEIPT', id: String(p._id) } })
  }
  if (want('LETTER') && can(auth, 'hrms.employees.view') && (!sections || auth.fullAccess)) {
    const staff = await Employee.find({ 'letters.0': { $exists: true }, ...(re && { $or: [{ name: re }, { employeeCode: re }] }) }).select('name employeeCode letters').lean()
    for (const e of staff) {
      for (const l of e.letters ?? []) {
        const day = l.at ? new Date(l.at).toISOString().slice(0, 10) : null
        if (!day || day < since || day > until) continue
        out.push({ type: 'LETTER', id: `${e._id}:${l.doc}:${day}`, no: l.ref ?? null, title: l.doc, date: day, person: { name: e.name, sub: e.employeeCode }, status: 'ISSUED', print: { kind: l.doc, id: String(e._id) } })
      }
    }
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const byType = {}
  for (const x of out) byType[x.type] = (byType[x.type] ?? 0) + 1
  const pageRows = out.slice((page - 1) * pageSize, page * pageSize)
  const names = await studentLabels(pageRows.filter((x) => x.studentId).map((x) => oid(x.studentId)))
  return {
    rows: pageRows.map((x) => (x.studentId ? { ...x, person: names.get(x.studentId) ? { name: names.get(x.studentId).name, sub: names.get(x.studentId).admissionNo, classShort: names.get(x.studentId).classShort, classId: names.get(x.studentId).classId } : null } : x)),
    total: out.length, page, pageSize, from: since, to: until, summary: { byType },
  }
}

// ───────────────────────────────────────────────────────── removed files (recycle bin) and space

/** Files removed from records (never destroyed): who removed them and why, newest first. */
export async function removedDocuments({ search, page = 1, pageSize = 50 } = {}, auth) {
  const base = await scopeMatch(auth)
  const filter = { ...base, 'deleted.at': { $ne: null }, ...(search && { $or: [{ fileName: new RegExp(escapeRegex(String(search).trim()), 'i') }, { 'deleted.reason': new RegExp(escapeRegex(String(search).trim()), 'i') }] }) }
  const [rows, total] = await Promise.all([
    Attachment.find(filter).sort({ 'deleted.at': -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Attachment.countDocuments(filter),
  ])
  const person = await peopleOf(rows)
  return { rows: rows.map((a) => ({ ...dto(a, person), removed: { at: a.deleted.at, by: a.deleted.by ?? null, reason: a.deleted.reason ?? null } })), total, page, pageSize }
}

/** Put a removed file back on its record. */
export async function restoreDocument(id, auth, req) {
  const base = await scopeMatch(auth)
  const a = isOid(id) ? await Attachment.findOne({ ...base, _id: oid(id), 'deleted.at': { $ne: null } }) : null
  if (!a) throw notFound('Removed file')
  const was = a.deleted
  a.deleted = undefined
  await a.save()
  await audit({ action: 'UPDATE', module: 'documents', entityType: 'attachment', entityId: String(a._id), entityName: a.fileName, studentId: a.studentId, summary: `Restored “${a.fileName}” (removed by ${was?.by ?? '—'}: ${was?.reason ?? ''})` }, req)
  return { restored: true }
}

/** Space the institution's files take, and what its plan allows (GB). */
export async function storageUse(auth) {
  // exact bytes (the plan's own counter rounds to whole MB); a paper used again elsewhere shares the original's bytes
  const [[sum], tenant] = await Promise.all([
    Attachment.aggregate([{ $match: { linkOf: null } }, { $group: { _id: null, bytes: { $sum: '$size' } } }]),
    Tenant.findById(auth.tenantId).lean(),
  ])
  const plan = tenant ? await Plan.findOne({ code: tenant.planCode }).lean() : null
  const bytes = sum?.bytes ?? 0
  return { bytes, usedGb: bytes / 1e9, limitGb: tenant ? limitsFor(tenant, plan).storageGb ?? null : null }
}

