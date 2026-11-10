import {
  DEFAULT_LEAVE_CHAIN, LEAVE_APPROVER_SHORT, LEAVE_CHAIN_MAX_STEPS, hasPermissionIn, leaveChainSummary, pickLeaveRule,
} from '@schoolgiant/shared'
import { Employee, Leave, LeaveApprovalRule } from '../models/hrms.js'
import { Department, Role, User } from '../models/tenant.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { escapeRegex } from '../platform/validate.js'
import { employeeIdFilter, scopedEmployeeIds, stamp, usersWith } from './hrmsCommon.js'
import { finalApproval } from './hrmsLeave.js'
import { notifyUsers } from './notify.js'

// Leave approval chains (ported from the hospital). A leave request walks through 1–5 steps (reporting manager, head
// of department, principal / HR, named people, anyone with a role) chosen by the highest-priority rule that matches it;
// nothing matching → the reporting manager, else the principal / HR. The chain is snapshotted onto the request when it
// is made, so editing a rule never moves a request already under way. The days stay held (waiting) while the chain
// runs and come off the ledger only at the final approval (hrmsLeave.finalApproval). Anyone who approves leave
// (hrms.leave.approve — the principal, HR) may decide at any step, in place of the step's approver; nobody decides
// their own leave. Moving on is lazy: a step that has waited past the rule's hours moves on when requests are next
// read or decided — there is no cron.

const sid = (x) => (x ? String(x) : '')
const HR_PERM = 'hrms.leave.approve'
const MAX_NAMES = 12
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const niceDate = (ymd) => (ymd ? `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}` : '')
export const datesText = (l) => (l.to !== l.from ? `${niceDate(l.from)} to ${niceDate(l.to)}` : niceDate(l.from))
export const daysText = (n) => `${n} day${n === 1 ? '' : 's'}`

// ───────────────────────────────────────────────────────── rules (Leave › Setup › Approval chains)

async function namesById(model, ids) {
  const list = [...new Set(ids.map(sid).filter(isOid))]
  if (!list.length) return new Map()
  return new Map((await model.find({ _id: { $in: list.map(oid) } }).select('name').lean()).map((x) => [String(x._id), x.name]))
}

