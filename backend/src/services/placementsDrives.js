import { DRIVE_FLOW, DRIVE_STATUS, checkEligibility, driveFunnel, driveWindowState, formatLpa, offerPolicyBlock } from '@schoolgiant/shared'
import { Company, PlacementDrive, PlacementOffer, PlacementRegistration } from '../models/placements.js'
import { Program, ProgramEnrolment } from '../models/programs.js'
import { Student } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { emit } from '../platform/events.js'
import { logger } from '../platform/logger.js'
import { currentYear } from './academics.js'
import { humanDate } from './notify.js'
import { bestOffers, placementSettings, rx, studentFacts, today } from './placements.js'

// Placement drives: the drive itself (roles, CTC, dates, criteria, rounds), who is eligible, registrations (by staff
// here, by students / parents in the app — services/placementsFamily.js), each round's marks and shortlist, and the
// final selections, which become offers. Opening a drive tells the eligible students (event placements.drive_open).

const idStr = (v) => (v ? String(v) : null)
const driveCtc = (d) => d.ctcMax ?? d.ctcMin ?? Math.max(0, ...(d.roles ?? []).map((r) => r.ctc ?? 0))

export function driveOut(d, company) {
  return {
    ...clean(d),
    companyId: String(d.companyId),
    company: company ? { id: String(company._id), name: company.name, sector: company.sector, city: company.city ?? null } : null,
    academicYearId: idStr(d.academicYearId),
    eligibility: {
      ...(d.eligibility ?? {}),
      programIds: (d.eligibility?.programIds ?? []).map(String), classIds: (d.eligibility?.classIds ?? []).map(String), batches: d.eligibility?.batches ?? [],
    },
    rounds: (d.rounds ?? []).map((r) => ({ id: String(r._id), name: r.name, kind: r.kind, date: r.date ?? null, maxMarks: r.maxMarks ?? null, done: !!r.done })),
  }
}

async function loadDrive(id) {
  const d = isOid(id) ? await PlacementDrive.findById(id).lean() : null
  if (!d) throw notFound('Placement drive')
  return d
}

// ───────────────────────────────────────────────────────── list and detail

export async function listDrives({ status, yearId, companyId, search } = {}) {
  const f = {}
  if (status) f.status = status
  if (yearId && isOid(yearId)) f.academicYearId = oid(yearId)
  if (companyId && isOid(companyId)) f.companyId = oid(companyId)
  if (search) {
    const companies = await Company.find({ name: rx(search) }).select('_id').lean()
    f.$or = [{ title: rx(search) }, { companyId: { $in: companies.map((c) => c._id) } }]
  }
  const drives = await PlacementDrive.find(f).sort({ startDate: -1, createdAt: -1 }).limit(500).lean()
  const ids = drives.map((d) => d._id)
  const [companies, regs, offers] = await Promise.all([
    Company.find({ _id: { $in: drives.map((d) => d.companyId) } }).select('name sector city').lean(),
    PlacementRegistration.aggregate([{ $match: { driveId: { $in: ids }, status: { $ne: 'WITHDRAWN' } } }, { $group: { _id: { d: '$driveId', s: '$status' }, n: { $sum: 1 } } }]),
    PlacementOffer.aggregate([{ $match: { driveId: { $in: ids } } }, { $group: { _id: { d: '$driveId', s: '$status' }, n: { $sum: 1 } } }]),
  ])
  const co = new Map(companies.map((c) => [String(c._id), c]))
  const count = (rows, d, s) => rows.filter((r) => String(r._id.d) === String(d) && (!s || s.includes(r._id.s))).reduce((n, r) => n + r.n, 0)
  const t = await today()
  const counts = await PlacementDrive.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
  return {
    data: drives.map((d) => ({
      ...driveOut(d, co.get(String(d.companyId))),
      window: driveWindowState(d, t),
      counts: { registered: count(regs, d._id), inRunning: count(regs, d._id, ['REGISTERED']), selected: count(regs, d._id, ['SELECTED']), offers: count(offers, d._id, ['OFFERED', 'ACCEPTED']), accepted: count(offers, d._id, ['ACCEPTED']) },
    })),
    statusCounts: Object.fromEntries(Object.keys(DRIVE_STATUS).map((k) => [k, counts.find((c) => c._id === k)?.n ?? 0])),
  }
}

