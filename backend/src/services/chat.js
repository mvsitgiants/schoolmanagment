import {
  CHAT_ATTACHMENTS_MAX, CHAT_AUTO_TYPES, CHAT_CHANNEL_TYPE_BY, CHAT_EDIT_HOURS, CHAT_GROUP_MAX_MEMBERS,
  CHAT_MESSAGE_MAX, CHAT_NOTIFY_LEVELS, CHAT_REACTIONS, CHAT_RECEIPTS_MAX_MEMBERS, chatPreview,
} from '@schoolgiant/shared'
import { StaffChatChannel as ChatChannel, StaffChatMember as ChatMember, StaffChatMessage as ChatMessage } from '../models/comms.js'
import { Attachment } from '../models/engines.js'
import { Employee } from '../models/hrms.js'
import { Student, studentName } from '../models/students.js'
import { Branch, Department, User } from '../models/tenant.js'
import { can, enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { isOid, oid } from '../platform/db.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { on } from '../platform/events.js'
import { logger } from '../platform/logger.js'
import {
  emitToRoom, emitToUser, emitToUsers, isOnline, joinRoom, joinUserRooms, leaveUserRooms, onConnect, onSocket, onlineUserIds, userSockets,
} from '../platform/realtime.js'
import { getSettings, saveSettings } from '../platform/settings.js'
import { escapeRegex, z } from '../platform/validate.js'
import { uploadFile } from './files.js'
import { notifyUsers } from './notify.js'

// Staff chat (module `comms`, page `chat`). Ported from the hospital product.
//
// Channels:
//   INSTITUTION "Whole staff" (key INSTITUTION:ALL) — every active staff member; plus, only when
//               the institution has several campuses, "<campus> staff" — people assigned to that campus.
//               "Announcements only" (Settings › Staff chat & call bell): only `comms.chat.moderate` posts.
//   DEPARTMENT  everyone in a department — the user's departments, and their Staff & HR record.
//   GROUP       made by a member of staff: owner / admins add and remove people.
//   DIRECT      two people, unique per pair, created with the first message.
// Automatic memberships are re-worked when a user's departments / campus / status change
// (event `chat.membership_changed`), when someone opens chat (at most every few minutes, the
// fallback) and by the hourly chat job.
//
// Every read and write checks the caller is an active member of the channel (server-side; a
// client never says who it is or what it belongs to). Students appear only as a chip
// (name + admission no.): opening one goes through the reader's own access to student records.
//
// Realtime (rooms `chat:<channelId>`, joined on connect and when someone is added):
//   server → client  chat:message { channelId, message } · chat:updated { channelId, message }
//                    chat:read { channelId, userId, name, lastReadAt, lastReadMessageId }
//                    chat:typing { channelId, userId, name } · chat:channel { action, channelId, … }
//   client → server  chat:send · chat:edit · chat:delete · chat:react · chat:pin · chat:read
//                    chat:typing · chat:focus { channelId | null } (the chat open on screen, for
//                    "don't ring the bell for a chat I am looking at")

const VIEW = 'comms.chat.view'
const CREATE = 'comms.chat.create'
const MANAGE = 'comms.chat.moderate'
const ACTIVE_EMP = ['ACTIVE', 'NOTICE']
const AUTO = new Set(CHAT_AUTO_TYPES)
const NOTIFY = new Set(CHAT_NOTIFY_LEVELS.map((n) => n.value))
const MIN = 60_000

const uniq = (xs) => [...new Set((xs ?? []).filter(Boolean).map(String))]
const room = (channelId) => `chat:${channelId}`
const tenantNow = () => getContext()?.tenantId
const hasModule = (modules, id) => !!modules?.includes(id)

// ───────────────────────────────────────────────────────── limits (one API instance)

const SEND_WINDOW_MS = 10_000
const SEND_MAX = 30
const sendLog = new Map() // tenant:user → [timestamps]
function assertSendRate(auth) {
  const key = `${auth.tenantId}:${auth.userId}`
  const now = Date.now()
  const recent = (sendLog.get(key) ?? []).filter((t) => now - t < SEND_WINDOW_MS)
  if (recent.length >= SEND_MAX) throw new AppError(429, 'You are sending messages too fast. Wait a few seconds.', { code: 'RATE_LIMITED' })
  recent.push(now)
  sendLog.set(key, recent)
  if (sendLog.size > 20_000) sendLog.clear()
}

const typingAt = new Map() // user:channel → ms
const syncedAt = new Map() // tenant:user → ms (the on-read membership fallback)
const SYNC_EVERY_MS = 5 * MIN

/** Chat is for signed-in institution staff — never an API key, the platform owner or a family / student. */
export function assertStaff(auth) {
  if (!auth?.tenantId || !auth.userId || auth.apiKey || auth.superadmin || auth.family || auth.portal) throw forbidden('Chat is for staff.')
}

// ───────────────────────────────────────────────────────── automatic channels

/** What the tenant has switched on, and the people / places memberships come from. */
async function directoryOf(modules) {
  const hrmsOn = hasModule(modules, 'hrms')
  const [branches, departments, users, employees] = await Promise.all([
    Branch.find({ active: true }).select('name isDefault').sort({ isDefault: -1, name: 1 }).lean(),
    Department.find({ active: true }).select('name').lean(),
    User.find({ active: true }).select('branchId departmentIds').limit(20_000).lean(),
    hrmsOn ? Employee.find({ status: { $in: ACTIVE_EMP }, userId: { $type: 'objectId' } }).select('userId departmentId branchId').limit(20_000).lean() : [],
  ])
  return { branches, departments, users, employees }
}

/** The automatic channel keys one person belongs to. */
function keysFor(user, employee, dir) {
  const keys = new Set()
  // everyone is in the one whole-staff chat; a campus chat exists only when there are several
  // campuses, and only people actually assigned to that campus are in it
  keys.add(EVERYONE_KEY)
  const branchId = user.branchId ?? employee?.branchId
  if (dir.branches.length > 1 && branchId && dir.branches.some((b) => String(b._id) === String(branchId))) keys.add(`INSTITUTION:${branchId}`)
  const depts = new Set(dir.departments.map((d) => String(d._id)))
  for (const d of uniq([...(user.departmentIds ?? []), employee?.departmentId])) if (depts.has(d)) keys.add(`DEPARTMENT:${d}`)
  return keys
}

const EVERYONE_KEY = 'INSTITUTION:ALL'
const EVERYONE_NAME = 'Whole staff'

/** Name / branch of the channel an automatic key stands for (null: its source is gone). */
function sourceOf(key, dir) {
  const [type, id] = key.split(':')
  if (type === 'INSTITUTION') {
    if (id === 'ALL') return { type, sourceId: null, branchId: null, name: EVERYONE_NAME }
    if (dir.branches.length <= 1) return null // one campus: the whole-staff chat is enough
    const b = dir.branches.find((x) => String(x._id) === id)
    return b && { type, sourceId: b._id, branchId: b._id, name: `${b.name} staff` }
  }
  if (type === 'DEPARTMENT') {
    const d = dir.departments.find((x) => String(x._id) === id)
    return d && { type, sourceId: d._id, name: d.name }
  }
  return null
}

async function ensureChannel(key, src) {
  const existing = await ChatChannel.findOne({ key })
  if (existing) {
    if (existing.name !== src.name || existing.archived) {
      existing.name = src.name
      existing.archived = false
      await existing.save()
    }
    return { channel: existing, created: false }
  }
  try {
    const channel = await ChatChannel.create({ key, type: src.type, sourceId: src.sourceId, branchId: src.branchId, name: src.name })
    return { channel, created: true }
  } catch (err) {
    if (err?.code !== 11000) throw err
    return { channel: await ChatChannel.findOne({ key }), created: false } // made at the same moment elsewhere
  }
}

/** Add / take people out of one channel. Returns { added, removed } user ids. */
async function setMembers(channel, desired, { auto = true, quiet = false } = {}) {
  const tenantId = tenantNow()
  const rows = await ChatMember.find({ channelId: channel._id }).select('userId active').lean()
  const byUser = new Map(rows.map((r) => [String(r.userId), r]))
  const want = new Set(desired)
  const now = new Date()
  const back = []
  const fresh = []
  for (const u of want) {
    const r = byUser.get(u)
    if (!r) fresh.push(u)
    else if (!r.active) back.push(u)
  }
  const removed = rows.filter((r) => r.active && !want.has(String(r.userId))).map((r) => String(r.userId))
  if (back.length) await ChatMember.updateMany({ channelId: channel._id, userId: { $in: back.map(oid) } }, { $set: { active: true, auto, joinedAt: now, leftAt: null, lastReadAt: now } })
  if (fresh.length) {
    try {
      await ChatMember.insertMany(fresh.map((u) => ({ tenantId, channelId: channel._id, userId: u, auto, active: true, joinedAt: now, lastReadAt: now })), { ordered: false })
    } catch (err) {
      if (err?.code !== 11000 && !err?.writeErrors?.every?.((e) => e.code === 11000)) throw err
    }
  }
  if (removed.length) await ChatMember.updateMany({ channelId: channel._id, userId: { $in: removed.map(oid) } }, { $set: { active: false, leftAt: now } })
  const added = [...back, ...fresh]
  if (added.length || removed.length) {
    await ChatChannel.updateOne({ _id: channel._id }, { $set: { memberCount: await ChatMember.countDocuments({ channelId: channel._id, active: true }) } })
    const r = room(channel._id)
    if (added.length) {
      for (const u of added) joinUserRooms(tenantId, u, r)
      emitToUsers(tenantId, added, 'chat:channel', { action: 'joined', channelId: String(channel._id) })
    }
    if (removed.length) {
      for (const u of removed) leaveUserRooms(tenantId, u, r)
      emitToUsers(tenantId, removed, 'chat:channel', { action: 'left', channelId: String(channel._id) })
    }
    // a few people moving in or out of a department is worth a line in it; a whole
    // new channel filling up, or a whole-staff one, is not
    if (!quiet && channel.type !== 'INSTITUTION' && added.length + removed.length <= 5) {
      const names = new Map((await User.find({ _id: { $in: [...added, ...removed].map(oid) } }).select('name').lean()).map((u) => [String(u._id), u.name]))
      if (added.length) await systemMessage(channel, 'JOINED', { names: added.map((u) => names.get(u)).filter(Boolean) })
      if (removed.length) await systemMessage(channel, 'LEFT', { names: removed.map((u) => names.get(u)).filter(Boolean) })
    }
  }
  return { added, removed }
}

/**
 * Re-work every automatic channel of the current tenant: create the ones that now have
 * people, refresh names, archive those whose campus / department went away, and put
 * each person in exactly the channels they belong to.
 */
export async function syncAutoChannels(modules) {
  const mods = modules ?? await enabledModuleIds(tenantNow())
  const dir = await directoryOf(mods)
  const empByUser = new Map(dir.employees.map((e) => [String(e.userId), e]))
  const members = new Map() // key → [userIds]
  for (const u of dir.users) {
    for (const k of keysFor(u, empByUser.get(String(u._id)), dir)) {
      if (!members.has(k)) members.set(k, [])
      members.get(k).push(String(u._id))
    }
  }
  const out = { channels: 0, added: 0, removed: 0, archived: 0 }
  for (const [key, userIds] of members) {
    const src = sourceOf(key, dir)
    if (!src) continue
    const { channel, created } = await ensureChannel(key, src)
    const r = await setMembers(channel, userIds, { quiet: created })
    out.channels++
    out.added += r.added.length
    out.removed += r.removed.length
  }
  // automatic channels nobody belongs to any more (department closed, campus gone)
  const stale = await ChatChannel.find({ type: { $in: CHAT_AUTO_TYPES }, key: { $nin: [...members.keys()] }, archived: false })
  for (const ch of stale) {
    await setMembers(ch, [], { quiet: true })
    if (!sourceOf(ch.key, dir)) {
      ch.archived = true
      await ch.save()
      out.archived++
    }
  }
  return out
}

/** Put one person in exactly their automatic channels (after a department / campus / status change). */
export async function syncUserChannels(userId, { force = false, modules } = {}) {
  if (!isOid(userId)) return
  const tenantId = tenantNow()
  const k = `${tenantId}:${userId}`
  if (!force && Date.now() - (syncedAt.get(k) ?? 0) < SYNC_EVERY_MS) return
  syncedAt.set(k, Date.now())
  if (syncedAt.size > 50_000) syncedAt.clear()
  const mods = modules ?? await enabledModuleIds(tenantId)
  const hrmsOn = hasModule(mods, 'hrms')
  const [user, employee, branches, departments] = await Promise.all([
    User.findById(userId).select('active branchId departmentIds').lean(),
    hrmsOn ? Employee.findOne({ userId, status: { $in: ACTIVE_EMP } }).select('departmentId branchId').lean() : null,
    Branch.find({ active: true }).select('name isDefault').lean(),
    Department.find({ active: true }).select('name').lean(),
  ])
  const dir = { branches, departments }
  const keys = user?.active ? keysFor(user, employee, dir) : new Set()
  const channels = await ChatChannel.find({ type: { $in: CHAT_AUTO_TYPES }, archived: false }).select('key type name').lean()
  const byKey = new Map(channels.map((c) => [c.key, c]))
  // a channel that does not exist yet means its whole membership is new: do the full pass once
  if ([...keys].some((key) => !byKey.has(key))) {
    await syncAutoChannels(mods)
    return
  }
  const mine = new Set((await ChatMember.find({ userId, active: true, channelId: { $in: channels.map((c) => c._id) } }).select('channelId').lean()).map((m) => String(m.channelId)))
  for (const ch of channels) {
    const should = keys.has(ch.key)
    const is = mine.has(String(ch._id))
    if (should === is) continue
    const current = (await ChatMember.find({ channelId: ch._id, active: true }).select('userId').lean()).map((m) => String(m.userId))
    await setMembers(ch, should ? [...current, String(userId)] : current.filter((u) => u !== String(userId)))
  }
}

// ───────────────────────────────────────────────────────── access

/** The channel and the caller's membership, or 404 (never says a chat exists to an outsider). */
async function membership(channelId, auth) {
  assertStaff(auth)
  if (!isOid(channelId)) throw notFound('Chat')
  const channel = await ChatChannel.findById(channelId).lean()
  if (!channel) throw notFound('Chat')
  let member = await ChatMember.findOne({ channelId, userId: auth.userId, active: true }).lean()
  if (!member && AUTO.has(channel.type)) {
    await syncUserChannels(auth.userId, { modules: auth.enabledModules }) // fallback: their department may have just changed
    member = await ChatMember.findOne({ channelId, userId: auth.userId, active: true }).lean()
  }
  if (!member) throw notFound('Chat')
  return { channel, member }
}

const isGroupAdmin = (channel, member) => channel.type === 'GROUP' && ['OWNER', 'ADMIN'].includes(member?.role)
/** May look after this channel: rename, add / remove people, remove others' messages, @channel. */
const canModerate = (channel, member, auth) => channel.type !== 'DIRECT' && (isGroupAdmin(channel, member) || can(auth, MANAGE))

async function chatSettings() {
  const s = await getSettings('comms')
  return { announcementsOnly: !!s.chatAnnouncementsOnly, retentionDays: Number(s.chatRetentionDays) || 0 }
}

function canPostIn(channel, auth, settings) {
  if (!can(auth, CREATE) || channel.archived) return false
  if (channel.type === 'INSTITUTION' && settings.announcementsOnly && !can(auth, MANAGE)) return false
  return true
}

async function assertCanPost(channel, auth) {
  const settings = await chatSettings()
  if (channel.archived) throw conflict('This chat is closed — its department or campus is no longer in use.')
  if (!can(auth, CREATE)) throw forbidden('Your role can read chats but not write in them.', { missing: [CREATE] })
  if (!canPostIn(channel, auth, settings)) throw forbidden('The whole-staff chat is for announcements only.')
  if (channel.type === 'DIRECT') {
    const peer = channel.directUserIds.map(String).find((u) => u !== String(auth.userId))
    if (peer && !(await User.exists({ _id: peer, active: true }))) throw conflict('This person no longer has an active account.')
  }
}

// ───────────────────────────────────────────────────────── shapes

const isImage = (type) => /^image\//.test(type ?? '')
const cursorOf = (m) => `${new Date(m.createdAt).toISOString()}_${m._id}`

/** A message as every screen sees it. A removed one keeps only who and when. */
export function messageOut(m) {
  const deleted = !!m.deleted?.at
  return {
    id: String(m._id),
    channelId: String(m.channelId),
    kind: m.kind,
    senderId: m.senderId ? String(m.senderId) : null,
    senderName: m.senderName,
    clientId: m.clientId,
    createdAt: m.createdAt,
    cursor: cursorOf(m),
    editedAt: deleted ? undefined : m.editedAt,
    deleted,
    moderated: deleted ? !!m.deleted.moderated : undefined,
    text: deleted ? '' : m.text ?? '',
    mentions: deleted ? [] : (m.mentions ?? []).map(String),
    mentionNames: deleted ? [] : m.mentionNames ?? [],
    mentionChannel: !deleted && !!m.mentionChannel,
    attachments: deleted ? [] : (m.attachments ?? []).map((a) => ({ id: String(a.fileId), fileName: a.fileName, contentType: a.contentType, size: a.size, image: isImage(a.contentType) })),
    replyTo: !deleted && m.replyTo?.id ? { id: String(m.replyTo.id), senderName: m.replyTo.senderName, preview: m.replyTo.preview } : null,
    student: !deleted && m.student?.id ? { id: String(m.student.id), display: m.student.display } : null,
    system: m.kind === 'SYSTEM' ? m.system : undefined,
    pinned: !deleted && m.pinned?.at ? { at: m.pinned.at, by: m.pinned.by } : null,
    reactions: deleted ? [] : (m.reactions ?? []).filter((r) => r.userIds?.length).map((r) => ({ emoji: r.emoji, userIds: r.userIds.map(String), count: r.userIds.length })),
  }
}

const lastOut = (c) => (c.lastMessage?.id ? {
  id: String(c.lastMessage.id), at: c.lastMessage.at, senderId: c.lastMessage.senderId ? String(c.lastMessage.senderId) : null,
  senderName: c.lastMessage.senderName, preview: c.lastMessage.preview,
} : null)

function channelOut(c, member, auth, { settings, peer, unread = 0, unreadMentions = 0 } = {}) {
  return {
    id: String(c._id),
    type: c.type,
    typeLabel: CHAT_CHANNEL_TYPE_BY[c.type]?.label ?? c.type,
    name: c.type === 'DIRECT' ? (peer?.name ?? 'Former colleague') : c.name,
    description: c.description,
    archived: !!c.archived,
    memberCount: c.memberCount ?? 0,
    peer: c.type === 'DIRECT' && peer ? { id: String(peer._id), name: peer.name, designation: peer.designation, active: peer.active !== false } : null,
    lastMessage: lastOut(c),
    lastMessageAt: c.lastMessageAt ?? c.createdAt,
    createdBy: c.createdBy?.name,
    me: member ? {
      role: member.role, muted: !!member.muted, pinned: !!member.pinned, notify: member.notify ?? 'ALL',
      lastReadAt: member.lastReadAt, lastReadMessageId: member.lastReadMessageId ? String(member.lastReadMessageId) : null,
    } : null,
    unread,
    unreadMentions,
    canPost: settings ? canPostIn(c, auth, settings) : undefined,
    canModerate: member ? canModerate(c, member, auth) : false,
    receipts: (c.memberCount ?? 0) <= CHAT_RECEIPTS_MAX_MEMBERS,
  }
}

async function peersOf(channels, auth) {
  const ids = uniq(channels.filter((c) => c.type === 'DIRECT').flatMap((c) => c.directUserIds.map(String).filter((u) => u !== String(auth.userId))))
  if (!ids.length) return new Map()
  const users = await User.find({ _id: { $in: ids.map(oid) } }).select('name designation active').lean()
  return new Map(users.map((u) => [String(u._id), u]))
}
const peerOf = (c, peers, auth) => (c.type === 'DIRECT' ? peers.get(c.directUserIds.map(String).find((u) => u !== String(auth.userId))) : null)

/** Unread (others' messages after my read pointer) and unread @mentions, capped at 99+. */
async function unreadOf(channel, member, me) {
  const since = member.lastReadAt ?? member.joinedAt ?? member.createdAt
  if (!channel.lastMessageAt || (since && channel.lastMessageAt <= since)) return { unread: 0, unreadMentions: 0 }
  const filter = { channelId: channel._id, kind: 'TEXT', senderId: { $ne: oid(me) }, 'deleted.at': null, ...(since && { createdAt: { $gt: since } }) }
  const unread = await ChatMessage.countDocuments(filter).limit(100)
  const unreadMentions = unread ? await ChatMessage.countDocuments({ ...filter, $or: [{ mentions: oid(me) }, { mentionChannel: true }] }).limit(100) : 0
  return { unread, unreadMentions }
}

async function systemMessage(channel, action, { actorName, names = [] } = {}) {
  const m = await ChatMessage.create({ channelId: channel._id, kind: 'SYSTEM', system: { action, actorName, names: names.slice(0, 20) } })
  emitToRoom(tenantNow(), room(channel._id), 'chat:message', { channelId: String(channel._id), message: messageOut(m.toObject()) })
  return m
}

// ───────────────────────────────────────────────────────── channels

/** Make sure the caller is in their automatic channels (cheap: at most every few minutes). */
async function ensureMine(auth) {
  try {
    await syncUserChannels(auth.userId, { modules: auth.enabledModules })
  } catch (err) {
    logger.warn({ err }, 'chat membership sync failed')
  }
}

/** My chats with unread counts and the last message, pinned first then newest. */
export async function listChannels(auth) {
  assertStaff(auth)
  await ensureMine(auth)
  const members = await ChatMember.find({ userId: auth.userId, active: true }).lean()
  const byChannel = new Map(members.map((m) => [String(m.channelId), m]))
  const [channels, settings] = await Promise.all([
    ChatChannel.find({ _id: { $in: members.map((m) => m.channelId) } }).lean(),
    chatSettings(),
  ])
  const peers = await peersOf(channels, auth)
  const out = await Promise.all(channels.map(async (c) => {
    const member = byChannel.get(String(c._id))
    const counts = await unreadOf(c, member, auth.userId)
    return channelOut(c, member, auth, { settings, peer: peerOf(c, peers, auth), ...counts })
  }))
  out.sort((a, b) => Number(b.me?.pinned) - Number(a.me?.pinned) || new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
  return {
    channels: out,
    settings,
    canManage: can(auth, MANAGE),
    canCreate: can(auth, CREATE),
    canAttachStudent: canAttachStudent(auth),
  }
}

/** One chat: details, who is online, pinned messages and (small chats) everyone's read pointer. */
export async function getChannel(channelId, auth) {
  const { channel, member } = await membership(channelId, auth)
  const [settings, peers, memberRows, pinned] = await Promise.all([
    chatSettings(),
    peersOf([channel], auth),
    ChatMember.find({ channelId: channel._id, active: true }).select('userId lastReadAt lastReadMessageId').limit(5000).lean(),
    ChatMessage.find({ channelId: channel._id, 'pinned.at': { $type: 'date' }, 'deleted.at': null }).sort({ 'pinned.at': -1 }).limit(50).lean(),
  ])
  const online = new Set(onlineUserIds(auth.tenantId))
  const counts = await unreadOf(channel, member, auth.userId)
  let readStates = []
  if (memberRows.length <= CHAT_RECEIPTS_MAX_MEMBERS) {
    const names = new Map((await User.find({ _id: { $in: memberRows.map((m) => m.userId) } }).select('name').lean()).map((u) => [String(u._id), u.name]))
    readStates = memberRows.filter((m) => String(m.userId) !== String(auth.userId)).map((m) => ({
      userId: String(m.userId), name: names.get(String(m.userId)) ?? '—', lastReadAt: m.lastReadAt, lastReadMessageId: m.lastReadMessageId ? String(m.lastReadMessageId) : null,
    }))
  }
  return {
    ...channelOut(channel, member, auth, { settings, peer: peerOf(channel, peers, auth), ...counts }),
    memberCount: memberRows.length,
    onlineCount: memberRows.filter((m) => online.has(String(m.userId))).length,
    readStates,
    pinnedMessages: pinned.map(messageOut),
  }
}

/** People in a chat (online first). Large chats are searched rather than listed whole. */
export async function listMembers(channelId, { search } = {}, auth) {
  const { channel } = await membership(channelId, auth)
  const rows = await ChatMember.find({ channelId: channel._id, active: true }).select('userId role joinedAt').limit(10_000).lean()
  const roleOf = new Map(rows.map((r) => [String(r.userId), r.role]))
  const q = { _id: { $in: rows.map((r) => r.userId) } }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i')
    q.$or = [{ name: re }, { designation: re }]
  }
  const users = await User.find(q).select('name designation active').sort({ name: 1 }).limit(search ? 30 : 500).lean()
  return users.map((u) => ({
    id: String(u._id), name: u.name, designation: u.designation, active: u.active !== false,
    role: channel.type === 'GROUP' ? roleOf.get(String(u._id)) : undefined,
    online: isOnline(auth.tenantId, u._id),
    me: String(u._id) === String(auth.userId),
  })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
}

/** Colleagues to start a chat with (active staff of this institution, online first). */
export async function people(search, auth) {
  assertStaff(auth)
  const q = { active: true, _id: { $ne: oid(auth.userId) } }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i')
    q.$or = [{ name: re }, { designation: re }, { email: re }]
  }
  const rows = await User.find(q).select('name designation departmentIds').sort({ name: 1 }).limit(search ? 40 : 300).lean()
  const deptIds = uniq(rows.flatMap((r) => r.departmentIds ?? []))
  const depts = deptIds.length ? new Map((await Department.find({ _id: { $in: deptIds.map(oid) } }).select('name').lean()).map((d) => [String(d._id), d.name])) : new Map()
  return rows.map((u) => ({
    id: String(u._id), name: u.name, designation: u.designation,
    departments: (u.departmentIds ?? []).map((d) => depts.get(String(d))).filter(Boolean),
    online: isOnline(auth.tenantId, u._id),
  })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)).slice(0, 60)
}

