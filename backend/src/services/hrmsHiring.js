import { CANDIDATE_STAGES, OPEN_CANDIDATE_STAGES, REQUISITION_STATUSES } from '@schoolgiant/shared'
import { Candidate, Employee, Requisition } from '../models/hrms.js'
import { Department } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { createEmployee } from './hrms.js'
import { idStr, stamp } from './hrmsCommon.js'

// Staff & HR › Recruitment: a vacancy (requisition) and the people applying for it, step by step — shortlisted,
// a demo class (for teachers), the interview, an offer, and joining, which makes their staff record.

const stageLabel = (s) => CANDIDATE_STAGES[s]?.label ?? s

// ───────────────────────────────────────────────────────── vacancies

export async function listRequisitions(q = {}) {
  const f = {}
  if (q.status === 'ACTIVE' || !q.status) f.status = { $in: ['OPEN', 'ON_HOLD'] }
  else if (q.status !== 'ALL') f.status = q.status
  const rows = await Requisition.find(f).sort({ createdAt: -1 }).limit(300).lean()
  const counts = await Candidate.aggregate([{ $match: { requisitionId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: { r: '$requisitionId', s: '$stage' }, n: { $sum: 1 } } }])
  const deps = new Map((await Department.find({ _id: { $in: rows.map((r) => r.departmentId).filter(Boolean) } }).select('name').lean()).map((d) => [String(d._id), d.name]))
  return rows.map((r) => {
    const mine = counts.filter((c) => String(c._id.r) === String(r._id))
    const by = Object.fromEntries(mine.map((c) => [c._id.s, c.n]))
    return {
      ...clean(r), departmentId: idStr(r.departmentId), department: deps.get(String(r.departmentId)) ?? null, statusLabel: REQUISITION_STATUSES[r.status]?.label,
      candidates: mine.reduce((n, c) => n + c.n, 0), inProcess: OPEN_CANDIDATE_STAGES.reduce((n, s) => n + (by[s] ?? 0), 0), byStage: by,
    }
  })
}

export async function saveRequisition(id, input, auth, req) {
  const r = id ? await Requisition.findById(id) : new Requisition({ requisitionNo: await nextNumber('REQUISITION'), status: 'OPEN', createdBy: auth.user?.name, statusHistory: [{ status: 'OPEN', ...stamp(auth) }] })
  if (!r) throw notFound('Vacancy')
  Object.assign(r, { ...input, departmentId: input.departmentId || undefined, branchId: input.branchId || undefined })
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'requisition', entityId: String(r._id), entityName: r.title, summary: `${id ? 'Updated' : 'Opened'} vacancy ${r.requisitionNo} — ${r.title} (${r.count})` }, req)
  return clean(r.toObject())
}

export async function setRequisitionStatus(id, { status, note }, auth, req) {
  const r = isOid(id) ? await Requisition.findById(id) : null
  if (!r) throw notFound('Vacancy')
  if (r.status === status) return clean(r.toObject())
  r.status = status
  r.statusHistory.push({ status, note, ...stamp(auth) })
  await r.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'requisition', entityId: String(r._id), entityName: r.title, summary: `Vacancy ${r.requisitionNo} is now ${REQUISITION_STATUSES[status]?.label.toLowerCase()}${note ? `: ${note}` : ''}` }, req)
  return clean(r.toObject())
}

// ───────────────────────────────────────────────────────── candidates

const cdto = (c) => ({ ...clean(c), requisitionId: String(c.requisitionId), employeeId: idStr(c.employeeId), stageLabel: stageLabel(c.stage), rating: avgRating(c) })
const avgRating = (c) => {
  const r = (c.evaluations ?? []).map((e) => e.rating).filter((x) => x >= 1)
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null
}

export async function listCandidates({ requisitionId, stage, search }) {
  const f = {}
  if (isOid(requisitionId)) f.requisitionId = requisitionId
  if (stage === 'OPEN') f.stage = { $in: OPEN_CANDIDATE_STAGES }
  else if (stage) f.stage = stage
  if (search) f.$or = [{ name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { mobile: new RegExp(search.replace(/\D/g, '') || '^$') }]
  const rows = await Candidate.find(f).sort({ updatedAt: -1 }).limit(500).lean()
  return rows.map(cdto)
}

export async function getCandidate(id) {
  const c = isOid(id) ? await Candidate.findById(id).lean() : null
  if (!c) throw notFound('Candidate')
  const r = await Requisition.findById(c.requisitionId).select('title requisitionNo category employmentType departmentId branchId').lean()
  return { ...cdto(c), requisition: r && { id: String(r._id), title: r.title, requisitionNo: r.requisitionNo } }
}

export async function saveCandidate(id, input, auth, req) {
  const req0 = await Requisition.findById(input.requisitionId ?? (id && (await Candidate.findById(id).select('requisitionId').lean())?.requisitionId)).lean()
  if (!req0) throw badRequest('Some details need fixing.', { fields: { requisitionId: 'Pick a vacancy' } })
  if (!id && input.mobile && await Candidate.exists({ requisitionId: req0._id, mobile: input.mobile })) throw conflict('This person has already applied for this vacancy.', { fields: { mobile: 'Already applied' } })
  const c = id ? await Candidate.findById(id) : new Candidate({ stage: 'APPLIED', createdBy: auth.user?.name, history: [{ stage: 'APPLIED', by: auth.user?.name, at: new Date() }] })
  if (!c) throw notFound('Candidate')
  Object.assign(c, input)
  await c.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'candidate', entityId: String(c._id), entityName: c.name, summary: `${id ? 'Updated' : 'Added'} candidate ${c.name} for ${req0.title}` }, req)
  return getCandidate(String(c._id))
}