function ruleDto(r, users, roles) {
  return {
    id: String(r._id), name: r.name, active: r.active !== false, priority: r.priority ?? 0,
    scope: {
      leaveTypeIds: (r.scope?.leaveTypeIds ?? []).map(String), departmentIds: (r.scope?.departmentIds ?? []).map(String),
      categories: r.scope?.categories ?? [], minDays: r.scope?.minDays ?? null,
    },
    steps: (r.steps ?? []).map((s) => ({
      label: s.label ?? '', approverType: s.approverType,
      userIds: (s.userIds ?? []).map(String), roleIds: (s.roleIds ?? []).map(String),
      userNames: (s.userIds ?? []).map((u) => users.get(String(u))).filter(Boolean),
      roleNames: (s.roleIds ?? []).map((x) => roles.get(String(x))).filter(Boolean),
    })),
    summary: leaveChainSummary(r.steps),
    skipSelfOrRepeat: r.skipSelfOrRepeat !== false, escalateAfterHours: r.escalateAfterHours ?? null,
    createdBy: r.createdBy, updatedBy: r.updatedBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export async function listLeaveApprovalRules() {
  const rules = await LeaveApprovalRule.find().sort({ priority: -1, updatedAt: -1 }).lean()
  const [users, roles] = await Promise.all([
    namesById(User, rules.flatMap((r) => r.steps.flatMap((s) => s.userIds ?? []))),
    namesById(Role, rules.flatMap((r) => r.steps.flatMap((s) => s.roleIds ?? []))),
  ])
  return rules.map((r) => ruleDto(r, users, roles))
}

/** People and roles for the step editor (HR may not hold core.users.view). */
export async function leaveApprovalOptions() {
  const [users, roles] = await Promise.all([
    User.find({ active: true }).select('name designation').sort({ name: 1 }).limit(2000).lean(),
    Role.find().select('name').sort({ name: 1 }).lean(),
  ])
  return {
    users: users.map((u) => ({ id: String(u._id), name: u.name, designation: u.designation ?? null })),
    roles: roles.map((r) => ({ id: String(r._id), name: r.name })),
  }
}

export async function saveLeaveApprovalRule(id, input, auth, req) {
  if (!input.steps?.length || input.steps.length > LEAVE_CHAIN_MAX_STEPS) throw badRequest(`Give the chain 1 to ${LEAVE_CHAIN_MAX_STEPS} steps.`, { fields: { steps: 'Required' } })
  const fields = {}
  const [activeUsers, roles] = await Promise.all([
    User.find({ _id: { $in: input.steps.flatMap((s) => s.userIds ?? []).filter(isOid).map(oid) }, active: true }).select('_id').lean(),
    Role.find({ _id: { $in: input.steps.flatMap((s) => s.roleIds ?? []).filter(isOid).map(oid) } }).select('_id').lean(),
  ])
  const okUser = new Set(activeUsers.map((u) => String(u._id)))
  const okRole = new Set(roles.map((r) => String(r._id)))
  const steps = input.steps.map((s, i) => {
    const userIds = s.approverType === 'SPECIFIC_USERS' ? [...new Set(s.userIds ?? [])].filter((u) => okUser.has(u)) : []
    const roleIds = s.approverType === 'ROLE' ? [...new Set(s.roleIds ?? [])].filter((r) => okRole.has(r)) : []
    if (s.approverType === 'SPECIFIC_USERS' && !userIds.length) fields[`steps.${i}.userIds`] = 'Pick at least one person'
    if (s.approverType === 'ROLE' && !roleIds.length) fields[`steps.${i}.roleIds`] = 'Pick at least one role'
    return { label: s.label?.trim() || undefined, approverType: s.approverType, userIds, roleIds }
  })
  if (Object.keys(fields).length) throw badRequest('Some steps have nobody to approve them.', { fields })
  let r
  if (id) {
    r = await LeaveApprovalRule.findById(isOid(id) ? id : null)
    if (!r) throw notFound('Approval chain')
  } else r = new LeaveApprovalRule({ createdBy: auth.user?.name })
  r.set({
    name: input.name, active: input.active !== false, priority: input.priority ?? 0,
    scope: {
      leaveTypeIds: (input.scope?.leaveTypeIds ?? []).filter(isOid), departmentIds: (input.scope?.departmentIds ?? []).filter(isOid),
      categories: input.scope?.categories ?? [], minDays: input.scope?.minDays ?? null,
    },
    steps, skipSelfOrRepeat: input.skipSelfOrRepeat !== false, escalateAfterHours: input.escalateAfterHours || null, updatedBy: auth.user?.name,
  })
  await r.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'hrms', entityType: 'leave_approval_rule', entityId: String(r._id), entityName: r.name, summary: `${id ? 'Changed' : 'Added'} leave approval chain “${r.name}”: ${leaveChainSummary(r.steps)}${r.active ? '' : ' (switched off)'}` }, req)
  return (await listLeaveApprovalRules()).find((x) => x.id === String(r._id))
}

export async function deleteLeaveApprovalRule(id, req) {
  const r = await LeaveApprovalRule.findOneAndDelete({ _id: isOid(id) ? id : null })
  if (!r) throw notFound('Approval chain')
  await audit({ action: 'DELETE', module: 'hrms', entityType: 'leave_approval_rule', entityId: String(r._id), entityName: r.name, summary: `Removed leave approval chain “${r.name}” — requests already under way keep their chain` }, req)
  return { id: String(r._id) }
}

// ───────────────────────────────────────────────────────── building a chain

const isHrStep = (s) => s?.approverType === 'HR' || !!s?.fallback
const stepLabel = (type) => LEAVE_APPROVER_SHORT[type] ?? type
/** "Reporting manager" or, when the principal / HR stands in, "Principal / HR (for the reporting manager)". */
export const waitingLabel = (s) => (s?.fallback ? `Principal / HR (for the ${String(s.label || 'approver').toLowerCase()})` : s?.label || 'Principal / HR')