/** The direct chat with a colleague, made when the first message is sent. */
async function directWith(userId, auth, { create = false } = {}) {
  if (!isOid(userId) || String(userId) === String(auth.userId)) throw badRequest('Pick a colleague to message.')
  const pair = [String(auth.userId), String(userId)].sort()
  const key = `DIRECT:${pair[0]}:${pair[1]}`
  let channel = await ChatChannel.findOne({ key }).lean()
  if (channel || !create) return { channel, created: false }
  const peer = await User.findOne({ _id: userId, active: true }).select('name').lean()
  if (!peer) throw badRequest('You can only message active staff of this institution.')
  try {
    channel = (await ChatChannel.create({ key, type: 'DIRECT', directUserIds: pair.map(oid), createdBy: { userId: auth.userId, name: auth.user.name }, memberCount: 2 })).toObject()
  } catch (err) {
    if (err?.code !== 11000) throw err
    return { channel: await ChatChannel.findOne({ key }).lean(), created: false }
  }
  await setMembers(channel, pair, { auto: false, quiet: true })
  return { channel, created: true }
}

/** Open (or look up) the direct chat with someone: { channel } or { channel: null, peer } before the first message. */
export async function findDirect(userId, auth) {
  assertStaff(auth)
  const { channel } = await directWith(userId, auth)
  if (channel && (await ChatMember.exists({ channelId: channel._id, userId: auth.userId, active: true }))) return { channel: await getChannel(String(channel._id), auth) }
  const peer = await User.findOne({ _id: userId, active: true }).select('name designation').lean()
  if (!peer) throw notFound('Colleague')
  return { channel: null, peer: { id: String(peer._id), name: peer.name, designation: peer.designation, online: isOnline(auth.tenantId, peer._id) } }
}

