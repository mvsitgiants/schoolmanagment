import webpush from 'web-push'
import { config } from '../config.js'
import { PlatformSetting } from '../models/platform.js'
import { PushSubscription } from '../models/push.js'
import { getContext } from '../platform/context.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { isOid } from '../platform/db.js'
import { badRequest } from '../platform/errors.js'
import { logger } from '../platform/logger.js'

// Web push: phone / desktop notifications from the installed app (frontend public/push-sw.js shows them).
//   · staff — whatever lands in their bell (services/notify.js notifyUsers)
//   · families — the event messages they'd get by SMS / WhatsApp (services/notify.js queueFamilyMessages)
// Keys (VAPID): VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT from the environment, else a pair made once and kept
// in PlatformSetting (private half encrypted). Sending never throws; a subscription the browser has dropped (404 / 410)
// is deleted, others are retried on the next message and removed after 5 failures in a row. Tests record, never send.

let cached = null
async function vapid() {
  if (cached) return cached
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim()
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim()
  if (envPub && envPriv) cached = { publicKey: envPub, privateKey: envPriv }
  else {
    let s = await PlatformSetting.findById('platform').select('push').lean()
    if (!s?.push?.publicKey) {
      const k = webpush.generateVAPIDKeys()
      await PlatformSetting.updateOne({ _id: 'platform' }, { $set: { push: { publicKey: k.publicKey, privateKey: encrypt(k.privateKey) } } }, { upsert: true })
      s = await PlatformSetting.findById('platform').select('push').lean()
    }
    cached = { publicKey: s.push.publicKey, privateKey: decrypt(s.push.privateKey) }
  }
  return cached
}

/** The public key browsers subscribe with. */
export async function pushPublicKey() {
  return (await vapid()).publicKey
}

const subSchema = (sub) => {
  const endpoint = String(sub?.endpoint ?? '')
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !sub?.keys?.p256dh || !sub?.keys?.auth) throw badRequest('That isn’t a push subscription.')
  return { endpoint, keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } }
}

/** Save (or move to this person) a browser's subscription. who: { kind: 'STAFF', userId } | { kind: 'FAMILY', sessionId, studentIds } */
export async function savePushSubscription(sub, who, userAgent) {
  const s = subSchema(sub)
  await PushSubscription.findOneAndUpdate(
    { endpoint: s.endpoint },
    { $set: { ...s, kind: who.kind, userId: who.userId ?? null, sessionId: who.sessionId ?? null, studentIds: who.studentIds ?? undefined, userAgent: String(userAgent ?? '').slice(0, 200), failures: 0 } },
    { upsert: true },
  )
  return { on: true }
}

export async function removePushSubscription(endpoint) {
  if (endpoint) await PushSubscription.deleteOne({ endpoint: String(endpoint) })
  return { on: false }
}

/** A family app session ended: its browsers stop hearing about the children. */
export async function forgetFamilySession(sessionId) {
  if (isOid(sessionId)) await PushSubscription.deleteMany({ kind: 'FAMILY', sessionId })
}

const sent = [] // tests: what would have gone out
export const sentPushes = () => sent

async function sendAll(rows, payload) {
  if (!rows.length) return 0
  const keys = await vapid()
  const body = JSON.stringify(payload)
  let n = 0
  for (const r of rows) {
    if (config.isTest) { sent.push({ endpoint: r.endpoint, ...payload }); n++; continue }
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, body, {
        TTL: 6 * 3600, urgency: payload.urgent ? 'high' : 'normal',
        vapidDetails: { subject: process.env.VAPID_SUBJECT || `mailto:${config.supportEmail || 'support@schoolgiant.in'}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
      })
      await PushSubscription.updateOne({ _id: r._id }, { $set: { lastSentAt: new Date(), failures: 0 } })
      n++
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410 || (r.failures ?? 0) >= 4) await PushSubscription.deleteOne({ _id: r._id })
      else await PushSubscription.updateOne({ _id: r._id }, { $inc: { failures: 1 } })
      logger.debug({ err: err?.message, status: err?.statusCode }, 'push: not delivered')
    }
  }
  return n
}

/** Staff: the bell's notification on their phones / desktops too. payload: { title, body, url, tag } */
export async function pushToUsers(userIds, payload) {
  try {
    if (!getContext()?.tenantId || !userIds?.length) return 0
    const rows = await PushSubscription.find({ kind: 'STAFF', userId: { $in: userIds.filter(isOid) } }).lean()
    return await sendAll(rows, payload)
  } catch (err) {
    logger.warn({ err }, 'push to staff failed')
    return 0
  }
}

/** Families: an event about a student, to every family browser that may hear about them. */
export async function pushToFamilies(studentId, payload) {
  try {
    if (!getContext()?.tenantId || !isOid(studentId)) return 0
    const rows = await PushSubscription.find({ kind: 'FAMILY', studentIds: studentId }).lean()
    return await sendAll(rows, payload)
  } catch (err) {
    logger.warn({ err }, 'push to families failed')
    return 0
  }
}
