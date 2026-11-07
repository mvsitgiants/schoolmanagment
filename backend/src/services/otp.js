import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { OtpChallenge } from '../models/engines.js'
import { getContext } from '../platform/context.js'
import { AppError, badRequest, conflict } from '../platform/errors.js'
import { isOid } from '../platform/db.js'
import { NO_EMAIL, NO_SMS, emailSender, sendCodeEmail, sendCodeSms, smsSender, testMode } from './codeDelivery.js'
import { isEmail, normalizeMobile } from './messaging.js'

// One-time codes that prove someone holds a mobile number (SMS) or an email address — for
// online booking (either, as the institution allows) and the self check-in kiosk (mobile only).
// Codes are stored hashed, live 10 minutes, allow five tries, and a number or address gets at
// most three codes in 15 minutes. A verified code turns into a short-lived pass for the next steps.

const VALID_MINUTES = 10
const MAX_SENDS = 3
const MAX_TRIES = 5
const PASS_MINUTES = 30
// own key, so a pass can never be mistaken for a staff sign-in token
const PASS_KEY = createHmac('sha256', config.jwtSecret).update('mobile-pass').digest()
const hash = (id, code) => createHmac('sha256', config.jwtSecret).update(`otp:${id}:${code}`).digest()

/** Send a code to a mobile number (a string or `{ mobile }`) or to `{ email }`. */
export async function sendOtp(target, purpose) {
  const raw = typeof target === 'string' ? { mobile: target } : target
  const email = raw.email != null ? String(raw.email).trim().toLowerCase() : null
  if (email != null && !isEmail(email)) throw badRequest('Enter a valid email address.', { fields: { email: 'Not valid' } })
  const mobile = email ? null : normalizeMobile(raw.mobile)
  if (!email && !mobile) throw badRequest('Enter a valid mobile number.', { fields: { mobile: 'Not valid' } })
  const who = email ? { email } : { mobile }
  const recent = await OtpChallenge.countDocuments({ ...who, createdAt: { $gte: new Date(Date.now() - 15 * 60_000) } })
  if (recent >= MAX_SENDS) throw new AppError(429, `Too many codes for this ${email ? 'address' : 'number'}. Try again in 15 minutes.`, { code: 'TOO_MANY' })
  // the institution's own SMS account or email, else the platform's (services/codeDelivery.js)
  const sender = email ? await emailSender() : await smsSender()
  if (sender.via === 'NONE') throw conflict(email ? NO_EMAIL : NO_SMS)
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const c = new OtpChallenge({ purpose, ...who, codeHash: '-', expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000) })
  c.codeHash = hash(String(c._id), code).toString('hex')
  await c.save()
  try {
    if (email) await sendCodeEmail(email, { code, minutes: VALID_MINUTES }, sender)
    else await sendCodeSms(mobile, { code, minutes: VALID_MINUTES }, sender)
  } catch (err) {
    await OtpChallenge.deleteOne({ _id: c._id })
    throw err
  }
  return {
    challengeId: String(c._id), channel: email ? 'EMAIL' : 'SMS', validMinutes: VALID_MINUTES,
    sentTo: email ? `${email.split('@')[0].slice(0, 2)}•••@${email.split('@')[1]}` : `•••••• ${mobile.slice(-4)}`,
    // demo institutions send SMS in test mode (nothing leaves the server): show the code on screen
    ...(testMode(sender) ? { testCode: code } : {}),
  }
}

/** Check a code. Returns the verified mobile (91XXXXXXXXXX) — for the kiosk, which is mobile only. */
export async function verifyOtp(challengeId, code, purpose) {
  return (await checkOtp(challengeId, code, purpose)).mobile
}

/** Check a code. Returns what it proved: `{ mobile }` (91XXXXXXXXXX) or `{ email }`. */
export async function verifyOtpWho(challengeId, code, purpose) {
  const c = await checkOtp(challengeId, code, purpose)
  return c.email ? { email: c.email } : { mobile: c.mobile }
}

async function checkOtp(challengeId, code, purpose) {
  if (!isOid(challengeId)) throw badRequest('This code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' })
  // Claim the attempt atomically before comparing: reading `attempts`, adding one and saving let
  // parallel guesses all see the same count, so the 5-try limit didn't hold (portalAuth.js does
  // the same). Then use the code atomically too, so it can't be spent twice at the same moment.
  const now = new Date()
  const c = await OtpChallenge.findOneAndUpdate(
    { _id: challengeId, purpose, verifiedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_TRIES } },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean()
  if (!c) {
    const why = await OtpChallenge.findOne({ _id: challengeId, purpose }).select('expiresAt verifiedAt attempts').lean()
    if (why?.verifiedAt) throw conflict('This code was already used. Ask for a new one.')
    if (why && why.expiresAt > now) throw badRequest('Too many wrong tries. Ask for a new code.', { code: 'OTP_EXPIRED' })
    throw badRequest('This code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' })
  }
  const given = String(code ?? '').trim()
  if (!/^\d{6}$/.test(given) || !timingSafeEqual(hash(String(c._id), given), Buffer.from(c.codeHash, 'hex'))) {
    throw badRequest(`That code isn’t right. ${MAX_TRIES - c.attempts} tries left.`, { fields: { code: 'Wrong code' } })
  }
  const used = await OtpChallenge.updateOne({ _id: c._id, verifiedAt: null }, { $set: { verifiedAt: new Date() } })
  if (!used.modifiedCount) throw conflict('This code was already used. Ask for a new one.')
  return c
}

/** A signed, short-lived pass for a verified mobile in this institution. */
export const mobilePass = (mobile, purpose) => jwt.sign({ t: getContext().tenantId, m: mobile, p: purpose }, PASS_KEY, { expiresIn: `${PASS_MINUTES}m`, audience: 'mobile-pass' })

/** A pass for whatever was verified — `{ mobile }` or `{ email }` (verifyOtpWho). */
export const whoPass = (who, purpose) => jwt.sign({ t: getContext().tenantId, ...(who.email ? { e: who.email } : { m: who.mobile }), p: purpose }, PASS_KEY, { expiresIn: `${PASS_MINUTES}m`, audience: 'mobile-pass' })

/** What a pass was issued for — `{ mobile }` or `{ email }` — if it is valid for this institution and purpose. */
export function readWhoPass(token, purpose) {
  try {
    const c = jwt.verify(String(token ?? ''), PASS_KEY, { audience: 'mobile-pass' })
    if (c.t === String(getContext().tenantId) && c.p === purpose) return c.e ? { email: c.e } : { mobile: c.m }
  } catch { /* expired or forged */ }
  throw new AppError(400, 'Your check has expired. Get a new code and try again.', { code: 'PASS_EXPIRED' })
}

/** The mobile a pass was issued for, if it is valid for this institution and purpose. */
export function readMobilePass(token, purpose) {
  try {
    const c = jwt.verify(String(token ?? ''), PASS_KEY, { audience: 'mobile-pass' })
    if (c.t === String(getContext().tenantId) && c.p === purpose) return c.m
  } catch { /* expired or forged */ }
  // 400, not 401: a 401 makes the web app think the staff session ended
  throw new AppError(400, 'Your mobile check has expired. Verify your number again.', { code: 'PASS_EXPIRED' })
}
