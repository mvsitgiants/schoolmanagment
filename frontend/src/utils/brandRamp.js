// Derive a 10-stop brand ramp (50–900) from a single accent colour and push it
// into the CSS custom properties Tailwind's `brand-*` classes read. Every stop the
// app uses must be here AND in tailwind.config.js — a class like `brand-400` with
// no stop generates no CSS at all, so that element silently ignores the accent.
// Stops are emitted as "r g b" channel strings so Tailwind's /opacity works.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

const hexToRgb = (hex) => {
  let h = String(hex || '').trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

const hslToRgbStr = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360
  s = clamp(s, 0, 100) / 100
  l = clamp(l, 0, 100) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
    .map((c) => Math.round(c * 255))
    .join(' ')
}

// Lightness offsets (percentage points) from the 500 stop, tuned to the
// built-in teal ramp. Light tints also lose a little saturation.
const STOPS = [
  ['50', +65, 0.35],
  ['100', +58, 0.5],
  ['200', +45, 0.65],
  ['300', +33, 0.8],
  ['400', +16, 0.9],
  ['500', 0, 1],
  ['600', -5, 1],
  ['700', -10, 1],
  ['800', -14, 1],
  ['900', -18, 1],
]

// WCAG relative luminance of an "r g b" string, and its contrast against white.
const whiteContrast = (rgbStr) => {
  const [r, g, b] = rgbStr.split(' ').map((c) => {
    const v = Number(c) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}

/** @returns { [stop]: "r g b" } or null if hex is invalid */
export function deriveBrandRamp(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [h, s, l0] = rgbToHsl(rgb)
  // Primary buttons are white text on brand-500. A very light pick (white, cream, pale yellow)
  // made them white-on-white — Save on the institution profile "vanished". Darken the 500 stop
  // until white text reaches 3:1; every built-in swatch already does, so they are unchanged.
  let l = l0
  while (l > 6 && whiteContrast(hslToRgbStr(h, s, l)) < 3) l -= 1
  const out = {}
  for (const [stop, dl, sMul] of STOPS) {
    out[stop] = hslToRgbStr(h, s * sMul, clamp(l + dl, 6, 97))
  }
  return out
}

/** Apply the ramp to :root, or clear the overrides (revert to index.css defaults). */
export function applyBrandRamp(hex) {
  const root = document.documentElement
  const ramp = hex ? deriveBrandRamp(hex) : null
  for (const [stop] of STOPS) {
    if (ramp) root.style.setProperty(`--brand-${stop}`, ramp[stop])
    else root.style.removeProperty(`--brand-${stop}`)
  }
}
