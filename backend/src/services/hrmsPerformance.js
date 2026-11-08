import { APPRAISAL_STATUS, TEACHER_CRITERIA, weightedScore } from '@schoolgiant/shared'
import { Appraisal, AppraisalCycle, Employee } from '../models/hrms.js'
import { User } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { notifyUsers } from './notify.js'
import { employeeIdFilter, idStr } from './hrmsCommon.js'

// Staff & HR › Appraisal: a review round with its criteria (teachers' defaults: subject knowledge, delivery, classroom,
// results …). Launching it makes one review per person: their own self review first (when the round asks for one),
// then their reporting manager's — or HR's, when the manager has no login.

const statusLabel = (s) => APPRAISAL_STATUS[s]?.label ?? s
const cycleDto = (c) => ({ ...clean(c) })

export async function listCycles() {
  const rows = await AppraisalCycle.find().sort({ createdAt: -1 }).lean()
  const counts = await Appraisal.aggregate([{ $match: { cycleId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: { c: '$cycleId', s: '$status' }, n: { $sum: 1 } } }])
  return rows.map((c) => {
    const mine = counts.filter((x) => String(x._id.c) === String(c._id))
    return { ...cycleDto(c), total: mine.reduce((n, x) => n + x.n, 0), byStatus: Object.fromEntries(mine.map((x) => [x._id.s, x.n])) }
  })
}

export async function saveCycle(id, input, auth, req) {
  const c = id ? await AppraisalCycle.findById(id) : new AppraisalCycle({ createdBy: auth.user?.name, criteria: TEACHER_CRITERIA })
  if (!c) throw notFound('Review round')
  if (id && c.status !== 'DRAFT' && input.criteria) throw conflict('The criteria can’t change once the round has started.')
  const criteria = input.criteria ?? c.criteria
  if (!criteria.length) throw badRequest('Some details need fixing.', { fields: { criteria: 'Add at least one' } })
  Object.assign(c, { ...input, criteria: criteria.map((x, i) => ({ key: x.key || `c${i + 1}`, label: x.label, weight: x.weight || 1 })) })
  await c.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'appraisal_cycle', entityId: String(c._id), entityName: c.name, summary: `${id ? 'Updated' : 'Set up'} review round ${c.name}` }, req)
  return cycleDto(c.toObject())
}

/** Start the round: a review for each person on the staff it covers. People who join later can be added by launching again. */
export async function launchCycle(id, auth, req) {
  const c = isOid(id) ? await AppraisalCycle.findById(id) : null
  if (!c) throw notFound('Review round')
  if (c.status === 'CLOSED') throw conflict('This round is closed.')
  const staff = await Employee.find({ status: { $ne: 'EXITED' }, ...(c.categories?.length && { category: { $in: c.categories } }) }).lean()
  const managers = new Map((await Employee.find({ _id: { $in: staff.map((e) => e.reportingManagerId).filter(Boolean) } }).select('name userId').lean()).map((m) => [String(m._id), m]))
  let made = 0
  const toNotify = new Set()
  for (const e of staff) {
    if (await Appraisal.exists({ cycleId: c._id, employeeId: e._id })) continue
    const m = managers.get(String(e.reportingManagerId))
    const self = c.selfReview && !!e.userId
    await Appraisal.create({
      cycleId: c._id, employeeId: e._id, employeeName: e.name, employeeCode: e.employeeCode, designation: e.designation, departmentId: e.departmentId, userId: e.userId,
      reviewerUserId: m?.userId, reviewerName: m?.name, status: self ? 'SELF' : 'MANAGER',
    })
    made++
    if (self) toNotify.add(String(e.userId))
    else if (m?.userId) toNotify.add(String(m.userId))
  }
  if (c.status === 'DRAFT') { c.status = 'OPEN'; c.launchedAt = new Date() }
  await c.save()
  await notifyUsers([...toNotify], { event: 'hrms.appraisal', title: `Review round: ${c.name}`, message: c.dueDate ? `Due by ${c.dueDate}` : 'A review is waiting for you', link: '/me?tab=reviews', tone: 'info' })
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'appraisal_cycle', entityId: String(c._id), entityName: c.name, summary: `Started review round ${c.name} (${made} review(s))` }, req)
  return { made, cycle: cycleDto(c.toObject()) }
}

export async function closeCycle(id, auth, req) {
  const c = isOid(id) ? await AppraisalCycle.findById(id) : null
  if (!c) throw notFound('Review round')
  c.status = 'CLOSED'
  c.closedAt = new Date()
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'appraisal_cycle', entityId: String(c._id), entityName: c.name, summary: `Closed review round ${c.name}` }, req)
  return cycleDto(c.toObject())
}

const adto = (a, cycle) => ({
  ...clean(a), cycleId: String(a.cycleId), employeeId: String(a.employeeId), userId: idStr(a.userId), reviewerUserId: idStr(a.reviewerUserId), statusLabel: statusLabel(a.status),
  cycle: cycle && { id: String(cycle._id), name: cycle.name, criteria: cycle.criteria, dueDate: cycle.dueDate ?? null, status: cycle.status },
})

/** A round's reviews (HR), with their scores. */
export async function cycleReviews(id, auth) {
  const c = isOid(id) ? await AppraisalCycle.findById(id).lean() : null
  if (!c) throw notFound('Review round')
  const rows = await Appraisal.find({ cycleId: c._id, ...await employeeIdFilter(auth) }).sort({ employeeName: 1 }).lean()
  return { cycle: cycleDto(c), rows: rows.map((a) => adto(a)) }
}

