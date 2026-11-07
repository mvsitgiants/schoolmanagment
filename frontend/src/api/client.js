import axios from 'axios'
import { notify } from '../context/SnackbarContext.jsx'
import { translateServerMessage } from '../i18n/serverMessage'
import { idleSeconds } from '../utils/activity'

// All backend calls go through /api, proxied to the Node API in dev (see vite.config.js).
// In production, set VITE_API_BASE_URL to the deployed backend origin.
// This is the ONE place the base URL is decided — never hardcode '/api' elsewhere.
const BUILT_IN_API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')
const API_OVERRIDE_KEY = 'erp_api_base'

/**
 * A deployed build has its backend URL baked in at build time, which is useless when the
 * backend is somewhere that moves — a laptop behind a tunnel, or an on-prem server. So the
 * URL can also be set at runtime from the login screen and kept in this browser.
 *
 * Only ever set by someone typing it in: never from a link or a query string, because a
 * link that silently re-points a real-looking login form at someone else's server is a
 * password-harvesting trick.
 */
export function getApiBaseOverride() {
  try {
    const v = (localStorage.getItem(API_OVERRIDE_KEY) || '').trim()
    return isUsableApiBase(v) ? v.replace(/\/+$/, '') : ''
  } catch { return '' }
}

/** Accepts an absolute http(s) URL, or a same-origin path like '/api'. */
export function isUsableApiBase(v) {
  if (!v) return false
  if (v.startsWith('/')) return true
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch { return false }
}

/** Saves the backend URL for this browser and returns it. Pass '' to go back to the built-in one. */
export function setApiBaseOverride(value) {
  const v = (value || '').trim()
  try {
    if (!v) localStorage.removeItem(API_OVERRIDE_KEY)
    else if (isUsableApiBase(v)) localStorage.setItem(API_OVERRIDE_KEY, v.replace(/\/+$/, ''))
  } catch { /* private window — the built-in URL still works */ }
  return getApiBaseOverride() || BUILT_IN_API_BASE
}

export const BUILT_IN_API_BASE_URL = BUILT_IN_API_BASE
export const API_BASE_URL = getApiBaseOverride() || BUILT_IN_API_BASE
const baseURL = API_BASE_URL

/** Absolute backend URL for a path like '/v1/...' — for <a href>, <iframe src>, window.open. */
export const apiUrl = (path) => `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`

