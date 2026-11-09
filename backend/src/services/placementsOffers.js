import { LIVE_OFFER, OFFER_STATUS, ctcStats, formatINR, formatLpa, lpa } from '@schoolgiant/shared'
import { AcademicYear, ClassLevel } from '../models/academics.js'
import { Company, PlacementDrive, PlacementOffer, PlacementRegistration } from '../models/placements.js'
import { Program } from '../models/programs.js'
import { Student } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { currentYear } from './academics.js'
import { placementSettings, rx, studentFacts, today } from './placements.js'

// Offers: those made from a drive's selections and those entered by hand (off campus, a pool drive elsewhere); the
// student accepts or declines (the offer policy — one offer, dream offer, no limit — is Settings › Placements); a
// company may revoke one. The offer letter is a file on the offer (files engine, record type placement_offer).
// Statistics per academic year: placed %, highest / median / average CTC, company-wise and program-wise.

const idStr = (v) => (v ? String(v) : null)

async function offersOut(rows) {
  const [facts, companies, drives] = await Promise.all([
    studentFacts(rows.map((o) => o.studentId)),
    Company.find({ _id: { $in: [...new Set(rows.map((o) => String(o.companyId)))] } }).select('name sector').lean(),
    PlacementDrive.find({ _id: { $in: rows.map((o) => o.driveId).filter(Boolean) } }).select('title').lean(),
  ])
  const co = new Map(companies.map((c) => [String(c._id), c]))
  const dr = new Map(drives.map((d) => [String(d._id), d]))
  return rows.map((o) => {
    const f = facts.get(String(o.studentId)) ?? {}
    const c = co.get(String(o.companyId))
    return {
      ...clean(o), studentId: String(o.studentId), companyId: String(o.companyId), driveId: idStr(o.driveId), programId: idStr(o.programId), academicYearId: idStr(o.academicYearId),
      student: { id: String(o.studentId), name: f.name ?? '—', admissionNo: f.admissionNo ?? null, program: f.program ?? null, classShort: f.classShort ?? null, batch: o.batch ?? f.batch ?? null, gender: f.gender ?? null },
      company: c ? { id: String(c._id), name: c.name, sector: c.sector } : null,
      drive: o.driveId && dr.get(String(o.driveId)) ? { id: String(o.driveId), title: dr.get(String(o.driveId)).title } : null,
    }
  })
}

async function offerFilter({ status, companyId, programId, yearId, search }) {
  const f = {}
  if (status) f.status = status
  if (companyId && isOid(companyId)) f.companyId = oid(companyId)
  if (programId && isOid(programId)) f.$or = [{ programId: oid(programId) }, { classId: oid(programId) }]
  if (yearId && isOid(yearId)) f.academicYearId = oid(yearId)
  if (search) {
    const re = rx(search)
    const [students, companies] = await Promise.all([
      Student.find({ $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }] }).select('_id').limit(500).lean(),
      Company.find({ name: re }).select('_id').lean(),
    ])
    f.$and = [{ $or: [{ studentId: { $in: students.map((s) => s._id) } }, { companyId: { $in: companies.map((c) => c._id) } }, { role: re }] }]
  }
  return f
}

