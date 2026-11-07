import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { AuthSession, PlatformUser, Tenant } from '../models/platform.js'
import { Role, User } from '../models/tenant.js'
import { bumpAccessVersion, loadAccess } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import {
  PASSWORD_RULE, REFRESH_COOKIE, checkPassword, clearAuthCookies, hashPassword, hashToken,
  isStrongPassword, newRefreshToken, setAuthCookies, signAccess,
} from '../platform/auth/tokens.js'
import { getContext, runAsSystem, runAsTenant } from '../platform/context.js'
import { assertNotLocked, clearFailedLogins, recordFailedLogin } from '../platform/auth/lockout.js'
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { PLATFORM_IDLE_MINUTES, authenticate, checkIdle, endSessions, tenantOnly } from '../platform/middleware.js'
import { pdfAvailable } from '../platform/pdf.js'
import { email, objectId, z } from '../platform/validate.js'
import { getSettings } from '../platform/settings.js'
import { PLATFORM_PERMISSIONS, SUPPORTED_LANGUAGES, platformCan } from '@schoolgiant/shared'
import { logPlatform } from '../services/platformAudit.js'
import { config } from '../config.js'
import { effectiveStatus, subscriptionSummary } from '../services/subscription.js'
import { mailPasswordChanged, sendPlatformMail, sendPlatformMailNow } from '../services/platformMail.js'
import { emailReady } from '../services/platformSettings.js'
import { confirmEmailFrom } from '../services/users.js'
import { issueCode, maskEmail, reissueCode, verifyCode } from '../platform/auth/codes.js'

const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please wait 15 minutes and try again.', code: 'RATE_LIMITED' },
})

async function openSession(res, req, { kind, userId, tenantId }) {
  const refresh = newRefreshToken()
  const session = await AuthSession.create({
    kind, userId, tenantId,
    refreshHash: hashToken(refresh),
    userAgent: req.get('user-agent')?.slice(0, 300),
    ip: req.ip,
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5),
  })
  const claims = kind === 'PLATFORM'
    ? { sub: String(userId), sid: String(session._id), sa: true }
    : { sub: String(userId), sid: String(session._id), tid: String(tenantId) }
  setAuthCookies(res, { access: signAccess(claims), refresh })
  return session
}

/** Sign an institution user in on this response (login, sign-up). */
export const openTenantSession = (res, req, user, tenantId) => openSession(res, req, { kind: 'TENANT', userId: user._id, tenantId })

const accessClaims = (session) => (session.kind === 'PLATFORM'
  ? { sub: String(session.userId), sid: String(session._id), sa: true }
  : { sub: String(session.userId), sid: String(session._id), tid: String(session.tenantId) })

/**
 * Why an institution user can't be signed in right now because of the subscription, or null.
 * Admins may still come in while it is stopped — only to renew; everyone else waits for them.
 * Checked at sign-in and again at every refresh, so a stopped institution doesn't run on for 30 days.
 */
async function subscriptionBlock(tenant, hasFullAccess) {
  const status = effectiveStatus(tenant)
  if (status === 'CANCELLED') return 'This institution workspace has been closed.'
  if (['SUSPENDED', 'TRIAL_EXPIRED'].includes(status) && !(await hasFullAccess())) {
    return `${tenant.name}'s subscription is not active right now. Please ask your institution administrator to renew it.`
  }
  return null
}

/**
 * Sign-in events for the institution's audit log (who, from where). `actor` names who acted when it
 * wasn't the account holder (a failed attempt, the system). Never blocks the request.
 */
async function auditSignIn(tenantId, user, action, summary, req, { actor } = {}) {
  await runAsTenant(tenantId, async () => {
    Object.assign(getContext(), actor ? { userId: null, userName: actor } : { userId: String(user._id), userName: user.name })
    await audit({ action, module: 'core', entityType: 'user', entityId: String(user._id), entityName: user.name, summary }, req)
  }).catch((err) => logger.warn({ err, action }, 'sign-in audit failed'))
}

