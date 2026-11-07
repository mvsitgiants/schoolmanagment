// The sidebar's colour, from one hex the tenant picks.
//
// The sidebar paints everything except its background with white-at-an-opacity
// (`text-sidebar-fg/60`, `bg-sidebar-fg/10`, …). That is why one variable can drive the
// whole surface — but only if the foreground flips to dark when the chosen background is
// light, otherwise a tenant who picks a pale brand colour gets white text on cream and an
// unreadable sidebar. So `--sidebar-fg` is derived here, never stored.

const DEFAULT_BG = '11 18 32' // #0B1220, the shipped navy
const LIGHT_FG = '255 255 255'
const DARK_FG = '15 23 42'

const hexToRgb = (hex) => {
  let h = String(hex || '').trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance([r, g, b]) {
  const chan = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** True when a background is light enough that white text on it would be hard to read. */
export function needsDarkText(hex) {
  const rgb = hexToRgb(hex)
  return rgb ? luminance(rgb) > 0.45 : false
}

/**
 * Point the sidebar's CSS variables at `hex`, or clear them to fall back to the default
 * defined in index.css. Clearing rather than writing the default back means a later change
 * to that default still reaches every tenant who never picked a colour.
 */
export function applySidebarTheme(hex) {
  const root = document.documentElement
  const rgb = hex ? hexToRgb(hex) : null

  if (!rgb) {
    root.style.removeProperty('--sidebar-bg')
    root.style.removeProperty('--sidebar-fg')
    return
  }
  root.style.setProperty('--sidebar-bg', rgb.join(' '))
  root.style.setProperty('--sidebar-fg', luminance(rgb) > 0.45 ? DARK_FG : LIGHT_FG)
}

export { DEFAULT_BG }
