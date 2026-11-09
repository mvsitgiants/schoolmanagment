import { COMPANY_SECTORS, LIVE_OFFER, OFFER_POLICIES, lpaToPaise, sectionLabel } from '@schoolgiant/shared'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { CoeSemesterResult } from '../models/coe.js'
import { Company, PlacementDrive, PlacementOffer } from '../models/placements.js'
import { Program, ProgramEnrolment } from '../models/programs.js'
import { Student, studentName } from '../models/students.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex } from '../platform/validate.js'
import { currentYear } from './academics.js'

// Training & placements (module `placements`): the shared pieces — what the screens pick from, the offer policy, the
// facts about students that eligibility reads (program, batch, CGPA and backlogs from the exam controller; class for
// schools) — and the companies. Drives, registrations and rounds are services/placementsDrives.js, offers and the
// statistics services/placementsOffers.js, the family app services/placementsFamily.js.

export const today = async () => (await institutionNow()).date
const idStr = (v) => (v ? String(v) : null)
export const rx = (s) => new RegExp(escapeRegex(String(s)), 'i')

/** Settings › Placements (with defaults while the setting rows are not there). */
export async function placementSettings() {
  const s = await getSettings('placements').catch(() => ({}))
  const policy = OFFER_POLICIES.some((p) => p.value === s.offerPolicy) ? s.offerPolicy : 'DREAM'
  return {
    policy,
    dreamCtc: lpaToPaise(Number(s.dreamCtcLakhs) > 0 ? Number(s.dreamCtcLakhs) : 10),
    familyRegistration: s.familyRegistration !== false,
    notifyEligible: s.notifyEligible !== false,
  }
}

/** Section labels of many students: sectionId → { label, short, classId }. */
export async function placesOf(students) {
  const ids = [...new Set(students.map((s) => idStr(s.sectionId)).filter(Boolean))]
  if (!ids.length) return new Map()
  const sections = await Section.find({ _id: { $in: ids } }).select('classId name').lean()
  const classes = await ClassLevel.find({ _id: { $in: sections.map((s) => s.classId) } }).select('name code order').lean()
  const cls = new Map(classes.map((c) => [String(c._id), c]))
  return new Map(sections.map((s) => [String(s._id), { label: sectionLabel(cls.get(String(s.classId)), s), short: sectionLabel(cls.get(String(s.classId)), s, { short: true }), classId: String(s.classId) }]))
}

/**
 * What placements knows about students: their program enrolment (program, batch, semester), the latest published
 * semester result (CGPA, active backlogs = arrears), their class, name and admission number. → Map studentId → facts.
 */
export async function studentFacts(studentIds) {
  const ids = [...new Set(studentIds.map(String))].filter(isOid)
  if (!ids.length) return new Map()
  const [students, enrolments, results] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('firstName middleName lastName admissionNo gender sectionId classId status branchId mobile email').lean(),
    ProgramEnrolment.find({ studentId: { $in: ids } }).select('studentId programId batch currentSemester registerNo status').lean(),
    CoeSemesterResult.aggregate([
      { $match: { studentId: { $in: ids.map(oid) }, published: true } },
      { $sort: { semester: -1, createdAt: -1 } },
      { $group: { _id: '$studentId', cgpa: { $first: '$cgpa' }, arrears: { $first: '$arrears' }, semester: { $first: '$semester' } } },
    ]),
  ])
  const programs = await Program.find({ _id: { $in: [...new Set(enrolments.map((e) => String(e.programId)))] } }).select('name code semesters').lean()
  const prog = new Map(programs.map((p) => [String(p._id), p]))
  const enr = new Map(enrolments.map((e) => [String(e.studentId), e]))
  const res = new Map(results.map((r) => [String(r._id), r]))
  const places = await placesOf(students)
  return new Map(students.map((s) => {
    const e = enr.get(String(s._id))
    const p = e && prog.get(String(e.programId))
    const r = res.get(String(s._id))
    const place = places.get(idStr(s.sectionId))
    return [String(s._id), {
      id: String(s._id), name: studentName(s), admissionNo: s.admissionNo, gender: s.gender ?? null, status: s.status, branchId: idStr(s.branchId),
      classId: idStr(s.classId) ?? place?.classId ?? null, classLabel: place?.label ?? null, classShort: place?.short ?? null,
      programId: e ? String(e.programId) : null, program: p ? p.code : null, programName: p?.name ?? null, batch: e?.batch ?? null,
      semester: e?.currentSemester ?? null, registerNo: e?.registerNo ?? null,
      cgpa: r?.cgpa ?? null, backlogs: r ? (r.arrears ?? 0) : null,
    }]
  }))
}