/** The console profile: role and what it may change (shared PLATFORM_ROLES). */
function platformProfile(owner) {
  const role = owner.role || 'OWNER'
  return {
    kind: 'PLATFORM', superadmin: true, permissions: ['*'], idleMinutes: PLATFORM_IDLE_MINUTES,
    user: { id: String(owner._id), name: owner.name, email: owner.email, mustChangePassword: !!owner.mustChangePassword },
    platformRole: role, platformPermissions: PLATFORM_PERMISSIONS.filter((p) => platformCan(role, p)),
  }
}

/** Active logins with this email at other institutions (the same person, by email). */
function otherInstitutionLogins(mail, tenantId, { exists = false } = {}) {
  const filter = { email: mail, active: true, tenantId: { $ne: tenantId } }
  return runAsSystem(() => (exists ? User.exists(filter) : User.find(filter).select('tenantId').lean()).setOptions({ allTenants: true }))
}

/** The signed-in profile the web app keeps (role, permissions, modules, subscription). */
export async function buildMe(auth) {
  if (auth.superadmin) return platformProfile(auth.user)
  const t = auth.tenant
  // institution-wide language defaults (core settings); never block sign-in on them
  const core = await runAsTenant(t._id, () => getSettings('core')).catch(() => ({}))
  return {
    kind: 'TENANT',
    superadmin: false,
    user: {
      id: String(auth.user._id), name: auth.user.name, email: auth.user.email, mobile: auth.user.mobile,
      designation: auth.user.designation, mustChangePassword: !!auth.user.mustChangePassword,
      branchId: auth.user.branchId ? String(auth.user.branchId) : null,
      language: auth.user.language || null,
      emailVerified: !!auth.user.emailVerifiedAt,
      twoStep: !!auth.user.twoStep,
      twoStepRequired: !!auth.require2fa, // one of their roles asks for a code at every sign-in
    },
    roles: auth.roles,
    fullAccess: auth.fullAccess,
    permissions: auth.permissions,
    dataScopes: auth.dataScopes,
    limits: auth.limits,
    homePage: auth.homePage,
    idleMinutes: auth.idleMinutes,
    enabledModules: auth.enabledModules,
    tenant: {
      id: String(t._id), name: t.name, slug: t.slug,
      profile: {
        logoUrl: t.profile?.logoUrl, primaryColor: t.profile?.primaryColor, sidebarColor: t.profile?.sidebarColor,
        timezone: t.profile?.timezone, currency: t.profile?.currency, dateFormat: t.profile?.dateFormat,
      },
      defaultLanguage: core.defaultAppLanguage || 'en',
      enabledLanguages: Array.isArray(core.enabledLanguages) ? core.enabledLanguages : null,
    },
    subscription: await subscriptionSummary(t),
    // server features the screens adapt to (PDF download needs Gotenberg — platform/pdf.js)
    // email: the platform can send codes and invites (Superadmin › Settings)
    features: { pdf: pdfAvailable(), email: await emailReady() },
    // the same email has a login at another institution: the menu offers "Switch institution"
    otherInstitutions: !!(await otherInstitutionLogins(auth.user.email, t._id, { exists: true })),
  }
}

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
  tenantId: objectId.optional(),
})

async function finishPlatformSignIn(res, req, owner, { viaCode = false } = {}) {
  await openSession(res, req, { kind: 'PLATFORM', userId: owner._id })
  await PlatformUser.updateOne({ _id: owner._id }, { $set: { lastLoginAt: new Date() } })
  logPlatform({ actor: owner, action: viaCode ? 'Signed in with an emailed code' : 'Signed in', method: 'POST', path: req.originalUrl, status: 200, ip: req.ip })
  res.json({ data: platformProfile(owner) })
}

async function finishTenantSignIn(res, req, user, { viaCode = false, switchedFrom } = {}) {
  await openSession(res, req, { kind: 'TENANT', userId: user._id, tenantId: user.tenantId })
  await runAsTenant(user.tenantId, () => User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }))
  const how = [viaCode && 'with an emailed code', switchedFrom && `(switched from ${switchedFrom})`].filter(Boolean).join(' ')
  await auditSignIn(user.tenantId, user, 'LOGIN', `${user.name} signed in${how ? ` ${how}` : ''}`, req)
  const access = await loadAccess(user.tenantId, user._id)
  res.json({ data: await buildMe({ ...access, tenantId: String(user.tenantId) }) })
}

