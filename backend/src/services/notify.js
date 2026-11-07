import {
  CHANNEL_LABEL, MESSAGE_CHANNELS, MESSAGE_STATUSES, NOTIFY_EVENTS, NOTIFY_EVENT_BY, langCodeFor, renderTemplate, unknownTemplateVars,
} from '@schoolgiant/shared'
import { config } from '../config.js'
import { translateDoc } from '../documents/engine.js'
import { MessageLog, MessagingConfig, Notification, NotificationRule } from '../models/engines.js'
import { Student, familyContact, studentName } from '../models/students.js'
import { Tenant } from '../models/platform.js'
import { audit } from '../platform/audit.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { encrypt } from '../platform/crypto.js'
import { clean, isOid, oid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { on } from '../platform/events.js'
import { getSetting } from '../platform/settings.js'
import { logger } from '../platform/logger.js'
import { emitToUser } from '../platform/realtime.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { channelConfig, deliver, isEmail, normalizeMobile } from './messaging.js'

// Notifications (docs/00 §7 E12):
//   · in-app — the bell, for staff (approvals waiting, decisions)
//   · family messages — SMS / WhatsApp / email to a student's guardian when an event
//     happens (absent today, fee received…), worded by the institution's rules.
// Messages go through the outbox (MessageLog): queued in the request, sent in the
// background, retried on failure, and every one is visible in the message log.

// ───────────────────────────────────────────────────────── in-app

/** Put a notification in each user's bell. Never throws. */
export async function notifyUsers(userIds, n) {
  const ids = [...new Set((userIds ?? []).map(String))].filter(isOid)
  if (!ids.length) return
  try {
    const rows = await Notification.insertMany(ids.map((userId) => ({ userId, ...n })))
    // the bell updates at once on every open device (its 30 s poll stays as the fallback)
    const tenantId = getContext()?.tenantId
    for (const r of rows) {
      emitToUser(tenantId, r.userId, 'notification:new', {
        id: String(r._id), event: r.event, title: r.title, message: r.message, link: r.link, tone: r.tone,
        entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt,
      })
    }
  } catch (err) {
    logger.warn({ err }, 'in-app notification failed')
  }
}

export async function inboxFor(userId, { limit = 20 } = {}) {
  const [items, unread] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId, readAt: null }),
  ])
  return { items: clean(items), unread }
}

export async function markRead(userId, ids) {
  const filter = { userId, readAt: null }
  if (ids?.length) filter._id = { $in: ids.filter(isOid).map(oid) }
  await Notification.updateMany(filter, { $set: { readAt: new Date() } })
}

// ───────────────────────────────────────────────────────── rules (wording per event)

const CHANNEL_FIELDS = {
  SMS: ['enabled', 'body', 'templateId'],
  WHATSAPP: ['enabled', 'body', 'templateName', 'language', 'params'],
  EMAIL: ['enabled', 'subject', 'body'],
}

function mergeRule(def, stored) {
  const channels = {}
  const customized = {}
  const fixed = def.fixed ?? []
  for (const { value: ch } of MESSAGE_CHANNELS) {
    const own = stored?.channels?.[ch]
    channels[ch] = { templateId: '', templateName: '', language: 'en', params: [], ...def.defaults[ch], ...(own ?? {}) }
    if (fixed.includes(ch)) channels[ch].enabled = true // can't be switched off (one-time codes)
    customized[ch] = !!own
  }
  return { event: def.event, module: def.module, label: def.label, when: def.when, vars: def.vars, fixed, channels, customized, updatedBy: stored?.updatedBy, updatedAt: stored?.updatedAt }
}

export async function listRules(enabledModules) {
  const stored = await NotificationRule.find().lean()
  const byEvent = new Map(stored.map((r) => [r.event, r]))
  return NOTIFY_EVENTS
    .filter((d) => !enabledModules || enabledModules.includes(d.module))
    .map((d) => mergeRule(d, byEvent.get(d.event)))
}

