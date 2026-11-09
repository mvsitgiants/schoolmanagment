import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { Plan, Tenant } from '../models/platform.js'
import { loadAccess } from '../platform/access.js'
import { PASSWORD_RULE, hashPassword, hashToken, isStrongPassword } from '../platform/auth/tokens.js'
import { conflict, badRequest, forbidden } from '../platform/errors.js'
import { email, mobile, objectId, optionalText, z } from '../platform/validate.js'
import { config } from '../config.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { audit } from '../platform/audit.js'
import { User } from '../models/tenant.js'
import { provisionTenant } from '../services/provisioning.js'
import { currentNotice, emailReady, signupOpen } from '../services/platformSettings.js'
import { mailWelcome, sendPlatformMailNow } from '../services/platformMail.js'
import { getPlan } from '../services/subscription.js'
import { issueCode, maskEmail, reissueCode, verifyCode, verifyLink } from '../platform/auth/codes.js'
import { confirmEmailFrom } from '../services/users.js'
import { Types } from 'mongoose'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { buildMe, openTenantSession } from './auth.js'
import { verifyCertificate } from '../services/certificates.js'
import { verifyStudentCard } from '../services/students.js'
import { verifyReceipt } from '../services/fees.js'

const router = Router()

/** The maintenance / announcement banner (Superadmin › Settings), for the sign-in page and the app. */
router.get('/notice', async (req, res) => {
  res.json({ data: await currentNotice() })
})

/** Is this certificate genuine? The QR on every certificate opens /verify/<code>, which asks here. */
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 60, message: { message: 'Too many checks. Try again in a few minutes.' } })
router.get('/verify/certificate/:code', verifyLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: await verifyCertificate(req.params.code) })
})
/** A student ID card's QR: does the holder study here now? (name and class only — what the card shows) */
router.get('/verify/student/:code', verifyLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: await verifyStudentCard(req.params.code) })
})
/** A fee receipt's QR: is this receipt genuine and still valid? (receipt no, date, amount, whose) */
router.get('/verify/receipt/:code', verifyLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: await verifyReceipt(req.params.code) })
})

router.get('/plans', async (req, res) => {
  const plans = await Plan.find({ active: true, isPublic: true }).sort({ sortOrder: 1 }).lean()
  res.json({
    data: plans.map((p) => ({
      code: p.code, name: p.name, tagline: p.tagline, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly,
      modules: p.modules, limits: p.limits, features: p.features, highlight: p.highlight, trialDays: p.trialDays,
    })),
    meta: { signupEnabled: await signupOpen() },
  })
})

const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 10, message: { message: 'Too many sign-ups from this network. Try again later.' } })

const signupSchema = z.object({
  institutionName: z.string().trim().min(3, 'Enter your institution or clinic name').max(120),
  city: optionalText(80),
  name: z.string().trim().min(2, 'Enter your name').max(100),
  email,
  mobile: mobile,
  password: z.string(),
  planCode: z.string().min(1),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  website: z.string().max(200).optional(), // honeypot: hidden from people, filled in by bots
})
const signupCodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 20, message: { message: 'Too many tries. Try again in 15 minutes.' } })

const emailTaken = (mail) => runAsSystem(() => User.exists({ email: mail }).setOptions({ allTenants: true }))
const TAKEN = () => conflict('This email already has an account. Sign in instead — or contact us to add another institution.', { fields: { email: 'Already registered' } })

/** Create the institution and sign its new admin in (sign-up confirmed, or email not set up yet). */
async function finishSignup(req, res, p, { emailVerified }) {
  const { tenant, user } = await provisionTenant({
    institutionName: p.institutionName,
    planCode: p.planCode,
    billingCycle: p.billingCycle,
    admin: { name: p.name, email: p.email, mobile: p.mobile, password: p.password, passwordHash: p.passwordHash, emailVerifiedAt: emailVerified ? new Date() : undefined },
    profile: { city: p.city },
    createdVia: 'SIGNUP',
  })
  mailWelcome(user, tenant)
  await openTenantSession(res, req, user, tenant._id)
  const access = await loadAccess(tenant._id, user._id)
  res.status(201).json({ data: await buildMe({ ...access, tenantId: String(tenant._id) }) })
}

/**
 * Start a free trial. Once the platform can send email, nothing is created yet: a code goes to
 * the email and /signup/verify creates the institution, so a typo'd or someone else's address
 * never owns a workspace. Before that (a fresh install), the institution is created straight away.
 */