const activeUserIds = async (ids) => {
  const list = (ids ?? []).map(sid).filter(isOid)
  if (!list.length) return []
  return (await User.find({ _id: { $in: list.map(oid) }, active: true }).select('_id').lean()).map((u) => String(u._id))
}

/** Who a step points at before the applicant is taken out; `missing` says why nobody. */
async function rawApprovers(step, e, hr) {
  switch (step.approverType) {
    case 'REPORTING_MANAGER': {
      if (!e.reportingManagerId) return { ids: [], missing: 'No reporting manager is set' }
      const m = await Employee.findById(e.reportingManagerId).select('userId name status').lean()
      if (!m?.userId || m.status === 'EXITED') return { ids: [], missing: `${m?.name ?? 'The reporting manager'} has no login` }
      const ids = await activeUserIds([m.userId])
      return ids.length ? { ids } : { ids: [], missing: `${m.name}’s login is switched off` }
    }
    case 'DEPARTMENT_HEAD': {
      if (!e.departmentId) return { ids: [], missing: 'No department is set' }
      const d = await Department.findById(e.departmentId).select('headUserId name').lean()
      if (!d?.headUserId) return { ids: [], missing: `${d?.name ?? 'The department'} has no head set` }
      const ids = await activeUserIds([d.headUserId])
      return ids.length ? { ids } : { ids: [], missing: `The head of ${d.name} has no active login` }
    }
    case 'HR': return { ids: await hr() }
    case 'SPECIFIC_USERS': {
      const ids = await activeUserIds(step.userIds)
      return ids.length ? { ids } : { ids: [], missing: 'None of the named people has an active login' }
    }
    case 'ROLE': {
      const roleIds = (step.roleIds ?? []).map(sid).filter(isOid).map(oid)
      const ids = roleIds.length ? (await User.find({ active: true, roleIds: { $in: roleIds } }).select('_id').lean()).map((u) => String(u._id)) : []
      return ids.length ? { ids } : { ids: [], missing: 'Nobody holds the role' }
    }
    default: return { ids: [], missing: 'Unknown approver' }
  }
}

/** One step, resolved: the applicant is never their own approver. A step only they could approve is skipped (when the rule says so); one with nobody falls to the principal / HR. */
async function resolveStep(step, i, e, opts, hr) {
  const me = sid(e.userId)
  const raw = await rawApprovers(step, e, hr)
  const ids = raw.ids.filter((u) => u !== me)
  const out = { step: i, label: step.label || stepLabel(step.approverType), approverType: step.approverType, approverIds: ids, approverNames: [] }
  if (ids.length || step.approverType === 'HR') return out
  if (raw.ids.length && opts.skipSelfOrRepeat) return { ...out, decision: 'SKIPPED', note: 'Only the person on leave could approve this step', at: new Date() }
  return { ...out, fallback: raw.missing ?? 'The approver is the person on leave', approverIds: (await hr()).filter((u) => u !== me) }
}

/** Has this step's group already said yes at an earlier step (or the same people as one)? */
function repeats(steps, i) {
  const s = steps[i]
  if (!s.approverIds?.length) return false
  const done = steps.slice(0, i).filter((x) => x.decision === 'APPROVED')
  const deciders = new Set(done.map((x) => sid(x.decidedById)))
  const key = (ids) => (ids ?? []).map(String).sort().join()
  return s.approverIds.every((u) => deciders.has(String(u))) || done.some((x) => key(x.approverIds) === key(s.approverIds))
}

/** The first step from `from` that still needs someone; skipped ones are marked. -1 = none left. */
function nextActionable(steps, from, { skipSelfOrRepeat }) {
  for (let i = from; i < steps.length; i++) {
    if (steps[i].decision) continue
    if (skipSelfOrRepeat && repeats(steps, i)) { Object.assign(steps[i], { decision: 'SKIPPED', note: 'Already approved at an earlier step', at: new Date() }); continue }
    return i
  }
  return -1
}

async function fillNames(steps) {
  const names = await namesById(User, steps.flatMap((s) => s.approverIds ?? []))
  for (const s of steps) s.approverNames = (s.approverIds ?? []).map((u) => names.get(String(u))).filter(Boolean).sort().slice(0, MAX_NAMES)
}

