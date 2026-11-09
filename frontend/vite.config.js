import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Installable web app (PWA): the app shell is cached so SchoolGiant opens with a poor connection, today's attendance
// rosters are kept for a couple of days, and attendance marked offline is queued on the device (utils/offlineQueue.js)
// and sent when the connection is back. Updates are offered, not forced (components/app/PwaPrompts.jsx).
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false, // registered in components/app/PwaPrompts.jsx so we can offer "Reload for the new version"
  includeAssets: ['favicon.svg', 'app-icon.svg', 'icons/apple-touch-icon.png'],
  manifest: {
    id: '/',
    name: 'SchoolGiant',
    short_name: 'SchoolGiant',
    description: 'Run your school or college: attendance, exams, fees, timetable and parents — in one app.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F5F6F8',
    theme_color: '#0E7C86',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mark attendance', url: '/attendance/mark', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My workspace', url: '/me', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    navigateFallback: '/index.html',
    // the API, live updates, public links and printed documents are never answered from the app shell
    navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io/, /^\/app\/[^/]+\/manifest/],
    cleanupOutdatedCaches: true,
    importScripts: ['/push-sw.js'], // phone / desktop notifications (public/push-sw.js)
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
        handler: 'CacheFirst',
        options: { cacheName: 'sg-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
      },
      {
        // today's attendance board and class rosters: fresh when online, last copy when not (marking works offline)
        urlPattern: ({ url, request }) => request.method === 'GET' && /^\/api\/v1\/attendance\/(board|sheet)/.test(url.pathname),
        handler: 'NetworkFirst',
        options: { cacheName: 'sg-attendance', networkTimeoutSeconds: 5, expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 2 }, cacheableResponse: { statuses: [200] } },
      },
    ],
  },
  devOptions: { enabled: false },
})

export default defineConfig({
  plugins: [react(), pwa],
  server: {
    port: 5190,
    strictPort: true, // 5180 / 4000 belong to Hospital Samadhan, so both projects can run side by side
    proxy: {
      '/api': {
        // Point at another API with API_TARGET=http://localhost:4200
        target: process.env.API_TARGET || 'http://localhost:4100',
        changeOrigin: true,
      },
      // live updates (context/RealtimeContext.jsx): socket.io long-polling + WebSocket upgrade
      '/socket.io': {
        target: process.env.API_TARGET || 'http://localhost:4100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    // built files go under /static/ so they can't collide with app routes such as /inventory/assets
    assetsDir: 'static',
  },
})