/** Make the direct chat with someone now (it is otherwise made by the first message). */
export async function openDirect(userId, auth) {
  assertStaff(auth)
  const { channel } = await directWith(userId, auth, { create: true })
  return getChannel(String(channel._id), auth)
}

async function activeUsers(ids) {
  const list = uniq(ids).filter(isOid)
  if (!list.length) return []
  return User.find({ _id: { $in: list.map(oid) }, active: true }).select('name').lean()
}

/** A new group: the creator is its owner. */
export async function createGroup({ name, description, memberIds }, auth) {
  assertStaff(auth)
  const users = await activeUsers(memberIds)
  if (users.length + 1 > CHAT_GROUP_MAX_MEMBERS) throw badRequest(`A group can have up to ${CHAT_GROUP_MAX_MEMBERS} people.`)
  const channel = (await ChatChannel.create({ type: 'GROUP', name, description, createdBy: { userId: auth.userId, name: auth.user.name } })).toObject()
  const ids = uniq([String(auth.userId), ...users.map((u) => String(u._id))])
  await setMembers(channel, ids, { auto: false, quiet: true })
  await ChatMember.updateOne({ channelId: channel._id, userId: auth.userId }, { $set: { role: 'OWNER' } })
  await systemMessage(channel, 'CREATED', { actorName: auth.user.name, names: users.map((u) => u.name) })
  return getChannel(String(channel._id), auth)
}