function regOut(r, facts, offer) {
  const f = facts.get(String(r.studentId)) ?? {}
  return {
    id: String(r._id), studentId: String(r.studentId), name: f.name ?? '—', admissionNo: f.admissionNo ?? null, gender: f.gender ?? null,
    program: f.program ?? null, classShort: f.classShort ?? null, batch: r.batch ?? f.batch ?? null,
    cgpa: r.cgpa ?? f.cgpa ?? null, backlogs: r.backlogs ?? f.backlogs ?? null, tenthPct: r.tenthPct ?? null, twelfthPct: r.twelfthPct ?? null,
    status: r.status, via: r.via, registeredOn: r.registeredOn ?? null,
    rounds: Object.fromEntries((r.rounds ?? []).map((x) => [String(x.roundId), { marks: x.marks ?? null, result: x.result ?? null, note: x.note ?? null }])),
    offer: offer ? { id: String(offer._id), status: offer.status, ctc: offer.ctc, role: offer.role ?? null } : null,
  }
}

/** A drive with its registrations (each round's marks and result), the funnel and its offers. */
export async function getDrive(id) {
  const d = await loadDrive(id)
  const [company, regs, offers] = await Promise.all([
    Company.findById(d.companyId).lean(),
    PlacementRegistration.find({ driveId: d._id }).sort({ createdAt: 1 }).lean(),
    PlacementOffer.find({ driveId: d._id }).lean(),
  ])
  const facts = await studentFacts(regs.map((r) => r.studentId))
  const offerOf = new Map(offers.map((o) => [String(o.studentId), o]))
  const live = regs.filter((r) => r.status !== 'WITHDRAWN')
  const out = driveOut(d, company)
  const programs = out.eligibility.programIds.length ? await Program.find({ _id: { $in: out.eligibility.programIds } }).select('code name').lean() : []
  return {
    ...out,
    programs: programs.map((p) => ({ id: String(p._id), code: p.code, name: p.name })),
    window: driveWindowState(d, await today()),
    registrations: regs.map((r) => regOut(r, facts, offerOf.get(String(r.studentId)))),
    funnel: driveFunnel(out.rounds, live, offers.filter((o) => o.status === 'ACCEPTED').length),
    offers: { made: offers.filter((o) => o.status !== 'REVOKED').length, accepted: offers.filter((o) => o.status === 'ACCEPTED').length },
  }
}

// ───────────────────────────────────────────────────────── save, status

function checkDrive(input) {
  const fields = {}
  if (input.ctcMin != null && input.ctcMax != null && input.ctcMax < input.ctcMin) fields.ctcMax = 'At least the lowest CTC'
  if (input.startDate && input.endDate && input.endDate < input.startDate) fields.endDate = 'On or after the first day'
  const r = input.registration ?? {}
  if (r.opensOn && r.closesOn && r.closesOn < r.opensOn) fields['registration.closesOn'] = 'On or after the day it opens'
  if (Object.keys(fields).length) throw badRequest('Some details need fixing.', { fields })
}

/** Rounds as sent: those with an id keep it (and their results); new ones get one. */
function roundsIn(list, existing = []) {
  const known = new Map(existing.map((r) => [String(r._id), r]))
  return list.map((r) => {
    const was = r.id && known.get(String(r.id))
    return { ...(was ? { _id: was._id, done: was.done } : {}), name: r.name, kind: r.kind, date: r.date || undefined, maxMarks: r.maxMarks ?? undefined, ...(r.done !== undefined && { done: r.done }) }
  })
}

