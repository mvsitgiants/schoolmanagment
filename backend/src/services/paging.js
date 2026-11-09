import { PAGE_CODE_BY, PAGE_PRIORITY_BY, formatSeconds, mergePageCodes } from '@schoolgiant/shared'
import mongoose from 'mongoose'
import { PageCall, PageCode } from '../models/comms.js'
import { Employee } from '../models/hrms.js'
import { Branch, Department, Role, User } from '../models/tenant.js'
import { can, enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { isOid, oid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { nextNumber } from '../platform/numbering.js'
import { emitToRoom, emitToUsers, isOnline, joinRoom, leaveRoom, onSocket } from '../platform/realtime.js'
import { getSettings } from '../platform/settings.js'
import { hhmmIn, timeZoneOf, ymdIn, zonedDate } from '../platform/time.js'
import { escapeRegex, listResponse, z } from '../platform/validate.js'
import { csvCell } from '../platform/csv.js'
import { notifyUsers } from './notify.js'

// Call bell & emergency alerts (module `comms`, page `calls`): one member of staff calls a
// person, a role, a department, or — emergency alerts — everyone on the campus.
//
//   create → recipients resolved now → `page:ring` to each (+ the bell) → each answers
//   "on my way" (ETA) or "busy" (reason) → the caller watches it live (`page:update`) →
//   the caller, anyone on the way, or someone with `broadcast` closes it ("All clear" for alerts).
//
// The paging job (server.js, every 30 s) rings unanswered people again (Settings › Staff chat &
// call bell: every N minutes, at most M times, then "missed"), escalates a call nobody is coming
// to one step at a time (head of department → whole department; alerts → everyone / the
// department), and closes forgotten normal / urgent calls. Alerts never close on their own.
//
// Realtime events (all `page:*`):
//   page:ring    → recipients         { call }             start ringing (again)
//   page:stop    → a recipient        { id, reason, … }    stop ringing (answered elsewhere, closed, missed, escalated)
//   page:update  → caller, recipients, rooms paging:all / paging:codes   { call }
//   page:answer  → the caller         { id, callNo, name, status, etaMinutes, reason }
//   client → server: page:respond { id, action, etaMinutes, reason } · page:watch · page:unwatch

const ACTIVE_EMP = ['ACTIVE', 'NOTICE']
const LADDER = ['DEPARTMENT_HEAD', 'DEPARTMENT']
const MIN = 60_000

const uniq = (xs) => [...new Set((xs ?? []).filter(Boolean).map(String))]
const settings = () => getSettings('comms')
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n')
const hasModule = (auth, id) => !!auth?.enabledModules?.includes(id)
const userName = (auth) => auth?.user?.name ?? getContext()?.userName ?? 'System'

// ───────────────────────────────────────────────────────── emergency codes (setup)

export async function listCodes() {
  return mergePageCodes(await PageCode.find().lean())
}

const codeMap = async () => Object.fromEntries((await listCodes()).map((c) => [c.code, c]))

export async function saveCode(code, input, req) {
  if (!PAGE_CODE_BY[code]) throw notFound('Emergency alert')
  const before = (await listCodes()).find((c) => c.code === code)
  await PageCode.updateOne({ code }, { $set: { ...input, updatedBy: getContext()?.userName } }, { upsert: true })
  const after = (await listCodes()).find((c) => c.code === code)
  await audit({ action: 'UPDATE', module: 'comms', entityType: 'page_code', entityId: code, entityName: after.label, summary: `Emergency alert ${before.label} → ${after.label} (${after.enabled ? 'in use' : 'switched off'})` }, req)
  return after
}

export async function resetCode(code, req) {
  if (!PAGE_CODE_BY[code]) throw notFound('Emergency alert')
  await PageCode.deleteOne({ code })
  await audit({ action: 'UPDATE', module: 'comms', entityType: 'page_code', entityId: code, entityName: PAGE_CODE_BY[code].label, summary: `Emergency alert ${PAGE_CODE_BY[code].label} back to the default wording` }, req)
  return (await listCodes()).find((c) => c.code === code)
}

// ───────────────────────────────────────────────────────── who a call rings

async function activeUsers(filter, { branchId } = {}) {
  const q = { active: true, ...filter }
  if (branchId) q.branchId = { $in: [oid(branchId), null] }
  return User.find(q).select('name designation mobile departmentIds branchId').sort({ name: 1 }).limit(3000).lean()
}

async function departmentMembers(departmentIds, hrmsOn) {
  const ids = departmentIds.filter(isOid).map(oid)
  if (!ids.length) return []
  const users = (await User.find({ active: true, departmentIds: { $in: ids } }).select('_id').lean()).map((u) => String(u._id))
  if (!hrmsOn) return users
  const emp = await Employee.find({ status: { $in: ACTIVE_EMP }, departmentId: { $in: ids }, userId: { $type: 'objectId' } }).select('userId').lean()
  return uniq([...users, ...emp.map((e) => e.userId)])
}

const namesOf = (rows, max = 3) => {
  const names = rows.map((r) => r.name).filter(Boolean)
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ')
}

/**
 * A target → the people it rings now: { users, label, departmentId }.
 * `branchId` limits EVERYONE to one campus (alerts go to the campus they are on).
 */
export async function resolveTarget(target, { auth, branchId, exclude = new Set() }) {
  const hrmsOn = hasModule(auth, 'hrms')
  const ids = uniq(target.ids)
  let userIds = []
  let label = ''
  let departmentId = null
  switch (target.type) {
    case 'USER': {
      const users = await activeUsers({ _id: { $in: ids.filter(isOid).map(oid) } })
      userIds = users.map((u) => String(u._id))
      label = namesOf(users)
      departmentId = users[0]?.departmentIds?.[0] ?? null
      if (!departmentId && hrmsOn && users[0]) departmentId = (await Employee.findOne({ userId: users[0]._id }).select('departmentId').lean())?.departmentId ?? null
      break
    }
    case 'ROLE': {
      const roles = await Role.find({ _id: { $in: ids.filter(isOid).map(oid) } }).select('name').lean()
      if (!roles.length) throw badRequest('Pick a role from the list.', { fields: { target: 'Unknown role' } })
      userIds = (await activeUsers({ roleIds: { $in: roles.map((r) => r._id) } })).map((u) => String(u._id))
      label = roles.map((r) => r.name).join(', ')
      break
    }
    case 'DEPARTMENT': {
      const depts = await Department.find({ _id: { $in: ids.filter(isOid).map(oid) } }).select('name').lean()
      if (!depts.length) throw badRequest('Pick a department from the list.', { fields: { target: 'Unknown department' } })
      userIds = await departmentMembers(depts.map((d) => String(d._id)), hrmsOn)
      label = depts.map((d) => d.name).join(', ')
      departmentId = depts[0]._id
      break
    }
    case 'EVERYONE': {
      userIds = (await activeUsers({}, { branchId })).map((u) => String(u._id))
      const branch = branchId && (await Branch.countDocuments({ active: true })) > 1 ? await Branch.findById(branchId).select('name').lean() : null
      label = branch ? `Everyone · ${branch.name}` : 'Everyone'
      break
    }
    default:
      throw badRequest('Say who to call.')
  }
  userIds = userIds.filter((u) => !exclude.has(u))
  const users = userIds.length ? await activeUsers({ _id: { $in: userIds.map(oid) } }) : []
  return { users, label: label || 'Nobody', departmentId }
}

// ───────────────────────────────────────────────────────── shapes

const counts = (recipients) => {
  const out = { RINGING: 0, ACKNOWLEDGED: 0, BUSY: 0, MISSED: 0 }
  for (const r of recipients ?? []) out[r.status] = (out[r.status] ?? 0) + 1
  return out
}

/** A call as the screens see it. */
export function callOut(c) {
  const o = c?.toObject ? c.toObject() : c
  const first = (o.recipients ?? []).filter((r) => r.status === 'ACKNOWLEDGED' && r.respondedAt).sort((a, b) => a.respondedAt - b.respondedAt)[0]
  return {
    id: String(o._id),
    callNo: o.callNo,
    from: { ...o.from, userId: o.from?.userId ? String(o.from.userId) : null },
    target: { type: o.target?.type, label: o.target?.label },
    priority: o.priority,
    code: o.code, codeLabel: o.codeLabel, codeColor: o.codeColor,
    location: o.location?.label ? { ...o.location, branchId: o.location.branchId ? String(o.location.branchId) : undefined } : null,
    message: o.message,
    status: o.status,
    recipients: (o.recipients ?? []).map((r) => ({
      userId: String(r.userId), name: r.name, designation: r.designation, status: r.status, etaMinutes: r.etaMinutes, reason: r.reason,
      step: r.step, rings: r.rings, respondedAt: r.respondedAt, respondSeconds: r.respondSeconds,
    })),
    counts: counts(o.recipients),
    firstResponder: first ? { name: first.name, etaMinutes: first.etaMinutes } : null,
    escalation: { step: o.escalation?.step ?? 0, history: o.escalation?.history ?? [] },
    firstAckAt: o.firstAckAt, firstAckSeconds: o.firstAckSeconds,
    closed: o.closed?.at ? o.closed : null,
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  }
}

/** What a ringing phone shows: no recipient list. */
function ringOut(c, { rering = false } = {}) {
  const o = callOut(c)
  const { recipients, ...rest } = o
  return { ...rest, rering, recipientCount: recipients.length }
}

// ───────────────────────────────────────────────────────── realtime fan-out

function broadcastUpdate(call) {
  const tenantId = String(call.tenantId)
  const out = callOut(call)
  const people = uniq([call.from?.userId, ...call.recipients.map((r) => r.userId)])
  const rooms = ['paging:all', ...(call.priority === 'CODE' ? ['paging:codes'] : []), ...people.map((user) => ({ user }))]
  emitToRoom(tenantId, rooms, 'page:update', { call: out })
}

const ring = (call, userIds, opts) => emitToUsers(String(call.tenantId), userIds, 'page:ring', { call: ringOut(call, opts) })
const stopRing = (call, userIds, reason, extra = {}) => emitToUsers(String(call.tenantId), userIds, 'page:stop', { id: String(call._id), callNo: call.callNo, reason, ...extra })

function ringTitle(call) {
  if (call.priority === 'CODE') return `${call.codeLabel}${call.location?.label ? ` — ${call.location.label}` : ''}`
  return `${PAGE_PRIORITY_BY[call.priority]?.label ?? 'Call'} call from ${call.from?.name ?? 'a colleague'}`
}

async function notifyRung(call, userIds) {
  await notifyUsers(userIds, {
    event: 'comms.page', title: ringTitle(call),
    message: [call.message, call.priority !== 'CODE' && call.location?.label].filter(Boolean).join(' · ') || undefined,
    link: '/comms/calls', tone: call.priority === 'CODE' ? 'danger' : call.priority === 'URGENT' ? 'warning' : 'info',
    entityType: 'page_call', entityId: String(call._id),
  })
}

// ───────────────────────────────────────────────────────── timing

function maxSteps(call, s) {
  if (call.priority === 'CODE') return s.codeEscalateTo === 'NONE' ? 0 : 1
  return Number(s.maxEscalations) || 0
}

const anyOnTheWay = (call) => call.recipients.some((r) => r.status === 'ACKNOWLEDGED')
const anyRinging = (call) => call.recipients.some((r) => r.status === 'RINGING')

/** When the paging job should next look at the call (null: nothing will ever be due). */
function nextCheck(call, s, now = new Date()) {
  if (call.status !== 'ACTIVE') return null
  const times = []
  for (const r of call.recipients) if (r.status === 'RINGING') times.push(new Date(r.lastRungAt ?? now).getTime() + s.reRingMinutes * MIN)
  if (!anyOnTheWay(call) && (call.escalation?.step ?? 0) < maxSteps(call, s)) {
    times.push(anyRinging(call) ? new Date(call.escalation?.stepAt ?? call.createdAt ?? now).getTime() + s.escalateMinutes * MIN : now.getTime())
  }
  if (call.priority !== 'CODE') times.push(new Date(call.createdAt ?? now).getTime() + s.autoCloseMinutes * MIN)
  return times.length ? new Date(Math.min(...times)) : null
}

// ───────────────────────────────────────────────────────── create

/** Where it is: the campus (an alert rings everyone there), a room and a free-text place. */
async function resolveLocation(loc = {}, auth) {
  const out = {}
  let branchId = null
  const multi = (await Branch.countDocuments({ active: true })) > 1
  const given = loc.branchId ?? auth.user?.branchId
  if (given) {
    const b = await Branch.findOne({ _id: given, active: true }).select('name').lean()
    if (!b && loc.branchId) throw badRequest('Pick a campus from the list.', { fields: { 'location.branchId': 'Unknown campus' } })
    if (b) { branchId = b._id; Object.assign(out, { branchId: b._id, branchName: b.name }) }
  }
  if (loc.room) out.room = loc.room
  if (loc.text) out.text = loc.text
  const place = [out.room && `Room ${out.room}`, out.text].filter(Boolean).join(' · ')
  out.label = place ? [multi && out.branchName, place].filter(Boolean).join(' · ') : ''
  return { location: out, branchId }
}

async function callerPhone(auth) {
  if (auth.user?.mobile) return auth.user.mobile
  if (!hasModule(auth, 'hrms')) return undefined
  return (await Employee.findOne({ userId: auth.userId }).select('mobile').lean())?.mobile || undefined
}

export async function createCall(input, auth, req) {
  const s = await settings()
  const isCode = input.priority === 'CODE'
  const canBroadcast = can(auth, 'comms.calls.broadcast')
  if ((isCode || input.target.type === 'EVERYONE') && !canBroadcast) {
    throw forbidden('Emergency alerts and calls to everyone need the “Send emergency alerts” permission.', { missing: ['comms.calls.broadcast'] })
  }
  let code = null
  if (isCode) {
    code = (await codeMap())[input.code]
    if (!code || !code.enabled) throw badRequest('Pick an emergency alert.', { fields: { code: 'Required' } })
  }
  const { location, branchId: locationBranch } = await resolveLocation(input.location, auth)
  if (isCode && !location.label) throw badRequest('Say where the emergency is.', { fields: { location: 'Required for an emergency alert' } })

  const branchId = locationBranch ?? null
  const exclude = new Set([String(auth.userId)])
  const resolved = await resolveTarget(input.target, { auth, branchId: isCode || input.target.type === 'EVERYONE' ? branchId : null, exclude })
  if (!resolved.users.length) throw badRequest(`Nobody to ring for “${resolved.label}” right now.`, { fields: { target: 'Nobody found' } })

  const now = new Date()
  const call = new PageCall({
    callNo: await nextNumber('PAGE_CALL', { branchId: branchId ?? undefined }),
    branchId: branchId ?? undefined,
    from: { userId: auth.userId, name: userName(auth), designation: auth.user?.designation, phone: await callerPhone(auth) },
    target: { type: input.target.type, ids: uniq(input.target.ids), label: resolved.label, departmentId: resolved.departmentId ?? undefined },
    priority: input.priority,
    code: code?.code, codeLabel: code?.label, codeColor: code?.color,
    location, message: input.message,
    recipients: resolved.users.map((u) => ({ userId: u._id, name: u.name, designation: u.designation, status: 'RINGING', step: 0, rings: 1, firstRungAt: now, lastRungAt: now })),
    escalation: { step: 0, stepAt: now, history: [] },
  })
  call.nextCheckAt = nextCheck(call, s, now)
  await call.save()

  const ids = call.recipients.map((r) => String(r.userId))
  ring(call, ids)
  broadcastUpdate(call)
  await notifyRung(call, ids)
  if (isCode) {
    await audit({ action: 'CREATE', module: 'comms', entityType: 'page_call', entityId: String(call._id), entityName: `${call.codeLabel} ${call.callNo}`, summary: `${call.codeLabel} raised at ${location.label} — ${ids.length} people rung (${resolved.label})` }, req)
  }
  return callOut(call)
}

// ───────────────────────────────────────────────────────── answer, close

/** Save with a retry when someone else (another answer, the job) changed the call meanwhile. */
async function withCall(id, fn) {
  if (!isOid(id)) throw notFound('Call')
  for (let attempt = 0; ; attempt++) {
    const call = await PageCall.findById(id)
    if (!call) throw notFound('Call')
    const after = await fn(call)
    try {
      await call.save()
      return after
    } catch (err) {
      if (!(err instanceof mongoose.Error.VersionError) || attempt >= 3) throw err
    }
  }
}

/** A recipient answers: ACK (on my way, ETA) or BUSY (reason). Only one's own ring. */
export async function respond(id, { action, etaMinutes, reason }, auth) {
  const s = await settings()
  let previous
  const call = await withCall(id, (c) => {
    const r = c.recipients.find((x) => String(x.userId) === String(auth.userId))
    if (!r) throw forbidden('This call did not ring you.')
    if (c.status !== 'ACTIVE') throw conflict(`This call is already ${c.status === 'ALL_CLEAR' ? 'all clear' : 'closed'}.`)
    const now = new Date()
    previous = r.status
    r.status = action === 'ACK' ? 'ACKNOWLEDGED' : 'BUSY'
    r.etaMinutes = action === 'ACK' ? etaMinutes : undefined
    r.reason = action === 'BUSY' ? reason : undefined
    if (previous === 'RINGING' || previous === 'MISSED') {
      r.respondedAt = now
      r.respondSeconds = Math.max(0, Math.round((now - new Date(r.firstRungAt ?? c.createdAt)) / 1000))
    }
    if (action === 'ACK' && !c.firstAckAt) {
      c.firstAckAt = now
      c.firstAckSeconds = Math.max(0, Math.round((now - c.createdAt) / 1000))
    }
    c.nextCheckAt = nextCheck(c, s, now)
    return c
  })
  const me = call.recipients.find((x) => String(x.userId) === String(auth.userId))
  stopRing(call, [auth.userId], 'answered', { status: me.status })
  broadcastUpdate(call)
  if (call.from?.userId) {
    emitToUsers(String(call.tenantId), [call.from.userId], 'page:answer', {
      id: String(call._id), callNo: call.callNo, name: me.name, status: me.status, etaMinutes: me.etaMinutes, reason: me.reason, previous,
    })
  }
  return callOut(call)
}

/** Stop a call (codes end with "All clear"); returns who was still ringing. */
function finish(call, { status, by, byId, note, now = new Date() }) {
  const stopped = []
  for (const r of call.recipients) if (r.status === 'RINGING') { r.status = 'MISSED'; stopped.push(String(r.userId)) }
  call.status = status
  call.closed = { by, byId, at: now, note }
  call.nextCheckAt = null
  return stopped
}

export async function closeCall(id, { note }, auth, req) {
  let stopped = []
  const call = await withCall(id, (c) => {
    if (c.status !== 'ACTIVE') throw conflict('This call is already closed.')
    const mine = String(c.from?.userId) === String(auth.userId)
    const onTheWay = c.recipients.some((r) => String(r.userId) === String(auth.userId) && r.status === 'ACKNOWLEDGED')
    if (!mine && !onTheWay && !can(auth, 'comms.calls.broadcast')) throw forbidden('Only the caller or someone on the way can close this call.')
    stopped = finish(c, { status: c.priority === 'CODE' ? 'ALL_CLEAR' : 'CLOSED', by: userName(auth), byId: auth.userId, note })
    return c
  })
  const isCode = call.priority === 'CODE'
  // for a code everyone it reached hears the all clear; otherwise only those still ringing stop
  const told = isCode ? call.recipients.map((r) => String(r.userId)) : stopped
  stopRing(call, told, isCode ? 'ALL_CLEAR' : 'closed', { label: isCode ? `${call.codeLabel} — all clear` : `Call ${call.callNo} closed`, by: userName(auth) })
  broadcastUpdate(call)
  if (isCode) {
    await audit({ action: 'UPDATE', module: 'comms', entityType: 'page_call', entityId: String(call._id), entityName: `${call.codeLabel} ${call.callNo}`, summary: `${call.codeLabel} at ${call.location?.label ?? '—'}: all clear${note ? ` (${note})` : ''}` }, req)
  }
  return callOut(call)
}

// ───────────────────────────────────────────────────────── escalation (paging job)

/** People a ladder step reaches, not rung yet. */
async function escalationUsers(level, call, exclude, hrmsOn) {
  const deptId = call.target?.departmentId ? String(call.target.departmentId) : null
  if (level === 'DEPARTMENT_HEAD') {
    if (!deptId) return { ids: [], label: '' }
    const d = await Department.findById(deptId).select('name headUserId').lean()
    const ids = d?.headUserId ? [String(d.headUserId)].filter((u) => !exclude.has(u)) : []
    return { ids, label: d ? `Head of ${d.name}` : '' }
  }
  if (level === 'DEPARTMENT') {
    if (!deptId) return { ids: [], label: '' }
    const d = await Department.findById(deptId).select('name').lean()
    return { ids: (await departmentMembers([deptId], hrmsOn)).filter((u) => !exclude.has(u)), label: d?.name ?? 'Department' }
  }
  if (level === 'EVERYONE') {
    return { ids: (await activeUsers({}, { branchId: call.branchId })).map((u) => String(u._id)).filter((u) => !exclude.has(u)), label: 'Everyone' }
  }
  return { ids: [], label: '' }
}

const LEVEL_LABEL = { DEPARTMENT_HEAD: 'Head of department', DEPARTMENT: 'Whole department', EVERYONE: 'Everyone' }

/** One escalation step: the next level of the ladder that finds somebody. */
async function escalate(call, s, now, hrmsOn) {
  const isCode = call.priority === 'CODE'
  const ladder = isCode ? (s.codeEscalateTo === 'NONE' ? [] : [s.codeEscalateTo]) : LADDER.slice(Math.max(0, LADDER.indexOf(s.escalateTo)))
  const used = [...(call.escalation.history ?? [])].reverse().find((h) => h.action === 'ESCALATE')?.to
  const exclude = new Set([String(call.from?.userId), ...call.recipients.map((r) => String(r.userId))])
  const step = (call.escalation.step ?? 0) + 1
  let found = null
  for (let i = used ? ladder.indexOf(used) + 1 : 0; i < ladder.length; i++) {
    const r = await escalationUsers(ladder[i], call, exclude, hrmsOn)
    if (r.ids.length) { found = { ...r, to: ladder[i] }; break }
  }
  call.escalation.step = step
  call.escalation.stepAt = now
  if (!found) {
    call.escalation.history.push({ step, at: now, action: 'NO_ONE', note: 'Nobody further to escalate to' })
    return { added: [], stopped: [] }
  }
  const users = await activeUsers({ _id: { $in: found.ids.map(oid) } })
  // routine / urgent: the ring moves on to the new people; a code keeps ringing everyone
  const stopped = []
  if (!isCode) for (const r of call.recipients) if (r.status === 'RINGING') { r.status = 'MISSED'; stopped.push(String(r.userId)) }
  for (const u of users) call.recipients.push({ userId: u._id, name: u.name, designation: u.designation, status: 'RINGING', step, rings: 1, firstRungAt: now, lastRungAt: now })
  call.escalation.history.push({ step, at: now, action: 'ESCALATE', to: found.to, label: [LEVEL_LABEL[found.to], found.label].filter(Boolean).join(' · '), added: users.length })
  return { added: users.map((u) => String(u._id)), stopped }
}

async function processCall(id, now, enabled) {
  const s = await settings()
  const out = { rerung: 0, escalated: 0, closed: 0 }
  const call = await PageCall.findById(id)
  if (!call || call.status !== 'ACTIVE') return out

  if (call.priority !== 'CODE' && now - call.createdAt >= s.autoCloseMinutes * MIN) {
    const stopped = finish(call, { status: anyOnTheWay(call) || call.firstAckAt ? 'CLOSED' : 'EXPIRED', by: 'System', note: 'Closed automatically', now })
    call.escalation.history.push({ step: call.escalation.step, at: now, action: 'AUTO_CLOSE', note: `Open for ${s.autoCloseMinutes} min` })
    await call.save()
    stopRing(call, stopped, 'closed', { label: `Call ${call.callNo} closed` })
    broadcastUpdate(call)
    out.closed++
    return out
  }

  const rerung = []
  const missed = []
  for (const r of call.recipients) {
    if (r.status !== 'RINGING' || now - new Date(r.lastRungAt) < s.reRingMinutes * MIN) continue
    if (r.rings < s.maxRings) { r.rings++; r.lastRungAt = now; rerung.push(String(r.userId)) } else { r.status = 'MISSED'; missed.push(String(r.userId)) }
  }

  let added = []
  let escalatedAway = []
  const step = call.escalation.step ?? 0
  const due = now - new Date(call.escalation.stepAt ?? call.createdAt) >= s.escalateMinutes * MIN || !anyRinging(call)
  if (!anyOnTheWay(call) && step < maxSteps(call, s) && due) {
    const r = await escalate(call, s, now, enabled.includes('hrms'))
    added = r.added
    escalatedAway = r.stopped
    out.escalated++
  }
  call.nextCheckAt = nextCheck(call, s, now)
  await call.save()

  const ringAgain = rerung.filter((u) => !escalatedAway.includes(u))
  if (ringAgain.length) { ring(call, ringAgain, { rering: true }); out.rerung += ringAgain.length }
  if (missed.length) stopRing(call, missed, 'missed', { label: `You missed call ${call.callNo}` })
  if (escalatedAway.length) stopRing(call, escalatedAway, 'escalated', { label: `Call ${call.callNo} passed on to others` })
  if (added.length) { ring(call, added); await notifyRung(call, added) }
  if (rerung.length || missed.length || added.length || out.escalated) broadcastUpdate(call)
  if (out.escalated && call.priority === 'CODE') {
    const last = call.escalation.history[call.escalation.history.length - 1]
    await audit({ action: 'UPDATE', module: 'comms', entityType: 'page_call', entityId: String(call._id), entityName: `${call.codeLabel} ${call.callNo}`, summary: `${call.codeLabel} unanswered — escalated: ${last?.label ?? last?.note ?? '—'}` })
  }
  return out
}

/** Due calls of every institution (one query), each handled in its own tenant. */
export async function runPagingJobs(at = new Date()) {
  const due = await runAsSystem(() => PageCall.find({ status: 'ACTIVE', nextCheckAt: { $ne: null, $lte: at } }).select('_id tenantId').sort({ nextCheckAt: 1 }).limit(500).setOptions({ allTenants: true }).lean())
  const total = { calls: 0, rerung: 0, escalated: 0, closed: 0 }
  const modules = new Map()
  for (const c of due) {
    const tenantId = String(c.tenantId)
    try {
      const r = await runAsTenant(tenantId, async () => {
        if (!modules.has(tenantId)) modules.set(tenantId, await enabledModuleIds(tenantId))
        return processCall(c._id, at, modules.get(tenantId))
      }, { userName: 'System', system: false })
      total.calls++
      total.rerung += r.rerung
      total.escalated += r.escalated
      total.closed += r.closed
    } catch (err) {
      if (err instanceof mongoose.Error.VersionError) continue // answered meanwhile; looked at again next run
      logger.error({ err, tenantId, callId: String(c._id) }, 'paging job failed for a call')
    }
  }
  return total
}

// ───────────────────────────────────────────────────────── lists, log, metrics

/** Calls the caller may see: their own (sent or rung), every alert, or all with `broadcast`. */
function visibleFilter(auth) {
  if (can(auth, 'comms.calls.broadcast')) return {}
  const me = oid(auth.userId)
  return { $or: [{ 'from.userId': me }, { 'recipients.userId': me }, { priority: 'CODE' }] }
}

export async function activeCalls(auth) {
  const rows = await PageCall.find({ status: 'ACTIVE', ...visibleFilter(auth) }).sort({ createdAt: -1 }).limit(200).lean()
  return rows.map(callOut)
}

/** Calls ringing me now — the incoming screen restores them after a reload. */
export async function incomingCalls(auth) {
  const rows = await PageCall.find({ status: 'ACTIVE', recipients: { $elemMatch: { userId: oid(auth.userId), status: 'RINGING' } } }).sort({ createdAt: -1 }).limit(20).lean()
  return rows.map((c) => ringOut(c))
}

export async function getCall(id, auth) {
  if (!isOid(id)) throw notFound('Call')
  const c = await PageCall.findOne({ _id: id, ...visibleFilter(auth) }).lean()
  if (!c) throw notFound('Call')
  return callOut(c)
}

async function logFilter(q, auth) {
  const timeZone = await timeZoneOf()
  const and = [visibleFilter(auth)]
  if (q.mine) {
    const me = oid(auth.userId)
    and.push({ $or: [{ 'from.userId': me }, { 'recipients.userId': me }] })
  }
  if (q.from || q.to) {
    const at = {}
    if (q.from) at.$gte = zonedDate(q.from, '00:00', timeZone)
    if (q.to) at.$lt = new Date(zonedDate(q.to, '00:00', timeZone).getTime() + 24 * 60 * MIN)
    and.push({ createdAt: at })
  }
  if (q.priority) and.push({ priority: q.priority })
  if (q.code) and.push({ code: q.code })
  if (q.status) and.push({ status: q.status })
  if (q.targetType) and.push({ 'target.type': q.targetType })
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i')
    and.push({ $or: [{ callNo: re }, { 'from.name': re }, { 'target.label': re }, { message: re }, { 'location.label': re }, { codeLabel: re }, { 'recipients.name': re }] })
  }
  const parts = and.filter((x) => Object.keys(x).length)
  return { filter: parts.length ? { $and: parts } : {}, timeZone }
}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

function metricsOf(rows) {
  const group = (key) => {
    const g = new Map()
    for (const r of rows) {
      const k = key(r)
      if (!k) continue
      if (!g.has(k.id)) g.set(k.id, { ...k, calls: 0, answered: 0, times: [] })
      const x = g.get(k.id)
      x.calls++
      if (r.firstAckSeconds !== undefined && r.firstAckSeconds !== null) { x.answered++; x.times.push(r.firstAckSeconds) }
    }
    return [...g.values()].map(({ times, ...x }) => ({ ...x, avgFirstAckSeconds: avg(times), medianFirstAckSeconds: median(times) })).sort((a, b) => b.calls - a.calls)
  }
  const answeredIn = (list) => list.map((r) => r.firstAckSeconds).filter((t) => t !== undefined && t !== null)
  const times = answeredIn(rows)
  const codeTimes = answeredIn(rows.filter((r) => r.priority === 'CODE'))
  return {
    calls: rows.length,
    answered: times.length,
    unanswered: rows.length - times.length,
    codes: rows.filter((r) => r.priority === 'CODE').length,
    avgFirstAckSeconds: avg(times),
    medianFirstAckSeconds: median(times),
    codeAvgFirstAckSeconds: avg(codeTimes),
    codeMedianFirstAckSeconds: median(codeTimes),
    byCode: group((r) => (r.priority === 'CODE' ? { id: r.code, code: r.code, label: r.codeLabel, color: r.codeColor } : null)),
    byPriority: group((r) => ({ id: r.priority, priority: r.priority, label: PAGE_PRIORITY_BY[r.priority]?.label ?? r.priority })),
  }
}

/**
 * The call log with response-time metrics over the same filter. With `paging` (a paged screen) the rows
 * are one page of the whole filtered log, with `meta` for the pager; without it, the latest 500.
 */
export async function callLog(q, auth, paging) {
  const { filter } = await logFilter(q, auth)
  const [rows, all, total] = await Promise.all([
    PageCall.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging?.skip ?? 0).limit(paging?.pageSize ?? 500).lean(),
    PageCall.find(filter).select('priority code codeLabel codeColor firstAckSeconds').limit(20_000).lean(),
    paging ? PageCall.countDocuments(filter) : null,
  ])
  const out = { rows: rows.map(callOut).map(({ recipients, ...r }) => r), metrics: metricsOf(all) }
  if (!paging) return { ...out, truncated: rows.length === 500 }
  return { ...out, truncated: false, meta: listResponse([], total, paging).meta }
}

