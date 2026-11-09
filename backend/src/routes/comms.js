import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  CHAT_GROUP_MAX_MEMBERS, CHAT_GROUP_NAME_MAX, CHAT_MESSAGE_MAX, CHAT_NOTIFY_LEVELS, FILE_MAX_MB, PAGE_CALL_STATUSES, PAGE_CODES, PAGE_PRIORITIES,
  PAGE_TARGET_TYPES,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { can } from '../platform/access.js'
import { badRequest, forbidden } from '../platform/errors.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  activeCalls, callLog, callLogCsv, closeCall, createCall, directory, getCall, incomingCalls, listCodes, pagingMeta, resetCode,
  respond, respondSchema, saveCode,
} from '../services/paging.js'
import {
  addMembers, assertStaff, channelFiles, chatSources, createAutoChannel, createGroup, deleteMessage, editMessage, findDirect, getChannel, getChatSettings, openDirect,
  listChannels, listMembers, listMessages, markRead, people, pinMessage, reactToMessage, removeMember, saveChatSettings, searchMessages,
  sendMessage, sendSchema, setMemberRole, updateChannel, updateMyPrefs, uploadAttachment,
} from '../services/chat.js'

// Staff chat & call bell: /api/v1/comms — calls & emergency alerts (paging) and staff chat.
// Staff only (tenantOnly + assertStaff in the services: never a family, an API key or the platform owner).
// Who is rung, the caller's name and phone, statuses and timings are never taken from a
// request: the service works them out. Live updates go out over the socket (page:* / chat:* events).
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('comms'))

const values = (list) => list.map((x) => x.value)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const VIEW = 'comms.calls.view'