/** Second step: email a code instead of opening the session. The client answers with /login/code. */
async function askForCode(res, { kind, user, endsSessionId }) {
  const { challengeId, code, validMinutes } = await issueCode({ purpose: 'LOGIN', email: user.email, kind, userId: user._id, tenantId: user.tenantId, endsSessionId })
  await sendPlatformMailNow(user.email, 'loginCode', { name: user.name, code, minutes: validMinutes })
  res.json({ data: { needsCode: true, challengeId, sentTo: maskEmail(user.email) } })
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email: mail, password, tenantId } = loginSchema.parse(req.body)
  await assertNotLocked(mail)

  // 1 · platform owner — always a second step once the platform can send email
  const owner = await PlatformUser.findOne({ email: mail }).lean()
  if (owner?.active && await checkPassword(password, owner.passwordHash)) {
    await clearFailedLogins(mail)
    if (owner.mustChangePassword && owner.tempPasswordExpiresAt && new Date(owner.tempPasswordExpiresAt) < new Date()) {
      throw unauthorized('Your temporary password has expired. Ask a platform owner for a new one.')
    }
    if (config.platformLoginCodes && await emailReady()) return askForCode(res, { kind: 'PLATFORM', user: owner })
    logger.warn('platform owner signed in with a password only: email codes are off or outgoing email is not set up')
    return finishPlatformSignIn(res, req, owner)
  }

  // 2 · institution users with this email (one person can work at several institutions)
  const candidates = await runAsSystem(() => User.find({ email: mail, active: true }).setOptions({ allTenants: true }).lean())
  const matches = []
  for (const u of candidates) if (await checkPassword(password, u.passwordHash)) matches.push(u)
  const chosen = tenantId ? matches.filter((u) => String(u.tenantId) === tenantId) : matches
  if (!chosen.length) {
    await recordFailedLogin(mail)
    // a known account with the wrong password goes on that institution's log; an unknown email only to the server log
    const targets = candidates.filter((u) => !tenantId || String(u.tenantId) === tenantId)
    for (const u of targets) await auditSignIn(u.tenantId, u, 'LOGIN_FAILED', `Wrong password for ${u.name}`, req, { actor: 'Sign-in attempt' })
    if (owner) logPlatform({ actor: owner, action: 'Sign-in failed (wrong password)', method: 'POST', path: req.originalUrl, status: 401, ip: req.ip })
    if (!targets.length && !owner) logger.info({ ip: req.ip }, 'sign-in failed for an unknown email')
    throw unauthorized('Email or password is incorrect.')
  }
  await clearFailedLogins(mail)
  if (chosen.length === 1 && chosen[0].mustChangePassword && chosen[0].tempPasswordExpiresAt && new Date(chosen[0].tempPasswordExpiresAt) < new Date()) {
    throw unauthorized('Your temporary password has expired. Ask your administrator for a new one.')
  }
  if (chosen.length > 1) {
    const tenants = await Tenant.find({ _id: { $in: chosen.map((u) => u.tenantId) } }).select('name profile.logoUrl').lean()
    return res.json({ data: { needsTenant: true, tenants: tenants.map((t) => ({ id: String(t._id), name: t.name, logoUrl: t.profile?.logoUrl })) } })
  }
  const user = chosen[0]
  const tenant = await Tenant.findById(user.tenantId).lean()
  const roles = await runAsTenant(user.tenantId, () => Role.find({ _id: { $in: user.roleIds } }).lean())
  const block = await subscriptionBlock(tenant, () => roles.some((r) => r.fullAccess))
  if (block) throw forbidden(block)

  // a code after the password: a role asks for it, or the person turned it on themselves
  if (roles.some((r) => r.security?.require2fa) || user.twoStep) {
    if (await emailReady()) return askForCode(res, { kind: 'TENANT', user })
    logger.warn({ userId: String(user._id) }, 'two-step sign-in skipped: outgoing email is not set up')
  }
  await finishTenantSignIn(res, req, user)
})

const codeSchema = z.object({ challengeId: z.string().min(1), code: z.string().min(1, 'Enter the code') })