/** Set up the chat of a department or campus now (moderators) — it would otherwise appear with its first member. */
export async function createAutoChannel({ type, sourceId }, auth, req) {
  assertStaff(auth)
  const dir = await directoryOf(auth.enabledModules)
  const key = type === 'INSTITUTION' ? (sourceId ? `INSTITUTION:${sourceId}` : EVERYONE_KEY) : `${type}:${sourceId}`
  const src = sourceOf(key, dir)
  if (!src) throw badRequest(type === 'DEPARTMENT' ? 'Pick an active department.' : 'Pick a campus (a campus chat exists only when there are several campuses).')
  const { channel } = await ensureChannel(key, src)
  await syncAutoChannels(auth.enabledModules)
  await audit({ action: 'CREATE', module: 'comms', entityType: 'chat_channel', entityId: String(channel._id), entityName: src.name, summary: `Set up the ${CHAT_CHANNEL_TYPE_BY[type].label.toLowerCase()} chat “${src.name}”` }, req)
  const mine = await ChatMember.exists({ channelId: channel._id, userId: auth.userId, active: true })
  return mine ? getChannel(String(channel._id), auth) : { id: String(channel._id), name: src.name, type, memberCount: (await ChatChannel.findById(channel._id).select('memberCount').lean())?.memberCount ?? 0 }
}