export const api = axios.create({
  baseURL,
  // The access + refresh tokens live in httpOnly cookies set by the backend on
  // login/refresh. The browser attaches them automatically; JS never sees them.
  // `withCredentials` makes axios send those cookies (and matters once the API
  // is on another origin in production).
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Every call says how long the person has been idle, so the server's idle sign-out ignores
// background polling (backend platform/middleware.js checkIdle).
function withIdle(config) {
  const h = config.headers
  const idle = String(idleSeconds())
  if (typeof h?.set === 'function') h.set('X-Idle-Sec', idle)
  else config.headers = { ...h, 'X-Idle-Sec': idle }
  return config
}
api.interceptors.request.use(withIdle)

// Money writes carry an Idempotency-Key (backend platform/idempotency.js). The same request sent
// again — a double-click while the first is in flight, or Save pressed again after a reply that
// never arrived — reuses the key, so the server answers with the first result instead of billing
// twice. A definite answer frees the key: a later, deliberate identical request is new work.
const MONEY_WRITE = /\/v1\/(billing\/(bills(\/[^/]+\/(payments|cancel|credit-notes))?|ip-accounts\/[^/]+\/(deposits|refund|final))|pharmacy\/sales(\/[^/]+\/(cancel|return))?|procurement\/(grn|purchase-returns)|integrations\/payments\/transactions\/[^/]+\/refund)$/
const KEY_TTL_MS = 10 * 60_000
const openKeys = new Map() // `${url}\n${body}` → { key, at }
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`)
const headerOf = (h, name) => (typeof h?.get === 'function' ? h.get(name) : h?.[name])

api.interceptors.request.use((config) => {
  if (String(config.method).toLowerCase() !== 'post' || !MONEY_WRITE.test(String(config.url ?? '').split('?')[0])) return config
  if (headerOf(config.headers, 'Idempotency-Key')) return config // a replay (e.g. after a token refresh) keeps its key
  const sig = `${config.url}\n${typeof config.data === 'string' ? config.data : JSON.stringify(config.data ?? null)}`
  let entry = openKeys.get(sig)
  if (!entry || Date.now() - entry.at > KEY_TTL_MS) entry = { key: newKey(), at: Date.now() }
  openKeys.set(sig, entry)
  if (typeof config.headers?.set === 'function') config.headers.set('Idempotency-Key', entry.key)
  else config.headers = { ...config.headers, 'Idempotency-Key': entry.key }
  config._idemSig = sig
  return config
})
api.interceptors.response.use(
  (res) => { if (res.config?._idemSig) openKeys.delete(res.config._idemSig); return res },
  (err) => {
    const sig = err?.config?._idemSig
    const status = err?.response?.status
    // keep the key when we can't know whether it was saved (no reply, a 5xx) or it is still being
    // saved (409) — the next press replays; any other answer is final
    if (sig && status && status < 500 && status !== 409) openKeys.delete(sig)
    return Promise.reject(err)
  },
)

// Bare client for the health / session probe — no response interceptors, so a probe can never
// recurse. It still reports idle time: the minute-by-minute probe must not count as activity.
const probeClient = axios.create({ baseURL, withCredentials: true, timeout: 5000 })
probeClient.interceptors.request.use(withIdle)

const USER_KEY = 'erp_user'
const REASON_KEY = 'erp_logout_reason'
const isAuthUrl = (url = '') => url.includes('/v1/auth/')
const loggedIn = () => !!localStorage.getItem(USER_KEY)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const SERVER_DOWN_MESSAGE = "Can't reach the server right now. Please try again in a moment."
// An outage is not a sign-out: a rolling restart or a few seconds of bad Wi-Fi used to log out
// every open tab and drop unsaved forms. Now the session stays and one notice says so; only a
// session the server actually rejects (401 after a failed refresh) signs the user out.
let downNoticeAt = 0
function noticeDown() {
  if (Date.now() - downNoticeAt < 15_000) return // one notice per outage, not one per request
  downNoticeAt = Date.now()
  notify(SERVER_DOWN_MESSAGE, { variant: 'error' })
}
const EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.'

function forceLogin(message) {
  localStorage.removeItem(USER_KEY)
  if (window.location.pathname !== '/login') {
    // A full reload drops any toast, so the login page picks the reason up from here.
    if (message) sessionStorage.setItem(REASON_KEY, message)
    window.location.href = '/login'
  } else if (message) {
    notify(message, { variant: 'error' })
  }
}

/** Keep a reason for the login page to show after a deliberate sign-out (idle guard). */
export function setLogoutReason(message) {
  try { sessionStorage.setItem(REASON_KEY, message) } catch { /* private mode */ }
}

// Read once per page load (forceLogin always reloads), so StrictMode's double-called initialisers
// and re-renders all see the same value while a later visit to /login doesn't show a stale one.
const pendingLogoutReason = typeof window !== 'undefined' ? sessionStorage.getItem(REASON_KEY) : null
if (pendingLogoutReason) sessionStorage.removeItem(REASON_KEY)

/** Why the app signed the user out just before this page load (shown by the login page). */
export function takeLogoutReason() {
  return pendingLogoutReason
}

/**
 * Server unreachable: no response at all, a gateway error, or the dev proxy's bare 500
 * (Vite answers ECONNREFUSED with an empty 500). A genuine backend 500 always carries an
 * ApiError JSON body, so it is never mistaken for an outage.
 */
export function isServerDown(err) {
  if (axios.isCancel(err)) return false
  const res = err?.response
  if (!res) return true
  if ([502, 503, 504].includes(res.status)) return true
  if (res.status === 500) {
    const d = res.data
    return d == null || d === '' || (typeof d === 'string' && !d.trim().startsWith('{'))
  }
  return false
}

// Spring's static-resource fallback: the API route doesn't exist at all on whatever answered —
// a wrong or half-started server — as opposed to a 404 for one missing record.
const isUnknownRoute = (err) =>
  err?.response?.status === 404 && /No static resource/i.test(String(err?.response?.data?.message || ''))

// auth.js registers a listener so each successful probe also refreshes the stored
// role + permissions (kept here as a callback to avoid a client ↔ auth import cycle).
let profileListener = null
export function setProfileListener(fn) { profileListener = fn }

/**
 * One shared probe of GET /v1/auth/me (3 tries, ~2 s apart) → 'ok' | 'session' | 'down'.
 * 'down' also covers "not this API" (the route itself 404s).
 */
let probing = null
let idleReason = null
const isIdleTimeout = (err) => err?.response?.status === 401 && err.response.data?.code === 'IDLE_TIMEOUT'
function checkServer() {
  if (!probing) {
    probing = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await probeClient.get('/v1/auth/me')
          try { profileListener?.(res.data) } catch { /* never let a listener break the probe */ }
          return 'ok'
        } catch (e) {
          const s = e?.response?.status
          if (isIdleTimeout(e)) { idleReason = e.response.data.message; return 'idle' }
          if (s === 401 || s === 403) return 'session'
          if (!isServerDown(e) && !isUnknownRoute(e)) return s === 404 ? 'session' : 'ok'
        }
        if (attempt < 2) await sleep(2000)
      }
      return 'down'
    })().finally(() => { probing = null })
  }
  return probing
}

/** Probe, and sign the user out if the server is gone or the session can't be recovered. */
async function verifyOrLogout() {
  const verdict = await checkServer()
  if (verdict === 'down') { noticeDown(); return false }
  if (verdict === 'idle') { forceLogin(translateServerMessage(idleReason) || EXPIRED_MESSAGE); return false }
  if (verdict === 'session') {
    try { await probeClient.post('/v1/auth/refresh'); return true }
    catch (e) {
      if (isServerDown(e)) noticeDown()
      else forceLogin(EXPIRED_MESSAGE)
      return false
    }
  }
  return true
}

// A single in-flight refresh shared by every request that 401s at the same time.
let refreshPromise = null
function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/v1/auth/refresh')
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config || {}
    const status = err?.response?.status

    // Signed out for being idle: the session is already ended, so no refresh — sign in again.
    if (isIdleTimeout(err)) {
      forceLogin(translateServerMessage(err.response.data.message) || EXPIRED_MESSAGE)
      return Promise.reject({ ...err, message: err.response.data.message })
    }

    // Access token expired mid-session → try one silent refresh, then replay the request.
    if (status === 401 && !isAuthUrl(original.url) && !original._retried) {
      original._retried = true
      try {
        await refreshOnce()
        return api(original)
      } catch (refreshErr) {
        // the server is down mid-refresh: keep the session, it is retried on the next request
        if (isServerDown(refreshErr)) { noticeDown(); return Promise.reject({ ...err, message: SERVER_DOWN_MESSAGE }) }
        // a stopped subscription ends the session with the server's reason (already translated)
        forceLogin(refreshErr?.response?.status === 402 || isIdleTimeout(refreshErr) ? refreshErr.message : EXPIRED_MESSAGE)
        return Promise.reject({ ...err, message: 'Session expired' })
      }
    }

    // Subscription stopped (trial over / suspended): let the app re-read the profile so it
    // shows the renew screen instead of a page full of failing calls.
    if (status === 402) window.dispatchEvent(new CustomEvent('erp:subscription-blocked'))

    if (status === 401 && !isAuthUrl(original.url)) {
      forceLogin(EXPIRED_MESSAGE)
    } else if (!isAuthUrl(original.url) && loggedIn() && (isServerDown(err) || isUnknownRoute(err))) {
      // Server stopped / restarting / not our API: confirm with a probe. Down → one notice, the
      // session stays; a session the server rejects → sign in again. A passing probe was a blip.
      const stillOk = await verifyOrLogout()
      if (!stillOk) return Promise.reject({ ...err, message: SERVER_DOWN_MESSAGE })
      if (isServerDown(err)) noticeDown()
    } else if (isServerDown(err) && !axios.isCancel(err)) {
      noticeDown()
    }

    const serverMessage = err?.response?.data?.message
    const message = isServerDown(err)
      ? SERVER_DOWN_MESSAGE
      : translateServerMessage(serverMessage) || err.message || 'Something went wrong'
    // Screens read either e.message or e.response.data.message — both get the translated text (English kept alongside).
    const response = serverMessage && err.response
      ? { ...err.response, data: { ...err.response.data, message, englishMessage: serverMessage } }
      : err.response
    return Promise.reject({ ...err, response, message })
  }
)

// Catch an outage or a dead session even while nobody is clicking: when the tab comes back into
// view, when the network returns, and once a minute while visible.
if (typeof window !== 'undefined' && !window.__erpSessionWatch) {
  window.__erpSessionWatch = true
  const watch = () => {
    if (!loggedIn() || document.visibilityState !== 'visible' || window.location.pathname === '/login') return
    verifyOrLogout()
  }
  document.addEventListener('visibilitychange', watch)
  window.addEventListener('online', watch)
  setInterval(watch, 60_000)
}

export default api