router.post('/login/code', loginLimiter, async (req, res) => {
  const { challengeId, code } = codeSchema.parse(req.body)
  const c = await verifyCode(challengeId, code, 'LOGIN')
  if (c.kind === 'PLATFORM') {
    const owner = await PlatformUser.findById(c.userId).lean()
    if (!owner?.active) throw forbidden('This account is not active.')
    return finishPlatformSignIn(res, req, owner, { viaCode: true })
  }
  const user = await runAsTenant(c.tenantId, () => User.findById(c.userId).lean())
  if (!user?.active) throw forbidden('This account is not active.')
  // still allowed in? (the code took a few minutes)
  const access = await loadAccess(user.tenantId, user._id)
  const block = await subscriptionBlock(access.tenant, () => access.fullAccess)
  if (block) throw forbidden(block)
  // reading the code proves the email
  if (!user.emailVerifiedAt) {
    await runAsTenant(user.tenantId, () => User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } }))
    await bumpAccessVersion(user.tenantId)
  }
  // switching institution: the session it came from ends now that this one opens
  if (c.endsSessionId) await endSessions({ _id: c.endsSessionId }, 'SWITCHED_INSTITUTION')
  await finishTenantSignIn(res, req, user, { viaCode: true })
})

router.post('/login/code/resend', loginLimiter, async (req, res) => {
  const { challengeId } = z.object({ challengeId: z.string().min(1) }).parse(req.body)
  const { challenge: c, code } = await reissueCode(challengeId, 'LOGIN')
  const who = c.kind === 'PLATFORM'
    ? await PlatformUser.findById(c.userId).select('name').lean()
    : await runAsTenant(c.tenantId, () => User.findById(c.userId).select('name').lean())
  await sendPlatformMailNow(c.email, 'loginCode', { name: who?.name ?? '', code, minutes: 10 })
  res.json({ data: { sentTo: maskEmail(c.email) } })
})

// ── forgotten password: an emailed code to a confirmed address. Platform owners are not
// included — their reset stays on the server, so a stolen mailbox alone can't take the platform.

const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many password resets from this network. Try again in 15 minutes.', code: 'RATE_LIMITED' } })
const resettable = (mail) => runAsSystem(() => User.find({ email: mail, active: true, emailVerifiedAt: { $ne: null } }).setOptions({ allTenants: true }).select('name email tenantId').lean())

router.post('/forgot', resetLimiter, async (req, res) => {
  const { email: mail } = z.object({ email }).parse(req.body)
  if (!await emailReady()) throw badRequest('Resetting a password by email isn’t available yet. Ask your institution administrator to reset it.')
  // the same answer whether or not the email has an account, so this can't be used to find out
  const { challengeId, code, validMinutes } = await issueCode({ purpose: 'RESET_PASSWORD', email: mail })
  if ((await resettable(mail)).length) sendPlatformMail(mail, 'resetCode', { code, minutes: validMinutes })
  res.json({ data: { challengeId, sentTo: maskEmail(mail) } })
})

router.post('/forgot/reset', resetLimiter, async (req, res) => {
  const { challengeId, code, password } = codeSchema.extend({ password: z.string() }).parse(req.body)
  if (!isStrongPassword(password)) throw badRequest(PASSWORD_RULE, { fields: { password: PASSWORD_RULE } })
  const c = await verifyCode(challengeId, code, 'RESET_PASSWORD')
  const users = await resettable(c.email)
  if (!users.length) throw badRequest('This code has expired. Ask for a new one.', { code: 'CODE_EXPIRED' })
  // one email, one person: every institution login on it gets the new password
  const passwordHash = await hashPassword(password)
  for (const u of users) {
    await runAsTenant(u.tenantId, () => User.updateOne({ _id: u._id }, {
      $set: { passwordHash, mustChangePassword: false },
      $unset: { tempPasswordExpiresAt: 1, inviteTokenHash: 1, inviteExpiresAt: 1 },
    }))
    await endSessions({ userId: u._id }, 'PASSWORD_RESET')
    await bumpAccessVersion(u.tenantId)
    await auditSignIn(u.tenantId, u, 'SECURITY', `${u.name} reset their password with an emailed code`, req)
  }
  await clearFailedLogins(c.email)
  mailPasswordChanged(users[0], req)
  res.json({ data: { message: 'Password changed. Sign in with your new password.' } })
})