const pendingFields = (s) => (isHrStep(s) ? { pendingWith: [], pendingWithHr: true } : { pendingWith: (s.approverIds ?? []).map(oid), pendingWithHr: false })
const memo = (fn) => { let p; return () => (p ??= fn()) }

/** Which rule applies to this request (null = the usual chain). */
export async function ruleFor(leave, e) {
  const rules = await LeaveApprovalRule.find({ active: true }).lean()
  return pickLeaveRule(rules, { leaveTypeId: sid(leave.leaveTypeId), departmentId: sid(e.departmentId), category: e.category, days: leave.days })
}

/**
 * Build the chain for a new request, store it on the request, and tell the first approvers.
 * `needsHr`: the request falls on no-leave days that need the principal / HR — a final principal / HR step is added
 * when the chain doesn't already end with one.
 */
async function buildChain(leave, e, { needsHr = false } = {}) {
  const rule = await ruleFor(leave, e)
  const def = rule ?? DEFAULT_LEAVE_CHAIN
  const opts = { skipSelfOrRepeat: def.skipSelfOrRepeat !== false }
  const hr = memo(() => usersWith(HR_PERM))
  const steps = []
  for (const [i, s] of def.steps.entries()) steps.push(await resolveStep(s, i, e, opts, hr))
  if (needsHr && !isHrStep(steps.at(-1))) {
    steps.push({ step: steps.length, label: 'Principal / HR (no-leave days)', approverType: 'HR', approverIds: (await hr()).filter((u) => u !== sid(e.userId)), approverNames: [] })
  }
  let cur = nextActionable(steps, 0, opts)
  if (cur < 0) {
    // every step was skipped — someone must still say yes: the principal / HR takes the last one
    cur = steps.length - 1
    Object.assign(steps[cur], { decision: undefined, note: undefined, at: undefined, fallback: 'Every step was the person on leave', approverIds: (await hr()).filter((u) => u !== sid(e.userId)) })
  }
  await fillNames(steps)
  return { rule, opts, steps, cur }
}

/** Who a request would go to, without making it (the apply preview): [{ label, people[], skipped }]. */
export async function planChain(leave, e, opts) {
  const { rule, steps, cur } = await buildChain(leave, e, opts)
  return {
    name: rule?.name ?? DEFAULT_LEAVE_CHAIN.name,
    steps: steps.map((s, i) => ({ label: waitingLabel(s), people: isHrStep(s) && !s.fallback ? [] : s.approverNames ?? [], skipped: s.decision === 'SKIPPED' || i < cur })),
  }
}

/**
 * Build the chain for a new request, store it on the request, and tell the first approvers.
 * `needsHr`: the request falls on no-leave days that need the principal / HR — a final principal / HR step is added
 * when the chain doesn't already end with one.
 */
export async function startChain(leave, e, { needsHr = false } = {}) {
  const { rule, opts, steps, cur } = await buildChain(leave, e, { needsHr })
  steps[cur].since = new Date()
  const set = {
    approvals: steps, currentStep: cur, ...pendingFields(steps[cur]),
    chain: { ruleId: rule?._id, ruleName: rule?.name ?? DEFAULT_LEAVE_CHAIN.name, skipSelfOrRepeat: opts.skipSelfOrRepeat, escalateAfterHours: rule?.escalateAfterHours ?? null },
  }
  const saved = await Leave.findOneAndUpdate({ _id: leave._id }, { $set: set }, { new: true }).lean()
  await notifyStep(saved, sid(e.userId))
  return saved
}

// ───────────────────────────────────────────────────────── reading a chain

/** Requests made before chains existed read as one principal / HR step, decided as the request was. */
function chainOf(l) {
  if (l.approvals?.length) return l.approvals
  const decided = ['APPROVED', 'REJECTED'].includes(l.status) && l.decided?.at
  const legacy = (l.pendingWith ?? []).length
  return [{
    step: 0, label: legacy ? 'Reporting manager' : 'Principal / HR', approverType: legacy ? 'REPORTING_MANAGER' : 'HR', approverIds: l.pendingWith ?? [], approverNames: l._legacyNames ?? [],
    ...(decided ? { decision: l.status, decidedBy: l.decided.by, decidedById: l.decided.byId, note: l.decided.note, at: l.decided.at } : {}),
  }]
}
const currentIndex = (l) => (l.approvals?.length ? l.currentStep ?? 0 : 0)
const currentOf = (l) => chainOf(l)[currentIndex(l)]

