import { Router } from 'express'
import { AUDIENCE_KINDS, CHAT_MAX, NOTICE_CATEGORIES, SEND_CHANNELS, SMS_MAX } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  deleteNotice, listBroadcasts, listNotices, moderate, myUnread, previewAudience, publishNotice, saveNotice, sendBroadcast, staffConversations,
  staffReply, staffStart, staffThread, withdrawNotice,
} from '../services/communication.js'
import { listMessages, retryMessage } from '../services/notify.js'

// Communication hub: /api/v1/communication/*
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('communication'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const id = (req) => objectId.parse(req.params.id)
const audience = z.object({
  kind: z.enum(AUDIENCE_KINDS.map((a) => a.value)).default('ALL'),
  classIds: z.array(objectId).max(60).default([]),
  sectionIds: z.array(objectId).max(300).default([]),
  studentIds: z.array(objectId).max(2000).default([]),
}).default({ kind: 'ALL' })
const channels = z.array(z.enum(SEND_CHANNELS)).max(3).default([])

router.post('/audience/preview', requirePermission('communication.notices.create', 'communication.messages.send'), async (req, res) => {
  res.json({ data: await previewAudience(audience.parse(req.body?.audience)) })
})

// ───────────────────────────────────────────────────────── notices

const noticeSchema = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(160),
  body: z.string().max(8000).default(''),
  category: z.enum(NOTICE_CATEGORIES).default('General'),
  audience,
  pinned: z.boolean().optional(),
  expiresOn: ymd.optional().or(z.literal('').transform(() => undefined)),
})
router.get('/notices', requirePermission('communication.notices.view'), async (req, res) => {
  const q = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'WITHDRAWN']).optional() }).parse(req.query)
  res.json(await listNotices(q, pageParams(req.query)))
})
router.post('/notices', requirePermission('communication.notices.create'), async (req, res) => {
  res.status(201).json({ data: await saveNotice(null, noticeSchema.parse(req.body), req.auth, req) })
})
router.patch('/notices/:id', requirePermission('communication.notices.edit'), async (req, res) => {
  res.json({ data: await saveNotice(id(req), noticeSchema.parse(req.body), req.auth, req) })
})
router.delete('/notices/:id', requirePermission('communication.notices.delete'), async (req, res) => {
  res.json({ data: await deleteNotice(id(req), req) })
})
router.post('/notices/:id/publish', requirePermission('communication.notices.publish'), async (req, res) => {
  res.json({ data: await publishNotice(id(req), z.object({ channels }).parse(req.body ?? {}), req.auth, req) })
})
router.post('/notices/:id/withdraw', requirePermission('communication.notices.publish'), async (req, res) => {
  res.json({ data: await withdrawNotice(id(req), req.auth, req) })
})

// ───────────────────────────────────────────────────────── one-off messages

router.get('/broadcasts', requirePermission('communication.messages.view'), async (req, res) => {
  res.json(await listBroadcasts(pageParams(req.query)))
})
router.post('/broadcasts', requirePermission('communication.messages.send'), async (req, res) => {
  const input = z.object({ subject: optionalText(120), text: z.string().trim().min(3, 'Write the message').max(2000), audience, channels: channels.refine((c) => c.length > 0, 'Pick at least one') })
    .refine((v) => !v.channels.includes('SMS') || v.text.length <= SMS_MAX, { message: `An SMS can be up to ${SMS_MAX} characters`, path: ['text'] })
    .parse(req.body)
  res.status(201).json({ data: await sendBroadcast(input, req.auth, req) })
})

// ───────────────────────────────────────────────────────── delivery log

router.get('/log', requirePermission('communication.log.view'), async (req, res) => {
  const q = z.object({
    status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(), channel: z.enum(SEND_CHANNELS).optional(),
    event: z.string().max(60).optional(), from: ymd.optional(), to: ymd.optional(), studentId: objectId.optional(),
  }).parse(req.query)
  res.json(await listMessages(q, pageParams(req.query)))
})
router.post('/log/:id/retry', requirePermission('communication.messages.send'), async (req, res) => {
  res.json({ data: await retryMessage(id(req), req) })
})

// ───────────────────────────────────────────────────────── parent–teacher chat

router.get('/chat', requirePermission('communication.chat.view'), async (req, res) => {
  const q = z.object({ all: z.enum(['1', 'true']).optional().transform((v) => !!v), search: optionalText(60) }).parse(req.query)
  res.json({ data: await staffConversations(req.auth, q) })
})
router.get('/chat/unread', requirePermission('communication.chat.view'), async (req, res) => {
  res.json({ data: await myUnread(req.auth) })
})
router.post('/chat/start', requirePermission('communication.chat.create'), async (req, res) => {
  const { studentId, text } = z.object({ studentId: objectId, text: z.string().trim().min(1).max(CHAT_MAX) }).parse(req.body)
  res.status(201).json({ data: await staffStart(studentId, text, req.auth, req) })
})
router.get('/chat/:id', requirePermission('communication.chat.view'), async (req, res) => {
  res.json({ data: await staffThread(id(req), req.auth) })
})
router.post('/chat/:id/reply', requirePermission('communication.chat.create'), async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1, 'Write something').max(CHAT_MAX) }).parse(req.body)
  res.json({ data: await staffReply(id(req), text, req.auth, req) })
})
router.post('/chat/:id/moderate', requirePermission('communication.chat.moderate'), async (req, res) => {
  const input = z.object({ messageId: objectId.optional(), close: z.boolean().optional() }).parse(req.body)
  res.json({ data: await moderate(id(req), input, req.auth, req) })
})

export default router