export async function saveDrive(id, input, auth, req) {
  checkDrive(input)
  if (input.companyId && !(await Company.exists({ _id: input.companyId }))) throw badRequest('Pick a company from the list.', { fields: { companyId: 'Not found' } })
  const body = { ...input }
  let d
  if (id) {
    d = await PlacementDrive.findById(id)
    if (!d) throw notFound('Placement drive')
    if (body.rounds) {
      const kept = new Set(body.rounds.filter((r) => r.id).map((r) => String(r.id)))
      const dropped = d.rounds.filter((r) => !kept.has(String(r._id)))
      if (dropped.length && await PlacementRegistration.exists({ driveId: d._id, 'rounds.roundId': { $in: dropped.map((r) => r._id) } })) {
        throw conflict(`The round “${dropped[0].name}” has results; it can’t be removed.`)
      }
      body.rounds = roundsIn(body.rounds, d.rounds)
    }
    if (body.eligibility) body.eligibility = { ...d.toObject().eligibility, ...body.eligibility }
    d.set(body)
    checkDrive(d.toObject())
    await d.save()
  } else {
    const year = body.academicYearId ? null : await currentYear()
    d = await PlacementDrive.create({ ...body, rounds: roundsIn(body.rounds ?? []), academicYearId: body.academicYearId ?? year?._id, branchId: body.branchId ?? auth.user?.branchId ?? undefined, status: 'DRAFT', createdBy: auth.user?.name })
  }
  const company = await Company.findById(d.companyId).select('name').lean()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: `${company?.name} · ${d.title}`, summary: `${id ? 'Updated' : 'Created'} the placement drive ${d.title} (${company?.name})` }, req)
  return getDrive(d._id)
}