export async function ruleFor(event) {
  const def = NOTIFY_EVENT_BY[event]
  if (!def) return null
  return mergeRule(def, await NotificationRule.findOne({ event }).lean())
}

/** Save an event's channels. A channel set to null goes back to the default wording. */
export async function saveRule(event, channels, req) {
  const def = NOTIFY_EVENT_BY[event]
  if (!def) throw notFound('Notification event')
  const fields = {}
  const stored = (await NotificationRule.findOne({ event }).lean())?.channels ?? {}
  const next = { ...stored }
  for (const [ch, value] of Object.entries(channels)) {
    if (!CHANNEL_FIELDS[ch]) continue
    if (value === null) { delete next[ch]; continue }
    const keep = Object.fromEntries(Object.entries(value).filter(([k]) => CHANNEL_FIELDS[ch].includes(k)))
    if (def.fixed?.includes(ch)) keep.enabled = true
    for (const k of ['body', 'subject']) {
      const bad = unknownTemplateVars(keep[k], def.vars)
      if (bad.length) fields[`${ch}.${k}`] = `Unknown placeholder: {{${bad[0]}}}`
    }
    for (const p of keep.params ?? []) if (!def.vars.includes(p)) fields[`${ch}.params`] = `Unknown variable: ${p}`
    if (keep.enabled && !String(keep.body ?? def.defaults[ch].body).trim()) fields[`${ch}.body`] = 'Write the message'
    next[ch] = keep
  }
  if (Object.keys(fields).length) throw badRequest('Some messages are not valid.', { fields })
  const by = getContext()?.userName
  await NotificationRule.updateOne({ event }, { $set: { channels: next, updatedBy: by } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'core', entityType: 'notification_rule', entityId: event, entityName: def.label, summary: `Changed family messages for “${def.label}”` }, req)
  return ruleFor(event)
}

// ───────────────────────────────────────────────────────── delivery settings

const SECRETS = { SMS: [['http', 'apiKey'], ['msg91', 'authKey']], WHATSAPP: [['meta', 'token'], ['http', 'apiKey']], EMAIL: [['smtp', 'pass']] }
const SECTION = { SMS: 'sms', WHATSAPP: 'whatsapp', EMAIL: 'email' }

export async function messagingConfig() {
  return (await MessagingConfig.findOne().lean()) ?? { sms: { provider: 'NONE' }, whatsapp: { provider: 'NONE' }, email: { provider: 'NONE' } }
}

/** Config for the screen: secrets replaced by "is it set". */
export function maskConfig(cfg) {
  const out = {}
  for (const { value: ch } of MESSAGE_CHANNELS) {
    const sec = structuredClone(cfg?.[SECTION[ch]] ?? {})
    sec.provider ??= 'NONE'
    for (const [part, key] of SECRETS[ch]) {
      if (!sec[part]) continue
      sec[part][`${key}Set`] = !!sec[part][key]
      delete sec[part][key]
    }
    out[ch] = sec
  }
  return out
}

export async function saveChannelConfig(channel, input, req) {
  const section = SECTION[channel]
  if (!section) throw notFound('Channel')
  const current = (await MessagingConfig.findOne().lean())?.[section] ?? {}
  const next = { ...current, ...input }
  for (const [part, key] of SECRETS[channel]) {
    if (!input[part]) continue
    const given = input[part][key]
    next[part] = { ...(current[part] ?? {}), ...input[part] }
    // an empty secret means "keep the one already saved"
    next[part][key] = given ? encrypt(given) : current[part]?.[key]
  }
  await MessagingConfig.updateOne({}, { $set: { [section]: next, updatedBy: getContext()?.userName } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'core', entityType: 'messaging', entityId: channel, entityName: CHANNEL_LABEL[channel], summary: `${CHANNEL_LABEL[channel]} delivery set to ${next.provider}` }, req)
  return maskConfig(await messagingConfig())
}

// ───────────────────────────────────────────────────────── queueing

