import {
  APPROVAL_STATUSES, APPROVAL_TYPES, APPROVAL_TYPE_BY, ROLE_LIMITS, approvalValueText, defaultApprovalRule, describePermission,
  hasPermissionIn, limitCovers, stepsFor,
} from '@schoolgiant/shared'
import { ApprovalRequest, ApprovalRule } from '../models/engines.js'
import { Role, User } from '../models/tenant.js'
import { can, enabledModuleIds, mergeRoles, moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid, oid } from '../platform/db.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { listResponse } from '../platform/validate.js'
import { notifyUsers } from './notify.js'

// Approval engine (docs/00 §7 E8; types in packages/shared/src/approvals.js).
// A module registers a handler per type:
//   prepare(payload, auth) → { payload, value, title, summary, entity: { type, id, name }, studentId }
//   execute(request, approverAuth, req) → result      (EXECUTE types only)
// PERMIT types are used by the module itself with checkPermit() + consumePermit().

const handlers = new Map()
export function registerApprovalHandler(type, handler) {
  if (!APPROVAL_TYPE_BY[type]) throw new Error(`Unknown approval type ${type}`)
  handlers.set(type, handler)
}

const HOUR = 3_600_000
const label = (status) => APPROVAL_STATUSES[status]?.label.toLowerCase() ?? status
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

// ───────────────────────────────────────────────────────── rules

export async function ruleFor(type) {
  const stored = await ApprovalRule.findOne({ type }).lean()
  if (!stored) return defaultApprovalRule(type)
  return {
    type, enabled: stored.enabled, expiryHours: stored.expiryHours,
    steps: stored.steps?.length ? stored.steps.map((s) => ({ label: s.label, roleIds: (s.roleIds ?? []).map(String), minValue: s.minValue ?? null })) : defaultApprovalRule(type).steps,
    updatedBy: stored.updatedBy, updatedAt: stored.updatedAt,
  }
}

/** Roles that hold the approver permission, with their limit for this type. */
async function approverRoles(t, enabled) {
  const roles = await Role.find().sort({ name: 1 }).lean()
  return roles
    .map((r) => ({ role: r, access: mergeRoles([r], enabled) }))
    .filter(({ access }) => access.fullAccess || hasPermissionIn(access.permissions, t.approver))
    .map(({ role, access }) => ({ id: String(role._id), name: role.name, limit: access.fullAccess ? null : access.limits[t.limitKey] ?? null }))
}

export async function listRules(auth) {
  const enabled = auth.enabledModules
  const out = []
  for (const t of APPROVAL_TYPES.filter((x) => enabled.includes(x.module))) {
    out.push({
      ...t,
      approverText: describePermission(t.approver).text,
      limitLabel: ROLE_LIMITS.find((l) => l.key === t.limitKey)?.label,
      unit: t.measure === 'PCT' ? '%' : '₹',
      rule: await ruleFor(t.type),
      approverRoles: await approverRoles(t, enabled),
    })
  }
  return out
}

export async function saveRule(type, input, auth, req) {
  const t = APPROVAL_TYPE_BY[type]
  if (!t || !moduleEnabled(auth, t.module)) throw notFound('Approval type')
  const fields = {}
  const steps = input.steps ?? []
  if (!steps.length) fields.steps = 'Keep at least one step'
  if (steps[0] && steps[0].minValue !== null && steps[0].minValue !== undefined) fields['steps.0.minValue'] = 'The first step applies to every request'
  const able = new Map((await approverRoles(t, auth.enabledModules)).map((r) => [r.id, r]))
  const roleNames = new Map((await Role.find().select('name').lean()).map((r) => [String(r._id), r.name]))
  steps.forEach((s, i) => {
    for (const id of s.roleIds ?? []) {
      if (!roleNames.has(id)) fields[`steps.${i}.roleIds`] = 'A chosen role no longer exists'
      else if (!able.has(id)) fields[`steps.${i}.roleIds`] = `${roleNames.get(id)} can’t approve this: it needs “${describePermission(t.approver).text}”`
    }
    if (i > 0 && steps[i - 1].minValue != null && s.minValue != null && s.minValue < steps[i - 1].minValue) fields[`steps.${i}.minValue`] = 'Later steps should start at a higher value'
  })
  if (Object.keys(fields).length) throw badRequest('The approval rule is not valid.', { fields })
  const doc = {
    enabled: input.enabled, expiryHours: input.expiryHours,
    steps: steps.map((s) => ({ label: s.label?.trim() || 'Approval', roleIds: (s.roleIds ?? []).map(oid), minValue: s.minValue ?? null })),
    updatedBy: auth.user.name,
  }
  await ApprovalRule.updateOne({ type }, { $set: doc }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'core', entityType: 'approval_rule', entityId: type, entityName: t.label, summary: `Approval rule for “${t.label}”: ${input.enabled ? `${steps.length} step${steps.length === 1 ? '' : 's'}, expires after ${input.expiryHours} h` : 'switched off'}` }, req)
  return ruleFor(type)
}

