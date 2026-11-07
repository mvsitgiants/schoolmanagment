import { config } from '../config.js'
import { PlatformSetting } from '../models/platform.js'
import { decrypt, encrypt } from '../platform/crypto.js'
import { getContext } from '../platform/context.js'
import { logger } from '../platform/logger.js'

// The platform's own settings (Superadmin › Settings): company details, outgoing email, sign-up.
// Read often (every sign-up, every email), so kept for 30 s; a save on this instance clears it.

const ID = 'platform'
const TTL_MS = 30_000
let cached = null // { at, row }

/** The code text the platform sends when an institution words nothing itself; must match the DLT template. */
export const PLATFORM_SMS_TEXT = '{{code}} is your {{institution}} code. It is valid for {{minutes}} minutes. Do not share it.'
// changing any of these means the last test SMS no longer proves it works
const SMS_FIELDS = ['provider', 'senderId', 'authKey', 'route', 'otpTemplateId', 'otpText']

// changing any of these means the last test send no longer proves email works
const TRANSPORT_FIELDS = ['host', 'port', 'secure', 'user', 'pass', 'fromEmail']

export async function getPlatformSettings() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.row
  const row = (await PlatformSetting.findById(ID).lean()) ?? { _id: ID, company: {}, email: {} }
  cached = { at: Date.now(), row }
  return row
}

export const forgetPlatformSettings = () => { cached = null }

/** Self sign-up is open: the console switch, else the SIGNUP_ENABLED default. */
export async function signupOpen() {
  const s = await getPlatformSettings()
  return s.signupEnabled ?? config.signupEnabled
}

/** Outgoing email is set up and a test send has gone through since it last changed. */
export async function emailReady() {
  const e = (await getPlatformSettings()).email ?? {}
  return !!(e.host && e.fromEmail && e.verifiedAt)
}

/**
 * The platform can send code SMS for institutions without their own: MSG91 set up and a test send
 * gone through since it last changed — or TEST, outside production (nothing is sent).
 */
export async function smsReady() {
  const s = (await getPlatformSettings()).sms ?? {}
  if (s.provider === 'TEST') return !config.isProd
  return s.provider === 'MSG91' && !!(s.senderId && s.msg91?.authKey && s.otpTemplateId && s.verifiedAt)
}

/** A test SMS went through: platform SMS counts as working until its settings change. */
export async function markSmsVerified() {
  await PlatformSetting.updateOne({ _id: ID }, { $set: { 'sms.verifiedAt': new Date() } }, { upsert: true })
  forgetPlatformSettings()
}

/** The platform's Razorpay keys are saved: institutions can pay subscription invoices online. */
export async function paymentsReady() {
  const r = (await getPlatformSettings()).razorpay ?? {}
  return !!(r.keyId && r.keySecret)
}

/** For the console: secrets replaced by "is it set". */
export function platformSettingsView(row) {
  const { pass, ...email } = row.email ?? {}
  const rz = row.razorpay ?? {}
  const sm = row.sms ?? {}
  return {
    company: row.company ?? {},
    email: { ...email, passSet: !!pass },
    razorpay: { keyId: rz.keyId ?? '', keySecretSet: !!rz.keySecret, webhookSecretSet: !!rz.webhookSecret },
    paymentsReady: !!(rz.keyId && rz.keySecret),
    sms: {
      provider: sm.provider ?? 'NONE', senderId: sm.senderId ?? '', route: sm.msg91?.route ?? '', authKeySet: !!sm.msg91?.authKey,
      otpTemplateId: sm.otpTemplateId ?? '', otpText: sm.otpText ?? '', defaultText: PLATFORM_SMS_TEXT, verifiedAt: sm.verifiedAt ?? null,
    },
    smsReady: sm.provider === 'TEST' ? !config.isProd : sm.provider === 'MSG91' && !!(sm.senderId && sm.msg91?.authKey && sm.otpTemplateId && sm.verifiedAt),
    testModeAllowed: !config.isProd,
    notice: { message: row.notice?.message ?? '', tone: row.notice?.tone ?? 'info', active: !!row.notice?.active, until: row.notice?.until ?? null },
    emailReady: !!(email.host && email.fromEmail && email.verifiedAt),
    signupEnabled: row.signupEnabled ?? config.signupEnabled,
    signupDefault: config.signupEnabled,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/** Save one or more sections. An empty SMTP password keeps the saved one. */
export async function savePlatformSettings(input) {
  const current = await PlatformSetting.findById(ID).lean()
  const set = { updatedBy: getContext()?.userName }
  const unset = {}
  if (input.company) for (const [k, v] of Object.entries(input.company)) set[`company.${k}`] = v
  if (input.email) {
    const { pass, ...rest } = input.email
    for (const [k, v] of Object.entries(rest)) set[`email.${k}`] = v
    if (pass) set['email.pass'] = encrypt(pass)
    const before = current?.email ?? {}
    const changed = TRANSPORT_FIELDS.some((k) => (k === 'pass' ? !!pass : k in rest && (rest[k] ?? null) !== (before[k] ?? null)))
    if (changed) unset['email.verifiedAt'] = 1
  }
  if (input.sms) {
    const { authKey, route, ...rest } = input.sms
    const before = current?.sms ?? {}
    for (const [k, v] of Object.entries(rest)) set[`sms.${k}`] = v
    if (route !== undefined) set['sms.msg91.route'] = route
    if (authKey) set['sms.msg91.authKey'] = encrypt(authKey) // empty keeps the saved one
    const was = { ...before, route: before.msg91?.route }
    const changed = SMS_FIELDS.some((k) => (k === 'authKey' ? !!authKey : k in input.sms && (input.sms[k] ?? '') !== (was[k] ?? '')))
    if (changed) unset['sms.verifiedAt'] = 1
  }
  if ('signupEnabled' in input) set.signupEnabled = input.signupEnabled
  if (input.notice) for (const [k, v] of Object.entries(input.notice)) set[`notice.${k}`] = v
  if (input.razorpay) {
    const { keyId, keySecret, webhookSecret } = input.razorpay
    if (keyId !== undefined) set['razorpay.keyId'] = keyId
    if (keySecret) set['razorpay.keySecret'] = encrypt(keySecret) // empty keeps the saved one
    if (webhookSecret) set['razorpay.webhookSecret'] = encrypt(webhookSecret)
  }
  await PlatformSetting.updateOne({ _id: ID }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true })
  forgetPlatformSettings()
  logger.info({ by: set.updatedBy, sections: Object.keys(input) }, 'platform settings saved')
  return platformSettingsView(await getPlatformSettings())
}

/** A test send went through: email counts as working until its server settings change. */
export async function markEmailVerified() {
  await PlatformSetting.updateOne({ _id: ID }, { $set: { 'email.verifiedAt': new Date() } }, { upsert: true })
  forgetPlatformSettings()
}

/** The banner to show right now (Superadmin › Settings › Notice), or null. */
export async function currentNotice(now = new Date()) {
  const n = (await getPlatformSettings()).notice
  if (!n?.active || !n.message?.trim() || (n.until && new Date(n.until) < now)) return null
  return { message: n.message.trim(), tone: n.tone || 'info' }
}