const DAY_FMT = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
/** '2026-10-07' → 'Tue, 7 Oct' */
export function humanDate(ymd) {
  const [y, m, d] = String(ymd ?? '').split('-').map(Number)
  return y && m && d ? DAY_FMT.format(Date.UTC(y, m - 1, d)) : ''
}

const CONSENT_KEY = { SMS: 'sms', WHATSAPP: 'whatsapp', EMAIL: 'email' }

const maskTo = (to, channel) => (channel === 'EMAIL'
  ? to.replace(/^(.)[^@]*(@.*)$/, (_, a, b) => `${a}•••${b}`)
  : `•••••${to.slice(-4)}`)

const addressOn = (channel, contact) => (channel === 'EMAIL'
  ? (isEmail(contact?.email) ? contact.email.trim() : null)
  : normalizeMobile(contact?.mobile))

/**
 * For a "Send to family" dialog, every channel: whether the institution has set it up (a provider
 * chosen), where the message would go (masked), why it can't go if it can't, and whether the
 * event's rule normally uses it.
 */
export async function channelOptions(event, studentId) {
  const [rule, student, cfg] = await Promise.all([ruleFor(event), Student.findById(studentId).lean(), messagingConfig()])
  if (!rule || !student) return []
  const contact = familyContact(student)
  return MESSAGE_CHANNELS.map(({ value: ch }) => {
    const setUp = (channelConfig(cfg, ch).provider ?? 'NONE') !== 'NONE'
    const to = addressOn(ch, contact)
    return { channel: ch, label: CHANNEL_LABEL[ch], setUp, to: to ? maskTo(to, ch) : null, reason: skipReason(cfg, ch, student, to), usual: !!rule.channels[ch]?.enabled }
  })
}

/** Why a message about this student on this channel can't go out, or null. */
function skipReason(cfg, channel, student, to) {
  if ((channelConfig(cfg, channel).provider ?? 'NONE') === 'NONE') return `${CHANNEL_LABEL[channel]} isn’t set up (Administration › Notification rules)`
  const consent = student?.consents?.communication?.[CONSENT_KEY[channel]]
  if (student && (channel === 'EMAIL' ? consent !== true : consent === false)) return `The family doesn’t want ${CHANNEL_LABEL[channel]} messages`
  if (!to) return channel === 'EMAIL' ? 'No email address for the family' : 'No valid mobile number for the family'
  return null
}

/**
 * A standard text in the family's language. Only texts the institution left as shipped are translated (keys
 * `notifications.events.<event>.<CHANNEL>.<field>` in the frontend locale files); an edited text is sent as written.
 */
function familyText(event, channel, field, text, lang) {
  if (!lang || lang === 'en' || !text) return text
  if (text !== NOTIFY_EVENT_BY[event]?.defaults?.[channel]?.[field]) return text
  return translateDoc(lang, `notifications.events.${event.replace(/\./g, '_')}.${channel}.${field}`, text)
}

async function institutionVars() {
  const t = await Tenant.findById(getContext()?.tenantId).lean()
  return { name: t?.name ?? '', phone: t?.profile?.phone ?? '' }
}

/**
 * Queue the messages one event sends. Usually about a student (the family's contact details and
 * consent apply); `to: { mobile, email }` sends to someone without a record — a one-time code
 * for a number being checked. `data.student.class` etc. come from the calling module.
 * Returns the MessageLog rows.
 */
