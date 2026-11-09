import { OFFER_STATUS, checkEligibility, driveWindowState, offerPolicyBlock } from '@schoolgiant/shared'
import { Company, PlacementDrive, PlacementOffer, PlacementRegistration } from '../models/placements.js'
import { Program, ProgramEnrolment } from '../models/programs.js'
import { audit } from '../platform/audit.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { bestOffers, placementSettings, studentFacts, today } from './placements.js'
import { reasonText, registerOne } from './placementsDrives.js'
import { need, studentFor } from './portal.js'

// The family app › Placements (feature PLACEMENTS): the drives the student may apply to — open ones whose programs /
// batches (or classes) include them — with the criteria checked against their CGPA and backlogs, registering (with
// their 10th / 12th marks when the drive asks) and withdrawing while registration is open, how far they have got in
// each drive, and their offers. Students and parents both see it.

const driveCtc = (d) => d.ctcMax ?? d.ctcMin ?? 0

/** Is the student in the drive's pool (its programs and batches, else the final year; or its classes)? */
function inPool(d, facts, enrolment, semesters) {
  const e = d.eligibility ?? {}
  if (e.classIds?.some((c) => String(c) === String(facts.classId))) return true
  if (!enrolment || !e.programIds?.some((p) => String(p) === String(enrolment.programId))) return false
  if (e.batches?.length) return e.batches.includes(enrolment.batch)
  return (enrolment.currentSemester ?? 1) >= (semesters ?? 8) - 1
}

async function studentPlacement(f, studentId) {
  need(f, 'PLACEMENTS')
  const s = studentFor(f, studentId)
  const [facts, enrolment] = await Promise.all([studentFacts([s._id]), ProgramEnrolment.findOne({ studentId: s._id, status: 'ACTIVE' }).lean()])
  const program = enrolment ? await Program.findById(enrolment.programId).select('semesters').lean() : null
  return { s, facts: facts.get(String(s._id)), enrolment, semesters: program?.semesters ?? 8 }
}

export async function familyPlacements(f, studentId) {
  const { s, facts, enrolment, semesters } = await studentPlacement(f, studentId)
  const [settings, t, drives, regs, offers, best] = await Promise.all([
    placementSettings(), today(),
    PlacementDrive.find({ status: { $in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } }).sort({ startDate: -1 }).limit(200).lean(),
    PlacementRegistration.find({ studentId: s._id }).lean(),
    PlacementOffer.find({ studentId: s._id, status: { $ne: 'REVOKED' } }).sort({ offeredOn: -1 }).lean(),
    bestOffers([s._id]),
  ])
  const regOf = new Map(regs.map((r) => [String(r.driveId), r]))
  const mine = drives.filter((d) => regOf.has(String(d._id)) || (d.status === 'OPEN' && inPool(d, facts, enrolment, semesters)))
  const companies = await Company.find({ _id: { $in: [...new Set([...mine.map((d) => String(d.companyId)), ...offers.map((o) => String(o.companyId))])] } }).select('name sector city website').lean()
  const co = new Map(companies.map((c) => [String(c._id), c]))
  const b = best.get(String(s._id))?.ctc ?? 0
  return {
    profile: { program: facts.programName ?? facts.classLabel ?? null, batch: facts.batch ?? null, cgpa: facts.cgpa ?? null, backlogs: facts.backlogs ?? null },
    canRegister: settings.familyRegistration,
    drives: mine.map((d) => {
      const reg = regOf.get(String(d._id))
      const check = checkEligibility(d.eligibility ?? {}, facts)
      const blocked = offerPolicyBlock({ policy: settings.policy, dreamCtc: settings.dreamCtc, best: b, driveCtc: driveCtc(d) })
      const c = co.get(String(d.companyId))
      return {
        id: String(d._id), title: d.title, company: c ? { name: c.name, sector: c.sector, city: c.city ?? null, website: c.website ?? null } : null,
        roles: (d.roles ?? []).map((r) => r.title), ctcMin: d.ctcMin ?? null, ctcMax: d.ctcMax ?? null, location: d.location ?? null, mode: d.mode,
        startDate: d.startDate ?? null, endDate: d.endDate ?? null, opensOn: d.registration?.opensOn ?? null, closesOn: d.registration?.closesOn ?? null,
        status: d.status, window: driveWindowState(d, t), description: d.description ?? null,
        criteria: { minCgpa: d.eligibility?.minCgpa ?? null, maxBacklogs: d.eligibility?.maxBacklogs ?? null, min10th: d.eligibility?.min10th ?? null, min12th: d.eligibility?.min12th ?? null, note: d.eligibility?.note ?? null },
        eligible: check.eligible && !blocked, reasons: [...check.reasons, ...(blocked ? [blocked] : [])].map((r) => ({ code: r, text: reasonText(r) })), pending: check.pending,
        registration: reg && reg.status !== 'WITHDRAWN' ? {
          status: reg.status, registeredOn: reg.registeredOn ?? null,
          rounds: (d.rounds ?? []).map((r) => { const x = (reg.rounds ?? []).find((y) => String(y.roundId) === String(r._id)); return { name: r.name, kind: r.kind, date: r.date ?? null, result: x?.result ?? null } }),
        } : null,
      }
    }),
    offers: offers.map((o) => ({ id: String(o._id), company: co.get(String(o.companyId))?.name ?? null, role: o.role ?? null, ctc: o.ctc, location: o.location ?? null, joiningDate: o.joiningDate ?? null, offeredOn: o.offeredOn, status: o.status, statusLabel: OFFER_STATUS[o.status]?.label })),
  }
}