export async function getReview(id, auth) {
  const a = isOid(id) ? await Appraisal.findById(id).lean() : null
  if (!a) throw notFound('Review')
  const mine = String(a.userId) === String(auth.userId)
  const reviewer = String(a.reviewerUserId) === String(auth.userId)
  if (!mine && !reviewer && !can(auth, 'hrms.performance.view')) throw notFound('Review')
  const c = await AppraisalCycle.findById(a.cycleId).lean()
  const out = adto(a, c)
  // the person sees the reviewer's part only when it's done
  if (mine && !reviewer && a.status !== 'DONE') out.manager = undefined
  return out
}

/** The person's own review: ratings per criterion and their comments. */
export async function submitSelf(id, { ratings, comments }, auth, req) {
  const a = isOid(id) ? await Appraisal.findById(id) : null
  if (!a || String(a.userId) !== String(auth.userId)) throw notFound('Review')
  if (a.status !== 'SELF') throw conflict('Your self review is already in.')
  const c = await AppraisalCycle.findById(a.cycleId).lean()
  if (c.status !== 'OPEN') throw conflict('This round is closed.')
  const score = weightedScore(c.criteria, ratings)
  if (score === null) throw badRequest('Rate every point from 1 to 5.')
  a.self = { ratings, comments, score, by: auth.user?.name, byId: auth.userId, at: new Date() }
  a.status = 'MANAGER'
  a.markModified('self')
  await a.save()
  const to = a.reviewerUserId ? [String(a.reviewerUserId)] : []
  await notifyUsers(to, { event: 'hrms.appraisal', title: `Self review in: ${a.employeeName}`, message: c.name, link: '/me?tab=reviews', tone: 'info' })
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'appraisal', entityId: String(a._id), entityName: a.employeeName, summary: `${a.employeeName} sent their self review (${c.name})` }, req)
  return getReview(id, auth)
}

/** The reviewer's part: ratings, strengths, what to improve, goals — the review is then done. */
export async function submitManager(id, input, auth, req) {
  const a = isOid(id) ? await Appraisal.findById(id) : null
  if (!a) throw notFound('Review')
  const reviewer = String(a.reviewerUserId) === String(auth.userId)
  if (!reviewer && !can(auth, 'hrms.performance.edit')) throw forbidden('This review is with someone else.')
  if (String(a.userId) === String(auth.userId)) throw forbidden('You can’t review yourself.')
  if (a.status === 'SELF' && !can(auth, 'hrms.performance.edit')) throw conflict('Waiting for their self review.')
  const c = await AppraisalCycle.findById(a.cycleId).lean()
  if (c.status !== 'OPEN') throw conflict('This round is closed.')
  const score = weightedScore(c.criteria, input.ratings)
  if (score === null) throw badRequest('Rate every point from 1 to 5.')
  a.manager = { ...input, score, by: auth.user?.name, byId: auth.userId, at: new Date() }
  a.finalScore = score
  a.status = 'DONE'
  a.markModified('manager')
  await a.save()
  if (a.userId) await notifyUsers([a.userId], { event: 'hrms.appraisal', title: 'Your review is done', message: c.name, link: '/me?tab=reviews', tone: 'success' })
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'appraisal', entityId: String(a._id), entityName: a.employeeName, summary: `Reviewed ${a.employeeName}: ${score}/5 (${c.name})` }, req)
  return getReview(id, auth)
}

/** Change who reviews someone (HR). */
export async function setReviewer(id, userId, auth, req) {
  const a = isOid(id) ? await Appraisal.findById(id) : null
  if (!a) throw notFound('Review')
  const u = userId ? await User.findById(userId).select('name').lean() : null
  if (userId && !u) throw badRequest('Pick a login.')
  a.reviewerUserId = u?._id
  a.reviewerName = u?.name
  await a.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'appraisal', entityId: String(a._id), entityName: a.employeeName, summary: `${u ? `${u.name} now reviews` : 'HR now reviews'} ${a.employeeName}` }, req)
  return adto(a.toObject())
}

/** Self-service: my reviews, and the ones I give. */
export async function myReviews(auth) {
  if (!isOid(auth.userId)) return { mine: [], team: [] }
  const [mine, team] = await Promise.all([
    Appraisal.find({ userId: oid(auth.userId) }).sort({ createdAt: -1 }).limit(20).lean(),
    Appraisal.find({ reviewerUserId: oid(auth.userId), status: { $in: ['SELF', 'MANAGER', 'DONE'] } }).sort({ status: 1, employeeName: 1 }).limit(200).lean(),
  ])
  const cycles = new Map((await AppraisalCycle.find({ _id: { $in: [...mine, ...team].map((a) => a.cycleId) } }).lean()).map((c) => [String(c._id), c]))
  const shape = (a, own) => {
    const out = adto(a, cycles.get(String(a.cycleId)))
    if (own && a.status !== 'DONE') out.manager = undefined
    return out
  }
  return { mine: mine.map((a) => shape(a, true)), team: team.filter((a) => cycles.get(String(a.cycleId))?.status !== 'CLOSED' || a.status === 'DONE').map((a) => shape(a, false)) }
}
