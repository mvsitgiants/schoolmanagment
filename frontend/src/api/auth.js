import api, { setProfileListener } from './client'
import { hasPermissionIn } from '@schoolgiant/shared'
import { applyProfileLanguage } from '../i18n'

// The signed-in profile (GET /v1/auth/me) is kept in localStorage so menus and
// buttons can be gated synchronously. Tokens live in httpOnly cookies — JS never
// sees them. The profile is re-read on load, on focus and every minute (client.js),
// so a role or plan change made elsewhere reaches this browser on its own.

const USER_KEY = 'erp_user'
const REMEMBER_KEY = 'erp_remember_email'
export const USER_CHANGED_EVENT = 'erp:user-changed'

export const getRememberedEmail = () => localStorage.getItem(REMEMBER_KEY) || ''
export function setRememberedEmail(email) {
  if (email) localStorage.setItem(REMEMBER_KEY, email)
  else localStorage.removeItem(REMEMBER_KEY)
}

export function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}

const fingerprint = (u) => (u ? JSON.stringify([
  u.user?.id, u.user?.name, u.user?.mustChangePassword, u.permissions, u.enabledModules,
  u.roles?.map((r) => r.name), u.subscription?.status, u.subscription?.banner?.text, u.subscription?.plan?.code,
  u.tenant?.name, u.tenant?.profile, u.features, u.user?.emailVerified, u.user?.twoStep, u.user?.twoStepRequired, u.idleMinutes,
  u.platformRole, u.platformPermissions,
]) : '')

function storeUser(me) {
  const before = getCurrentUser()
  localStorage.setItem(USER_KEY, JSON.stringify(me))
  if (fingerprint(before) !== fingerprint(me)) window.dispatchEvent(new CustomEvent(USER_CHANGED_EVENT, { detail: me }))
  if (me?.kind === 'TENANT') applyProfileLanguage(me, before?.user?.id === me.user?.id ? before : null)
}

/** Save the signed-in staff user's interface language on their account (null = institution default). */
export async function saveMyLanguage(language) {
  await api.patch('/v1/auth/me/language', { language })
  const current = getCurrentUser()
  if (current?.user) localStorage.setItem(USER_KEY, JSON.stringify({ ...current, user: { ...current.user, language } }))
}

function applyProfile(body) {
  const me = body?.data
  const current = getCurrentUser()
  if (!me?.user?.id || !current) return // a late probe must not resurrect a signed-out user
  if (me.user.id !== current.user?.id) return
  storeUser(me)
}
setProfileListener(applyProfile)

/** Re-read role, permissions, modules and subscription from the server. */
export async function syncCurrentUser() {
  try {
    const res = await api.get('/v1/auth/me')
    applyProfile(res.data)
  } catch { /* client.js handles 401 / outages */ }
  return getCurrentUser()
}

function friendly(err, fallback) {
  const status = err?.response?.status
  if (status === 401) return new Error('Email or password is incorrect.')
  if (status === 429) return new Error(err?.response?.data?.message || 'Too many attempts. Please wait a few minutes.')
  if (status === 403 || status === 400 || status === 409 || status === 422) return Object.assign(new Error(err?.response?.data?.message || fallback), { details: err?.response?.data?.details })
  return new Error(err?.message || fallback)
}

/**
 * Sign in. Returns `{ needsTenant, tenants }` when the email works at several
 * institutions — call again with the chosen `tenantId` — and `{ needsCode, challengeId, sentTo }`
 * when a code was emailed (finish with verifyLoginCode).
 */
export async function login(email, password, tenantId) {
  let res
  try {
    res = await api.post('/v1/auth/login', { email, password, tenantId })
  } catch (err) {
    throw friendly(err, 'Could not sign in. Is the server running?')
  }
  const data = res.data.data
  if (data.needsTenant || data.needsCode) return data
  storeUser(data)
  return data
}

/** Second sign-in step: the emailed code. */
export async function verifyLoginCode(challengeId, code) {
  let res
  try {
    res = await api.post('/v1/auth/login/code', { challengeId, code })
  } catch (err) {
    throw friendly(err, 'Could not check the code. Please try again.')
  }
  storeUser(res.data.data)
  return res.data.data
}

const call = async (fn, fallback) => {
  try { return (await fn()).data.data } catch (err) { throw friendly(err, fallback) }
}

export const resendLoginCode = (challengeId) => call(() => api.post('/v1/auth/login/code/resend', { challengeId }), 'Could not send a new code.')
export const forgotPassword = (email) => call(() => api.post('/v1/auth/forgot', { email }), 'Could not send the code. Please try again.')
export const resetPassword = (challengeId, code, password) => call(() => api.post('/v1/auth/forgot/reset', { challengeId, code, password }), 'Could not change the password.')
export const checkInvite = (token) => call(() => api.post('/v1/public/invite/check', { token }), 'Could not open this invite.')