export async function listOffers(q = {}) {
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 50
  const f = await offerFilter(q)
  const [rows, total] = await Promise.all([
    PlacementOffer.find(f).sort({ offeredOn: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    PlacementOffer.countDocuments(f),
  ])
  return { data: await offersOut(rows), total, page, pageSize }
}

export async function getOffer(id) {
  const o = isOid(id) ? await PlacementOffer.findById(id).lean() : null
  if (!o) throw notFound('Offer')
  return (await offersOut([o]))[0]
}

/** An offer entered by hand (off campus, or a drive's offer recorded late). */
export async function createOffer(input, auth, req) {
  const [facts, company] = await Promise.all([studentFacts([input.studentId]), Company.findById(input.companyId).select('name').lean()])
  const f = facts.get(String(input.studentId))
  if (!f) throw badRequest('Pick the student.', { fields: { studentId: 'Not found' } })
  if (!company) throw badRequest('Pick the company.', { fields: { companyId: 'Not found' } })
  let drive = null
  if (input.driveId) {
    drive = await PlacementDrive.findById(input.driveId).lean()
    if (!drive || String(drive.companyId) !== String(input.companyId)) throw badRequest('That drive is not this company’s.', { fields: { driveId: 'Pick a drive of the company' } })
  }
  const year = input.academicYearId ? { _id: input.academicYearId } : drive?.academicYearId ? { _id: drive.academicYearId } : await currentYear()
  const reg = drive ? await PlacementRegistration.findOne({ driveId: drive._id, studentId: input.studentId }) : null
  const o = await PlacementOffer.create({
    studentId: input.studentId, companyId: input.companyId, driveId: drive?._id, registrationId: reg?._id, programId: f.programId ?? undefined, classId: f.classId ?? undefined,
    batch: f.batch ?? undefined, academicYearId: year?._id, branchId: f.branchId ?? auth.user?.branchId ?? undefined,
    role: input.role, ctc: input.ctc, location: input.location, joiningDate: input.joiningDate, offeredOn: input.offeredOn || await today(),
    status: 'OFFERED', note: input.note, offCampus: !drive, by: auth.user?.name,
  })
  if (reg && reg.status !== 'SELECTED') { reg.status = 'SELECTED'; reg.offerId = o._id; await reg.save() }
  await audit({ action: 'CREATE', module: 'placements', entityType: 'placement_offer', entityId: String(o._id), entityName: f.name, studentId: f.id, summary: `Offer from ${company.name} to ${f.name}: ${formatLpa(o.ctc)}${o.role ? `, ${o.role}` : ''}${drive ? '' : ' (off campus)'}` }, req)
  return getOffer(o._id)
}

/**
 * Accept, decline or revoke. Accepting follows the offer policy: one offer — a second can't be accepted; dream offer —
 * a student holding an offer below the dream CTC may accept a dream one (the earlier acceptance is released).
 */
export async function decideOffer(id, { status, note, on }, auth, req) {
  const o = isOid(id) ? await PlacementOffer.findById(id) : null
  if (!o) throw notFound('Offer')
  const from = o.status
  const allowed = { ACCEPTED: ['OFFERED'], DECLINED: ['OFFERED', 'ACCEPTED'], REVOKED: ['OFFERED', 'ACCEPTED'], OFFERED: ['DECLINED', 'REVOKED'] }
  if (!(allowed[status] ?? []).includes(from)) throw badRequest(`An offer that is “${OFFER_STATUS[from]?.label}” can’t be made “${OFFER_STATUS[status]?.label}”.`)
  const released = []
  if (status === 'ACCEPTED') {
    const settings = await placementSettings()
    const held = await PlacementOffer.find({ studentId: o.studentId, status: 'ACCEPTED', _id: { $ne: o._id } })
    if (held.length && settings.policy === 'ONE') throw conflict('This student has already accepted an offer (one offer per student).')
    if (held.length && settings.policy === 'DREAM') {
      const best = Math.max(...held.map((h) => h.ctc))
      if (best >= settings.dreamCtc) throw conflict(`This student already holds a dream offer (${formatLpa(best)}).`)
      if (o.ctc < settings.dreamCtc) throw conflict(`This student has already accepted an offer; only a dream offer (${formatLpa(settings.dreamCtc)} or more) can be accepted now.`)
      for (const h of held) { h.status = 'DECLINED'; h.decidedOn = on || await today(); h.note = [h.note, 'Released for a dream offer'].filter(Boolean).join(' · '); await h.save(); released.push(h) }
    }
  }
  o.status = status
  o.decidedOn = status === 'OFFERED' ? undefined : on || await today()
  if (note) o.note = [o.note, note].filter(Boolean).join(' · ')
  await o.save()
  const f = (await studentFacts([o.studentId])).get(String(o.studentId))
  const company = await Company.findById(o.companyId).select('name').lean()
  if (status === 'ACCEPTED') await emit('placements.offer_accepted', { studentId: String(o.studentId), entity: { type: 'placement_offer', id: o._id } })
  await audit({ action: 'UPDATE', module: 'placements', entityType: 'placement_offer', entityId: String(o._id), entityName: f?.name, studentId: o.studentId, summary: `${company?.name} offer to ${f?.name}: ${OFFER_STATUS[from]?.label} → ${OFFER_STATUS[status]?.label}${released.length ? ` (released ${released.length} earlier acceptance)` : ''}${note ? ` — ${note}` : ''}` }, req)
  return getOffer(o._id)
}

// ───────────────────────────────────────────────────────── statistics

const CTC_BANDS = [[0, 3], [3, 5], [5, 8], [8, 12], [12, 20], [20, Infinity]]

/** A year's placement statistics (the current year when none is named). */
export async function offerStats({ yearId } = {}) {
  const year = yearId && isOid(yearId) ? await AcademicYear.findById(yearId).select('name').lean() : await currentYear()
  const yf = year ? { academicYearId: year._id } : {}
  const [offers, drives] = await Promise.all([
    PlacementOffer.find(yf).select('studentId companyId programId classId ctc status').lean(),
    PlacementDrive.find({ ...yf, status: { $ne: 'CANCELLED' } }).select('_id status').lean(),
  ])
  const regs = await PlacementRegistration.find({ driveId: { $in: drives.map((d) => d._id) }, status: { $ne: 'WITHDRAWN' } }).select('studentId programId').lean()
  const live = offers.filter((o) => LIVE_OFFER.includes(o.status))
  const best = new Map()
  for (const o of live) if ((best.get(String(o.studentId))?.ctc ?? -1) < o.ctc) best.set(String(o.studentId), o)
  // the pool: everyone who registered in the year's drives, and everyone placed (an off-campus offer)
  const facts = await studentFacts([...new Set([...regs.map((r) => String(r.studentId)), ...offers.map((o) => String(o.studentId))])])
  const pool = new Set([...regs.map((r) => String(r.studentId)), ...best.keys()])
  const groupOf = (sid) => { const f = facts.get(sid) ?? {}; return f.programId ?? f.classId ?? 'NONE' }
  const groups = new Map()
  for (const sid of pool) {
    const g = groupOf(sid)
    const row = groups.get(g) ?? { pool: 0, placed: 0, ctcs: [] }
    row.pool++
    if (best.has(sid)) { row.placed++; row.ctcs.push(best.get(sid).ctc) }
    groups.set(g, row)
  }
  const gids = [...groups.keys()].filter(isOid)
  const [programs, classes, companies] = await Promise.all([
    Program.find({ _id: { $in: gids } }).select('code name').lean(),
    ClassLevel.find({ _id: { $in: gids } }).select('name code').lean(),
    Company.find({ _id: { $in: [...new Set(offers.map((o) => String(o.companyId)))] } }).select('name sector').lean(),
  ])
  const label = new Map([...programs.map((p) => [String(p._id), { code: p.code, name: p.name }]), ...classes.map((c) => [String(c._id), { code: c.code ?? c.name, name: c.name }])])
  const byCompany = new Map()
  for (const o of offers) {
    if (!['OFFERED', 'ACCEPTED'].includes(o.status)) continue
    const row = byCompany.get(String(o.companyId)) ?? { offers: 0, accepted: 0, best: 0 }
    row.offers++
    if (o.status === 'ACCEPTED') row.accepted++
    row.best = Math.max(row.best, o.ctc)
    byCompany.set(String(o.companyId), row)
  }
  const bestCtcs = [...best.values()].map((o) => o.ctc)
  return {
    year: year ? { id: String(year._id), name: year.name ?? null } : null,
    totals: {
      drives: drives.length, completed: drives.filter((d) => d.status === 'COMPLETED').length,
      pool: pool.size, placed: best.size, placedPct: pool.size ? Math.round((best.size / pool.size) * 1000) / 10 : 0,
      offers: live.length, accepted: offers.filter((o) => o.status === 'ACCEPTED').length, pending: offers.filter((o) => o.status === 'OFFERED').length,
      declined: offers.filter((o) => o.status === 'DECLINED').length, multiple: [...new Set(live.map((o) => String(o.studentId)))].filter((s) => live.filter((o) => String(o.studentId) === s).length > 1).length,
    },
    ctc: ctcStats(bestCtcs),
    byCompany: companies.map((c) => ({ id: String(c._id), name: c.name, sector: c.sector, ...(byCompany.get(String(c._id)) ?? { offers: 0, accepted: 0, best: 0 }) })).filter((c) => c.offers).sort((a, b) => b.offers - a.offers || b.best - a.best),
    byProgram: [...groups.entries()].map(([id, g]) => ({ id, code: label.get(id)?.code ?? '—', name: label.get(id)?.name ?? '—', pool: g.pool, placed: g.placed, pct: g.pool ? Math.round((g.placed / g.pool) * 1000) / 10 : 0, ...ctcStats(g.ctcs) })).sort((a, b) => b.placed - a.placed),
    bands: CTC_BANDS.map(([lo, hi]) => ({ id: `${lo}`, label: hi === Infinity ? `${lo}+` : `${lo}–${hi}`, value: bestCtcs.filter((c) => lpa(c) >= lo && lpa(c) < hi).length })),
  }
}

export async function exportOffers(q) {
  const { data } = await listOffers({ ...q, page: 1, pageSize: 20000 })
  const head = ['Offered on', 'Student', 'Admission no.', 'Program / class', 'Batch', 'Company', 'Drive', 'Role', 'CTC (₹ a year)', 'CTC (LPA)', 'Location', 'Joining', 'Status', 'Decided on', 'Off campus', 'Note']
  return [head, ...data.map((o) => [o.offeredOn, o.student.name, o.student.admissionNo, o.student.program ?? o.student.classShort, o.student.batch, o.company?.name, o.drive?.title, o.role, formatINR(o.ctc), lpa(o.ctc), o.location, o.joiningDate, OFFER_STATUS[o.status]?.label ?? o.status, o.decidedOn, o.offCampus ? 'Yes' : '', o.note])]
    .map((r) => r.map(csvCell).join(',')).join('\n')
}

/** The files engine's view of an offer (its offer letter): the student it is about and a name. */
export async function offerRecord(id) {
  const o = isOid(id) ? await PlacementOffer.findById(id).select('studentId companyId status').lean() : null
  if (!o) return null
  const [s, c] = await Promise.all([Student.findById(o.studentId).select('firstName lastName admissionNo').lean(), Company.findById(o.companyId).select('name').lean()])
  return { studentId: o.studentId, name: `${c?.name ?? 'Offer'} · ${[s?.firstName, s?.lastName].filter(Boolean).join(' ')}`, locked: o.status === 'REVOKED' }
}
