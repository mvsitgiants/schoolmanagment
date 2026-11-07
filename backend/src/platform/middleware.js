import { isKnownPermission, MODULE_BY_ID, platformCan } from '@schoolgiant/shared'
import { AuthSession, PlatformUser } from '../models/platform.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { authenticateApiKey, looksLikeApiKey } from '../services/apiKeys.js'
import { can, loadAccess, moduleEnabled } from './access.js'
import { ACCESS_COOKIE, verifyAccess } from './auth/tokens.js'
import { getContext } from './context.js'
import { AppError, forbidden, unauthorized } from './errors.js'

// Short cache so every request doesn't re-read its session row.
const sessionCache = new Map() // sid → { at, session }
const SESSION_TTL = 30_000

// Others holding sessions open (the realtime sockets) hear when sessions are dropped, so a
// sign-out or "sign out all devices" closes the live connection too.
const forgetListeners = new Set()
export function onSessionsForgotten(fn) {
  forgetListeners.add(fn)
  return () => forgetListeners.delete(fn)
}

export function forgetSessions(sids) {
  if (!sids) sessionCache.clear()
  else for (const sid of [].concat(sids)) sessionCache.delete(String(sid))
  for (const fn of forgetListeners) {
    try { fn(sids ? [].concat(sids).map(String) : null) } catch { /* a listener never breaks sign-out */ }
  }
}

/** End the matching live sessions (with why) and drop them from the cache and live sockets. */
export async function endSessions(filter, reason) {
  const rows = await AuthSession.find({ ...filter, revokedAt: null }).select('_id').lean()
  if (!rows.length) return 0
  await AuthSession.updateMany({ _id: { $in: rows.map((s) => s._id) } }, { $set: { revokedAt: new Date(), revokeReason: reason } })
  forgetSessions(rows.map((s) => String(s._id)))
  return rows.length
}

/** The session row behind an access token (cached for 30 s). */
export async function liveSession(sid) {
  const hit = sessionCache.get(sid)
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.session
  const session = await AuthSession.findById(sid).lean()
  sessionCache.set(sid, { at: Date.now(), session })
  return session
}

/** Platform owners have no role to set it: a fixed idle sign-out. */
export const PLATFORM_IDLE_MINUTES = 30
const ACTIVE_WRITE_EVERY = 60_000

/**
 * Idle sign-out (Roles › Session, Settings › core). The web app sends how long its person has
 * been idle (X-Idle-Sec, shared by every tab), so background polling never counts as use. A
 * request without the header — API tools, scripts — counts as activity. Throws 401 IDLE_TIMEOUT
 * and ends the session once the limit has passed; otherwise records the activity (once a minute).
 */
export async function checkIdle(req, session, idleMinutes) {
  const now = Date.now()
  const idleSec = Number(req.get('x-idle-sec'))
  const activeAt = Number.isFinite(idleSec) && idleSec >= 0 ? now - idleSec * 1000 : now
  const last = new Date(session.lastActiveAt ?? session.createdAt ?? now).getTime()
  if (now - Math.max(last, activeAt) > idleMinutes * 60_000) {
    await endSessions({ _id: session._id }, 'IDLE_TIMEOUT')
    throw new AppError(401, `You were signed out after ${idleMinutes} minutes without activity. Please sign in again.`, { code: 'IDLE_TIMEOUT' })
  }
  if (activeAt - last > ACTIVE_WRITE_EVERY) {
    session.lastActiveAt = new Date(activeAt) // the cached row too, so the next request doesn't write again
    await AuthSession.updateOne({ _id: session._id }, { $max: { lastActiveAt: new Date(activeAt) } })
  }
}