/** Rename / describe a group (its owner or admins, or a chat manager); describe an automatic channel (managers). */
export async function updateChannel(channelId, { name, description }, auth, req) {
  const { channel, member } = await membership(channelId, auth)
  if (!canModerate(channel, member, auth)) throw forbidden('Only the group’s owner or admins can change it.')
  const set = {}
  if (name !== undefined && channel.type === 'GROUP' && name !== channel.name) set.name = name
  if (description !== undefined && description !== channel.description) set.description = description ?? ''
  if (!Object.keys(set).length) return getChannel(channelId, auth)
  await ChatChannel.updateOne({ _id: channel._id }, { $set: set })
  if (set.name) await systemMessage(channel, 'RENAMED', { actorName: auth.user.name, names: [set.name] })
  if (!isGroupAdmin(channel, member)) await audit({ action: 'UPDATE', module: 'comms', entityType: 'chat_channel', entityId: channelId, entityName: set.name ?? channel.name, summary: `Changed the chat “${channel.name}”` }, req)
  emitToRoom(auth.tenantId, room(channelId), 'chat:channel', { action: 'updated', channelId })
  return getChannel(channelId, auth)
}

export async function addMembers(channelId, userIds, auth, req) {
  const { channel, member } = await membership(channelId, auth)
  if (channel.type !== 'GROUP') throw badRequest('People join department and whole-staff chats on their own.')
  if (!canModerate(channel, member, auth)) throw forbidden('Only the group’s owner or admins can add people.')
  const users = await activeUsers(userIds)
  if (!users.length) throw badRequest('Pick active staff to add.')
  const current = (await ChatMember.find({ channelId: channel._id, active: true }).select('userId').lean()).map((m) => String(m.userId))
  const next = uniq([...current, ...users.map((u) => String(u._id))])
  if (next.length > CHAT_GROUP_MAX_MEMBERS) throw badRequest(`A group can have up to ${CHAT_GROUP_MAX_MEMBERS} people.`)
  const { added } = await setMembers(channel, next, { auto: false, quiet: true })
  if (added.length) {
    await ChatMember.updateMany({ channelId: channel._id, userId: { $in: added.map(oid) } }, { $set: { role: 'MEMBER' } })
    await systemMessage(channel, 'ADDED', { actorName: auth.user.name, names: users.filter((u) => added.includes(String(u._id))).map((u) => u.name) })
    if (!isGroupAdmin(channel, member)) await audit({ action: 'UPDATE', module: 'comms', entityType: 'chat_channel', entityId: channelId, entityName: channel.name, summary: `Added ${added.length} people to the group “${channel.name}”` }, req)
  }
  emitToRoom(auth.tenantId, room(channelId), 'chat:channel', { action: 'members', channelId })
  return listMembers(channelId, {}, auth)
}

/** Take someone out of a group, or (yourself) leave it. The owner leaving hands the group on. */
export async function removeMember(channelId, userId, auth, req) {
  const { channel, member } = await membership(channelId, auth)
  if (channel.type !== 'GROUP') throw badRequest('You can only leave or be removed from groups.')
  const self = String(userId) === String(auth.userId)
  const target = self ? member : await ChatMember.findOne({ channelId: channel._id, userId, active: true }).lean()
  if (!target) throw notFound('Member')
  if (!self) {
    if (!canModerate(channel, member, auth)) throw forbidden('Only the group’s owner or admins can remove people.')
    if (target.role === 'OWNER' && !can(auth, MANAGE)) throw forbidden('The owner cannot be removed.')
    if (target.role === 'ADMIN' && member.role !== 'OWNER' && !can(auth, MANAGE)) throw forbidden('Only the owner can remove an admin.')
  }
  const current = (await ChatMember.find({ channelId: channel._id, active: true }).select('userId').lean()).map((m) => String(m.userId))
  await setMembers(channel, current.filter((u) => u !== String(userId)), { auto: false, quiet: true })
  const name = (await User.findById(userId).select('name').lean())?.name ?? 'A member'
  await systemMessage(channel, self ? 'LEFT' : 'REMOVED', { actorName: auth.user.name, names: [name] })
  if (target.role === 'OWNER') {
    const heir = await ChatMember.findOne({ channelId: channel._id, active: true }).sort({ role: 1, joinedAt: 1 }).lean() // ADMIN sorts before MEMBER
    if (heir) await ChatMember.updateOne({ _id: heir._id }, { $set: { role: 'OWNER' } })
  }
  if (!self && !isGroupAdmin(channel, member)) {
    await audit({ action: 'UPDATE', module: 'comms', entityType: 'chat_channel', entityId: channelId, entityName: channel.name, summary: `Removed ${name} from the group “${channel.name}”` }, req)
  }
  emitToRoom(auth.tenantId, room(channelId), 'chat:channel', { action: 'members', channelId })
  return { removed: String(userId) }
}

/** Make a group member an admin or back (the owner, or a chat manager). */
export async function setMemberRole(channelId, userId, role, auth) {
  const { channel, member } = await membership(channelId, auth)
  if (channel.type !== 'GROUP') throw badRequest('Only groups have admins.')
  if (member.role !== 'OWNER' && !can(auth, MANAGE)) throw forbidden('Only the group’s owner can change admins.')
  const target = await ChatMember.findOne({ channelId: channel._id, userId, active: true })
  if (!target) throw notFound('Member')
  if (target.role === 'OWNER') throw conflict('The owner stays the owner.')
  target.role = role
  await target.save()
  emitToRoom(auth.tenantId, room(channelId), 'chat:channel', { action: 'members', channelId })
  return listMembers(channelId, {}, auth)
}

/** My own settings for a chat: mute, pin to the top, which messages ring the bell. */
export async function updateMyPrefs(channelId, { muted, pinned, notify }, auth) {
  const { member } = await membership(channelId, auth)
  const set = {}
  if (muted !== undefined) set.muted = muted
  if (pinned !== undefined) set.pinned = pinned
  if (notify !== undefined && NOTIFY.has(notify)) set.notify = notify
  if (Object.keys(set).length) await ChatMember.updateOne({ _id: member._id }, { $set: set })
  emitToUser(auth.tenantId, auth.userId, 'chat:channel', { action: 'prefs', channelId })
  return getChannel(channelId, auth)
}

// ───────────────────────────────────────────────────────── messages

const cursorRe = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([a-f0-9]{24})$/
function parseCursor(c) {
  const m = cursorRe.exec(c ?? '')
  if (!m) return null
  const at = new Date(m[1])
  return Number.isNaN(at.getTime()) ? null : { at, id: oid(m[2]) }
}

/** History, newest last. `before` pages back (scrolling up); `after` catches up (after a reconnect). */
export async function listMessages(channelId, { before, after, limit = 40 } = {}, auth) {
  const { channel } = await membership(channelId, auth)
  const n = Math.min(Math.max(Number(limit) || 40, 1), 100)
  const b = parseCursor(before)
  const a = parseCursor(after)
  const filter = { channelId: channel._id }
  if (a) {
    filter.$or = [{ createdAt: { $gt: a.at } }, { createdAt: a.at, _id: { $gt: a.id } }]
    const rows = await ChatMessage.find(filter).sort({ createdAt: 1, _id: 1 }).limit(n + 1).lean()
    return { messages: rows.slice(0, n).map(messageOut), hasMore: false, hasNewer: rows.length > n }
  }
  if (b) filter.$or = [{ createdAt: { $lt: b.at } }, { createdAt: b.at, _id: { $lt: b.id } }]
  const rows = await ChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(n + 1).lean()
  return { messages: rows.slice(0, n).reverse().map(messageOut), hasMore: rows.length > n, hasNewer: false }
}