router.post('/signup', signupLimiter, async (req, res) => {
  if (!await signupOpen()) throw forbidden('Self sign-up is closed. Please contact us to get started.')
  const input = signupSchema.parse(req.body)
  // a bot filled the hidden field: answer like a real start, create and send nothing
  if (input.website) return res.json({ data: { needsCode: true, challengeId: String(new Types.ObjectId()), sentTo: maskEmail(input.email) } })
  if (!isStrongPassword(input.password)) throw badRequest(PASSWORD_RULE, { fields: { password: PASSWORD_RULE } })
  // someone who already has a login is signing up again (often for a second free trial): send them to sign in.
  // A real second institution for the same owner is opened by us (Superadmin › Institutions).
  if (await emailTaken(input.email)) throw TAKEN()
  await getPlan(input.planCode, { activeOnly: true })
  if (!await emailReady()) return finishSignup(req, res, input, { emailVerified: false })

  const { password, website, ...form } = input
  const { challengeId, code, validMinutes } = await issueCode({ purpose: 'SIGNUP', email: input.email, payload: { ...form, passwordHash: await hashPassword(password) } })
  await sendPlatformMailNow(input.email, 'signupCode', { name: input.name, code, minutes: validMinutes })
  res.json({ data: { needsCode: true, challengeId, sentTo: maskEmail(input.email) } })
})

router.post('/signup/verify', signupCodeLimiter, async (req, res) => {
  const { challengeId, code } = z.object({ challengeId: z.string().min(1), code: z.string().min(1, 'Enter the code') }).parse(req.body)
  const c = await verifyCode(challengeId, code, 'SIGNUP')
  if (await emailTaken(c.email)) throw TAKEN() // signed up twice from two tabs
  await finishSignup(req, res, { ...c.payload, email: c.email }, { emailVerified: true })
})

router.post('/signup/resend', signupCodeLimiter, async (req, res) => {
  const { challengeId } = z.object({ challengeId: z.string().min(1) }).parse(req.body)
  const { challenge: c, code } = await reissueCode(challengeId, 'SIGNUP')
  await sendPlatformMailNow(c.email, 'signupCode', { name: c.payload?.name ?? '', code, minutes: 10 })
  res.json({ data: { sentTo: maskEmail(c.email) } })
})

// public one-time links (confirm email, invites): 30 tries per 15 minutes per network, each its own count
function linkLimiter() {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 30, message: { message: 'Too many tries. Try again in 15 minutes.' } })
}

// ───────────────────────────────────────────────────────── "Confirm my email" link

/** The link in the confirmation email: works without signing in (it's often opened on a phone). */
router.post('/verify-email', linkLimiter(), async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body)
  const c = await verifyLink(token, 'VERIFY_EMAIL')
  const user = await confirmEmailFrom(c, req)
  res.json({ data: { verified: true, email: user.email } })
})

// ───────────────────────────────────────────────────────── invite links (services/users.js)

const inviteLimiter = linkLimiter()
const inviteSchema = z.object({ token: z.string().min(20).max(200) })

async function findInvite(token) {
  const user = await runAsSystem(() => User.findOne({ inviteTokenHash: hashToken(token), active: true }).setOptions({ allTenants: true }).lean())
  if (!user || !user.inviteExpiresAt || new Date(user.inviteExpiresAt) < new Date()) {
    throw badRequest('This invite link has expired or was already used. Ask your administrator to send a new one.', { code: 'INVITE_EXPIRED' })
  }
  return user
}

/** Who the invite is for, so the page can greet them before they choose a password. */
router.post('/invite/check', inviteLimiter, async (req, res) => {
  const user = await findInvite(inviteSchema.parse(req.body).token)
  const tenant = await Tenant.findById(user.tenantId).select('name profile.logoUrl').lean()
  res.json({ data: { name: user.name, email: user.email, institution: tenant?.name, logoUrl: tenant?.profile?.logoUrl } })
})

/** Choose a password from the invite and sign straight in (opening the emailed link proves the address). */
router.post('/invite/accept', inviteLimiter, async (req, res) => {
  const { token, password } = inviteSchema.extend({ password: z.string() }).parse(req.body)
  if (!isStrongPassword(password)) throw badRequest(PASSWORD_RULE, { fields: { password: PASSWORD_RULE } })
  const user = await findInvite(token)
  const done = await runAsTenant(user.tenantId, async () => User.updateOne(
    { _id: user._id, inviteTokenHash: hashToken(token) }, // used once, even if two tabs submit together
    { $set: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), mustChangePassword: false }, $unset: { inviteTokenHash: 1, inviteExpiresAt: 1, tempPasswordExpiresAt: 1 } },
  ))
  if (!done.modifiedCount) throw badRequest('This invite link was already used. Sign in with your password.', { code: 'INVITE_EXPIRED' })
  await runAsTenant(user.tenantId, async () => {
    Object.assign(getContext(), { userId: String(user._id), userName: user.name })
    await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary: `${user.name} accepted the invite and chose a password` }, req)
  })
  const access = await loadAccess(user.tenantId, user._id)
  if (BLOCKED_STATUSES.includes(effectiveStatus(access.tenant)) && !access.fullAccess) {
    // the password is set; they sign in once the institution renews
    return res.json({ data: { signedIn: false, message: `Your password is set. ${access.tenant.name}'s subscription is paused right now, so you can sign in once your administrator renews it.` } })
  }
  await openTenantSession(res, req, user, user.tenantId)
  res.json({ data: { signedIn: true, me: await buildMe({ ...access, tenantId: String(user.tenantId) }) } })
})

export default router