/** May this caller decide the step the request waits on — and is it in place of the step's approver? */
export function rightsFor(auth, l, { inScope, applicantUserId }) {
  const me = sid(auth?.userId)
  if (l.status !== 'PENDING') return { canAct: false }
  if (applicantUserId && applicantUserId === me) return { canAct: false, reason: 'This is your own leave — someone else decides it.' }
  const s = currentOf(l)
  if (!isHrStep(s) && (s.approverIds ?? []).some((u) => sid(u) === me)) return { canAct: true, actingAsHr: false }
  if (isHrStep(s) && inScope && can(auth, HR_PERM)) return { canAct: true, actingAsHr: false }
  if (inScope && can(auth, HR_PERM)) return { canAct: true, actingAsHr: true }
  return { canAct: false, reason: `Waiting for ${waitingLabel(s)}.` }
}

const STATE = { APPROVED: 'APPROVED', OVERRIDDEN: 'APPROVED', REJECTED: 'REJECTED', SKIPPED: 'SKIPPED', ESCALATED: 'ESCALATED' }

/** Where the request is, who has it, and every step. */
export function chainProgress(l, rights = {}) {
  const steps = chainOf(l)
  const cur = currentIndex(l)
  const pending = l.status === 'PENDING'
  const s = steps[cur]
  return {
    status: l.status, ruleName: l.chain?.ruleName ?? null,
    stepNumber: cur + 1, totalSteps: steps.length,
    waitingOn: pending ? waitingLabel(s) : null,
    waitingOnPeople: pending && !isHrStep(s) ? s.approverNames ?? [] : [],
    since: pending ? s.since ?? l.applied?.at ?? l.createdAt : null,
    escalateAfterHours: l.chain?.escalateAfterHours ?? null,
    canAct: !!rights.canAct, actingAsHr: !!rights.actingAsHr, cannotActReason: rights.reason ?? null,
    requestedBy: l.applied?.by ?? null,
    rejectionReason: l.status === 'REJECTED' ? l.decided?.note ?? null : l.status === 'CANCELLED' ? l.cancelled?.reason ?? null : null,
    steps: steps.map((x, i) => ({
      no: i + 1, label: x.label, approverType: x.approverType, approverNames: isHrStep(x) && !x.fallback ? [] : x.approverNames ?? [], fallback: x.fallback ?? null,
      state: STATE[x.decision] ?? (pending ? (i === cur ? 'CURRENT' : i > cur ? 'UPCOMING' : 'NOT_REACHED') : 'NOT_REACHED'),
      override: x.decision === 'OVERRIDDEN', decidedBy: x.decidedBy ?? null, at: x.at ?? null, note: x.note ?? null,
    })),
  }
}

/** The caller's rights over each request. */
export async function rightsMap(leaves, auth) {
  const empIds = [...new Set(leaves.map((l) => sid(l.employeeId)))]
  const [emps, scoped] = await Promise.all([
    Employee.find({ _id: { $in: empIds.map(oid) } }).select('userId').lean(),
    scopedEmployeeIds(auth),
  ])
  const userOf = new Map(emps.map((e) => [String(e._id), sid(e.userId)]))
  const scope = scoped ? new Set(scoped.map(String)) : null
  return new Map(leaves.map((l) => [String(l._id), rightsFor(auth, l, { inScope: !scope || scope.has(sid(l.employeeId)), applicantUserId: userOf.get(sid(l.employeeId)) || sid(l.userId) })]))
}

