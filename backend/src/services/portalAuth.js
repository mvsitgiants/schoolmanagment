import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { PORTAL_OTP, PORTAL_SESSION_DAYS, maskMobile, mobile10, mobileVariants } from '@schoolgiant/shared'
import { config } from '../config.js'
import { PortalOtp, PortalSession } from '../models/portal.js'
import { Student } from '../models/students.js'
import { isOid } from '../platform/db.js'
import { AppError, conflict, unauthorized } from '../platform/errors.js'
import { sendCodeSms, smsSender, testMode } from './codeDelivery.js'

// Family sign-in for the parent & student app — a separate principal from staff, by design
// (ported from the hospital patient portal):
//
//   · A parent proves the mobile number on their child's record with a 6-digit code (crypto.randomInt),
//     kept only as an HMAC, valid 5 minutes, 5 tries, at most 3 codes per number and 20 per network
//     address in 15 minutes (plus the per-address limiters on the routes).
//   · Codes go through the school's own SMS account when it has one, else the platform's
//     (services/codeDelivery.js), so a new school can offer sign-in on day one.
//   · "Send me a code" answers the same whether or not the number is on a record: for an unknown
//     number a code is stored but never sent, so nobody can sign in with it.
//   · The session token has its OWN key and audience — a staff check (platform/auth/tokens.js
//     verifyAccess) can never accept it — and travels in its own cookie scoped to
//     /api/v1/family/<school>, so staff routes never see it.
//   · Who a session reaches is looked up on every request: every active student with a guardian on
//     that number; or, for a student's own sign-in (Settings › App › students get their own sign-in),
//     just that student.

export const FAMILY_COOKIE = 'sg_family'
const AUDIENCE = 'family-app'
const OTP_KEY = createHmac('sha256', config.jwtSecret).update('family-app:otp').digest()
const SESSION_KEY = createHmac('sha256', config.jwtSecret).update('family-app:session').digest()
const { digits: DIGITS, validMinutes: VALID_MINUTES, maxTries: MAX_TRIES, perMobile: PER_MOBILE, perIp: PER_IP, windowMinutes: WINDOW } = PORTAL_OTP

const hashCode = (id, code) => createHmac('sha256', OTP_KEY).update(`${id}:${code}`).digest()
const newCode = () => String(randomInt(0, 10 ** DIGITS)).padStart(DIGITS, '0')
const tooMany = (msg) => new AppError(429, msg, { code: 'TOO_MANY' })
const NO_SMS = 'This school can’t send sign-in codes yet. Please call the school office.'

/** Active students with a guardian on this number (a parent), oldest admission first. */
export const childrenOn = (ten) => Student.find({ status: 'ACTIVE', 'guardians.mobile': { $in: mobileVariants(ten) } }).sort({ admissionDate: 1, createdAt: 1 }).limit(10).lean()
/** An active student whose own mobile this is (a student's own sign-in). */
export const studentOn = (ten) => Student.findOne({ status: 'ACTIVE', mobile: { $in: mobileVariants(ten) } }).lean()

/** Who a number signs in as: { kind, students } — a parent's children, a student themself, or nobody. */
async function whoIs(ten, { studentLogins }) {
  const children = await childrenOn(ten)
  if (children.length) return { kind: 'PARENT', students: children }
  if (studentLogins) {
    const s = await studentOn(ten)
    if (s) return { kind: 'STUDENT', students: [s] }
  }
  return { kind: null, students: [] }
}

/** Send a sign-in code. The reply doesn't say whether the number is on a record. */
export async function sendFamilyCode(rawMobile, { ip, studentLogins }) {
  const mobile = mobile10(rawMobile)
  if (!mobile) throw new AppError(400, 'Enter a 10-digit mobile number.', { details: { fields: { mobile: 'Not valid' } } })
  const since = new Date(Date.now() - WINDOW * 60_000)
  if (await PortalOtp.countDocuments({ mobile, createdAt: { $gte: since } }) >= PER_MOBILE) throw tooMany(`Too many codes for this number. Try again in ${WINDOW} minutes.`)
  if (ip && await PortalOtp.countDocuments({ ip, createdAt: { $gte: since } }) >= PER_IP) throw tooMany(`Too many codes asked from this network. Try again in ${WINDOW} minutes.`)
  // asked before looking the number up, so the answer is the same either way
  const sender = await smsSender()
  if (sender.via === 'NONE') throw conflict(NO_SMS)
  const known = (await whoIs(mobile, { studentLogins })).kind !== null
  const code = newCode()
  const otp = new PortalOtp({ mobile, ip, codeHash: '-', expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000) })
  otp.codeHash = hashCode(String(otp._id), known ? code : newCode()).toString('hex') // unknown: a code nobody is told
  await otp.save()
  if (known) {
    try {
      await sendCodeSms(mobile, { code, minutes: VALID_MINUTES }, sender)
    } catch (err) {
      await PortalOtp.deleteOne({ _id: otp._id })
      throw err
    }
  }
  return {
    challengeId: String(otp._id), sentTo: maskMobile(mobile), validMinutes: VALID_MINUTES, digits: DIGITS,
    // a school's channel in test mode (demo schools, never production) sends nothing: the code is shown
    // on screen. An unknown number is shown a code too — one that never works.
    ...(testMode(sender) ? { testCode: known ? code : newCode() } : {}),
  }
}