// ── switching institution: the same email at another institution. That login's password is asked
// again (it can differ), and its sign-in code if its roles require one. The current session
// ends once the new one opens.

router.get('/institutions', authenticate, tenantOnly, async (req, res) => {
  const others = await otherInstitutionLogins(req.auth.user.email, req.auth.tenantId)
  const tenants = await Tenant.find({ _id: { $in: others.map((u) => u.tenantId) }, status: { $ne: 'CANCELLED' } }).select('name profile.logoUrl').sort({ name: 1 }).lean()
  res.json({ data: tenants.map((t) => ({ id: String(t._id), name: t.name, logoUrl: t.profile?.logoUrl })) })
})

router.post('/switch-tenant', loginLimiter, authenticate, tenantOnly, async (req, res) => {
  const { tenantId, password } = z.object({ tenantId: objectId, password: z.string().min(1, 'Enter your password') }).parse(req.body)
  if (tenantId === String(req.auth.tenantId)) throw badRequest('You are already in this institution.')
  const mail = req.auth.user.email
  await assertNotLocked(mail)
  const user = await runAsSystem(() => User.findOne({ email: mail, tenantId, active: true }).setOptions({ allTenants: true }).lean())
  // 400, not 401: a 401 makes the web app think this session ended
  if (!user || !await checkPassword(password, user.passwordHash)) {
    await recordFailedLogin(mail)
    throw badRequest('That password isn’t right for this institution.', { fields: { password: 'Not correct' } })
  }
  await clearFailedLogins(mail)
  if (user.mustChangePassword && user.tempPasswordExpiresAt && new Date(user.tempPasswordExpiresAt) < new Date()) {
    throw badRequest('Your temporary password for this institution has expired. Ask its administrator for a new one.')
  }
  const tenant = await Tenant.findById(tenantId).lean()
  const roles = await runAsTenant(tenantId, () => Role.find({ _id: { $in: user.roleIds } }).lean())
  const block = await subscriptionBlock(tenant, () => roles.some((r) => r.fullAccess))
  if (block) throw forbidden(block)
  if ((roles.some((r) => r.security?.require2fa) || user.twoStep) && await emailReady()) {
    return askForCode(res, { kind: 'TENANT', user, endsSessionId: req.auth.sessionId })
  }
  await endSessions({ _id: req.auth.sessionId }, 'SWITCHED_INSTITUTION')
  await finishTenantSignIn(res, req, user, { switchedFrom: req.auth.tenant.name })
})

