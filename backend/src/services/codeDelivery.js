import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { getContext } from '../platform/context.js'
import { AppError, conflict } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { renderTemplate } from '@schoolgiant/shared'
import { channelConfig, deliver, normalizeMobile } from './messaging.js'
import { messagingConfig, queueFamilyMessages } from './notify.js'
import { sendPlatformMailNow } from './platformMail.js'
import { PLATFORM_SMS_TEXT, emailReady, getPlatformSettings, markSmsVerified, smsReady } from './platformSettings.js'

// One-time codes by SMS or email (portal sign-in, online booking, the self check-in kiosk). A
// institution's own SMS account or email sends them when it has connected one (Integrations ›
// Messaging), with its own wording; otherwise the platform's does (Superadmin › Settings), so a
// new institution can use codes on day one.

export const NO_SMS = 'This institution can’t send SMS codes yet. Please call the institution.'
export const NO_EMAIL = 'This institution can’t send codes by email yet. Please call the institution.'

const institutionName = async () => {
  const tenantId = getContext()?.tenantId
  return (tenantId && (await Tenant.findById(tenantId).select('name').lean())?.name) || 'the institution'
}

/** Who would send a code email right now: { via: INSTITUTION | PLATFORM | NONE, provider }. */
export async function emailSender() {
  const provider = channelConfig(await messagingConfig(), 'EMAIL').provider ?? 'NONE'
  if (provider !== 'NONE') return { via: 'INSTITUTION', provider }
  return { via: await emailReady() ? 'PLATFORM' : 'NONE', provider: 'NONE' }
}

/** Send a code to an email address through `sender` (emailSender). Throws a readable 409 when it can't. */
export async function sendCodeEmail(email, { code, minutes }, sender) {
  if (sender.via === 'INSTITUTION') {
    const [m] = await queueFamilyMessages('portal.otp', { to: { email }, data: { otp: { code, minutes } }, pick: ['EMAIL'] })
    if (!m || m.status === 'SKIPPED') throw conflict(NO_EMAIL)
    return
  }
  if (sender.via !== 'PLATFORM') throw conflict(NO_EMAIL)
  await sendPlatformMailNow(email, 'portalCode', { institution: await institutionName(), code, minutes })
}

/** Who would send a code SMS right now: { via: INSTITUTION | PLATFORM | NONE, provider }. */
export async function smsSender() {
  const provider = channelConfig(await messagingConfig(), 'SMS').provider ?? 'NONE'
  if (provider !== 'NONE') return { via: 'INSTITUTION', provider }
  if (await smsReady()) return { via: 'PLATFORM', provider: (await getPlatformSettings()).sms?.provider }
  return { via: 'NONE', provider: 'NONE' }
}

/** A code shown on screen instead: the sender is in test mode, outside production. */
export const testMode = (sender) => !config.isProd && sender.provider === 'TEST'

const platformSmsConfig = (s) => ({ sms: { provider: s.provider, senderId: s.senderId, msg91: s.msg91 } })
const codeText = (s, vars) => renderTemplate(s.otpText?.trim() || PLATFORM_SMS_TEXT, vars)

/** Send a code to a mobile number through `sender` (smsSender). Throws a readable 409 when it can't. */
export async function sendCodeSms(rawMobile, { code, minutes }, sender) {
  if (sender.via === 'INSTITUTION') {
    // `pick`: by SMS whatever the rule's automatic channels are
    const [m] = await queueFamilyMessages('portal.otp', { to: { mobile: rawMobile }, data: { otp: { code, minutes } }, pick: ['SMS'] })
    if (!m || m.status === 'SKIPPED') throw conflict(NO_SMS)
    return
  }
  if (sender.via !== 'PLATFORM') throw conflict(NO_SMS)
  const s = (await getPlatformSettings()).sms ?? {}
  const institution = await institutionName()
  try {
    await deliver(platformSmsConfig(s), { channel: 'SMS', to: normalizeMobile(rawMobile), body: codeText(s, { code, minutes, institution }), templateId: s.otpTemplateId })
  } catch (err) {
    logger.warn({ err: err.message }, 'platform code SMS failed')
    // not a 5xx: the web app reads those as "server down"
    throw new AppError(409, 'We couldn’t send the SMS just now. Please try again in a minute.', { code: 'SMS_FAILED' })
  }
}

/** Superadmin › Settings: send a sample code with the saved account; success marks it working. */
export async function sendPlatformTestSms(rawMobile) {
  const to = normalizeMobile(rawMobile)
  if (!to) throw new AppError(400, 'Enter a valid mobile number.', { details: { fields: { to: 'Not valid' } } })
  const s = (await getPlatformSettings()).sms ?? {}
  if (!s.provider || s.provider === 'NONE') throw conflict('Choose an SMS provider and save first.')
  try {
    await deliver(platformSmsConfig(s), { channel: 'SMS', to, body: codeText(s, { code: '123456', minutes: 5, institution: 'Test Institution' }), templateId: s.otpTemplateId })
  } catch (err) {
    throw new AppError(400, `The SMS was not sent: ${err.message}`)
  }
  await markSmsVerified()
}
