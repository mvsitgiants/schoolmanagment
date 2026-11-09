// Phone / desktop notifications (web push) — the browser half. The service worker that shows them is
// public/push-sw.js; the server half is backend/src/services/push.js. Works in the installed app and in
// browsers that support Push (on iPhone only once the app is added to the home screen, iOS 16.4+).

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ?? null
}

/** 'on' | 'off' | 'blocked' | 'unsupported' (no service worker yet counts as unsupported — e.g. the dev server). */
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await registration()
  if (!reg) return 'unsupported'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

/** Ask permission, subscribe and hand the subscription to the server. api: { key(), save(sub), off(endpoint) } */
export async function turnPushOn(api) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const reg = await registration()
  if (!reg) return 'unsupported'
  const { publicKey } = await api.key()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) })
  await api.save(sub.toJSON())
  return 'on'
}

export async function turnPushOff(api) {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.off(sub.endpoint).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  return 'off'
}