const expired = () => new AppError(400, 'This code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' })

/** Check a code: each try counted atomically first, a code works once. Returns the session and its token. */
export async function verifyFamilyCode(challengeId, code, { ip, userAgent, tenantId, studentLogins }) {
  if (!isOid(challengeId)) throw expired()
  const now = new Date()
  const c = await PortalOtp.findOneAndUpdate(
    { _id: challengeId, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_TRIES } },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean()
  if (!c) {
    const raw = await PortalOtp.findById(challengeId).lean()
    if (raw?.usedAt) throw conflict('This code was already used. Ask for a new one.')
    if (raw && raw.expiresAt > now) throw new AppError(400, 'Too many wrong tries. Ask for a new code.', { code: 'OTP_LOCKED' })
    throw expired()
  }
  const left = MAX_TRIES - c.attempts
  const wrong = () => new AppError(400, `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { code: 'OTP_WRONG', details: { fields: { code: 'Wrong code' } } })
  const given = String(code ?? '').trim()
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(given) || !timingSafeEqual(hashCode(String(c._id), given), Buffer.from(c.codeHash, 'hex'))) throw wrong()
  const who = await whoIs(c.mobile, { studentLogins })
  if (!who.kind) throw wrong()
  const used = await PortalOtp.updateOne({ _id: c._id, usedAt: null }, { $set: { usedAt: now } })
  if (!used.modifiedCount) throw conflict('This code was already used. Ask for a new one.')
  const session = await PortalSession.create({
    mobile: c.mobile, kind: who.kind, studentId: who.kind === 'STUDENT' ? who.students[0]._id : undefined,
    ip, userAgent: String(userAgent ?? '').slice(0, 200), expiresAt: new Date(Date.now() + PORTAL_SESSION_DAYS * 864e5), lastSeenAt: now,
  })
  const token = jwt.sign({ k: 'FAMILY', tid: String(tenantId), sid: String(session._id) }, SESSION_KEY, { audience: AUDIENCE, expiresIn: `${PORTAL_SESSION_DAYS}d`, algorithm: 'HS256' })
  return { token, session: session.toObject(), students: who.students }
}

/** The signed-in family of this school and the students it may see (401 when there is none). */
export async function readFamilySession(token, tenantId, { studentLogins }) {
  let claims = null
  try {
    claims = jwt.verify(String(token ?? ''), SESSION_KEY, { audience: AUDIENCE, algorithms: ['HS256'] })
  } catch { /* expired, forged or a staff token */ }
  if (!claims || claims.k !== 'FAMILY' || claims.tid !== String(tenantId) || !isOid(claims.sid)) throw unauthorized('Please sign in.')
  const session = await PortalSession.findById(claims.sid).lean()
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized('Your session has ended. Please sign in again.')
  let students
  if (session.kind === 'STUDENT') {
    if (!studentLogins) throw unauthorized('Student sign-in has been switched off. Please ask a parent to sign in.')
    const s = await Student.findOne({ _id: session.studentId, status: 'ACTIVE' }).lean()
    students = s && mobileVariants(session.mobile).includes(s.mobile) ? [s] : []
  } else {
    students = await childrenOn(session.mobile)
  }
  if (!students.length) throw unauthorized('Please sign in again.')
  if (!session.lastSeenAt || Date.now() - new Date(session.lastSeenAt) > 5 * 60_000) await PortalSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } })
  return { session, students }
}

export const endFamilySession = (sessionId) => PortalSession.updateOne({ _id: sessionId }, { $set: { revokedAt: new Date() } })

const cookiePath = (slug) => `/api/v1/family/${slug}`
const cookieOpts = (res, slug, extra = {}) => {
  const origin = res?.req?.get('origin') || ''
  const crossSite = origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')
  return crossSite ? { httpOnly: true, sameSite: 'none', secure: true, path: '/', ...extra } : { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: cookiePath(slug), ...extra }
}
export const setFamilyCookie = (res, slug, token) => res.cookie(FAMILY_COOKIE, token, cookieOpts(res, slug, { maxAge: PORTAL_SESSION_DAYS * 864e5 }))
export const clearFamilyCookie = (res, slug) => res.clearCookie(FAMILY_COOKIE, cookieOpts(res, slug))
