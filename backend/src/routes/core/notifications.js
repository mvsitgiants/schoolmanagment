import { Router } from 'express'
import { GATEWAY_VARS, MESSAGE_CHANNELS, MESSAGE_PROVIDERS, MESSAGE_STATUSES, NOTIFY_EVENTS, templateVarHelp } from '@schoolgiant/shared'
import { requirePermission } from '../../platform/middleware.js'
import { optionalText, pageParams, z } from '../../platform/validate.js'
import { waitingCount } from '../../services/approvals.js'
import {
  inboxFor, listMessages, listRules, markRead, maskConfig, messagingConfig, retryMessage, saveChannelConfig, saveRule, sendTestMessage,
} from '../../services/notify.js'
import { subscriptionSummary } from '../../services/subscription.js'

const router = Router()
const CHANNELS = MESSAGE_CHANNELS.map((c) => c.value)

// ───────────────────────────────────────────────────────── the bell (every user)

/** Things that need this user: account alerts, approvals waiting, and their inbox. */
router.get('/notifications', async (req, res) => {
  const alerts = []
  const sub = await subscriptionSummary(req.auth.tenant)
  if (sub.banner && req.auth.fullAccess) alerts.push({ id: 'subscription', tone: sub.banner.tone, title: 'Subscription', message: sub.banner.text, link: '/core/subscription' })
  if (sub.openInvoice && req.auth.fullAccess) alerts.push({ id: 'invoice', tone: 'warning', title: `Invoice ${sub.openInvoice.number} is due`, message: 'Pay it to keep the workspace running without interruption.', link: '/core/subscription' })
  if (req.auth.user.mustChangePassword) alerts.push({ id: 'password', tone: 'warning', title: 'Change your temporary password', message: 'You signed in with a password someone else set.', link: '/me' })
  const waiting = await waitingCount(req.auth)
  if (waiting) alerts.push({ id: 'approvals', tone: 'warning', title: `${waiting} approval${waiting === 1 ? '' : 's'} waiting for you`, message: 'Requests your role can decide.', link: '/approvals' })
  const inbox = await inboxFor(req.auth.userId)
  res.json({ data: { alerts, items: inbox.items, unread: inbox.unread, approvalsWaiting: waiting } })
})

router.post('/notifications/read', async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {})
  await markRead(req.auth.userId, ids)
  res.json({ data: { ok: true } })
})

// ───────────────────────────────────────────────────────── delivery setup

// Delivery setup is also managed from Integrations › SMS & WhatsApp (same config, same screen part).
router.get('/messaging', requirePermission('core.notifications-setup.view', 'integrations.messaging.view'), async (req, res) => {
  res.json({ data: { config: maskConfig(await messagingConfig()), providers: MESSAGE_PROVIDERS, gatewayVars: GATEWAY_VARS } })
})

const keyValue = z.object({ name: z.string().trim().max(80), value: z.string().max(500).default('') })
const gateway = z.object({
  method: z.enum(['GET', 'POST']).default('POST'),
  url: z.string().trim().max(1000).default(''),
  bodyType: z.enum(['JSON', 'FORM']).default('JSON'),
  body: z.string().max(4000).default(''),
  headers: z.array(keyValue).max(10).default([]),
  apiKey: z.string().max(500).optional(),
})
const channelBody = {
  SMS: z.object({
    provider: z.enum(MESSAGE_PROVIDERS.SMS.map((p) => p.value)), senderId: optionalText(20), http: gateway.optional(),
    msg91: z.object({ authKey: z.string().max(200).optional(), route: z.enum(['1', '4']).default('4') }).optional(),
  }),
  WHATSAPP: z.object({
    provider: z.enum(MESSAGE_PROVIDERS.WHATSAPP.map((p) => p.value)),
    meta: z.object({ phoneNumberId: optionalText(40), apiVersion: optionalText(10), token: z.string().max(1000).optional() }).optional(),
    http: gateway.optional(),
  }),
  EMAIL: z.object({
    provider: z.enum(MESSAGE_PROVIDERS.EMAIL.map((p) => p.value)),
    smtp: z.object({ host: optionalText(200), port: z.coerce.number().int().min(1).max(65535).optional(), secure: z.boolean().default(false), user: optionalText(200), pass: z.string().max(500).optional(), from: optionalText(200) }).optional(),
  }),
}

router.put('/messaging/:channel', requirePermission('core.notifications-setup.edit', 'integrations.messaging.configure'), async (req, res) => {
  const channel = z.enum(CHANNELS).parse(req.params.channel)
  const input = channelBody[channel].parse(req.body)
  res.json({ data: await saveChannelConfig(channel, input, req) })
})

router.post('/messaging/:channel/test', requirePermission('core.notifications-setup.edit', 'integrations.messaging.configure'), async (req, res) => {
  const channel = z.enum(CHANNELS).parse(req.params.channel)
  const { to } = z.object({ to: z.string().trim().min(3, 'Enter where to send it').max(200) }).parse(req.body)
  res.json({ data: await sendTestMessage(channel, to, req) })
})

// ───────────────────────────────────────────────────────── message wording

router.get('/notification-rules', requirePermission('core.notifications-setup.view'), async (req, res) => {
  const rules = await listRules(req.auth.enabledModules)
  res.json({ data: { rules: rules.map((r) => ({ ...r, varHelp: Object.fromEntries(r.vars.map((v) => [v, templateVarHelp(v)])) })), channels: MESSAGE_CHANNELS } })
})

const ruleChannel = z.object({
  enabled: z.boolean(),
  body: z.string().max(2000).optional(),
  subject: z.string().max(200).optional(),
  templateId: z.string().trim().max(60).optional(),
  templateName: z.string().trim().max(120).optional(),
  language: z.string().trim().max(10).optional(),
  params: z.array(z.string()).max(10).optional(),
}).nullable()

router.put('/notification-rules/:event', requirePermission('core.notifications-setup.edit'), async (req, res) => {
  const event = z.enum(NOTIFY_EVENTS.map((e) => e.event)).parse(req.params.event)
  const { channels } = z.object({ channels: z.record(z.enum(CHANNELS), ruleChannel) }).parse(req.body)
  res.json({ data: await saveRule(event, channels, req) })
})

// ───────────────────────────────────────────────────────── message log

router.get('/messages', requirePermission('core.notifications-setup.view'), async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(MESSAGE_STATUSES)).optional(), channel: z.enum(CHANNELS).optional(), event: z.string().max(60).optional(),
    studentId: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
  }).parse(req.query)
  res.json(await listMessages(q, pageParams(req.query)))
})

router.post('/messages/:id/retry', requirePermission('core.notifications-setup.edit'), async (req, res) => {
  res.json({ data: await retryMessage(req.params.id, req) })
})

export default router