// ───────────────────────────────────────────────────────── who may decide

/** Can this signed-in user decide the request's current step? */
export function canDecide(auth, r) {
  if (r.status !== 'PENDING') return false
  if (String(r.requestedById) === auth.userId) return false
  const step = r.steps?.[r.currentStep]
  if (!step) return false
  if (r.steps.some((s, i) => i < r.currentStep && String(s.decidedById) === auth.userId)) return false
  const allowed = (step.roleIds ?? []).map(String)
  if (allowed.length && !(auth.roles ?? []).some((x) => allowed.includes(String(x.id)))) return false
  const t = APPROVAL_TYPE_BY[r.type]
  return can(auth, t.approver) && (auth.fullAccess || limitCovers(auth.limits?.[t.limitKey], t.measure, r.value))
}

/** Active users who can decide the current step (for the bell and "waiting for …"). */
async function approversOf(r) {
  const t = APPROVAL_TYPE_BY[r.type]
  const step = r.steps[r.currentStep]
  if (!step) return []
  const enabled = await enabledModuleIds(getContext().tenantId)
  const roleById = new Map((await Role.find().lean()).map((x) => [String(x._id), x]))
  const allowed = (step.roleIds ?? []).map(String)
  const earlier = r.steps.slice(0, r.currentStep).map((s) => String(s.decidedById))
  const users = await User.find({ active: true, _id: { $ne: r.requestedById } }).select('name roleIds').lean()
  return users.filter((u) => {
    if (earlier.includes(String(u._id))) return false
    const roles = (u.roleIds ?? []).map((id) => roleById.get(String(id))).filter(Boolean)
    if (allowed.length && !roles.some((x) => allowed.includes(String(x._id)))) return false
    const a = mergeRoles(roles, enabled)
    if (!a.fullAccess && !hasPermissionIn(a.permissions, t.approver)) return false
    return a.fullAccess || limitCovers(a.limits[t.limitKey], t.measure, r.value)
  }).map((u) => ({ id: String(u._id), name: u.name }))
}

// ───────────────────────────────────────────────────────── requests

/** Requests past their time stop being usable. */
export const expireStale = () => ApprovalRequest.updateMany({ status: { $in: ['PENDING', 'APPROVED'] }, expiresAt: { $lt: new Date() } }, { $set: { status: 'EXPIRED' } })

function toDto(r, auth) {
  const t = APPROVAL_TYPE_BY[r.type]
  return {
    id: String(r._id), type: r.type, typeLabel: t?.label, module: r.module, mode: r.mode, title: r.title, summary: r.summary, reason: r.reason,
    measure: r.measure, value: r.value, valueText: approvalValueText(r.measure, r.value),
    entityType: r.entityType, entityId: r.entityId, entityName: r.entityName, studentId: r.studentId ? String(r.studentId) : null,
    payload: r.payload, status: r.status, requestedBy: r.requestedBy, requestedById: String(r.requestedById),
    steps: (r.steps ?? []).map((s) => ({ ...s, roleIds: (s.roleIds ?? []).map(String), decidedById: s.decidedById ? String(s.decidedById) : undefined })),
    currentStep: r.currentStep, createdAt: r.createdAt, decidedAt: r.decidedAt, expiresAt: r.expiresAt, usedAt: r.usedAt, usedRef: r.usedRef,
    result: r.result, error: r.error,
    canDecide: auth ? canDecide(auth, r) : false,
    canWithdraw: auth ? r.status === 'PENDING' && String(r.requestedById) === auth.userId : false,
  }
}