/** Messages that mention a word, in the chats I am in (or one of them). */
export async function searchMessages({ q, channelId }, auth) {
  assertStaff(auth)
  let channelIds
  if (channelId) channelIds = [(await membership(channelId, auth)).channel._id]
  else channelIds = (await ChatMember.find({ userId: auth.userId, active: true }).select('channelId').lean()).map((m) => m.channelId)
  if (!channelIds.length) return []
  const rows = await ChatMessage.find({ channelId: { $in: channelIds }, kind: 'TEXT', 'deleted.at': null, text: new RegExp(escapeRegex(q), 'i') }).sort({ createdAt: -1 }).limit(50).lean()
  const channels = await ChatChannel.find({ _id: { $in: uniq(rows.map((r) => r.channelId)).map(oid) } }).lean()
  const peers = await peersOf(channels, auth)
  const names = new Map(channels.map((c) => [String(c._id), c.type === 'DIRECT' ? peerOf(c, peers, auth)?.name ?? 'Direct message' : c.name]))
  return rows.map((m) => ({ ...messageOut(m), channelName: names.get(String(m.channelId)) }))
}

/** Files shared in a chat (newest first) — from its messages, so removed messages drop out. */
export async function channelFiles(channelId, auth) {
  const { channel } = await membership(channelId, auth)
  const rows = await ChatMessage.find({ channelId: channel._id, 'attachments.0': { $exists: true }, 'deleted.at': null }).select('attachments senderName createdAt').sort({ createdAt: -1 }).limit(200).lean()
  return rows.flatMap((m) => m.attachments.map((a) => ({
    id: String(a.fileId), fileName: a.fileName, contentType: a.contentType, size: a.size, image: isImage(a.contentType), messageId: String(m._id), senderName: m.senderName, at: m.createdAt,
  })))
}

/** Upload a file into a chat; it is attached to a message by its id when that is sent. */
export async function uploadAttachment(channelId, { fileName }, buffer, auth, req) {
  const { channel } = await membership(channelId, auth)
  await assertCanPost(channel, auth)
  return uploadFile({ entityType: 'chat_message', entityId: String(channel._id), category: 'OTHER', fileName }, buffer, auth, req)
}

export const sendSchema = z.object({
  channelId: z.string().optional(),
  toUserId: z.string().optional(), // a direct chat that may not exist yet
  clientId: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  text: z.string().max(CHAT_MESSAGE_MAX, `Keep a message under ${CHAT_MESSAGE_MAX} characters.`).default(''),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).max(50).default([]),
  mentionChannel: z.boolean().default(false),
  attachmentIds: z.array(z.string()).max(CHAT_ATTACHMENTS_MAX, `Up to ${CHAT_ATTACHMENTS_MAX} files a message.`).default([]),
  studentId: z.string().optional(),
}).strict().refine((v) => v.channelId || v.toUserId, 'Say which chat.')

/** Only the people in the chat can be @mentioned: { ids, names }. */
async function validMentions(channelId, ids, me) {
  const list = uniq(ids).filter((u) => isOid(u) && u !== String(me))
  if (!list.length) return { ids: [], names: [] }
  const members = (await ChatMember.find({ channelId, userId: { $in: list.map(oid) }, active: true }).select('userId').lean()).map((m) => m.userId)
  const users = members.length ? await User.find({ _id: { $in: members } }).select('name').lean() : []
  return { ids: users.map((u) => u._id), names: users.map((u) => u.name) }
}

/** May point at a student in a message (the chip opens the student with the reader's own access). */
function canAttachStudent(auth) {
  return !!auth?.enabledModules?.includes('students') && can(auth, 'students.profile.view')
}

async function studentChip(studentId, auth) {
  if (!studentId) return undefined
  if (!canAttachStudent(auth)) throw forbidden('Pointing at a student needs access to student records.')
  if (!isOid(studentId)) throw badRequest('Pick the student again.')
  const st = await Student.findById(studentId).select('firstName middleName lastName admissionNo').lean()
  if (!st) throw badRequest('Pick the student again.', { fields: { studentId: 'Unknown student' } })
  return { id: st._id, display: `${studentName(st)}${st.admissionNo ? ` (${st.admissionNo})` : ''}` } // name + admission no., nothing more
}

/** Send a message (socket or REST). The sender, the chat and who may be mentioned come from the server. */
export async function sendMessage(input, auth) {
  assertStaff(auth)
  if (!can(auth, CREATE)) throw forbidden('Your role can read chats but not write in them.', { missing: [CREATE] })
  assertSendRate(auth)
  let channel
  let member
  if (input.toUserId && !input.channelId) {
    channel = (await directWith(input.toUserId, auth, { create: true })).channel
    member = await ChatMember.findOne({ channelId: channel._id, userId: auth.userId, active: true }).lean()
    if (!member) throw notFound('Chat')
  } else {
    ({ channel, member } = await membership(input.channelId, auth))
  }
  await assertCanPost(channel, auth)
  if (input.clientId) {
    const dup = await ChatMessage.findOne({ senderId: auth.userId, clientId: input.clientId }).lean()
    if (dup) return messageOut(dup) // a retry of a message that already went
  }
  const text = (input.text ?? '').replace(/\r\n/g, '\n').trim()
  const attachIds = uniq(input.attachmentIds).filter(isOid)
  if (!text && !attachIds.length && !input.studentId) throw badRequest('Write something first.')

  let replyTo
  if (input.replyToId) {
    const r = isOid(input.replyToId) ? await ChatMessage.findOne({ _id: input.replyToId, channelId: channel._id }).lean() : null
    if (!r) throw badRequest('The message you are replying to is gone.')
    replyTo = { id: r._id, senderName: r.senderName ?? 'System', preview: chatPreview(r, 140) }
  }
  if (input.mentionChannel && !canModerate(channel, member, auth)) throw forbidden('Only the chat’s admins can use @channel.')
  const mentions = await validMentions(channel._id, input.mentions, auth.userId)
  let attachments = []
  if (attachIds.length) {
    const files = await Attachment.find({ _id: { $in: attachIds.map(oid) }, entityType: 'chat_message', entityId: String(channel._id), uploadedById: auth.userId, 'deleted.at': null }).lean()
    if (files.length !== attachIds.length) throw badRequest('Some files are missing — attach them again.')
    attachments = files.map((f) => ({ fileId: f._id, fileName: f.fileName, contentType: f.mime, size: f.size }))
  }
  const student = await studentChip(input.studentId, auth)

  let m
  try {
    m = await ChatMessage.create({
      channelId: channel._id, kind: 'TEXT', senderId: auth.userId, senderName: auth.user.name, clientId: input.clientId,
      text, mentions: mentions.ids, mentionNames: mentions.names, mentionChannel: !!input.mentionChannel && channel.type !== 'DIRECT', attachments, replyTo, student,
    })
  } catch (err) {
    if (err?.code === 11000 && input.clientId) return messageOut(await ChatMessage.findOne({ senderId: auth.userId, clientId: input.clientId }).lean())
    throw err
  }
  const preview = chatPreview(m, 140)
  await Promise.all([
    ChatChannel.updateOne({ _id: channel._id }, { $set: { lastMessage: { id: m._id, at: m.createdAt, senderId: auth.userId, senderName: auth.user.name, preview }, lastMessageAt: m.createdAt } }),
    ChatMember.updateOne({ _id: member._id }, { $set: { lastReadAt: m.createdAt, lastReadMessageId: m._id } }),
  ])
  const out = messageOut(m.toObject())
  emitToRoom(auth.tenantId, room(channel._id), 'chat:message', { channelId: String(channel._id), message: out, preview })
  notifyForMessage(channel, m, auth).catch((err) => logger.warn({ err }, 'chat notification failed'))
  return out
}

/** Is this person looking at this chat right now, on any device? */
function looking(tenantId, userId, channelId) {
  return userSockets(tenantId, userId).some((s) => s.data.chatFocus === String(channelId))
}

/**
 * The bell for a direct message or an @mention — only when the person is not looking at
 * the chat (offline, another screen, tab in the background) and their settings allow it:
 * "Nothing" never rings; a muted chat still rings for an @mention of them by name.
 */
