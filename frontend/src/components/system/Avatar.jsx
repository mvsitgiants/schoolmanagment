import clsx from 'clsx'

/** Deterministic initials avatar — no external image service. `soft`: pale tint + dark letters (calmer, for lists and record headers). */
export default function Avatar({ name = '', size = 24, soft = false, className }) {
  const clean = String(name).trim()
  const initials = clean
    ? clean.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
    : '?'
  let h = 0
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span
      className={clsx('inline-flex items-center justify-center rounded-full font-semibold text-white select-none shrink-0', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...(soft
        ? { background: clean ? `hsl(${h} 30% 93%)` : '#EEF0F3', color: clean ? `hsl(${h} 30% 32%)` : '#5B616E' }
        : { background: clean ? `hsl(${h} 42% 52%)` : 'var(--tw-prose-captions, #94a3b8)' }) }}
      title={clean || undefined}
    >
      {initials}
    </span>
  )
}