/** Leave rows with their `chain` progress, as the caller sees it (internal chain fields left out). */
export async function withChain(leaves, auth, dto = (x) => x) {
  if (!leaves.length) return []
  const rights = await rightsMap(leaves, auth)
  // requests from before chains name only the reporting manager's login: show their name
  const legacy = leaves.filter((l) => !l.approvals?.length && l.pendingWith?.length)
  const names = legacy.length ? await namesById(User, legacy.flatMap((l) => l.pendingWith)) : new Map()
  return leaves.map((l0) => {
    const l = !l0.approvals?.length && l0.pendingWith?.length ? { ...l0, _legacyNames: l0.pendingWith.map((u) => names.get(String(u))).filter(Boolean) } : l0
    const { approvals, pendingWithHr, currentStep, _legacyNames, ...rest } = l
    return { ...dto(rest), chain: chainProgress(l, rights.get(String(l._id))) }
  })
}

// ───────────────────────────────────────────────────────── "waiting on me"

/** PENDING requests whose current step is mine — named on it, or the principal's / HR's and I approve leave (in scope). */
export async function waitingFilter(auth) {
  if (!isOid(auth?.userId)) return { _id: null }
  const or = [{ pendingWith: oid(auth.userId) }]
  if (can(auth, HR_PERM)) {
    const scope = await employeeIdFilter(auth)
    // HR steps, and requests from before chains (no steps, nobody named)
    or.push({ pendingWithHr: true, ...scope }, { 'approvals.0': { $exists: false }, 'pendingWith.0': { $exists: false }, ...scope })
  }
  const mine = await Employee.findOne({ userId: auth.userId }).select('_id').lean()
  return { status: 'PENDING', $or: or, ...(mine ? { employeeId: { $ne: mine._id } } : {}), userId: { $ne: oid(auth.userId) } }
}

export async function waitingOnMe(auth, { search } = {}) {
  await sweepEscalations()
  const filter = await waitingFilter(auth)
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i')
    filter.$and = [{ $or: [{ employeeName: re }, { employeeCode: re }, { leaveName: re }] }]
  }
  return Leave.find(filter).sort({ from: 1 }).limit(300).lean()
}

export const countWaitingOnMe = async (auth) => Leave.countDocuments(await waitingFilter(auth))

// ───────────────────────────────────────────────────────── notifications

/** Of these users, those whose role holds `perm` (they get the HR screen link). */
async function holders(perm, ids) {
  const users = await User.find({ _id: { $in: ids.filter(isOid).map(oid) } }).select('roleIds').lean()
  const roles = await Role.find({ _id: { $in: users.flatMap((u) => u.roleIds ?? []) } }).select('permissions fullAccess').lean()
  const ok = new Set(roles.filter((r) => r.fullAccess || hasPermissionIn(r.permissions, perm)).map((r) => String(r._id)))
  return new Set(users.filter((u) => (u.roleIds ?? []).some((r) => ok.has(String(r)))).map((u) => String(u._id)))
}

/** Tell whoever the request now waits on. Leave staff land on Leave › Requests, others in My workspace › Team leave. */
async function notifyStep(l, applicantUserId, { escalated = false } = {}) {
  const s = currentOf(l)
  const ids = (isHrStep(s) ? await usersWith(HR_PERM) : (s.approverIds ?? []).map(String)).filter((u) => u && u !== applicantUserId)
  if (!ids.length) return
  const viewers = await holders('hrms.leave.view', ids)
  const n = chainOf(l).length
  const base = {
    event: 'hrms.leave_applied', tone: 'warning', entityType: 'leave', entityId: String(l._id),
    title: `${escalated ? 'Moved to you — leave' : 'Leave'} request: ${l.employeeName}`,
    message: `${daysText(l.days)} of ${l.leaveName ?? l.leaveCode}, ${datesText(l)}${n > 1 ? ` · step ${currentIndex(l) + 1} of ${n} (${waitingLabel(s)})` : ''}${l.reason ? ` — ${l.reason}` : ''}`,
  }
  await notifyUsers(ids.filter((u) => viewers.has(u)), { ...base, link: `/hrms/leave?open=${l._id}` })
  await notifyUsers(ids.filter((u) => !viewers.has(u)), { ...base, link: '/me?tab=approvals' })
}

