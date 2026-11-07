// Browser tab notification badge utility (WhatsApp / Slack style)
//
// 1. Tab title counter: "(11) SchoolGiant"
// 2. Favicon notification badge: draws a red notification badge onto the tab icon
// 3. Background tab flasher: flashes tab title when a new message/alert arrives while inactive
// 4. Native App Badging API: updates taskbar/dock/PWA badge (navigator.setAppBadge)

let baseTitle = 'SchoolGiant'
const sources = {
  bell: 0,
  chat: 0,
}
let flashInterval = null
let flashTimeout = null
let cachedDefaultFavicon = null
let faviconImage = null
let isFaviconLoaded = false

function getFaviconLink() {
  return document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]')
}

function initFavicon() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const link = getFaviconLink()
  if (link && !cachedDefaultFavicon) {
    cachedDefaultFavicon = link.getAttribute('href') || '/favicon.svg'
    faviconImage = new Image()
    faviconImage.crossOrigin = 'anonymous'
    faviconImage.onload = () => {
      isFaviconLoaded = true
      applyFaviconBadge(getTotalCount())
    }
    faviconImage.src = cachedDefaultFavicon
  }
}

function getTotalCount() {
  return Object.values(sources).reduce((acc, n) => acc + (Math.max(0, Number(n) || 0)), 0)
}

function updateFavicon(total) {
  try {
    const link = getFaviconLink()
    if (!link) return
    if (!cachedDefaultFavicon) initFavicon()

    if (total <= 0) {
      if (cachedDefaultFavicon && link.getAttribute('href') !== cachedDefaultFavicon) {
        link.setAttribute('href', cachedDefaultFavicon)
      }
      return
    }

    if (!isFaviconLoaded || !faviconImage) return

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw the original favicon
    ctx.drawImage(faviconImage, 0, 0, 32, 32)

    // Draw the badge in the top right
    const badgeText = total > 99 ? '99+' : String(total)
    const isPill = badgeText.length > 1
    const badgeWidth = isPill ? (badgeText.length > 2 ? 18 : 15) : 12
    const badgeHeight = 12
    const x = 32 - badgeWidth - 1
    const y = 1

    // Badge background (crimson red with soft shadow)
    ctx.fillStyle = '#EF4444'
    ctx.beginPath()
    const r = badgeHeight / 2
    ctx.roundRect ? ctx.roundRect(x, y, badgeWidth, badgeHeight, r) : ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
    ctx.fill()

    // White outline
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#FFFFFF'
    ctx.stroke()

    // Badge count text
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 8px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(badgeText, x + badgeWidth / 2, y + badgeHeight / 2 + 0.5)

    link.setAttribute('href', canvas.toDataURL('image/png'))
  } catch {
    // Ignore canvas security or rendering errors gracefully
  }
}

function applyFaviconBadge(total) {
  if (typeof window === 'undefined') return
  updateFavicon(total)
}

function updateAppBadge(total) {
  if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    if (total > 0) {
      navigator.setAppBadge(total).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }
}

function renderTitle() {
  if (flashInterval) return // While flashing an alert, do not overwrite immediately
  const total = getTotalCount()
  document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle
}

function applyBadge() {
  const total = getTotalCount()
  renderTitle()
  applyFaviconBadge(total)
  updateAppBadge(total)
}

/** Set or update the base title (e.g. "MedCare Institution · SchoolGiant") */
export function setBaseTitle(newTitle) {
  if (!newTitle) return
  baseTitle = newTitle
  renderTitle()
}

/** Get the current base title */
export function getBaseTitle() {
  return baseTitle
}

/**
 * Update unread count for a given source ('bell', 'chat', etc.)
 * @param {'bell' | 'chat' | string} source
 * @param {number} count
 */
export function updateBadgeSource(source, count) {
  sources[source] = Math.max(0, Number(count) || 0)
  applyBadge()
}

/**
 * Flash the tab title between alertText and current tab title.
 * Used when a message or alert arrives while the user is in another tab (document.hidden).
 * Automatically stops when the user focuses the tab.
 *
 * @param {string} alertText - e.g. "💬 New message from Dr. Asha" or "🔔 New notification"
 * @param {number} [durationMs=10000] - maximum flash duration
 */
export function flashTabNotification(alertText, durationMs = 10000) {
  if (typeof document === 'undefined') return

  // Only flash if user is currently looking away in another tab
  if (!document.hidden) return

  stopFlashing()

  let toggle = false
  const total = getTotalCount()
  const normalTitle = total > 0 ? `(${total}) ${baseTitle}` : baseTitle

  document.title = alertText
  flashInterval = setInterval(() => {
    toggle = !toggle
    document.title = toggle ? alertText : normalTitle
  }, 1000)

  // Listen for tab focus / visibility change
  const onVisible = () => {
    if (!document.hidden) {
      stopFlashing()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)

  // Stop after timeout
  flashTimeout = setTimeout(() => {
    stopFlashing()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }, durationMs)
}

export function stopFlashing() {
  if (flashInterval) {
    clearInterval(flashInterval)
    flashInterval = null
  }
  if (flashTimeout) {
    clearTimeout(flashTimeout)
    flashTimeout = null
  }
  renderTitle()
}

// Initialize favicon on document ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFavicon, { once: true })
  } else {
    initFavicon()
  }
}
