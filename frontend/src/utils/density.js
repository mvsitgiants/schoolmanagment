/**
 * Layout density, per viewer. "compact" tightens the shared components' spacing
 * (see the density block in index.css) for people who would rather see thirty rows
 * than twenty; "comfortable" is the default and changes nothing.
 *
 * Stored in localStorage because it is a per-device preference, not tenant data.
 */
const KEY = 'erp_density'

export const DENSITIES = ['comfortable', 'compact']

export function readDensity() {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

export function applyDensity(value) {
  const density = value === 'compact' ? 'compact' : 'comfortable'
  document.documentElement.setAttribute('data-density', density)
  try { localStorage.setItem(KEY, density) } catch { /* private window — this session only */ }
  return density
}

/** Call once at start-up so the stored choice is in force before the first paint. */
export function initDensity() {
  return applyDensity(readDensity())
}