const bearer = (req) => {
  const h = req.get('authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/** Who is calling? Sets req.auth and fills the request context (tenant, user). */
export async function authenticate(req, res, next) {
  // Tenant API keys (Administration › API keys & webhooks): `Authorization: Bearer hk_…`.
  const presented = bearer(req)
  if (looksLikeApiKey(presented)) {
    const auth = await authenticateApiKey(presented, req.ip)
    if (!auth) throw unauthorized('This API key is not valid, has expired or was revoked.')
    Object.assign(getContext(), { tenantId: auth.tenantId, userId: null, userName: auth.user.name })
    req.auth = auth
    return next()
  }
  const claims = verifyAccess(req.cookies?.[ACCESS_COOKIE] || presented)
  if (!claims) throw unauthorized()
  const session = await liveSession(claims.sid)
  if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) {
    throw unauthorized('Your session has ended. Please sign in again.')
  }
  const ctx = getContext()

  if (claims.sa) {
    const owner = await PlatformUser.findById(claims.sub).lean()
    if (!owner?.active) throw unauthorized('This account is not active.')
    await checkIdle(req, session, PLATFORM_IDLE_MINUTES)
    Object.assign(ctx, { superadmin: true, userId: claims.sub, userName: owner.name })
    req.auth = { superadmin: true, user: owner, role: owner.role || 'OWNER', permissions: ['*'], sessionId: claims.sid }
    // new platform staff sign in with a temporary password: only the sign-in routes until they set their own
    if (owner.mustChangePassword && !req.originalUrl.startsWith('/api/v1/auth/')) {
      throw new AppError(403, 'Set your own password first — your temporary password is only for that.', { code: 'PASSWORD_CHANGE_REQUIRED' })
    }
    return next()
  }

  ctx.tenantId = claims.tid
  ctx.userId = claims.sub
  const access = await loadAccess(claims.tid, claims.sub)
  if (!access || !access.user.active) throw unauthorized('This account is not active.')
  await checkIdle(req, session, access.idleMinutes)
  ctx.userName = access.user.name
  req.auth = {
    ...access,
    tenantId: claims.tid,
    userId: claims.sub,
    sessionId: claims.sid,
    status: effectiveStatus(access.tenant),
  }
  // A temporary password (new user, admin reset) is for one thing: setting your own. Until then
  // only the sign-in routes answer (me, change password, sign out) — the app shows that screen.
  if (access.user.mustChangePassword && !req.originalUrl.startsWith('/api/v1/auth/')) {
    throw new AppError(403, 'Set your own password first — your temporary password is only for that.', { code: 'PASSWORD_CHANGE_REQUIRED' })
  }
  next()
}

/** Institution workspace endpoints: a tenant user must be calling. */
export function tenantOnly(req, res, next) {
  if (!req.auth?.tenantId) throw forbidden('Sign in to an institution workspace to use this.')
  next()
}

/**
 * When a subscription stops (trial over, suspended, cancelled) only the screens needed to
 * pay and come back stay open. Everything else answers 402.
 */
const OPEN_WHEN_BLOCKED = [/^\/subscription/, /^\/plans/, /^\/notifications/, /^\/settings$/]
export function subscriptionGate(req, res, next) {
  if (!BLOCKED_STATUSES.includes(req.auth.status)) return next()
  if (OPEN_WHEN_BLOCKED.some((re) => re.test(req.path))) return next()
  throw new AppError(402, 'Your subscription is not active. An administrator can restore access from Subscription & billing.', { code: 'SUBSCRIPTION_INACTIVE' })
}

/** Any-of permission check. Keys are validated against the catalog at startup. */
export function requirePermission(...keys) {
  for (const k of keys) {
    if (!isKnownPermission(k)) throw new Error(`requirePermission: "${k}" is not in the catalog (packages/shared/src/catalog.js)`)
  }
  return (req, res, next) => {
    if (keys.some((k) => can(req.auth, k))) return next()
    throw forbidden(`Your role doesn't allow this. It needs: ${keys.join(' or ')}.`, { missing: keys })
  }
}

/** A switched-off module looks "not installed" (404), as in mvserp. */
export function requireModule(moduleId) {
  if (!MODULE_BY_ID[moduleId]) throw new Error(`requireModule: unknown module "${moduleId}"`)
  return (req, res, next) => {
    if (req.auth?.superadmin || moduleEnabled(req.auth, moduleId)) return next()
    throw new AppError(404, `${MODULE_BY_ID[moduleId].name} is not enabled for this institution.`, { code: 'MODULE_DISABLED' })
  }
}

export function requireSuperadmin(req, res, next) {
  if (!req.auth?.superadmin) throw forbidden('Platform owner access only.')
  next()
}

/** A platform console action this staff role may take (shared PLATFORM_ROLES). */
export function requirePlatform(perm) {
  return (req, res, next) => {
    if (req.auth?.superadmin && platformCan(req.auth.role, perm)) return next()
    throw forbidden('Your platform role doesn’t allow this. Ask a platform owner.')
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SESSION_COOKIES = ['hx_at', 'hx_rt', 'hx_pt'] // staff access / refresh, patient portal

/**
 * CSRF guard for cookie sign-ins. The cookies are SameSite=None (the app and the API are on
 * different sites), so a browser sends them on a form another website posts to us. Any request
 * that changes something and carries one of them must come from an allowed origin — browsers
 * always send Origin on a cross-site POST/PUT/PATCH/DELETE. API keys (Bearer, no cookie),
 * webhooks and kiosks don't carry the cookies and are untouched.
 */
export function requireTrustedOrigin(isAllowed) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || !SESSION_COOKIES.some((c) => req.cookies?.[c])) return next()
    let origin = req.get('origin')
    if (!origin || origin === 'null') {
      const ref = req.get('referer')
      try { origin = ref ? new URL(ref).origin : null } catch { origin = null }
    }
    if (!origin || !isAllowed(origin)) throw forbidden('This request did not come from the app. Reload the page and try again.')
    next()
  }
}