/** Move a candidate to a step (not to "joined" — that is hire()). Booking a demo class or interview goes with it. */
export async function moveCandidate(id, { stage, note, next }, auth, req) {
  const c = isOid(id) ? await Candidate.findById(id) : null
  if (!c) throw notFound('Candidate')
  if (c.stage === 'HIRED') throw conflict('This person has joined; their staff record is in Staff.')
  if (stage === 'HIRED') throw badRequest('Use “Joined” to make their staff record.')
  c.stage = stage
  c.next = ['DEMO', 'INTERVIEW'].includes(stage) && next ? { kind: stage, ...next } : undefined
  c.history.push({ stage, note, by: auth.user?.name, at: new Date() })
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'candidate', entityId: String(c._id), entityName: c.name, summary: `${c.name}: ${stageLabel(stage)}${next?.date ? ` on ${next.date}` : ''}${note ? ` — ${note}` : ''}` }, req)
  return getCandidate(id)
}

/** Feedback on a demo class or interview: a rating out of 5 and a note. */
export async function evaluateCandidate(id, { rating, note }, auth, req) {
  const c = isOid(id) ? await Candidate.findById(id) : null
  if (!c) throw notFound('Candidate')
  c.evaluations.push({ stage: c.stage, rating, note, by: auth.user?.name, byId: auth.userId, at: new Date() })
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'candidate', entityId: String(c._id), entityName: c.name, summary: `Feedback on ${c.name} (${stageLabel(c.stage)}): ${rating}/5` }, req)
  return getCandidate(id)
}

export async function offerCandidate(id, input, auth, req) {
  const c = isOid(id) ? await Candidate.findById(id) : null
  if (!c) throw notFound('Candidate')
  if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c.stage)) throw conflict(`This candidate is ${stageLabel(c.stage).toLowerCase()}.`)
  c.offer = { ...input, at: new Date(), by: auth.user?.name }
  c.stage = 'OFFERED'
  c.next = undefined
  c.history.push({ stage: 'OFFERED', note: `Offer: joining ${input.joiningDate}`, by: auth.user?.name, at: new Date() })
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'candidate', entityId: String(c._id), entityName: c.name, summary: `Offered ${c.name} the post, joining ${input.joiningDate}` }, req)
  return getCandidate(id)
}

/** They joined: make the staff record from the candidate and the vacancy; the vacancy fills up. */
export async function hireCandidate(id, input, auth, req) {
  const c = isOid(id) ? await Candidate.findById(id) : null
  if (!c) throw notFound('Candidate')
  if (c.stage === 'HIRED') throw conflict('Already joined.')
  const r = await Requisition.findById(c.requisitionId)
  const emp = await createEmployee({
    name: c.name, mobile: c.mobile, email: c.email, gender: c.gender, qualifications: c.qualifications, experienceYears: c.experienceYears,
    subjects: r?.subjects, designation: input.designation || c.offer?.designation || r?.title, category: r?.category ?? 'OTHER', employmentType: input.employmentType || r?.employmentType || 'PERMANENT',
    departmentId: r?.departmentId ? String(r.departmentId) : undefined, branchId: r?.branchId ? String(r.branchId) : undefined,
    joiningDate: input.joiningDate || c.offer?.joiningDate, reportingManagerId: input.reportingManagerId, employeeCode: input.employeeCode, candidateId: String(c._id),
  }, auth, req)
  c.stage = 'HIRED'
  c.employeeId = emp.id
  c.history.push({ stage: 'HIRED', note: `Staff record ${emp.employeeCode}`, by: auth.user?.name, at: new Date() })
  await c.save()
  if (r) {
    r.filled = (await Candidate.countDocuments({ requisitionId: r._id, stage: 'HIRED' }))
    if (r.filled >= r.count && r.status !== 'FILLED') { r.status = 'FILLED'; r.statusHistory.push({ status: 'FILLED', note: 'Every post filled', ...stamp(auth) }) }
    await r.save()
  }
  if (await Employee.exists({ _id: emp.id })) await audit({ action: 'UPDATE', module: 'hrms', entityType: 'candidate', entityId: String(c._id), entityName: c.name, summary: `${c.name} joined (${emp.employeeCode})` }, req)
  return { candidate: await getCandidate(id), employee: emp }
}
