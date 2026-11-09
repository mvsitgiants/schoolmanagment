import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { formatCurrency, getFormatConfig } from '../../../utils/format'

// Small pieces the Live campus panels share. The page is deliberately calm: grey and ink for the normal state, the
// brand teal for what is current or clickable, and colour only where something needs doing — red to act now,
// amber to watch. Green appears only as a tiny dot.

/** Presence state → how loud it is: 'danger' (act), 'warning' (watch), 'ok' (in), 'muted'. */
export const PRESENCE_LEVEL = {
  PRESENT: 'ok', LATE: 'warning', NOT_IN_YET: 'warning', EXPECTED: 'muted', ON_LEAVE: 'danger', ABSENT: 'danger', OFF: 'muted', UNKNOWN: 'muted',
}
export const PRESENCE_ORDER = ['ABSENT', 'ON_LEAVE', 'NOT_IN_YET', 'LATE', 'PRESENT', 'EXPECTED', 'OFF', 'UNKNOWN']
export const isAway = (state) => state === 'ABSENT' || state === 'ON_LEAVE'

/** Text colour for a level: only red and amber stand out. */
export const LEVEL_TEXT = { danger: 'text-rose-600', warning: 'text-amber-600', ok: 'text-ink-muted', muted: 'text-ink-faint' }
const LEVEL_DOT = { danger: 'bg-rose-500', warning: 'bg-amber-500', ok: 'bg-emerald-500', muted: 'bg-ink-faint/50' }

export function Dot({ level = 'muted', size = 6, className, title }) {
  return <span title={title} className={clsx('inline-block shrink-0 rounded-full', LEVEL_DOT[level], className)} style={{ width: size, height: size }} />
}

export function PresenceDot({ state, size = 6, className }) {
  const { t } = useTranslation('dashboard')
  if (!state) return null
  return <Dot level={PRESENCE_LEVEL[state] ?? 'muted'} size={size} className={className} title={t(`dashboard.live.presence.${state}`)} />
}

export const initialsOf = (name = '') => String(name).trim().replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()

/** Grey initials disc — the same for everyone (no colour per person). */
export function Initials({ name, size = 26, className }) {
  return (
    <span title={name} className={clsx('inline-flex shrink-0 select-none items-center justify-center rounded-full bg-black/[0.06] font-semibold text-ink-muted', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initialsOf(name) || '?'}
    </span>
  )
}

/** A panel: white, grey border, a plain title row. */
export function Block({ title, sub, actions, children, className, bodyClassName }) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-xl border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            {sub && <p className="mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
          </div>
          {actions && <div className="flex max-w-full items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

/** A neutral filter chip: active = teal outline. */
export function Chip({ active, onClick, children, count }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={clsx('inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:h-9',
        active ? 'border-brand-500 bg-surface text-brand-700' : 'border-border bg-surface text-ink-muted hover:text-ink')}>
      {children}
      {count != null && <span className="tabular-nums text-ink-faint">{count}</span>}
    </button>
  )
}

/** A thin bar: grey track, ink fill for what is done, a small tick for where it should be. */
export function ThinBar({ value, tick, className, title }) {
  return (
    <span title={title} className={clsx('relative block h-1.5 w-full rounded-full bg-black/[0.07]', className)}>
      <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      {tick != null && <span className="absolute -top-[3px] h-3 w-0.5 rounded bg-ink" style={{ left: `calc(${Math.min(100, tick)}% - 1px)` }} />}
    </span>
  )
}

/** Time "HH:MM" → minutes. */
export const toMin = (hhmm) => { const [h, m] = String(hhmm ?? '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

// ───────────────────────────────────────────────────────── plain words

/**
 * What the page is showing, for the wording: LIVE (now), PAST (an earlier time or day — what happened) or FUTURE
 * (a later time or day — the plan).
 */
export function situationOf(now) {
  if (!now || now.live) return 'LIVE'
  if (now.date > now.today || (now.isToday && now.time > now.clock)) return 'FUTURE'
  return 'PAST'
}

/** A section as people say it: "Class 8 – A", "Nursery – B" (from the class name and the section letter). */
export const sectionName = (className, short) => `${className} – ${String(short ?? '').split('-').pop()}`

/** A short name for a teacher: "Meenakshi R." */
export function shortName(name = '') {
  const w = String(name).trim().replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/).filter(Boolean)
  return w.length > 1 ? `${w[0]} ${w.at(-1)[0]}.` : w[0] ?? ''
}

/** Times, dates and money in the institution's locale: "8:10 am", "Wednesday 11 November", "₹33.3 lakh". */
export function usePlain() {
  const { t } = useTranslation('dashboard')
  const locale = getFormatConfig().locale || 'en-IN'
  const clock = (hhmm) => {
    if (!/^\d{1,2}:\d{2}$/.test(hhmm ?? '')) return hhmm ?? ''
    const [h, m] = hhmm.split(':').map(Number)
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h, m))
  }
  const day = (ymd, opts) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T12:00:00Z`))
  const longDate = (ymd) => day(ymd, { weekday: 'long', day: 'numeric', month: 'long' })
  const shortDate = (ymd) => day(ymd, { weekday: 'short', day: 'numeric', month: 'short' })
  const money = (paise) => {
    const r = Math.round((Number(paise) || 0) / 100)
    const one = (n) => Number(n.toFixed(n >= 100 ? 0 : 1))
    if (getFormatConfig().currency === 'INR' || !getFormatConfig().currency) {
      if (r >= 1e7) return t('dashboard.live.money.crore', { n: one(r / 1e7) })
      if (r >= 1e5) return t('dashboard.live.money.lakh', { n: one(r / 1e5) })
    }
    return formatCurrency(r)
  }
  return { clock, longDate, shortDate, money }
}
