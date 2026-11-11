import { LEAVER_STATUSES, alumniBatchOf, linkedInUrl } from '@schoolgiant/shared'
import { Alumnus, AlumniDonation } from '../models/alumni.js'
import { Company, PlacementOffer } from '../models/placements.js'
import { Program, ProgramEnrolment } from '../models/programs.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { institutionNow, timeZoneOf, ymdIn } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'
import { placesOf } from './placements.js'

// Alumni directory (module `alumni`): former students — imported from the student records of a year's leavers (left
// or passed out) or added by hand — with their batch (passing-out year), program or last class, where they work now,
// how to reach them and whether they agree to be contacted. Donations are services/alumniDonations.js.

export const today = async () => (await institutionNow()).date
const rx = (s) => new RegExp(escapeRegex(String(s)), 'i')
const idStr = (v) => (v ? String(v) : null)

const alumnusOut = (a, given) => ({ ...clean(a), studentId: idStr(a.studentId), programId: idStr(a.programId), linkedIn: a.linkedIn ?? null, given: given ?? undefined })

/** Batches with their counts, programs in use, and the directory's totals. */
export async function alumniMeta() {
  const [batches, programs, totals, programNames] = await Promise.all([
    Alumnus.aggregate([{ $match: { active: true } }, { $group: { _id: '$batch', n: { $sum: 1 }, consent: { $sum: { $cond: ['$consent', 1, 0] } } } }, { $sort: { _id: -1 } }]),
    Program.find({ active: true }).select('name code').sort({ code: 1 }).lean(),
    Alumnus.aggregate([{ $match: { active: true } }, { $group: { _id: null, n: { $sum: 1 }, consent: { $sum: { $cond: ['$consent', 1, 0] } }, working: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$organisation', ''] } }, 0] }, 1, 0] } } } }]),
    Alumnus.distinct('program', { active: true }),
  ])
  return {
    batches: batches.map((b) => ({ batch: b._id, count: b.n, consent: b.consent })),
    programs: programs.map((p) => ({ id: String(p._id), name: p.name, code: p.code })),
    programNames: programNames.filter(Boolean).sort(),
    totals: { alumni: totals[0]?.n ?? 0, consent: totals[0]?.consent ?? 0, working: totals[0]?.working ?? 0 },
    today: await today(),
  }
}

function directoryFilter({ batch, search, consent, program }) {
  const f = { active: true }
  if (batch) f.batch = Number(batch)
  if (consent === '1') f.consent = true
  if (consent === '0') f.consent = { $ne: true }
  if (program) f.program = program
  if (search) {
    const re = rx(search)
    f.$or = [{ name: re }, { organisation: re }, { designation: re }, { city: re }, { email: re }, { mobile: re }, { admissionNo: re }, { program: re }]
  }
  return f
}

export async function listAlumni(q = {}) {
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 50
  const f = directoryFilter(q)
  const [rows, total] = await Promise.all([Alumnus.find(f).sort({ batch: -1, name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), Alumnus.countDocuments(f)])
  const given = await AlumniDonation.aggregate([{ $match: { 'donor.alumnusId': { $in: rows.map((r) => r._id) }, status: 'RECEIVED' } }, { $group: { _id: '$donor.alumnusId', amount: { $sum: '$amount' }, n: { $sum: 1 } } }])
  const by = new Map(given.map((g) => [String(g._id), { amount: g.amount, count: g.n }]))
  return { data: rows.map((a) => alumnusOut(a, by.get(String(a._id)))), total, page, pageSize }
}

export async function getAlumnus(id) {
  const a = isOid(id) ? await Alumnus.findById(id).lean() : null
  if (!a) throw notFound('Alumnus')
  const donations = await AlumniDonation.find({ 'donor.alumnusId': a._id }).sort({ date: -1 }).lean()
  return { ...alumnusOut(a), donations: donations.map((d) => ({ id: String(d._id), receiptNo: d.receiptNo, date: d.date, amount: d.amount, fund: d.fund, status: d.status })) }
}

export async function saveAlumnus(id, input, auth, req) {
  const body = { ...input }
  if (body.linkedIn) body.linkedIn = linkedInUrl(body.linkedIn)
  if (body.programId) {
    const p = await Program.findById(body.programId).select('name').lean()
    if (!p) throw badRequest('Pick a program from the list.', { fields: { programId: 'Not found' } })
    if (!body.program) body.program = p.name
  }
  let a
  if (id) {
    a = await Alumnus.findById(id)
    if (!a) throw notFound('Alumnus')
    a.set(body)
    await a.save()
  } else {
    a = await Alumnus.create({ ...body, source: 'MANUAL', createdBy: auth.user?.name })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'alumni', entityType: 'alumnus', entityId: String(a._id), entityName: a.name, ...(a.studentId && { studentId: a.studentId }), summary: `${id ? 'Updated' : 'Added'} ${a.name} (batch ${a.batch}) in the alumni directory` }, req)
  return getAlumnus(a._id)
}

/**
 * Take someone out of the directory. A hand-made entry with no donations is deleted; one that came from a
 * student record, or that has donations on record, is only hidden (active: false) so receipts keep their donor
 * and the leaver isn't imported again.
 */
export async function deleteAlumnus(id, req) {
  const a = isOid(id) ? await Alumnus.findById(id) : null
  if (!a) throw notFound('Alumnus')
  const keep = a.studentId || await AlumniDonation.exists({ 'donor.alumnusId': a._id })
  if (keep) {
    a.active = false
    await a.save()
    await audit({ action: 'UPDATE', module: 'alumni', entityType: 'alumnus', entityId: String(a._id), entityName: a.name, ...(a.studentId && { studentId: a.studentId }), summary: `Removed ${a.name} from the alumni directory (kept on record)` }, req)
    return { deleted: false, deactivated: true }
  }
  await a.deleteOne()
  await audit({ action: 'DELETE', module: 'alumni', entityType: 'alumnus', entityId: String(a._id), entityName: a.name, summary: `Deleted ${a.name} from the alumni directory` }, req)
  return { deleted: true }
}

// ───────────────────────────────────────────────────────── leavers → alumni

async function leavers() {
  const tz = await timeZoneOf()
  const rows = await Student.find({ status: { $in: LEAVER_STATUSES } }).select('firstName middleName lastName admissionNo gender status leaving updatedAt sectionId history mobile email guardians address branchId').lean()
  return rows.map((s) => ({ ...s, batch: alumniBatchOf(s.leaving?.date, ymdIn(s.updatedAt ?? new Date(), tz)) }))
}

/** Years that have leavers, with how many are in the directory already. */
export async function leaverYears() {
  const [all, imported] = await Promise.all([leavers(), Alumnus.find({ studentId: { $type: 'objectId' } }).select('studentId').lean()])
  const done = new Set(imported.map((a) => String(a.studentId)))
  const by = new Map()
  for (const s of all) {
    if (!s.batch) continue
    const r = by.get(s.batch) ?? { year: s.batch, leavers: 0, imported: 0 }
    r.leavers++
    if (done.has(String(s._id))) r.imported++
    by.set(s.batch, r)
  }
  return [...by.values()].sort((a, b) => b.year - a.year)
}

/** What a leaver becomes in the directory: name, batch, program (or last class), contact, and the job they took (an accepted placement offer). */
async function fromStudents(students) {
  const ids = students.map((s) => s._id)
  const [enrolments, offers, places] = await Promise.all([
    ProgramEnrolment.find({ studentId: { $in: ids } }).select('studentId programId').lean(),
    PlacementOffer.find({ studentId: { $in: ids }, status: 'ACCEPTED' }).sort({ ctc: -1 }).select('studentId companyId role location').lean(),
    placesOf(students),
  ])
  const programs = await Program.find({ _id: { $in: enrolments.map((e) => e.programId) } }).select('name').lean()
  const companies = await Company.find({ _id: { $in: offers.map((o) => o.companyId) } }).select('name').lean()
  const prog = new Map(programs.map((p) => [String(p._id), p.name]))
  const co = new Map(companies.map((c) => [String(c._id), c.name]))
  const enr = new Map(enrolments.map((e) => [String(e.studentId), e]))
  const job = new Map()
  for (const o of offers) if (!job.has(String(o.studentId))) job.set(String(o.studentId), o)
  return students.map((s) => {
    const e = enr.get(String(s._id))
    const o = job.get(String(s._id))
    const g = s.guardians?.find((x) => x.isPrimary) ?? s.guardians?.[0]
    const lastClass = places.get(idStr(s.sectionId))?.label ?? [...(s.history ?? [])].reverse().find((h) => h.classLabel)?.classLabel
    return {
      studentId: s._id, name: studentName(s), gender: s.gender, admissionNo: s.admissionNo, batch: s.batch, branchId: s.branchId,
      programId: e?.programId, program: (e && prog.get(String(e.programId))) || lastClass || undefined,
      email: s.email || g?.email || undefined, mobile: s.mobile || g?.mobile || undefined, city: s.address?.city || undefined,
      organisation: o ? co.get(String(o.companyId)) : undefined, designation: o?.role || undefined, source: 'IMPORT', consent: false,
    }
  })
}

/** A year's leavers not yet in the directory (and how many are). */
export async function leaversPreview(year) {
  const all = (await leavers()).filter((s) => s.batch === year)
  const imported = new Set((await Alumnus.find({ studentId: { $in: all.map((s) => s._id) } }).select('studentId').lean()).map((a) => String(a.studentId)))
  const todo = all.filter((s) => !imported.has(String(s._id)))
  const rows = await fromStudents(todo)
  return { year, total: all.length, imported: imported.size, data: rows.map((r, i) => ({ ...r, studentId: String(r.studentId), programId: idStr(r.programId), status: todo[i].status, leavingDate: todo[i].leaving?.date ?? null, reason: todo[i].leaving?.reason ?? null })) }
}

/** Add a year's leavers (all of them, or the ones picked) to the directory. */
export async function importLeavers({ year, studentIds }, auth, req) {
  const all = (await leavers()).filter((s) => s.batch === year && (!studentIds?.length || studentIds.includes(String(s._id))))
  const imported = new Set((await Alumnus.find({ studentId: { $in: all.map((s) => s._id) } }).select('studentId').lean()).map((a) => String(a.studentId)))
  const todo = all.filter((s) => !imported.has(String(s._id)))
  const rows = await fromStudents(todo)
  let added = 0
  for (const r of rows) {
    try { await Alumnus.create({ ...r, createdBy: auth.user?.name }); added++ } catch (err) { if (err.code !== 11000) throw err } // added meanwhile: skip
  }
  if (added) await audit({ action: 'IMPORT', module: 'alumni', entityType: 'alumnus', entityName: `Batch ${year}`, summary: `Added ${added} leaver(s) of ${year} to the alumni directory${imported.size ? ` (${imported.size} already there)` : ''}` }, req)
  return { added, already: imported.size }
}

export async function exportAlumni(q) {
  const { data } = await listAlumni({ ...q, page: 1, pageSize: 50000 })
  const head = ['Name', 'Batch', 'Program / class', 'Admission no.', 'Organisation', 'Designation', 'City', 'Country', 'Email', 'Mobile', 'LinkedIn', 'Agrees to be contacted', 'Donated', 'Source']
  return [head, ...data.map((a) => [a.name, a.batch, a.program, a.admissionNo, a.organisation, a.designation, a.city, a.country, a.email, a.mobile, a.linkedIn, a.consent ? 'Yes' : 'No', a.given ? a.given.amount / 100 : '', a.source === 'IMPORT' ? 'Student records' : 'Added by hand'])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}
