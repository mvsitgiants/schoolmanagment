// One-shot browser location — read only when the person presses a button (marking attendance, or an admin pinning a
// site). Nothing here watches or tracks the position. (Ported from the hospital platform.)

const ERROR_CODE = { 1: 'DENIED', 2: 'UNAVAILABLE', 3: 'TIMEOUT' }

/**
 * Ask the browser where we are, once.
 * → { location: { lat, lng, accuracy } } or { error: 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' }
 * (never rejects). Needs a secure page (https or localhost). Error texts: geo.json › geo.location.<error>.
 */
export function currentLocation({ timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation || (typeof window !== 'undefined' && window.isSecureContext === false)) {
      resolve({ error: 'UNSUPPORTED' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy ?? 0) } }),
      (err) => resolve({ error: ERROR_CODE[err?.code] ?? 'UNAVAILABLE' }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}