export async function callLogCsv(q, auth) {
  const { filter, timeZone } = await logFilter(q, auth)
  const rows = await PageCall.find(filter).sort({ createdAt: -1 }).limit(20_000).lean()
  const when = (d) => (d ? `${ymdIn(d, timeZone)} ${hhmmIn(d, timeZone)}` : '')
  const out = [['Call no.', 'Date & time', 'Priority', 'Code', 'From', 'To', 'Location', 'Message', 'People rung', 'On the way', 'Busy', 'Missed', 'First answer (s)', 'First answer', 'First responder', 'Escalation steps', 'Status', 'Closed by', 'Closed at']]
  for (const r of rows.map(callOut)) {
    out.push([
      r.callNo, when(r.createdAt), PAGE_PRIORITY_BY[r.priority]?.label ?? r.priority, r.codeLabel ?? '', r.from?.name ?? '', r.target?.label ?? '', r.location?.label ?? '', r.message ?? '',
      r.recipients.length, r.counts.ACKNOWLEDGED, r.counts.BUSY, r.counts.MISSED, r.firstAckSeconds ?? '', formatSeconds(r.firstAckSeconds), r.firstResponder?.name ?? '',
      r.escalation.step, r.status, r.closed?.by ?? '', when(r.closed?.at),
    ])
  }
  return csv(out)
}

