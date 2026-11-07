import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { config } from '../../config.js'
import { AuthCode } from '../../models/platform.js'
import { isOid } from '../db.js'
import { AppError, badRequest, conflict } from '../errors.js'

// Emailed six-digit codes for staff and platform owners: the second sign-in step, proving an
// email address, and a forgotten password. The same rules as the patients' SMS codes
// (services/otp.js): stored hashed, 10 minutes, five tries claimed atomically, used once, and
// at most three codes per email and purpose in 15 minutes. The caller emails the code.

const VALID_MINUTES = 10
const LINK_HOURS = 24 // a link is clicked later than a code is typed
const MAX_SENDS = 3
const MAX_TRIES = 5
const RESEND_AFTER_MS = 60_000
const WINDOW_MS = 15 * 60_000
const hash = (id, code) => createHmac('sha256', config.jwtSecret).update(`authcode:${id}:${code}`).digest()
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
const tooMany = () => new AppError(429, 'Too many codes for this email. Try again in 15 minutes.', { code: 'TOO_MANY' })
const expired = () => badRequest('This code has expired. Ask for a new one.', { code: 'CODE_EXPIRED' })

/** "a•••@institution.com" — enough to recognise, not enough to harvest. */
export function maskEmail(email) {
  const [name, domain] = String(email ?? '').split('@')
  return domain ? `${name.slice(0, 1)}•••@${domain}` : '•••'
}

/** Start a code. Returns the challenge id (for the next request) and the code (to email). */
export async function issueCode({ purpose, email, kind, userId, tenantId, payload, endsSessionId, withLink = false }) {
  const recent = await AuthCode.aggregate([
    { $match: { email, purpose, createdAt: { $gte: new Date(Date.now() - WINDOW_MS) } } },
    { $group: { _id: null, sends: { $sum: '$sends' } } },
  ])
  if ((recent[0]?.sends ?? 0) >= MAX_SENDS) throw tooMany()
  const code = newCode()
  const c = new AuthCode({ purpose, email, kind, userId, tenantId, payload, endsSessionId, codeHash: '-', expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000) })
  c.codeHash = hash(String(c._id), code).toString('hex')
  // a link that does the same as typing the code (only its hash is kept)
  const linkToken = withLink ? randomBytes(32).toString('base64url') : undefined
  if (linkToken) Object.assign(c, { linkHash: linkHashOf(linkToken), linkExpiresAt: new Date(Date.now() + LINK_HOURS * 3600_000) })
  await c.save()
  return { challengeId: String(c._id), code, validMinutes: VALID_MINUTES, linkToken, linkHours: linkToken ? LINK_HOURS : undefined }
}

/** A fresh code on the same challenge (the first one didn't arrive). Returns the challenge and the code. */
export async function reissueCode(challengeId, purpose) {
  if (!isOid(challengeId)) throw expired()
  const c = await AuthCode.findOne({ _id: challengeId, purpose, usedAt: null }).lean()
  if (!c) throw expired()
  if (Date.now() - new Date(c.sentAt) < RESEND_AFTER_MS) throw new AppError(429, 'Please wait a minute before asking for another code.', { code: 'TOO_SOON' })
  if (c.sends >= MAX_SENDS) throw tooMany()
  const code = newCode()
  await AuthCode.updateOne({ _id: c._id }, {
    $set: { codeHash: hash(String(c._id), code).toString('hex'), attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000) },
    $inc: { sends: 1 },
  })
  return { challenge: c, code }
}

const linkHashOf = (token) => createHash('sha256').update(`authlink:${token}`).digest('hex')

/** Use up a link sent with a code (once, before it expires). Returns the challenge. */
export async function verifyLink(token, purpose) {
  const t = String(token ?? '')
  if (t.length < 20 || t.length > 200) throw badRequest('This link is incomplete. Open it from the email again.', { code: 'LINK_INVALID' })
  const c = await AuthCode.findOneAndUpdate(
    { linkHash: linkHashOf(t), purpose, usedAt: null, linkExpiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  ).lean()
  if (!c) throw badRequest('This link has expired or was already used. Send yourself a new one from your Account page.', { code: 'LINK_EXPIRED' })
  return c
}

/** Check a code and use it up. Returns the challenge (email, user, tenant). */
export async function verifyCode(challengeId, code, purpose) {
  if (!isOid(challengeId)) throw expired()
  const now = new Date()
  // claim the try before comparing, so parallel guesses can't all see the same count
  const c = await AuthCode.findOneAndUpdate(
    { _id: challengeId, purpose, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_TRIES } },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean()
  if (!c) {
    const why = await AuthCode.findOne({ _id: challengeId, purpose }).select('expiresAt usedAt').lean()
    if (why?.usedAt) throw conflict('This code was already used. Ask for a new one.')
    if (why && why.expiresAt > now) throw badRequest('Too many wrong tries. Ask for a new code.', { code: 'CODE_EXPIRED' })
    throw expired()
  }
  const given = String(code ?? '').trim()
  if (!/^\d{6}$/.test(given) || !timingSafeEqual(hash(String(c._id), given), Buffer.from(c.codeHash, 'hex'))) {
    throw badRequest(`That code isn’t right. ${MAX_TRIES - c.attempts} tries left.`, { fields: { code: 'Wrong code' } })
  }
  const used = await AuthCode.updateOne({ _id: c._id, usedAt: null }, { $set: { usedAt: new Date() } })
  if (!used.modifiedCount) throw conflict('This code was already used. Ask for a new one.')
  return c
}