/** Move a drive on (DRIVE_FLOW). Opening it the first time tells the eligible students. */
export async function setDriveStatus(id, status, auth, req) {
  const d = await PlacementDrive.findById(id)
  if (!d) throw notFound('Placement drive')
  if (d.status === status) return getDrive(d._id)
  if (!(DRIVE_FLOW[d.status] ?? []).includes(status)) throw badRequest(`A drive that is “${DRIVE_STATUS[d.status]?.label}” can’t be made “${DRIVE_STATUS[status]?.label}”.`)
  if (status === 'OPEN' && !(d.eligibility?.programIds?.length || d.eligibility?.classIds?.length)) {
    throw badRequest('Say who may apply — the programs or the classes — before opening registration.', { fields: { 'eligibility.programIds': 'Pick at least one' } })
  }
  const first = status === 'OPEN' && !d.openedAt
  const was = d.status
  d.status = status
  if (first) d.openedAt = new Date()
  await d.save()
  const company = await Company.findById(d.companyId).select('name').lean()
  let told = 0
  if (first && (await placementSettings()).notifyEligible) {
    told = await notifyEligible(d.toObject(), company).catch((err) => { logger.warn({ err, driveId: String(d._id) }, 'drive open notice failed'); return 0 })
    if (told) await PlacementDrive.updateOne({ _id: d._id }, { $set: { notified: told } })
  }
  await audit({ action: 'UPDATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: `${company?.name} · ${d.title}`, summary: `Placement drive ${d.title}: ${DRIVE_STATUS[was]?.label} → ${DRIVE_STATUS[status]?.label}${told ? ` — ${told} eligible student(s) told` : ''}` }, req)
  return { ...(await getDrive(d._id)), told }
}

async function notifyEligible(d, company) {
  const list = await eligibleList(d)
  const t = d.registration?.closesOn
  let n = 0
  for (const s of list) {
    if (!s.eligible || s.blocked || s.registered) continue
    await emit('placements.drive_open', {
      studentId: s.id, entity: { type: 'placement_drive', id: d._id },
      data: { drive: { company: company?.name ?? '', title: d.title, ctc: d.ctcMax ? (d.ctcMin && d.ctcMin !== d.ctcMax ? `${formatLpa(d.ctcMin)} – ${formatLpa(d.ctcMax)}` : formatLpa(d.ctcMax)) : formatLpa(d.ctcMin), lastDate: t ? humanDate(t) : '', date: d.startDate ? humanDate(d.startDate) : '' } },
    })
    n++
  }
  return n
}

// ───────────────────────────────────────────────────────── eligibility

/**
 * The pool a drive draws from: students of its programs (its batches, else those in the final year of the program)
 * — or, for a school, the students of its classes — each with the criteria checked and the offer policy applied.
 */
export async function eligibleList(d) {
  const e = d.eligibility ?? {}
  let ids = []
  if (e.programIds?.length) {
    const programs = await Program.find({ _id: { $in: e.programIds } }).select('semesters').lean()
    const enrolments = await ProgramEnrolment.find({ programId: { $in: e.programIds }, status: 'ACTIVE', ...(e.batches?.length && { batch: { $in: e.batches } }) }).select('studentId programId currentSemester').lean()
    const sems = new Map(programs.map((p) => [String(p._id), p.semesters ?? 8]))
    ids = enrolments.filter((x) => e.batches?.length || (x.currentSemester ?? 1) >= (sems.get(String(x.programId)) ?? 8) - 1).map((x) => x.studentId)
  }
  if (e.classIds?.length) ids.push(...(await Student.find({ classId: { $in: e.classIds }, status: 'ACTIVE' }).select('_id').lean()).map((s) => s._id))
  if (!ids.length) return []
  const [facts, regs, best, settings] = await Promise.all([
    studentFacts(ids), PlacementRegistration.find({ driveId: d._id, studentId: { $in: ids } }).select('studentId status').lean(), bestOffers(ids), placementSettings(),
  ])
  const regOf = new Map(regs.map((r) => [String(r.studentId), r]))
  const ctc = driveCtc(d)
  return [...facts.values()].filter((f) => f.status === 'ACTIVE').map((f) => {
    const check = checkEligibility(e, f)
    const b = best.get(f.id)
    const reg = regOf.get(f.id)
    return {
      ...f, eligible: check.eligible, reasons: check.reasons, pending: check.pending,
      blocked: offerPolicyBlock({ policy: settings.policy, dreamCtc: settings.dreamCtc, best: b?.ctc ?? 0, driveCtc: ctc }),
      bestOffer: b?.ctc ?? 0, registered: !!reg && reg.status !== 'WITHDRAWN',
    }
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name))
}

export async function driveEligible(id) {
  const d = await loadDrive(id)
  const list = await eligibleList(d)
  return { data: list, summary: { pool: list.length, eligible: list.filter((s) => s.eligible && !s.blocked).length, registered: list.filter((s) => s.registered).length, blocked: list.filter((s) => s.blocked).length } }
}

const REASON_TEXT = {
  NOT_IN_POOL: 'not in the programs or classes this drive is for', CGPA: 'CGPA below the cut-off', NO_CGPA: 'no CGPA on record yet',
  BACKLOGS: 'too many active backlogs', TENTH: '10th marks below the cut-off', TWELFTH: '12th marks below the cut-off',
  PLACED: 'already placed (one offer per student)', DREAM_HELD: 'already holds a dream offer', NOT_DREAM: 'already placed; this drive pays below the dream CTC',
  MISSING_TENTH: 'give the 10th marks', MISSING_TWELFTH: 'give the 12th marks', CLOSED: 'registration is closed', ALREADY: 'already registered',
}
export const reasonText = (r) => REASON_TEXT[r] ?? r

/**
 * Register one student in a drive (the checks both desks share). `pool`: their eligibleList row (null: not in the
 * drive's pool). Staff may `override` the criteria and the policy; nobody overrides "not in the pool" by accident —
 * that needs override too. → { reg } or { reason }.
 */
export async function registerOne(d, studentId, pool, { tenthPct, twelfthPct, via = 'STAFF', by, override = false } = {}) {
  if (!pool && !override) return { reason: 'NOT_IN_POOL' }
  const existing = await PlacementRegistration.findOne({ driveId: d._id, studentId })
  if (existing && existing.status !== 'WITHDRAWN') return { reason: 'ALREADY' }
  const facts = pool ?? (await studentFacts([studentId])).get(String(studentId))
  if (!facts) return { reason: 'NOT_IN_POOL' }
  const check = checkEligibility(d.eligibility ?? {}, { ...facts, tenthPct, twelfthPct })
  if (!override) {
    if (check.pending.includes('tenthPct')) return { reason: 'MISSING_TENTH' }
    if (check.pending.includes('twelfthPct')) return { reason: 'MISSING_TWELFTH' }
    if (!check.eligible) return { reason: check.reasons[0] }
    if (pool?.blocked) return { reason: pool.blocked }
  }
  const body = {
    programId: facts.programId ?? undefined, batch: facts.batch ?? undefined, cgpa: facts.cgpa ?? undefined, backlogs: facts.backlogs ?? undefined,
    tenthPct: tenthPct ?? undefined, twelfthPct: twelfthPct ?? undefined, status: 'REGISTERED', via, registeredOn: await today(), rounds: [], by,
  }
  if (existing) { existing.set(body); await existing.save(); return { reg: existing } }
  return { reg: await PlacementRegistration.create({ driveId: d._id, studentId, ...body }) }
}

/** Staff register students (from the eligible list, or anyone with override). */
export async function registerStudents(id, { studentIds, tenthPct, twelfthPct, override = false }, auth, req) {
  const d = await loadDrive(id)
  if (['COMPLETED', 'CANCELLED'].includes(d.status)) throw conflict('This drive is closed.')
  const pool = new Map((await eligibleList(d)).map((s) => [s.id, s]))
  const added = []
  const skipped = []
  for (const sid of [...new Set(studentIds)]) {
    const r = await registerOne(d, sid, pool.get(String(sid)) ?? null, { tenthPct, twelfthPct, via: 'STAFF', by: auth.user?.name, override })
    if (r.reg) added.push(String(r.reg.studentId))
    else skipped.push({ studentId: String(sid), name: pool.get(String(sid))?.name ?? null, reason: r.reason, text: reasonText(r.reason) })
  }
  if (added.length) {
    const company = await Company.findById(d.companyId).select('name').lean()
    await audit({ action: 'CREATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: `${company?.name} · ${d.title}`, summary: `Registered ${added.length} student(s) for ${d.title}${override ? ' (criteria overridden)' : ''}` }, req)
  }
  return { added: added.length, skipped }
}

export async function withdrawRegistration(driveId, regId, auth, req) {
  const r = isOid(regId) ? await PlacementRegistration.findOne({ _id: regId, driveId }) : null
  if (!r) throw notFound('Registration')
  if (r.status === 'SELECTED') throw conflict('This student was selected — revoke or decline the offer instead.')
  r.status = 'WITHDRAWN'
  await r.save()
  const facts = (await studentFacts([r.studentId])).get(String(r.studentId))
  await audit({ action: 'UPDATE', module: 'placements', entityType: 'placement_drive', entityId: String(driveId), entityName: facts?.name, studentId: r.studentId, summary: `Withdrew ${facts?.name ?? 'a student'} from the drive` }, req)
  return { id: String(r._id) }
}

// ───────────────────────────────────────────────────────── rounds

/** Is the registration still in the running for this round (passed every earlier one)? */
function reachedRound(d, reg, roundId) {
  for (const r of d.rounds ?? []) {
    if (String(r._id) === String(roundId)) return true
    const res = (reg.rounds ?? []).find((x) => String(x.roundId) === String(r._id))
    if (res?.result !== 'PASS') return false
  }
  return false
}

/** A round's marks and shortlist; `done` marks the round final. Failing a round puts the student out of the drive. */
export async function saveRoundResults(id, roundId, { results, done }, auth, req) {
  const d = await loadDrive(id)
  const round = (d.rounds ?? []).find((r) => String(r._id) === String(roundId))
  if (!round) throw notFound('Round')
  const regs = await PlacementRegistration.find({ driveId: d._id, _id: { $in: results.map((r) => r.registrationId).filter(isOid) } })
  const byId = new Map(regs.map((r) => [String(r._id), r]))
  const errors = {}
  let saved = 0
  for (const row of results) {
    const reg = byId.get(String(row.registrationId))
    if (!reg || reg.status === 'WITHDRAWN') { errors[row.registrationId] = 'Not registered'; continue }
    if (reg.status === 'SELECTED') continue
    if (!reachedRound(d, reg, round._id)) { errors[row.registrationId] = 'Did not clear an earlier round'; continue }
    if (round.maxMarks != null && row.marks != null && row.marks > round.maxMarks) { errors[row.registrationId] = `0 to ${round.maxMarks}`; continue }
    const list = (reg.rounds ?? []).filter((x) => String(x.roundId) !== String(round._id))
    if (row.result || row.marks != null) list.push({ roundId: round._id, marks: row.marks ?? undefined, result: row.result ?? undefined, note: row.note ?? undefined })
    reg.rounds = list
    // out at this round (fail / absent); back in the running when the result is changed
    const anyOut = list.some((x) => x.result && x.result !== 'PASS')
    reg.status = anyOut ? 'REJECTED' : 'REGISTERED'
    await reg.save()
    saved++
  }
  if (Object.keys(errors).length && !saved) throw badRequest('None of the results could be saved.', { fields: errors })
  if (done !== undefined) await PlacementDrive.updateOne({ _id: d._id, 'rounds._id': round._id }, { $set: { 'rounds.$.done': !!done } })
  if (d.status === 'OPEN' && saved) await PlacementDrive.updateOne({ _id: d._id }, { $set: { status: 'IN_PROGRESS' } })
  const company = await Company.findById(d.companyId).select('name').lean()
  await audit({ action: 'UPDATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: `${company?.name} · ${d.title}`, summary: `Entered ${round.name} results for ${saved} student(s)${done ? ' and closed the round' : ''}` }, req)
  return { saved, errors, drive: await getDrive(d._id) }
}

// ───────────────────────────────────────────────────────── selections → offers

/** The final selections: each becomes an offer (OFFERED) at the CTC and role given. */
export async function selectCandidates(id, { registrationIds, role, ctc, joiningDate, offeredOn, location }, auth, req) {
  const d = await loadDrive(id)
  if (d.status === 'CANCELLED') throw conflict('This drive was cancelled.')
  const regs = await PlacementRegistration.find({ driveId: d._id, _id: { $in: registrationIds.filter(isOid) } })
  const last = d.rounds?.at(-1)
  const errors = {}
  const ok = regs.filter((r) => {
    if (r.status !== 'REGISTERED') { errors[String(r._id)] = r.status === 'SELECTED' ? 'Already selected' : 'Not in the running'; return false }
    if (last && !(r.rounds ?? []).some((x) => String(x.roundId) === String(last._id) && x.result === 'PASS')) { errors[String(r._id)] = `Not shortlisted in ${last.name}`; return false }
    return true
  })
  if (!ok.length) throw badRequest('None of these students can be selected yet.', { fields: errors })
  const day = offeredOn || await today()
  const company = await Company.findById(d.companyId).select('name').lean()
  const facts = await studentFacts(ok.map((r) => r.studentId))
  const made = []
  for (const r of ok) {
    const f = facts.get(String(r.studentId)) ?? {}
    const o = await PlacementOffer.create({
      studentId: r.studentId, companyId: d.companyId, driveId: d._id, registrationId: r._id, programId: r.programId ?? f.programId ?? undefined,
      classId: f.classId ?? undefined, batch: r.batch ?? f.batch ?? undefined, academicYearId: d.academicYearId, branchId: d.branchId ?? f.branchId ?? undefined,
      role: role || d.roles?.[0]?.title, ctc: ctc ?? d.ctcMax ?? d.ctcMin ?? 0, location: location || d.location, joiningDate: joiningDate || undefined, offeredOn: day, status: 'OFFERED', by: auth.user?.name,
    })
    r.status = 'SELECTED'
    r.offerId = o._id
    await r.save()
    made.push(o)
    await emit('placements.selected', { studentId: String(r.studentId), entity: { type: 'placement_offer', id: o._id }, data: { drive: { company: company?.name ?? '', title: d.title, ctc: formatLpa(o.ctc), role: o.role ?? '' } } })
  }
  await audit({ action: 'CREATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: `${company?.name} · ${d.title}`, summary: `Selected ${made.length} student(s) in ${d.title} — offers of ${formatLpa(made[0].ctc)}` }, req)
  return { offers: made.length, errors, drive: await getDrive(d._id) }
}