// Two tabs (or a tab and the session watcher) can refresh at the same moment with the same
// token; the slower one arrives with the token the faster one just replaced. Inside this window
// that is a race and it gets a fresh access token (the browser already holds the new refresh
// cookie). After it, the replaced token is in someone else's hands: every session ends.
const ROTATE_GRACE_MS = 30_000

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (!token) throw unauthorized()
  const hash = hashToken(token)
  const ended = () => {
    clearAuthCookies(res)
    return unauthorized('Your session has ended. Please sign in again.')
  }

  let session = await AuthSession.findOne({ refreshHash: hash }).lean()
  let raced = false
  if (!session) {
    const replaced = await AuthSession.findOne({ prevRefreshHash: hash }).lean()
    if (!replaced || replaced.revokedAt || new Date(replaced.expiresAt) < new Date()) throw ended()
    if (Date.now() - new Date(replaced.rotatedAt) > ROTATE_GRACE_MS) {
      const n = await endSessions({ userId: replaced.userId }, 'REUSE_DETECTED')
      logger.warn({ userId: String(replaced.userId), sessionId: String(replaced._id), ip: req.ip, signedOut: n }, 'refresh token reused — all sessions ended')
      if (replaced.kind === 'TENANT') {
        const user = await runAsTenant(replaced.tenantId, () => User.findById(replaced.userId).select('name').lean())
        if (user) await auditSignIn(replaced.tenantId, user, 'SECURITY', `${user.name} was signed out of every device: an old sign-in token was used again`, req, { actor: 'System' })
      }
      throw ended()
    }
    session = replaced
    raced = true
  }
  if (session.revokedAt || new Date(session.expiresAt) < new Date()) throw ended()

  // the account and the subscription are checked again: a refresh must not outlive either
  if (session.kind === 'PLATFORM') {
    const owner = await PlatformUser.findById(session.userId).select('active').lean()
    if (!owner?.active) {
      await endSessions({ _id: session._id }, 'USER_INACTIVE')
      throw ended()
    }
    await checkIdle(req, session, PLATFORM_IDLE_MINUTES).catch((e) => { clearAuthCookies(res); throw e })
  } else {
    const access = await loadAccess(session.tenantId, session.userId)
    if (!access?.user?.active) {
      await endSessions({ userId: session.userId }, 'USER_INACTIVE')
      throw ended()
    }
    await checkIdle(req, session, access.idleMinutes).catch((e) => { clearAuthCookies(res); throw e })
    const block = await subscriptionBlock(access.tenant, () => access.fullAccess)
    if (block) {
      await endSessions({ _id: session._id }, 'SUBSCRIPTION_INACTIVE')
      clearAuthCookies(res)
      throw new AppError(402, block, { code: 'SUBSCRIPTION_INACTIVE' })
    }
  }

  if (raced) {
    setAuthCookies(res, { access: signAccess(accessClaims(session)) })
    return res.json({ data: { ok: true } })
  }
  // rotate only if nobody else rotated it since we read it; if someone did, this is the race above
  const refresh = newRefreshToken()
  const now = new Date()
  const rotated = await AuthSession.findOneAndUpdate(
    { _id: session._id, refreshHash: hash, revokedAt: null },
    { $set: { refreshHash: hashToken(refresh), prevRefreshHash: hash, rotatedAt: now, lastUsedAt: now } },
  )
  setAuthCookies(res, rotated ? { access: signAccess(accessClaims(session)), refresh } : { access: signAccess(accessClaims(session)) })
  res.json({ data: { ok: true } })
})

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (token) {
    const s = await AuthSession.findOne({ refreshHash: hashToken(token), revokedAt: null }).lean()
    if (s) {
      await endSessions({ _id: s._id }, 'LOGOUT')
      if (s.kind === 'TENANT') {
        const user = await runAsTenant(s.tenantId, () => User.findById(s.userId).select('name').lean())
        if (user) await auditSignIn(s.tenantId, user, 'LOGOUT', `${user.name} signed out`, req)
      }
    }
  }
  clearAuthCookies(res)
  res.json({ data: { ok: true } })
})

router.post('/logout-all', authenticate, async (req, res) => {
  const signedOut = await endSessions({ userId: req.auth.user._id }, 'LOGOUT_ALL')
  if (!req.auth.superadmin) await auditSignIn(req.auth.tenantId, req.auth.user, 'LOGOUT', `${req.auth.user.name} signed out of every device`, req)
  clearAuthCookies(res)
  res.json({ data: { ok: true, signedOut } })
})

router.get('/me', authenticate, async (req, res) => {
  res.json({ data: await buildMe(req.auth) })
})

const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code)

/** The signed-in staff user's own interface language (null = follow the institution default). */
router.patch('/me/language', authenticate, tenantOnly, async (req, res) => {
  const { language } = z.object({
    language: z.string().refine((c) => LANGUAGE_CODES.includes(c), 'Pick a supported language').nullable(),
  }).parse(req.body)
  await User.updateOne({ _id: req.auth.user._id }, language ? { $set: { language } } : { $unset: { language: 1 } })
  await bumpAccessVersion(req.auth.tenantId) // /me is built from the cached access profile
  res.json({ data: { language } })
})