export async function tellApplicant(l, title, message, tone) {
  const e = await Employee.findById(l.employeeId).select('userId').lean()
  if (e?.userId) await notifyUsers([String(e.userId)], { event: 'hrms.leave_decided', title, message, link: '/me?tab=leave', tone, entityType: 'leave', entityId: String(l._id) })
}

/** A waiting request was withdrawn: the people it was with needn't look for it. */
export async function notifyWithdrawn(l) {
  const s = currentOf(l)
  if (isHrStep(s)) return // the principal / HR see it leave the list
  await notifyUsers((s.approverIds ?? []).map(String), {
    event: 'hrms.leave_cancelled', title: `Leave request withdrawn: ${l.employeeName}`, message: `${l.leaveName ?? l.leaveCode}, ${datesText(l)} — nothing to decide now.`,
    link: '/me?tab=approvals', tone: 'info', entityType: 'leave', entityId: String(l._id),
  })
}

// ───────────────────────────────────────────────────────── moving on (lazy)

async function escalate(l) {
  const steps = l.approvals.map((x) => ({ ...x }))
  const i = l.currentStep ?? 0
  const h = l.chain.escalateAfterHours
  Object.assign(steps[i], { decision: 'ESCALATED', decidedBy: 'System', at: new Date(), note: `No decision within ${h} hours — moved on` })
  let next = nextActionable(steps, i + 1, { skipSelfOrRepeat: l.chain.skipSelfOrRepeat !== false })
  const e = await Employee.findById(l.employeeId).select('userId').lean()
  if (next < 0) {
    steps.push({ step: steps.length, label: 'Principal / HR (moved on)', approverType: 'HR', approverIds: (await usersWith(HR_PERM)).filter((u) => u !== sid(e?.userId)), approverNames: [] })
    await fillNames([steps[steps.length - 1]])
    next = steps.length - 1
  }
  steps[next].since = new Date()
  const r = await Leave.findOneAndUpdate({ _id: l._id, status: 'PENDING', currentStep: i }, { $set: { approvals: steps, currentStep: next, ...pendingFields(steps[next]) } }, { new: true }).lean()
  if (!r) return
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `Moved on ${l.employeeName}’s ${l.leaveName ?? l.leaveCode} request (${datesText(l)}): step ${i + 1} (${waitingLabel(l.approvals[i])}) waited more than ${h} hours — now with ${waitingLabel(steps[next])}` })
  await notifyStep(r, sid(e?.userId), { escalated: true })
}

/** Move on every waiting step that has sat past its rule's hours. */
export async function sweepEscalations() {
  const now = Date.now()
  const open = await Leave.find({ status: 'PENDING', 'chain.escalateAfterHours': { $gt: 0 } })
    .select('approvals currentStep chain employeeId employeeName leaveCode leaveName from to days reason').limit(300).lean()
  for (const l of open) {
    const i = l.currentStep ?? 0
    const s = l.approvals?.[i]
    if (!s?.since || now - new Date(s.since).getTime() < l.chain.escalateAfterHours * 3600e3) continue
    if (i === l.approvals.length - 1 && isHrStep(s)) continue // already with the principal / HR at the end: nowhere further
    await escalate(l)
  }
}

// ───────────────────────────────────────────────────────── deciding

const raced = () => conflict('Someone else has just decided this step. Refresh to see where the request is.')

/**
 * Approve or reject the step a request waits on. Approving the last step (or the principal / HR deciding in place of
 * the step's approver) is the final approval: the balance and clash checks, the ledger entry, staff attendance and the
 * cover note (hrmsLeave.finalApproval). Rejecting at any step ends the request, with a reason the person sees.
 * A guard on (status, currentStep) stops two approvers both moving it on.
 */
