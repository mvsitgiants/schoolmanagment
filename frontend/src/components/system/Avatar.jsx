import clsx from 'clsx'

/**
 * Deterministic initials avatar — no external image service. The same name always gets the same colour.
 * `soft`: a tinted disc with dark letters (calmer, for lists and record headers); otherwise a solid gradient.
 */
export default function Avatar({ name = '', size = 24, soft = false, className }) {
  const clean = String(name).trim()
  const initials = clean
    ? clean.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
    : '?'
  let h = 0
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) % 360
  const style = !clean
    ? { background: '#EEF0F3', color: '#5B616E' }
    : soft
      ? { background: `linear-gradient(135deg, hsl(${h} 85% 94%), hsl(${(h + 25) % 360} 80% 88%))`, color: `hsl(${h} 60% 30%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 60% 82%)` }
      : { background: `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 30) % 360} 70% 45%))` }
  return (
    <span
      className={clsx('inline-flex items-center justify-center rounded-full font-semibold text-white select-none shrink-0', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ...style }}
      title={clean || undefined}
    >
      {initials}
    </span>
  )
}