async function openDriveFor(f, studentId, driveId) {
  const ctx = await studentPlacement(f, studentId)
  if (!(await placementSettings()).familyRegistration) throw forbidden('Your institution’s placement office registers students for drives.')
  const d = isOid(driveId) ? await PlacementDrive.findById(driveId).lean() : null
  if (!d) throw notFound('Placement drive')
  if (driveWindowState(d, await today()) !== 'OPEN') throw conflict('Registration for this drive is closed.')
  return { ...ctx, d }
}

export async function familyRegister(f, studentId, driveId, { tenthPct, twelfthPct }, req) {
  const { s, facts, enrolment, semesters, d } = await openDriveFor(f, studentId, driveId)
  if (!inPool(d, facts, enrolment, semesters)) throw badRequest('This drive is not open to your program or batch.')
  const settings = await placementSettings()
  const b = (await bestOffers([s._id])).get(String(s._id))?.ctc ?? 0
  const blocked = offerPolicyBlock({ policy: settings.policy, dreamCtc: settings.dreamCtc, best: b, driveCtc: driveCtc(d) })
  const r = await registerOne(d, s._id, { ...facts, blocked }, { tenthPct, twelfthPct, via: 'APP', by: f.session?.kind === 'STUDENT' ? 'Student (app)' : 'Parent (app)' })
  if (!r.reg) {
    const fields = r.reason === 'MISSING_TENTH' ? { tenthPct: 'Enter your 10th marks' } : r.reason === 'MISSING_TWELFTH' ? { twelfthPct: 'Enter your 12th marks' } : undefined
    throw badRequest(`You can’t register: ${reasonText(r.reason)}.`, fields ? { fields } : undefined)
  }
  await audit({ action: 'CREATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: d.title, studentId: s._id, summary: `${facts.name} registered for ${d.title} in the app` }, req)
  return familyPlacements(f, studentId)
}

export async function familyWithdraw(f, studentId, driveId, req) {
  const { s, facts, d } = await openDriveFor(f, studentId, driveId)
  const reg = await PlacementRegistration.findOne({ driveId: d._id, studentId: s._id })
  if (!reg || reg.status === 'WITHDRAWN') throw notFound('Registration')
  if (reg.status !== 'REGISTERED' || (reg.rounds ?? []).length) throw conflict('The rounds have started; ask the placement office.')
  reg.status = 'WITHDRAWN'
  await reg.save()
  await audit({ action: 'UPDATE', module: 'placements', entityType: 'placement_drive', entityId: String(d._id), entityName: d.title, studentId: s._id, summary: `${facts.name} withdrew from ${d.title} in the app` }, req)
  return familyPlacements(f, studentId)
}