export async function decideStep(id, { approve, note }, auth, req) {
  await sweepEscalations()
  const l = await Leave.findById(isOid(id) ? id : null).lean()
  if (!l) throw notFound('Leave request')
  const me = sid(auth.userId)
  const e = await Employee.findById(l.employeeId).lean()
  if (!e) throw notFound('Staff record')
  const applicantUserId = sid(e.userId) || sid(l.userId)
  const scoped = await scopedEmployeeIds(auth)
  const inScope = !scoped || scoped.some((x) => sid(x) === sid(l.employeeId))
  const named = chainOf(l).some((s) => (s.approverIds ?? []).some((u) => sid(u) === me))
  if (!inScope && !named) throw notFound('Leave request')
  if (applicantUserId && applicantUserId === me) throw forbidden('You can’t approve or reject your own leave.')
  if (l.status !== 'PENDING') throw conflict('This request has already been decided.')
  const rights = rightsFor(auth, l, { inScope, applicantUserId })
  if (!rights.canAct) throw forbidden(rights.reason ?? 'This step isn’t yours to decide.')
  const text = note?.trim() || undefined
  if (!approve && !text) throw badRequest('Say why it isn’t approved — they will see it.', { fields: { note: 'Required' } })

  const steps = chainOf(l).map((s) => ({ ...s }))
  const cur = currentIndex(l)
  const n = steps.length
  const guard = { _id: l._id, status: 'PENDING', ...(l.approvals?.length ? { currentStep: cur } : {}) }
  const by = stamp(auth)
  const override = rights.actingAsHr
  const was = waitingLabel(steps[cur])
  const what = `${daysText(l.days)} of ${l.leaveName ?? l.leaveCode} for ${l.employeeName} (${datesText(l)})`
  const step = n > 1 ? ` at step ${cur + 1} of ${n} (${was})` : ''
  Object.assign(steps[cur], { decision: !approve ? 'REJECTED' : override ? 'OVERRIDDEN' : 'APPROVED', decidedBy: by.by, decidedById: by.byId, note: text, at: by.at })
  const closed = { pendingWith: [], pendingWithHr: false, approvals: steps, currentStep: cur }

  if (!approve) {
    const r = await Leave.findOneAndUpdate(guard, { $set: { ...closed, status: 'REJECTED', decided: { ...by, note: text } } }, { new: true }).lean()
    if (!r) throw raced()
    await audit({ action: 'REJECT', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `${override ? `Decided in place of the ${was.toLowerCase()}: ` : ''}Did not approve ${what}${step} — ${text}` }, req)
    await tellApplicant(r, `Leave not approved: ${l.leaveName ?? l.leaveCode}`, `${datesText(l)} — ${text}`, 'warning')
    return r
  }

  const next = override ? -1 : nextActionable(steps, cur + 1, { skipSelfOrRepeat: l.chain?.skipSelfOrRepeat !== false })
  if (next >= 0) {
    steps[next].since = by.at
    const r = await Leave.findOneAndUpdate(guard, { $set: { approvals: steps, currentStep: next, ...pendingFields(steps[next]) } }, { new: true }).lean()
    if (!r) throw raced()
    const now = `${waitingLabel(steps[next])}${steps[next].approverNames?.length && !isHrStep(steps[next]) ? ` — ${steps[next].approverNames.join(', ')}` : ''}`
    await audit({ action: 'APPROVE', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `Approved step ${cur + 1} of ${n} (${was}) of ${what}${text ? ` — ${text}` : ''}; now with ${now}` }, req)
    await notifyStep(r, applicantUserId)
    await tellApplicant(r, `Leave: step ${cur + 1} of ${n} approved`, `${by.by} approved your ${l.leaveName ?? l.leaveCode} request (${datesText(l)}). Now with ${now}.`, 'info')
    return r
  }

  // the final approval
  await finalApproval(l, e, auth, { guard, set: { ...closed, status: 'APPROVED', decided: { ...by, note: text } }, raced })
  const r = await Leave.findById(l._id).lean()
  await audit({ action: 'APPROVE', module: 'hrms', entityType: 'leave', entityId: String(l._id), entityName: l.employeeName, summary: `${override ? `Decided in place of the ${was.toLowerCase()}: ` : ''}Approved ${what}${step}${n > 1 && !override ? ' — final approval' : ''}${text ? ` — ${text}` : ''}` }, req)
  await tellApplicant(r, `Leave approved: ${l.leaveName ?? l.leaveCode}`, `${datesText(l)} (${daysText(l.days)})${text ? ` — ${text}` : ''}`, 'success')
  return r
}