/** Choose a password from an invite link; signs in unless the institution's subscription is paused. */
export async function acceptInvite(token, password) {
  const data = await call(() => api.post('/v1/public/invite/accept', { token, password }), 'Could not set your password.')
  if (data.signedIn) storeUser(data.me)
  return data
}

export const resendSignupCode = (challengeId) => call(() => api.post('/v1/public/signup/resend', { challengeId }), 'Could not send a new code.')

/** Other institutions where your email has a login (Switch institution). */
export const fetchOtherInstitutions = () => call(() => api.get('/v1/auth/institutions'), 'Could not load your institutions.')

/**
 * Move to another institution (its password, maybe its sign-in code). Returns `{ needsCode, … }`
 * — finish with verifyLoginCode — or the new profile.
 */
export async function switchInstitution(tenantId, password) {
  const data = await call(() => api.post('/v1/auth/switch-tenant', { tenantId, password }), 'Could not switch institution.')
  if (!data.needsCode) storeUser(data)
  return data
}

/** Confirm your email address: send a code, then check it. */
export const startEmailVerify = () => call(() => api.post('/v1/auth/me/email/verify/start'), 'Could not send the code.')
export async function confirmEmailVerify(challengeId, code) {
  const data = await call(() => api.post('/v1/auth/me/email/verify', { challengeId, code }), 'Could not check the code.')
  await syncCurrentUser()
  return data
}

/** The "Confirm my email" link (works signed out). Refreshes the profile when this browser is signed in. */
export async function confirmEmailLink(token) {
  const data = await call(() => api.post('/v1/public/verify-email', { token }), 'Could not confirm your email.')
  if (getCurrentUser()) await syncCurrentUser()
  return data
}

/** Turn your own sign-in code on or off. */
export async function setTwoStep(enabled) {
  const data = await call(() => api.patch('/v1/auth/me/two-step', { enabled }), 'Could not save.')
  await syncCurrentUser()
  return data
}

/**
 * Start a free trial. Returns `{ needsCode, challengeId, sentTo }` when the email must be
 * confirmed first (finish with verifySignup); otherwise the institution is created and signed in.
 */
export async function signup(body) {
  let res
  try {
    res = await api.post('/v1/public/signup', body)
  } catch (err) {
    throw friendly(err, 'Could not create your workspace. Please try again.')
  }
  const data = res.data.data
  if (!data.needsCode) storeUser(data)
  return data
}

/** The emailed sign-up code: creates the institution and signs the new admin in. */
export async function verifySignup(challengeId, code) {
  let res
  try {
    res = await api.post('/v1/public/signup/verify', { challengeId, code })
  } catch (err) {
    throw friendly(err, 'Could not create your workspace. Please try again.')
  }
  storeUser(res.data.data)
  return res.data.data
}

export async function changePassword(currentPassword, newPassword) {
  const res = await api.post('/v1/auth/change-password', { currentPassword, newPassword })
  await syncCurrentUser()
  return res.data?.data?.message || 'Password changed.'
}

export async function fetchSessions() {
  return (await api.get('/v1/auth/sessions')).data.data
}

/** Sign one of your other devices out. */
export const signOutSession = (id) => api.delete(`/v1/auth/sessions/${id}`)

export const isAuthenticated = () => !!getCurrentUser()

export const isSuperadmin = () => !!getCurrentUser()?.superadmin

/** A platform console action the signed-in staff role may take (shared PLATFORM_ROLES; the server checks too). */
export function canPlatform(perm) {
  const u = getCurrentUser()
  if (!u?.superadmin) return false
  return u.platformPermissions ? u.platformPermissions.includes(perm) : true // a profile stored before roles: refreshed within a minute
}

/** Holds the full-access role (Institution Admin) or is the platform owner. */
export function isFullAccess() {
  const u = getCurrentUser()
  return !!u && (u.superadmin || !!u.fullAccess || !!u.permissions?.includes('*'))
}

/** Mirrors the API: superadmin or '*' always pass; otherwise the exact key. */
export function hasPermission(key) {
  const u = getCurrentUser()
  if (!u) return false
  if (u.superadmin) return true
  // a screen the platform hid for this institution is closed to everyone there (the API refuses it too)
  if (u.hiddenPages?.includes(String(key).split('.').slice(0, 2).join('.'))) return false
  return hasPermissionIn(u.permissions, key)
}

export const hasAnyPermission = (...keys) => keys.some((k) => hasPermission(k))

async function endSession(url) {
  try { await api.post(url) } catch { /* cookies are cleared server-side; leave anyway */ }
  localStorage.removeItem(USER_KEY)
  window.location.href = '/login'
}

export const logout = () => endSession('/v1/auth/logout')
export const logoutAll = () => endSession('/v1/auth/logout-all')