async function notifyForMessage(channel, m, auth) {
  const reasons = new Map() // userId → dm | mention | channel
  const sender = String(auth.userId)
  if (channel.type === 'DIRECT') for (const u of channel.directUserIds.map(String)) if (u !== sender) reasons.set(u, 'dm')
  for (const u of (m.mentions ?? []).map(String)) reasons.set(u, 'mention')
  if (m.mentionChannel) {
    const all = await ChatMember.find({ channelId: channel._id, active: true }).select('userId').limit(10_000).lean()
    for (const r of all) if (String(r.userId) !== sender && !reasons.has(String(r.userId))) reasons.set(String(r.userId), 'channel')
  }
  reasons.delete(sender)
  if (!reasons.size) return
  const prefs = new Map((await ChatMember.find({ channelId: channel._id, userId: { $in: [...reasons.keys()].map(oid) }, active: true }).select('userId muted notify').lean()).map((p) => [String(p.userId), p]))
  const tenantId = auth.tenantId
  const byReason = { dm: [], mention: [], channel: [] }
  for (const [u, why] of reasons) {
    const p = prefs.get(u)
    if (!p || p.notify === 'NONE') continue
    if (why === 'dm' && (p.muted || p.notify !== 'ALL')) continue
    if (why === 'channel' && p.muted) continue
    if (looking(tenantId, u, channel._id)) continue
    byReason[why].push(u)
  }
  const preview = chatPreview(m, 140)
  const where = channel.type === 'DIRECT' ? '' : ` in ${channel.name}`
  const base = { link: `/comms/chat/${channel._id}`, tone: 'info', entityType: 'chat_channel', entityId: String(channel._id), message: preview }
  if (byReason.dm.length) await notifyUsers(byReason.dm, { ...base, event: 'chat.direct', title: `Message from ${auth.user.name}` })
  if (byReason.mention.length) await notifyUsers(byReason.mention, { ...base, event: 'chat.mention', title: `${auth.user.name} mentioned you${where}` })
  if (byReason.channel.length) await notifyUsers(byReason.channel, { ...base, event: 'chat.mention', title: `${auth.user.name} — @channel${where}` })
}

async function ownMessage(messageId, auth) {
  assertStaff(auth)
  if (!isOid(messageId)) throw notFound('Message')
  const m = await ChatMessage.findById(messageId)
  if (!m) throw notFound('Message')
  const { channel, member } = await membership(String(m.channelId), auth)
  return { m, channel, member }
}

async function refreshPreview(channel, m) {
  if (String(channel.lastMessage?.id) !== String(m._id)) return
  await ChatChannel.updateOne({ _id: channel._id }, { $set: { 'lastMessage.preview': chatPreview(m, 140) } })
}

function broadcastUpdate(auth, m) {
  emitToRoom(auth.tenantId, room(m.channelId), 'chat:updated', { channelId: String(m.channelId), message: messageOut(m.toObject ? m.toObject() : m) })
}

export async function editMessage(messageId, { text, mentions = [] }, auth) {
  const { m, channel } = await ownMessage(messageId, auth)
  if (String(m.senderId) !== String(auth.userId) || m.kind !== 'TEXT') throw forbidden('You can only edit your own messages.')
  if (m.deleted?.at) throw conflict('This message was removed.')
  if (Date.now() - m.createdAt > CHAT_EDIT_HOURS * 3_600_000) throw conflict(`Messages can be edited for ${CHAT_EDIT_HOURS} hours. Send a new one instead.`)
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim()
  if (!clean && !m.attachments?.length && !m.student?.id) throw badRequest('Write something, or remove the message instead.')
  if (clean === m.text) return messageOut(m.toObject())
  m.text = clean
  const valid = await validMentions(channel._id, mentions, auth.userId)
  m.mentions = valid.ids
  m.mentionNames = valid.names
  m.editedAt = new Date()
  await m.save()
  await refreshPreview(channel, m)
  broadcastUpdate(auth, m)
  return messageOut(m.toObject())
}

/** Remove a message: your own, or (the chat's admins / chat managers) anyone's — that is audited. */
export async function deleteMessage(messageId, auth, req) {
  const { m, channel, member } = await ownMessage(messageId, auth)
  if (m.deleted?.at) return messageOut(m.toObject())
  const own = String(m.senderId) === String(auth.userId)
  if (m.kind !== 'TEXT' || (!own && !canModerate(channel, member, auth))) throw forbidden('You can only remove your own messages.')
  m.deleted = { at: new Date(), by: auth.user.name, byId: auth.userId, moderated: !own }
  m.pinned = undefined
  await m.save()
  const files = (m.attachments ?? []).map((a) => a.fileId)
  if (files.length) await Attachment.updateMany({ _id: { $in: files }, 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: auth.user.name, reason: 'Chat message removed' } } })
  if (String(channel.lastMessage?.id) === String(m._id)) await ChatChannel.updateOne({ _id: channel._id }, { $set: { 'lastMessage.preview': 'Message removed' } })
  if (!own) {
    const where = channel.type === 'DIRECT' ? 'a direct chat' : `“${channel.name}”`
    await audit({ action: 'DELETE', module: 'comms', entityType: 'chat_message', entityId: String(m._id), entityName: channel.name ?? 'Direct chat', summary: `Removed a message by ${m.senderName} in ${where}` }, req)
  }
  broadcastUpdate(auth, m)
  return messageOut(m.toObject())
}

export async function reactToMessage(messageId, emoji, auth) {
  if (!CHAT_REACTIONS.includes(emoji)) throw badRequest('Pick one of the reactions.')
  const { m } = await ownMessage(messageId, auth)
  if (m.deleted?.at || m.kind !== 'TEXT') throw conflict('This message cannot be reacted to.')
  const me = String(auth.userId)
  const r = m.reactions.find((x) => x.emoji === emoji)
  if (!r) m.reactions.push({ emoji, userIds: [auth.userId] })
  else if (r.userIds.map(String).includes(me)) r.userIds = r.userIds.filter((u) => String(u) !== me)
  else r.userIds.push(auth.userId)
  m.reactions = m.reactions.filter((x) => x.userIds.length)
  await m.save()
  broadcastUpdate(auth, m)
  return messageOut(m.toObject())
}

/** Pin to the top of the chat: anyone in a direct chat or group; the admins elsewhere. */
export async function pinMessage(messageId, pinned, auth) {
  const { m, channel, member } = await ownMessage(messageId, auth)
  if (m.deleted?.at || m.kind !== 'TEXT') throw conflict('This message cannot be pinned.')
  if (!['DIRECT', 'GROUP'].includes(channel.type) && !canModerate(channel, member, auth)) throw forbidden('Only the chat’s admins can pin messages here.')
  m.pinned = pinned ? { at: new Date(), by: auth.user.name } : undefined
  await m.save()
  broadcastUpdate(auth, m)
  return messageOut(m.toObject())
}

/** Move my read pointer forward (never back) and tell the chat (small chats) or my devices. */
export async function markRead(channelId, { messageId } = {}, auth) {
  const { channel, member } = await membership(channelId, auth)
  let at = new Date()
  let id = channel.lastMessage?.id ?? null
  if (messageId && isOid(messageId)) {
    const m = await ChatMessage.findOne({ _id: messageId, channelId: channel._id }).select('createdAt').lean()
    if (m) { at = m.createdAt; id = m._id }
  }
  if (member.lastReadAt && member.lastReadAt >= at) return { lastReadAt: member.lastReadAt }
  await ChatMember.updateOne({ _id: member._id }, { $set: { lastReadAt: at, lastReadMessageId: id } })
  const payload = { channelId: String(channel._id), userId: String(auth.userId), name: auth.user.name, lastReadAt: at, lastReadMessageId: id ? String(id) : null }
  if ((channel.memberCount ?? 0) <= CHAT_RECEIPTS_MAX_MEMBERS) emitToRoom(auth.tenantId, room(channel._id), 'chat:read', payload)
  else emitToUser(auth.tenantId, auth.userId, 'chat:read', payload)
  return { lastReadAt: at }
}