// 20 calls a minute per person: enough for a real emergency, not for a stuck button or a script
const createLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.isTest ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.auth.tenantId}:${req.auth.userId}`,
  message: { message: 'Too many calls in a minute. Wait a moment before calling again.', code: 'RATE_LIMITED' },
})

// ── compose helpers
router.get('/paging/meta', requirePermission(VIEW), async (req, res) => { res.json({ data: await pagingMeta(req.auth) }) })
router.get('/paging/directory', requirePermission('comms.calls.create'), async (req, res) => {
  const { search, all } = z.object({ search: optionalText(60), all: z.enum(['1', 'true']).optional() }).parse(req.query)
  res.json({ data: await directory(search, req.auth, { all: !!all }) })
})

// ── calls
const target = z.object({
  type: z.enum(values(PAGE_TARGET_TYPES)),
  ids: z.array(z.string().trim().max(64)).max(50).default([]),
})
router.post('/paging/calls', requirePermission('comms.calls.create'), createLimiter, async (req, res) => {
  const body = z.object({
    target,
    priority: z.enum(values(PAGE_PRIORITIES)).default('ROUTINE'),
    code: z.enum(PAGE_CODES.map((c) => c.code)).optional(),
    location: z.object({
      branchId: objectId.optional(),
      room: optionalText(40), text: optionalText(120),
    }).default({}),
    message: optionalText(300),
  }).parse(req.body)
  res.status(201).json({ data: await createCall(body, req.auth, req) })
})
router.get('/paging/calls/active', requirePermission(VIEW), async (req, res) => { res.json({ data: await activeCalls(req.auth) }) })
// Being rung is not a permission: every signed-in member of staff gets their own calls back
// (after a reload), and answers only calls that rang them (checked in the service).
router.get('/paging/incoming', async (req, res) => { res.json({ data: await incomingCalls(req.auth) }) })

const logQuery = z.object({
  from: ymd.optional(), to: ymd.optional(),
  priority: z.enum(values(PAGE_PRIORITIES)).optional(),
  code: z.enum(PAGE_CODES.map((c) => c.code)).optional(),
  status: z.enum(Object.keys(PAGE_CALL_STATUSES)).optional(),
  targetType: z.enum(values(PAGE_TARGET_TYPES)).optional(),
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  search: optionalText(60),
})
router.get('/paging/calls', requirePermission(VIEW), async (req, res) => {
  // ?page=… → one page of the whole log (the call log screen); without it, the latest 500 (older callers)
  res.json({ data: await callLog(logQuery.parse(req.query), req.auth, req.query.page ? pageParams(req.query) : undefined) })
})
router.get('/paging/calls/export', requirePermission('comms.calls.export'), async (req, res) => {
  const q = logQuery.parse(req.query)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="calls-${q.from ?? 'all'}-${q.to ?? new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(await callLogCsv(q, req.auth))
})
router.get('/paging/calls/:id', requirePermission(VIEW), async (req, res) => { res.json({ data: await getCall(req.params.id, req.auth) }) })
router.post('/paging/calls/:id/respond', async (req, res) => {
  res.json({ data: await respond(req.params.id, respondSchema.parse(req.body), req.auth) })
})
router.post('/paging/calls/:id/close', requirePermission(VIEW), async (req, res) => {
  const { note } = z.object({ note: optionalText(300) }).parse(req.body ?? {})
  res.json({ data: await closeCall(req.params.id, { note }, req.auth, req) })
})

// ── emergency alerts (setup)
router.get('/codes', requirePermission('comms.codes.view'), async (req, res) => { res.json({ data: await listCodes() }) })
router.put('/codes/:code', requirePermission('comms.codes.edit'), async (req, res) => {
  const body = z.object({
    label: z.string().trim().min(2, 'Enter a name').max(40),
    meaning: z.string().trim().min(2, 'Say what it means').max(80),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
    enabled: z.boolean().default(true),
  }).parse(req.body)
  res.json({ data: await saveCode(req.params.code, body, req) })
})
router.delete('/codes/:code', requirePermission('comms.codes.edit'), async (req, res) => { res.json({ data: await resetCode(req.params.code, req) }) })

// ───────────────────────────────────────────────────────── staff chat
// Signed-in staff only (never an API key). Membership of the chat is checked in the service
// for every read and write; sender, members and mentions are never taken from the request.
const CHAT_VIEW = 'comms.chat.view'
const CHAT_CREATE = 'comms.chat.create'
const CHAT_MANAGE = 'comms.chat.moderate'
const staffOnly = (req, res, next) => { assertStaff(req.auth); next() }
const chat = Router()
chat.use(staffOnly)
const idParam = (v) => objectId.parse(v)

chat.get('/channels', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await listChannels(req.auth) }) })
chat.post('/channels', requirePermission(CHAT_CREATE, CHAT_MANAGE), async (req, res) => {
  const body = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('GROUP'),
      name: z.string().trim().min(2, 'Name the group').max(CHAT_GROUP_NAME_MAX),
      description: optionalText(300),
      memberIds: z.array(objectId).max(CHAT_GROUP_MAX_MEMBERS).default([]),
    }).strict(),
    z.object({ type: z.enum(['INSTITUTION', 'DEPARTMENT']), sourceId: objectId.optional() }).strict(),
  ]).parse(req.body)
  if (body.type === 'GROUP') {
    if (!can(req.auth, CHAT_CREATE)) throw forbidden('Your role cannot start chats.', { missing: [CHAT_CREATE] })
    return res.status(201).json({ data: await createGroup(body, req.auth) })
  }
  if (!can(req.auth, CHAT_MANAGE)) throw forbidden('Setting up department and whole-staff chats needs “Moderate” on Staff chat.', { missing: [CHAT_MANAGE] })
  if (body.type === 'DEPARTMENT' && !body.sourceId) throw badRequest('Pick the department.')
  return res.status(201).json({ data: await createAutoChannel(body, req.auth, req) })
})
chat.get('/people', requirePermission(CHAT_VIEW), async (req, res) => {
  const { search } = z.object({ search: optionalText(60) }).parse(req.query)
  res.json({ data: await people(search, req.auth) })
})
chat.get('/direct/:userId', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await findDirect(idParam(req.params.userId), req.auth) }) })
// make the direct chat now (before its first message), so a file can be attached to it
chat.post('/direct/:userId', requirePermission(CHAT_CREATE), async (req, res) => { res.json({ data: await openDirect(idParam(req.params.userId), req.auth) }) })
chat.get('/search', requirePermission(CHAT_VIEW), async (req, res) => {
  const q = z.object({ q: z.string().trim().min(2, 'Type at least 2 letters').max(100), channelId: objectId.optional() }).parse(req.query)
  res.json({ data: await searchMessages(q, req.auth) })
})
chat.get('/sources', requirePermission(CHAT_MANAGE), async (req, res) => { res.json({ data: await chatSources(req.auth) }) })
chat.get('/settings', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await getChatSettings() }) })
chat.put('/settings', requirePermission(CHAT_MANAGE), async (req, res) => {
  const body = z.object({ announcementsOnly: z.boolean().optional(), retentionDays: z.coerce.number().int().min(0).max(3650).optional() }).strict().parse(req.body)
  res.json({ data: await saveChatSettings(body, req) })
})

chat.get('/channels/:id', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await getChannel(idParam(req.params.id), req.auth) }) })
chat.patch('/channels/:id', requirePermission(CHAT_VIEW), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2, 'Name the group').max(CHAT_GROUP_NAME_MAX).optional(), description: z.string().trim().max(300).optional() }).strict().parse(req.body)
  res.json({ data: await updateChannel(idParam(req.params.id), body, req.auth, req) })
})
chat.patch('/channels/:id/me', requirePermission(CHAT_VIEW), async (req, res) => {
  const body = z.object({ muted: z.boolean().optional(), pinned: z.boolean().optional(), notify: z.enum(CHAT_NOTIFY_LEVELS.map((n) => n.value)).optional() }).strict().parse(req.body)
  res.json({ data: await updateMyPrefs(idParam(req.params.id), body, req.auth) })
})
chat.get('/channels/:id/members', requirePermission(CHAT_VIEW), async (req, res) => {
  const { search } = z.object({ search: optionalText(60) }).parse(req.query)
  res.json({ data: await listMembers(idParam(req.params.id), { search }, req.auth) })
})
chat.post('/channels/:id/members', requirePermission(CHAT_VIEW), async (req, res) => {
  const { userIds } = z.object({ userIds: z.array(objectId).min(1, 'Pick someone to add').max(CHAT_GROUP_MAX_MEMBERS) }).strict().parse(req.body)
  res.json({ data: await addMembers(idParam(req.params.id), userIds, req.auth, req) })
})
chat.patch('/channels/:id/members/:userId', requirePermission(CHAT_VIEW), async (req, res) => {
  const { role } = z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).strict().parse(req.body)
  res.json({ data: await setMemberRole(idParam(req.params.id), idParam(req.params.userId), role, req.auth) })
})
chat.delete('/channels/:id/members/:userId', requirePermission(CHAT_VIEW), async (req, res) => {
  res.json({ data: await removeMember(idParam(req.params.id), idParam(req.params.userId), req.auth, req) })
})
chat.get('/channels/:id/messages', requirePermission(CHAT_VIEW), async (req, res) => {
  const q = z.object({ before: z.string().max(60).optional(), after: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query)
  res.json({ data: await listMessages(idParam(req.params.id), q, req.auth) })
})
// sending works over REST too (when the live connection is down)
chat.post('/channels/:id/messages', requirePermission(CHAT_CREATE), async (req, res) => {
  const body = sendSchema.parse({ ...(req.body ?? {}), channelId: idParam(req.params.id) })
  res.status(201).json({ data: await sendMessage(body, req.auth) })
})
chat.post('/direct/:userId/messages', requirePermission(CHAT_CREATE), async (req, res) => {
  const body = sendSchema.parse({ ...(req.body ?? {}), toUserId: idParam(req.params.userId) })
  res.status(201).json({ data: await sendMessage(body, req.auth) })
})
chat.post('/channels/:id/read', requirePermission(CHAT_VIEW), async (req, res) => {
  const { messageId } = z.object({ messageId: objectId.optional() }).strict().parse(req.body ?? {})
  res.json({ data: await markRead(idParam(req.params.id), { messageId }, req.auth) })
})
chat.get('/channels/:id/files', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await channelFiles(idParam(req.params.id), req.auth) }) })
// the file itself is the request body; it is attached to a message by id when that is sent
chat.post('/channels/:id/attachments', requirePermission(CHAT_CREATE), express.raw({ type: () => true, limit: `${FILE_MAX_MB}mb` }), async (req, res) => {
  let fileName = req.get('x-file-name') || 'file'
  try { fileName = decodeURIComponent(fileName) } catch { /* keep as sent */ }
  res.status(201).json({ data: await uploadAttachment(idParam(req.params.id), { fileName }, Buffer.isBuffer(req.body) ? req.body : null, req.auth, req) })
})

chat.patch('/messages/:id', requirePermission(CHAT_CREATE), async (req, res) => {
  const { text, mentions } = z.object({ text: z.string().max(CHAT_MESSAGE_MAX), mentions: z.array(objectId).max(50).default([]) }).strict().parse(req.body)
  res.json({ data: await editMessage(idParam(req.params.id), { text, mentions }, req.auth) })
})
chat.delete('/messages/:id', requirePermission(CHAT_VIEW), async (req, res) => { res.json({ data: await deleteMessage(idParam(req.params.id), req.auth, req) }) })
chat.post('/messages/:id/react', requirePermission(CHAT_VIEW), async (req, res) => {
  const { emoji } = z.object({ emoji: z.string().max(8) }).strict().parse(req.body)
  res.json({ data: await reactToMessage(idParam(req.params.id), emoji, req.auth) })
})
chat.post('/messages/:id/pin', requirePermission(CHAT_VIEW), async (req, res) => {
  const { pinned } = z.object({ pinned: z.boolean() }).strict().parse(req.body)
  res.json({ data: await pinMessage(idParam(req.params.id), pinned, req.auth) })
})

router.use('/chat', chat)

export default router
