// When the person last touched the app, shared by every tab of this browser (localStorage), for
// the idle sign-out. Every API call reports it (X-Idle-Sec, api/client.js), so background polling
// never counts as use; the server ends the session once the role's idle limit has passed, and
// <IdleGuard> warns a minute before.

const KEY = 'erp_last_active'
const WRITE_EVERY = 5_000
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']

let last = Date.now() // this tab's own value, used when storage is blocked
let awake = 0

export function markActive() {
  const now = Date.now()
  if (now - last < WRITE_EVERY) return
  last = now
  try { localStorage.setItem(KEY, String(now)) } catch { /* private mode: this tab's value still works */ }
}

export function lastActive() {
  let shared = 0
  try { shared = Number(localStorage.getItem(KEY)) || 0 } catch { /* private mode */ }
  return Math.max(last, shared)
}

/** Seconds since the person last did anything in any tab (0 while a screen holds the app awake). */
export const idleSeconds = () => (awake > 0 ? 0 : Math.max(0, Math.floor((Date.now() - lastActive()) / 1000)))

/**
 * Screens meant to run unattended (TV queue display, self check-in kiosk) keep the session
 * alive. Returns the release function — use as `useEffect(() => holdAwake(), [])`.
 */
export function holdAwake() {
  awake += 1
  const timer = setInterval(() => { last = 0; markActive() }, 30_000)
  return () => { awake -= 1; clearInterval(timer) }
}

if (typeof window !== 'undefined' && !window.__erpActivity) {
  window.__erpActivity = true
  // opening or reloading the app is activity too
  last = 0
  markActive()
  for (const e of EVENTS) window.addEventListener(e, markActive, { passive: true, capture: true })
}