// ───────────────────────────────────────────────────────── settings (managers)

/** Campuses and departments a moderator can set up a chat for, with the chats that exist. */
export async function chatSources(auth) {
  assertStaff(auth)
  const dir = await directoryOf(auth.enabledModules)
  const existing = new Map((await ChatChannel.find({ type: { $in: CHAT_AUTO_TYPES } }).select('key memberCount archived').lean()).map((c) => [c.key, c]))
  const row = (type, x) => {
    const c = existing.get(`${type}:${x._id}`)
    return { id: String(x._id), name: x.name, channelId: c ? String(c._id) : null, members: c?.memberCount ?? 0, archived: !!c?.archived }
  }
  return {
    branches: dir.branches.map((b) => row('INSTITUTION', b)),
    departments: dir.departments.map((d) => row('DEPARTMENT', d)).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function getChatSettings() {
  return chatSettings()
}

export async function saveChatSettings({ announcementsOnly, retentionDays }, req) {
  const before = await chatSettings()
  const values = {}
  if (announcementsOnly !== undefined) values.chatAnnouncementsOnly = announcementsOnly
  if (retentionDays !== undefined) values.chatRetentionDays = retentionDays
  await saveSettings('comms', values)
  const after = await chatSettings()
  await audit({
    action: 'UPDATE', module: 'comms', entityType: 'chat_settings', entityName: 'Chat settings',
    summary: `Chat: whole-staff chat ${after.announcementsOnly ? 'announcements only' : 'open to all'}; messages kept ${after.retentionDays ? `${after.retentionDays} days` : 'for ever'}`,
    changes: [
      ...(before.announcementsOnly !== after.announcementsOnly ? [{ field: 'announcementsOnly', from: before.announcementsOnly, to: after.announcementsOnly }] : []),
      ...(before.retentionDays !== after.retentionDays ? [{ field: 'retentionDays', from: before.retentionDays, to: after.retentionDays }] : []),
    ],
  }, req)
  return after
}

// ───────────────────────────────────────────────────────── the chat job

/** One institution: re-work automatic channels, then drop messages older than the retention period. */
async function chatJobsForTenant(tenantId) {
  const modules = await enabledModuleIds(tenantId)
  const sync = await syncAutoChannels(modules)
  const { retentionDays } = await chatSettings()
  let removed = 0
  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * MIN)
    const withFiles = await ChatMessage.find({ createdAt: { $lt: cutoff }, 'attachments.0': { $exists: true } }).select('attachments.fileId').limit(20_000).lean()
    const fileIds = withFiles.flatMap((m) => m.attachments.map((a) => a.fileId))
    if (fileIds.length) await Attachment.updateMany({ _id: { $in: fileIds }, 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: 'System', reason: `Chat retention (${retentionDays} days)` } } })
    removed = (await ChatMessage.deleteMany({ createdAt: { $lt: cutoff } })).deletedCount ?? 0
    if (removed) {
      await ChatChannel.updateMany({ lastMessageAt: { $lt: cutoff } }, { $unset: { lastMessage: 1 } })
      await audit({ action: 'DELETE', module: 'comms', entityType: 'chat_message', entityName: 'Chat retention', summary: `Removed ${removed} chat messages older than ${retentionDays} days` })
    }
  }
  return { channels: sync.channels, joined: sync.added, left: sync.removed, removed }
}

/** Every institution that uses chat. Idempotent; hourly is plenty. */
export async function runChatJobs() {
  const tenants = await runAsSystem(() => ChatChannel.distinct('tenantId').setOptions({ allTenants: true }))
  const total = { tenants: 0, joined: 0, left: 0, removed: 0 }
  for (const t of tenants) {
    try {
      const r = await runAsTenant(String(t), () => chatJobsForTenant(String(t)), { userName: 'System', system: false })
      total.tenants++
      total.joined += r.joined
      total.left += r.left
      total.removed += r.removed
    } catch (err) {
      logger.error({ err, tenantId: String(t) }, 'chat job failed for an institution')
    }
  }
  return total
}

// ───────────────────────────────────────────────────────── sockets & listeners

const idOnly = z.object({ channelId: z.string() }).passthrough()

let registered = false
export function registerChatSockets() {
  if (registered) return
  registered = true

  // every new connection joins the rooms of its chats (rooms do not survive a reconnect)
  onConnect(async (socket, { auth }) => {
    if (!can(auth, VIEW) || !auth?.enabledModules) return
    await ensureMine(auth)
    const mine = await ChatMember.find({ userId: auth.userId, active: true }).select('channelId').limit(2000).lean()
    for (const m of mine) joinRoom(socket, room(m.channelId))
  })

  onSocket('chat:send', async (payload, ctx) => sendMessage(sendSchema.parse(payload), ctx.auth), { permission: CREATE })
  onSocket('chat:edit', async (payload, ctx) => {
    const { id, text, mentions } = z.object({ id: z.string(), text: z.string().max(CHAT_MESSAGE_MAX), mentions: z.array(z.string()).max(50).default([]) }).strict().parse(payload)
    return editMessage(id, { text, mentions }, ctx.auth)
  }, { permission: CREATE })
  onSocket('chat:delete', async (payload, ctx) => deleteMessage(z.object({ id: z.string() }).strict().parse(payload).id, ctx.auth), { permission: VIEW })
  onSocket('chat:react', async (payload, ctx) => {
    const { id, emoji } = z.object({ id: z.string(), emoji: z.string().max(8) }).strict().parse(payload)
    return reactToMessage(id, emoji, ctx.auth)
  }, { permission: VIEW })
  onSocket('chat:pin', async (payload, ctx) => {
    const { id, pinned } = z.object({ id: z.string(), pinned: z.boolean() }).strict().parse(payload)
    return pinMessage(id, pinned, ctx.auth)
  }, { permission: VIEW })
  onSocket('chat:read', async (payload, ctx) => {
    const { channelId, messageId } = z.object({ channelId: z.string(), messageId: z.string().optional() }).strict().parse(payload)
    return markRead(channelId, { messageId }, ctx.auth)
  }, { permission: VIEW })
  // not stored; at most one every 2 s per person and chat, only in chats small enough to care
  onSocket('chat:typing', async (payload, ctx) => {
    const { channelId } = idOnly.parse(payload)
    const k = `${ctx.tenantId}:${ctx.userId}:${channelId}`
    const now = Date.now()
    if (now - (typingAt.get(k) ?? 0) < 2000) return { sent: false }
    typingAt.set(k, now)
    if (typingAt.size > 20_000) typingAt.clear()
    const { channel } = await membership(channelId, ctx.auth)
    if ((channel.memberCount ?? 0) > CHAT_RECEIPTS_MAX_MEMBERS) return { sent: false }
    emitToRoom(ctx.tenantId, room(channel._id), 'chat:typing', { channelId: String(channel._id), userId: String(ctx.userId), name: ctx.userName })
    return { sent: true }
  }, { permission: CREATE })
  // the chat this tab shows (null: none, or the tab is in the background)
  onSocket('chat:focus', async (payload, ctx) => {
    const { channelId } = z.object({ channelId: z.string().nullable() }).strict().parse(payload)
    ctx.socket.data.chatFocus = channelId && isOid(channelId) ? channelId : null
    return { focus: ctx.socket.data.chatFocus }
  }, { permission: VIEW })
}

let listening = false
/** Department / campus / status changes move people between automatic channels. */
export function registerChatListeners() {
  if (listening) return
  listening = true
  on('chat.membership_changed', async ({ userIds } = {}) => {
    if (!tenantNow()) return
    for (const u of uniq(userIds)) await syncUserChannels(u, { force: true })
  })
}