/** Each student's best live offer (OFFERED or ACCEPTED): studentId → { ctc, companyId, offerId }. */
export async function bestOffers(studentIds) {
  const rows = await PlacementOffer.aggregate([
    { $match: { studentId: { $in: studentIds.filter(isOid).map(oid) }, status: { $in: LIVE_OFFER } } },
    { $sort: { ctc: -1 } },
    { $group: { _id: '$studentId', ctc: { $first: '$ctc' }, companyId: { $first: '$companyId' }, offerId: { $first: '$_id' }, count: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [String(r._id), { ctc: r.ctc, companyId: String(r.companyId), offerId: String(r.offerId), count: r.count }]))
}

// ───────────────────────────────────────────────────────── what the screens pick from

/** Programs, classes, years, companies and the policy — for the drive form, filters and the offer form. */
export async function placementsMeta() {
  const [year, years, classes, programs, companies, settings, batches] = await Promise.all([
    currentYear(),
    AcademicYear.find().select('name startDate isCurrent').sort({ startDate: -1 }).lean(),
    ClassLevel.find({ active: true }).select('name code order').sort({ order: 1, name: 1 }).lean(),
    Program.find({ active: true }).select('name code level semesters').sort({ code: 1 }).lean(),
    Company.find({ active: true }).select('name sector city').sort({ name: 1 }).lean(),
    placementSettings(),
    ProgramEnrolment.distinct('batch', { status: 'ACTIVE' }),
  ])
  return {
    currentYearId: idStr(year?._id), years: years.map((y) => ({ id: String(y._id), name: y.name, isCurrent: !!y.isCurrent })),
    classes: classes.map((c) => ({ id: String(c._id), name: c.name, code: c.code })),
    programs: programs.map((p) => ({ id: String(p._id), name: p.name, code: p.code, level: p.level, semesters: p.semesters })),
    companies: companies.map((c) => ({ id: String(c._id), name: c.name, sector: c.sector, city: c.city ?? null })),
    batches: batches.filter(Boolean).sort((a, b) => b - a),
    sectors: COMPANY_SECTORS, settings, today: await today(),
  }
}

/** Find students by name, admission or register number (the offer form, adding a registration by hand). */
export async function findStudents(search) {
  const q = String(search ?? '').trim()
  if (q.length < 2) return []
  const byReg = await ProgramEnrolment.find({ registerNo: q.toUpperCase() }).select('studentId').lean()
  const re = rx(q)
  const rows = await Student.find({ status: 'ACTIVE', $or: [{ firstName: re }, { lastName: re }, { admissionNo: re }, ...(byReg.length ? [{ _id: { $in: byReg.map((r) => r.studentId) } }] : [])] })
    .select('_id').limit(20).lean()
  const facts = await studentFacts(rows.map((r) => r._id))
  return [...facts.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ───────────────────────────────────────────────────────── companies

/** Each company's visits: drives held, the last one, offers made and the best CTC. */
async function visitStats(companyIds) {
  const [drives, offers] = await Promise.all([
    PlacementDrive.aggregate([
      { $match: { companyId: { $in: companyIds }, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: '$companyId', drives: { $sum: 1 }, last: { $max: '$startDate' } } },
    ]),
    PlacementOffer.aggregate([
      { $match: { companyId: { $in: companyIds }, status: { $in: [...LIVE_OFFER] } } },
      { $group: { _id: '$companyId', offers: { $sum: 1 }, best: { $max: '$ctc' } } },
    ]),
  ])
  const out = new Map()
  for (const d of drives) out.set(String(d._id), { drives: d.drives, lastVisit: d.last ?? null, offers: 0, bestCtc: 0 })
  for (const o of offers) out.set(String(o._id), { drives: 0, lastVisit: null, ...out.get(String(o._id)), offers: o.offers, bestCtc: o.best })
  return out
}

const companyOut = (c, stats) => ({
  ...clean(c), contacts: (c.contacts ?? []).map((x) => ({ ...x, id: String(x._id), _id: undefined })),
  visits: stats.get(String(c._id)) ?? { drives: 0, lastVisit: null, offers: 0, bestCtc: 0 },
})

export async function listCompanies({ search, sector, active } = {}) {
  const f = {}
  if (sector) f.sector = sector
  if (active !== 'all') f.active = active === 'inactive' ? false : true
  if (search) f.$or = [{ name: rx(search) }, { city: rx(search) }, { 'contacts.name': rx(search) }]
  const rows = await Company.find(f).sort({ name: 1 }).lean()
  const stats = await visitStats(rows.map((r) => r._id))
  const bySector = await Company.aggregate([{ $match: { active: true } }, { $group: { _id: '$sector', n: { $sum: 1 } } }])
  return { data: rows.map((c) => companyOut(c, stats)), sectors: Object.fromEntries(bySector.map((s) => [s._id, s.n])) }
}

/** One company with its drives (past visits) and offers. */
export async function getCompany(id) {
  const c = await Company.findById(id).lean()
  if (!c) throw notFound('Company')
  const stats = await visitStats([c._id])
  const drives = await PlacementDrive.find({ companyId: c._id }).select('title startDate status ctcMin ctcMax academicYearId').sort({ startDate: -1 }).lean()
  const offers = await PlacementOffer.aggregate([{ $match: { companyId: c._id } }, { $group: { _id: '$driveId', offers: { $sum: { $cond: [{ $in: ['$status', LIVE_OFFER] }, 1, 0] } } } }])
  const offersBy = new Map(offers.map((o) => [String(o._id), o.offers]))
  return { ...companyOut(c, stats), drives: drives.map((d) => ({ id: String(d._id), title: d.title, startDate: d.startDate ?? null, status: d.status, ctcMin: d.ctcMin ?? null, ctcMax: d.ctcMax ?? null, offers: offersBy.get(String(d._id)) ?? 0 })) }
}

function contactsIn(list = []) {
  const out = list.map((x) => ({ ...x, primary: !!x.primary }))
  if (out.length && !out.some((x) => x.primary)) out[0].primary = true
  return out
}

export async function saveCompany(id, input, auth, req) {
  const body = { ...input }
  if (body.contacts) body.contacts = contactsIn(body.contacts)
  const clash = body.name && await Company.findOne({ name: new RegExp(`^${escapeRegex(body.name)}$`, 'i'), ...(id && { _id: { $ne: id } }) }).select('_id').lean()
  if (clash) throw badRequest('A company with this name is already listed.', { fields: { name: 'Already listed' } })
  let c
  if (id) {
    c = await Company.findById(id)
    if (!c) throw notFound('Company')
    c.set(body)
    await c.save()
  } else {
    c = await Company.create({ ...body, createdBy: auth.user?.name })
  }
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'placements', entityType: 'placement_company', entityId: String(c._id), entityName: c.name, summary: `${id ? 'Updated' : 'Added'} the company ${c.name}` }, req)
  return getCompany(c._id)
}

/** A company that has drives stays (switch it off instead). */
export async function deleteCompany(id, req) {
  const c = await Company.findById(id).lean()
  if (!c) throw notFound('Company')
  if (await PlacementDrive.exists({ companyId: c._id })) throw conflict(`${c.name} has placement drives; mark it inactive instead.`)
  if (await PlacementOffer.exists({ companyId: c._id })) throw conflict(`${c.name} has offers on record; mark it inactive instead.`)
  await Company.deleteOne({ _id: c._id })
  await audit({ action: 'DELETE', module: 'placements', entityType: 'placement_company', entityId: String(c._id), entityName: c.name, summary: `Removed the company ${c.name}` }, req)
  return { id: String(c._id) }
}