export async function createRequest({ type, payload, reason }, auth, req) {
  const t = APPROVAL_TYPE_BY[type]
  if (!t || !moduleEnabled(auth, t.module) || !handlers.has(type)) throw notFound('Approval type')
  const rule = await ruleFor(type)
  if (!rule.enabled) throw forbidden('Approvals for this are switched off at your institution. Ask someone whose role can do it.')
  await expireStale()
  const p = await handlers.get(type).prepare(payload ?? {}, auth)
  const entityId = p.entity?.id ? String(p.entity.id) : undefined
  const open = await ApprovalRequest.find({ type, entityId, status: 'PENDING' }).lean()
  const others = open.filter((o) => String(o.requestedById) !== auth.userId)
  if (others.length && t.mode === 'EXECUTE') throw conflict(`${others[0].requestedBy} already asked for this — it is waiting for approval.`)
  // asking again (say, with a different discount) replaces your earlier request
  for (const o of open.filter((x) => String(x.requestedById) === auth.userId)) {
    await ApprovalRequest.updateOne({ _id: o._id, status: 'PENDING' }, { $set: { status: 'WITHDRAWN', error: 'Replaced by a newer request' } })
  }
  const steps = stepsFor(rule, t.measure, p.value)
  const use = steps.length ? steps : rule.steps.slice(0, 1)
  const roleNames = new Map((await Role.find().select('name').lean()).map((r) => [String(r._id), r.name]))
  const r = await ApprovalRequest.create({
    type, module: t.module, mode: t.mode, title: p.title, summary: p.summary, measure: t.measure, value: p.value,
    entityType: p.entity?.type, entityId, entityName: p.entity?.name, studentId: p.studentId, payload: p.payload,
    reason: reason?.trim() || undefined, requestedById: auth.userId, requestedBy: auth.user.name,
    steps: use.map((s) => ({ label: s.label, roleIds: s.roleIds ?? [], roleNames: (s.roleIds ?? []).map((id) => roleNames.get(String(id))).filter(Boolean), status: 'PENDING' })),
    currentStep: 0, status: 'PENDING', expiresAt: new Date(Date.now() + rule.expiryHours * HOUR),
  })
  const approvers = await approversOf(r)
  await notifyUsers(approvers.map((a) => a.id), { event: 'approvals.requested', title: `Approval needed: ${r.title}`, message: `${auth.user.name}: ${r.summary}`, link: `/approvals?id=${r._id}`, tone: 'warning', entityType: 'approval', entityId: String(r._id) })
  await audit({ action: 'CREATE', module: r.module, entityType: 'approval', entityId: String(r._id), entityName: r.title, studentId: r.studentId, summary: `Asked for approval: ${r.title} — ${r.summary}${r.reason ? ` (${r.reason})` : ''}` }, req)
  return { ...toDto(r.toObject(), auth), approvers }
}

export async function getRequest(id, auth) {
  await expireStale()
  const r = await ApprovalRequest.findById(id).lean()
  if (!r) throw notFound('Approval request')
  const involved = String(r.requestedById) === auth.userId || r.steps.some((s) => String(s.decidedById) === auth.userId)
  if (!involved && !canDecide(auth, r) && !can(auth, 'core.workflows.view')) throw forbidden('This request isn’t yours to see.')
  return { ...toDto(r, auth), approvers: r.status === 'PENDING' ? await approversOf(r) : [] }
}

/**
 * box: waiting (for me to decide) · mine (I asked) · all (needs Workflows & approvals).
 * With `paging` (the request carried ?page=) → { data, meta }; without → a plain array, capped as before.
 */