/** Confirm your email address with an emailed code (needed for a personal code at sign-in and for password reset). */
router.post('/me/email/verify/start', authenticate, tenantOnly, async (req, res) => {
  if (!await emailReady()) throw badRequest('The platform can’t send email yet, so addresses can’t be confirmed.')
  const u = req.auth.user
  if (u.emailVerifiedAt) return res.json({ data: { verified: true } })
  const { challengeId, code, validMinutes, linkToken, linkHours } = await issueCode({ purpose: 'VERIFY_EMAIL', email: u.email, kind: 'TENANT', userId: u._id, tenantId: req.auth.tenantId, withLink: true })
  // the token rides in the fragment, so it never reaches a server log or a Referer header
  await sendPlatformMailNow(u.email, 'verifyEmail', { name: u.name, code, minutes: validMinutes, link: `${config.appUrl}/verify-email#${linkToken}`, hours: linkHours })
  res.json({ data: { challengeId, sentTo: maskEmail(u.email) } })
})

router.post('/me/email/verify', authenticate, tenantOnly, async (req, res) => {
  const { challengeId, code } = codeSchema.parse(req.body)
  const c = await verifyCode(challengeId, code, 'VERIFY_EMAIL')
  if (String(c.userId) !== String(req.auth.user._id)) throw badRequest('This code was sent for a different account. Ask for a new one.')
  await confirmEmailFrom(c, req)
  res.json({ data: { verified: true } })
})

/** Your own choice to get a code at every sign-in (a role may require it anyway). */
router.patch('/me/two-step', authenticate, tenantOnly, async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
  if (enabled && !req.auth.user.emailVerifiedAt) throw badRequest('Confirm your email address first.')
  if (enabled && !await emailReady()) throw badRequest('The platform can’t send email yet, so sign-in codes aren’t available.')
  await User.updateOne({ _id: req.auth.user._id }, { $set: { twoStep: enabled } })
  await bumpAccessVersion(req.auth.tenantId)
  await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(req.auth.user._id), entityName: req.auth.user.name, summary: `${req.auth.user.name} turned ${enabled ? 'on' : 'off'} sign-in codes` }, req)
  res.json({ data: { twoStep: enabled } })
})

router.get('/sessions', authenticate, async (req, res) => {
  const rows = await AuthSession.find({ userId: req.auth.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean()
  res.json({ data: rows.map((s) => ({ id: String(s._id), userAgent: s.userAgent, ip: s.ip, lastUsedAt: s.lastUsedAt, createdAt: s.createdAt, current: String(s._id) === req.auth.sessionId })) })
})

/** Sign one of your other devices out (the sessions list). This device signs out with /logout. */
router.delete('/sessions/:id', authenticate, async (req, res) => {
  const { id } = z.object({ id: objectId }).parse(req.params)
  if (id === req.auth.sessionId) throw badRequest('This is the device you are using — sign out from the menu instead.')
  const n = await endSessions({ _id: id, userId: req.auth.user._id }, 'SIGNED_OUT_REMOTELY')
  if (!n) throw notFound('Session')
  if (!req.auth.superadmin) await auditSignIn(req.auth.tenantId, req.auth.user, 'LOGOUT', `${req.auth.user.name} signed out one of their other devices`, req)
  res.json({ data: { ok: true } })
})

const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string() })

router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changeSchema.parse(req.body)
  if (!isStrongPassword(newPassword)) throw badRequest(PASSWORD_RULE, { fields: { newPassword: PASSWORD_RULE } })
  const Model = req.auth.superadmin ? PlatformUser : User
  const doc = await Model.findById(req.auth.user._id)
  if (!await checkPassword(currentPassword, doc.passwordHash)) throw badRequest('Your current password is not correct.', { fields: { currentPassword: 'Not correct' } })
  doc.passwordHash = await hashPassword(newPassword)
  if ('mustChangePassword' in doc) doc.mustChangePassword = false
  if ('tempPasswordExpiresAt' in doc) doc.tempPasswordExpiresAt = undefined
  await doc.save()
  // sign out every other device
  await endSessions({ userId: doc._id, _id: { $ne: req.auth.sessionId } }, 'PASSWORD_CHANGED')
  mailPasswordChanged(doc, req, { platform: !!req.auth.superadmin })
  if (!req.auth.superadmin) {
    await bumpAccessVersion(req.auth.tenantId)
    await audit({ action: 'UPDATE', module: 'core', entityType: 'user', entityId: String(doc._id), entityName: doc.name, summary: `${doc.name} changed their password` }, req)
  }
  res.json({ data: { message: 'Password changed. Other devices were signed out.' } })
})

export default router