// ───────────────────────────────────────────────────────── compose helpers

/** Everything the compose screen offers: roles, departments, campuses, alerts, recent targets. */
export async function pagingMeta(auth) {
  const hrmsOn = hasModule(auth, 'hrms')
  const [roles, departments, branches, codes, recent] = await Promise.all([
    Role.find().select('name').sort({ name: 1 }).lean(),
    Department.find({ active: true }).select('name').sort({ name: 1 }).lean(),
    Branch.find({ active: true }).select('name isDefault').sort({ isDefault: -1, name: 1 }).lean(),
    listCodes(),
    PageCall.find({ 'from.userId': oid(auth.userId) }).select('target priority').sort({ createdAt: -1 }).limit(40).lean(),
  ])
  const seen = new Set()
  const recentTargets = []
  for (const c of recent) {
    if (c.target?.type === 'EVERYONE' && !can(auth, 'comms.calls.broadcast')) continue
    const key = `${c.target?.type}|${(c.target?.ids ?? []).join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    recentTargets.push({ type: c.target.type, ids: c.target.ids ?? [], label: c.target.label })
    if (recentTargets.length >= 6) break
  }
  return {
    hrmsOn,
    canBroadcast: can(auth, 'comms.calls.broadcast'),
    canExport: can(auth, 'comms.calls.export'),
    roles: roles.map((r) => ({ id: String(r._id), name: r.name })),
    departments: departments.map((d) => ({ id: String(d._id), name: d.name })),
    branches: branches.map((b) => ({ id: String(b._id), name: b.name, isDefault: !!b.isDefault })),
    myBranchId: auth.user?.branchId ? String(auth.user.branchId) : null,
    codes,
    recentTargets,
  }
}

/** Find a colleague to call (online first). With no search: who is online now — or, with `all`, everyone (online first). */
export async function directory(search, auth, { all = false } = {}) {
  const q = { active: true, _id: { $ne: oid(auth.userId) } }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i')
    q.$or = [{ name: re }, { designation: re }, { email: re }]
  }
  const rows = await User.find(q).select('name designation departmentIds').sort({ name: 1 }).limit(search ? 25 : 200).lean()
  const deptIds = uniq(rows.flatMap((r) => r.departmentIds ?? []))
  const depts = deptIds.length ? new Map((await Department.find({ _id: { $in: deptIds.map(oid) } }).select('name').lean()).map((d) => [String(d._id), d.name])) : new Map()
  const tenantId = getContext()?.tenantId
  const out = rows.map((u) => ({
    id: String(u._id), name: u.name, designation: u.designation,
    departments: (u.departmentIds ?? []).map((d) => depts.get(String(d))).filter(Boolean),
    online: isOnline(tenantId, u._id),
  }))
  // with no search: who is online now (or everyone, for the quick-call list)
  return (search || all ? out : out.filter((u) => u.online)).sort((a, b) => Number(b.online) - Number(a.online)).slice(0, all && !search ? 80 : 25)
}

// ───────────────────────────────────────────────────────── socket handlers

export const respondSchema = z.object({
  action: z.enum(['ACK', 'BUSY']),
  etaMinutes: z.coerce.number().int().min(0).max(240).optional(),
  reason: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
})

let registered = false
/** Client → server events for calls (platform/realtime.js onSocket). */
export function registerPagingSockets() {
  if (registered) return
  registered = true
  // answering needs no permission of its own: the server checks the call rang this user
  onSocket('page:respond', async (payload, ctx) => {
    const { id, ...body } = z.object({ id: z.string() }).passthrough().parse(payload)
    return respond(id, respondSchema.parse(body), ctx.auth)
  })
  // the Call bell screen: live updates for alerts (and every call, for those with `broadcast`)
  onSocket('page:watch', async (_payload, ctx) => {
    joinRoom(ctx.socket, 'paging:codes')
    if (can(ctx.auth, 'comms.calls.broadcast')) joinRoom(ctx.socket, 'paging:all')
    return { watching: true }
  }, { permission: 'comms.calls.view' })
  onSocket('page:unwatch', async (_payload, ctx) => {
    leaveRoom(ctx.socket, 'paging:codes')
    leaveRoom(ctx.socket, 'paging:all')
    return { watching: false }
  })
}