export async function listRequests(box, q, auth, paging) {
  await expireStale()
  if (box === 'waiting') {
    // Who may decide is worked out per request (role, limit, step), so the waiting box is paged in memory.
    // PENDING requests expire, so this set stays small.
    const find = ApprovalRequest.find({ status: 'PENDING' }).sort({ createdAt: -1 })
    const mine = (await (paging ? find : find.limit(300)).lean()).filter((r) => canDecide(auth, r))
    if (!paging) return mine.map((r) => toDto(r, auth))
    return listResponse(mine.slice(paging.skip, paging.skip + paging.pageSize).map((r) => toDto(r, auth)), mine.length, paging)
  }
  const filter = {}
  if (box === 'mine') filter.requestedById = oid(auth.userId)
  else if (!can(auth, 'core.workflows.view')) throw forbidden('Seeing every request needs Workflows & approvals.')
  if (q.status) filter.status = q.status
  if (q.type) filter.type = q.type
  const find = ApprovalRequest.find(filter).sort({ createdAt: -1 })
  if (!paging) return (await find.limit(200).lean()).map((r) => toDto(r, auth))
  const [rows, total] = await Promise.all([find.skip(paging.skip).limit(paging.pageSize).lean(), ApprovalRequest.countDocuments(filter)])
  return listResponse(rows.map((r) => toDto(r, auth)), total, paging)
}

export async function waitingCount(auth) {
  const rows = await ApprovalRequest.find({ status: 'PENDING', expiresAt: { $gte: new Date() } }).select('type status steps currentStep requestedById value').lean()
  return rows.filter((r) => canDecide(auth, r)).length
}

export async function decide(id, decision, note, auth, req) {
  await expireStale()
  const r = await ApprovalRequest.findById(id).lean()
  if (!r) throw notFound('Approval request')
  if (r.status !== 'PENDING') throw conflict(`This request is ${label(r.status)}.`)
  if (String(r.requestedById) === auth.userId) throw forbidden('You can’t decide your own request.')
  if (!canDecide(auth, r)) throw forbidden('This request needs someone else’s approval: your role, or your limit, doesn’t cover it.')
  if (decision === 'REJECT' && !note?.trim()) throw badRequest('Say why it is rejected — the requester sees this.', { fields: { note: 'Required' } })
  const t = APPROVAL_TYPE_BY[r.type]
  const idx = r.currentStep
  const now = new Date()
  const step = compact({
    [`steps.${idx}.status`]: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    [`steps.${idx}.decidedById`]: oid(auth.userId),
    [`steps.${idx}.decidedBy`]: auth.user.name,
    [`steps.${idx}.decidedAt`]: now,
    [`steps.${idx}.note`]: note?.trim() || undefined,
  })
  const final = decision === 'REJECT' || idx >= r.steps.length - 1
  let set = step
  if (decision === 'REJECT') set = { ...step, status: 'REJECTED', decidedAt: now }
  else if (!final) set = { ...step, currentStep: idx + 1 }
  else {
    const rule = await ruleFor(r.type)
    set = { ...step, status: 'APPROVED', decidedAt: now, ...(r.mode === 'PERMIT' ? { expiresAt: new Date(now.getTime() + rule.expiryHours * HOUR) } : {}) }
  }
  let updated = await ApprovalRequest.findOneAndUpdate({ _id: r._id, status: 'PENDING', currentStep: idx }, { $set: set }, { returnDocument: 'after' }).lean()
  if (!updated) throw conflict('Someone else decided this request just now. Refresh to see it.')
  const verb = decision === 'REJECT' ? 'Rejected' : final ? 'Approved' : `Approved step ${idx + 1} of`
  await audit({ action: decision === 'REJECT' ? 'REJECT' : 'APPROVE', module: r.module, entityType: 'approval', entityId: String(r._id), entityName: r.title, studentId: r.studentId, summary: `${verb} “${r.title}” (asked by ${r.requestedBy})${note?.trim() ? `: ${note.trim()}` : ''}` }, req)

  const tell = (title, message, tone) => notifyUsers([r.requestedById], { event: 'approvals.decided', title, message, link: `/approvals?id=${r._id}`, tone, entityType: 'approval', entityId: String(r._id) })
  if (decision === 'REJECT') {
    await tell(`Rejected: ${r.title}`, `${auth.user.name}: ${note.trim()}`, 'danger')
  } else if (!final) {
    const next = await approversOf(updated)
    await notifyUsers(next.map((a) => a.id), { event: 'approvals.requested', title: `Approval needed: ${r.title}`, message: `${r.requestedBy}: ${r.summary} — approved by ${auth.user.name}, now needs ${updated.steps[updated.currentStep].label}`, link: `/approvals?id=${r._id}`, tone: 'warning', entityType: 'approval', entityId: String(r._id) })
  } else if (r.mode === 'EXECUTE') {
    try {
      const result = await handlers.get(r.type).execute(updated, auth, req)
      updated = await ApprovalRequest.findByIdAndUpdate(r._id, { $set: { status: 'USED', usedAt: new Date(), result } }, { returnDocument: 'after' }).lean()
      await tell(`Approved: ${r.title}`, `${auth.user.name} approved it${result?.summary ? ` — ${result.summary}` : ''}.`, 'success')
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Something went wrong while doing it.'
      updated = await ApprovalRequest.findByIdAndUpdate(r._id, { $set: { status: 'FAILED', error: message } }, { returnDocument: 'after' }).lean()
      await tell(`Approved, but not done: ${r.title}`, message, 'danger')
    }
  } else {
    await tell(`Approved: ${r.title}`, `${auth.user.name} approved it. ${t.type === 'billing.discount' ? 'Save the bill now — the approval is valid once.' : ''}`.trim(), 'success')
  }
  return toDto(updated, auth)
}

