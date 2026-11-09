// Web push for the installed app (loaded into the generated service worker via workbox importScripts —
// vite.config.js). The server sends { title, body, url, tag } (backend/src/services/push.js).
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(d.title || 'SchoolGiant', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const same = all.find((c) => c.url.startsWith(url)) || all.find((c) => new URL(c.url).origin === self.location.origin)
    if (same) { await same.focus(); if (!same.url.startsWith(url) && 'navigate' in same) await same.navigate(url); return }
    await self.clients.openWindow(url)
  })())
})