export async function queueFamilyMessages(event, { studentId, to: direct, data = {}, entity, only, pick } = {}) {
  const rule = await ruleFor(event)
  if (!rule || (!studentId && !direct)) return []
  // `only`: just these of the rule's channels; `pick`: the channels staff ticked in "Send to family" —
  // sent even if the rule leaves them off for automatic sends
  const channels = MESSAGE_CHANNELS.map((c) => c.value).filter((ch) => (pick ? pick.includes(ch) : rule.channels[ch]?.enabled && (!only || only.includes(ch))))
  if (!channels.length) return []
  const student = studentId ? await Student.findById(studentId).lean() : null
  if (studentId && !student) return []
  const cfg = await messagingConfig()
  const lang = student?.language && (await getSetting('core', 'familyMessageLanguage')) !== false ? langCodeFor(student.language) : null
  const contact = student ? familyContact(student) : { mobile: direct.mobile, email: direct.email }
  const vars = {
    ...data,
    ...(student && {
      student: { name: studentName(student), firstName: student.firstName, admissionNo: student.admissionNo, ...data.student },
      guardian: { name: contact.name, ...data.guardian },
    }),
    institution: await institutionVars(),
  }
  const rows = []
  for (const channel of channels) {
    const r = rule.channels[channel]
    const to = addressOn(channel, contact)
    const reason = skipReason(cfg, channel, student, to)
    rows.push(await MessageLog.create({
      event, channel, to: to ?? undefined, studentId: student?._id, studentName: student ? studentName(student) : undefined,
      entityType: entity?.type, entityId: entity?.id ? String(entity.id) : undefined,
      subject: channel === 'EMAIL' ? renderTemplate(familyText(event, channel, 'subject', r.subject, lang), vars) : undefined,
      body: renderTemplate(familyText(event, channel, 'body', r.body, lang), vars),
      waTemplate: channel === 'WHATSAPP' && r.templateName ? { name: r.templateName, language: r.language || 'en', params: (r.params ?? []).map((p) => renderTemplate(`{{${p}}}`, vars)) } : undefined,
      templateId: channel === 'SMS' ? r.templateId || undefined : undefined,
      provider: channelConfig(cfg, channel).provider ?? 'NONE',
      status: reason ? 'SKIPPED' : 'QUEUED',
      reason: reason ?? undefined,
      createdBy: getContext()?.userName,
    }))
  }
  if (rows.some((m) => m.status === 'QUEUED')) kickOutbox()
  return rows
}

let registered = false
/** Family messages follow domain events (attendance.absent, fees.receipt…). */
export function registerNotificationListeners() {
  if (registered) return
  registered = true
  on('*', async (payload, event) => {
    if (NOTIFY_EVENT_BY[event] && getContext()?.tenantId) await queueFamilyMessages(event, payload)
  })
}

// ───────────────────────────────────────────────────────── sending (outbox)

const RETRY_MINUTES = [1, 5, 30]

async function sendOne(msg) {
  const cfg = await messagingConfig()
  const provider = channelConfig(cfg, msg.channel).provider ?? 'NONE'
  msg.provider = provider
  if (provider === 'NONE') {
    msg.status = 'SKIPPED'
    msg.reason = `${CHANNEL_LABEL[msg.channel]} isn’t set up (Administration › Notification rules)`
  } else {
    try {
      const { ref } = await deliver(cfg, msg)
      Object.assign(msg, { status: 'SENT', providerRef: ref, sentAt: new Date(), reason: undefined, nextAttemptAt: undefined })
    } catch (err) {
      const retryIn = RETRY_MINUTES[msg.attempts - 1]
      msg.reason = String(err?.message || err).slice(0, 300)
      if (retryIn && !msg.test) {
        msg.status = 'QUEUED'
        msg.nextAttemptAt = new Date(Date.now() + retryIn * 60_000)
      } else {
        msg.status = 'FAILED'
      }
    }
  }
  await msg.save()
  return msg
}