export async function withdraw(id, auth, req) {
  const r = await ApprovalRequest.findOneAndUpdate({ _id: id, status: 'PENDING', requestedById: oid(auth.userId) }, { $set: { status: 'WITHDRAWN', decidedAt: new Date() } }, { returnDocument: 'after' }).lean()
  if (!r) throw conflict('Only a waiting request you made can be withdrawn.')
  await audit({ action: 'UPDATE', module: r.module, entityType: 'approval', entityId: String(r._id), entityName: r.title, studentId: r.studentId, summary: `Withdrew the request “${r.title}”` }, req)
  return toDto(r, auth)
}

// ───────────────────────────────────────────────────────── permits (PERMIT types)

/** An approved permit the caller may use now. `verify(request)` throws when it doesn't fit. */
export async function checkPermit(id, type, auth, verify) {
  if (!isOid(id)) throw badRequest('Unknown approval.')
  const r = await ApprovalRequest.findOne({ _id: id, type }).lean()
  if (!r) throw notFound('Approval')
  if (String(r.requestedById) !== auth.userId) throw forbidden('This approval was given to someone else.')
  if (r.status === 'APPROVED' && r.expiresAt && r.expiresAt < new Date()) {
    await ApprovalRequest.updateOne({ _id: r._id, status: 'APPROVED' }, { $set: { status: 'EXPIRED' } })
    throw conflict('This approval has expired. Ask again.')
  }
  if (r.status !== 'APPROVED') throw conflict(r.status === 'PENDING' ? 'This request is still waiting for approval.' : `This approval is ${label(r.status)}.`)
  verify?.(r)
  return r
}

/** Mark a permit used (call inside the transaction that does the work). */
export async function consumePermit(id, ref) {
  const res = await ApprovalRequest.updateOne({ _id: id, status: 'APPROVED' }, { $set: { status: 'USED', usedAt: new Date(), usedRef: ref } })
  if (!res.modifiedCount) throw conflict('This approval was used meanwhile. Ask again.')
}

/** Who approved a permit, for the record ("approved by Meena"). */
export const approvedBy = (r) => r.steps.filter((s) => s.status === 'APPROVED').map((s) => s.decidedBy).join(', ')