/** Send what is due, across all institutions. Safe to run in parallel with itself. */
export async function processOutbox({ limit = 50 } = {}) {
  return runAsSystem(async () => {
    // a crash mid-send leaves SENDING rows behind; give them another go
    await MessageLog.updateMany({ status: 'SENDING', updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }, { $set: { status: 'QUEUED' } }).setOptions({ allTenants: true })
    let sent = 0
    for (let i = 0; i < limit; i++) {
      const now = new Date()
      const msg = await MessageLog.findOneAndUpdate(
        { status: 'QUEUED', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
        { $set: { status: 'SENDING' }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      ).setOptions({ allTenants: true })
      if (!msg) break
      await runAsTenant(msg.tenantId, () => sendOne(msg))
      sent++
    }
    return sent
  })
}

let running = false
let again = false
/** Send queued messages soon, in the background (not in tests: they call processOutbox). */
export function kickOutbox() {
  if (!config.sendMessages) return
  if (running) { again = true; return }
  running = true
  setImmediate(async () => {
    try {
      do { again = false; await processOutbox() } while (again)
    } catch (err) {
      logger.error({ err }, 'outbox run failed')
    } finally {
      running = false
    }
  })
}

/** Send a test message now and return how it went. */
export async function sendTestMessage(channel, to, req) {
  const address = channel === 'EMAIL' ? (isEmail(to) ? to.trim() : null) : normalizeMobile(to)
  if (!address) throw badRequest(channel === 'EMAIL' ? 'Enter a valid email address.' : 'Enter a valid mobile number.', { fields: { to: 'Not valid' } })
  const inst = await institutionVars()
  const msg = await MessageLog.create({
    event: 'test', channel, to: address, test: true, status: 'SENDING', attempts: 1,
    subject: channel === 'EMAIL' ? `Test email from ${inst.name}` : undefined,
    body: `This is a test ${CHANNEL_LABEL[channel]} message from ${inst.name}. If you can read it, messages to families are set up correctly.`,
    createdBy: getContext()?.userName,
  })
  await sendOne(msg)
  await audit({ action: 'SEND', module: 'core', entityType: 'messaging', entityId: channel, entityName: CHANNEL_LABEL[channel], summary: `Test ${CHANNEL_LABEL[channel]} to ${address}: ${MESSAGE_STATUSES[msg.status]?.label}` }, req)
  return clean(msg.toObject())
}

export async function listMessages(q, paging) {
  const filter = {}
  if (q.status) filter.status = q.status
  if (q.channel) filter.channel = q.channel
  if (q.event) filter.event = q.event
  if (q.studentId && isOid(q.studentId)) filter.studentId = oid(q.studentId)
  if (q.from || q.to) {
    filter.createdAt = {}
    if (q.from) filter.createdAt.$gte = new Date(`${q.from}T00:00:00`)
    if (q.to) filter.createdAt.$lte = new Date(`${q.to}T23:59:59.999`)
  }
  if (paging.search) {
    const re = new RegExp(escapeRegex(paging.search), 'i')
    filter.$or = [{ to: re }, { studentName: re }, { body: re }]
  }
  const [rows, total, counts] = await Promise.all([
    MessageLog.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    MessageLog.countDocuments(filter),
    MessageLog.aggregate([{ $match: { createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  // one-time codes stay out of sight, even for administrators
  const res = listResponse(clean(rows).map((m) => (m.event === 'portal.otp' ? { ...m, body: m.body?.replace(/\d{4,8}/g, '••••••') } : m)), total, paging)
  res.meta.last7Days = Object.fromEntries(counts.map((c) => [c._id, c.n]))
  return res
}

/** Try a failed or skipped message again (after fixing the setup or the family's number). */
export async function retryMessage(id, req) {
  const msg = await MessageLog.findById(id)
  if (!msg) throw notFound('Message')
  if (!['FAILED', 'SKIPPED'].includes(msg.status)) throw conflict(`This message is ${MESSAGE_STATUSES[msg.status]?.label.toLowerCase()}.`)
  if (msg.studentId && !msg.test) {
    const student = await Student.findById(msg.studentId).lean()
    const to = addressOn(msg.channel, familyContact(student))
    const reason = skipReason(await messagingConfig(), msg.channel, student, to)
    if (reason) throw conflict(reason)
    msg.to = to
  }
  Object.assign(msg, { status: 'QUEUED', attempts: 0, nextAttemptAt: undefined, reason: undefined })
  await msg.save()
  await audit({ action: 'UPDATE', module: 'core', entityType: 'message', entityId: String(msg._id), entityName: `${CHANNEL_LABEL[msg.channel]} to ${msg.studentName ?? msg.to}`, summary: 'Sent a message again', studentId: msg.studentId }, req)
  kickOutbox()
  return clean(msg.toObject())
}
