import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { SectionCard } from '../../components/system'

/**
 * Small pieces shared by the My workspace tabs. Everything here is presentation —
 * the data always comes from the caller's own record.
 */

const DOT = '•'
/** Keep the first and last quarter, dot out the middle half: "9876543210" → "987•••••10". */
const maskMiddle = (s) => {
  if (s.length <= 2) return s.slice(0, 1) + DOT
  const head = Math.ceil(s.length / 4)
  const tail = Math.floor(s.length / 4)
  return s.slice(0, head) + DOT.repeat(s.length - head - tail) + s.slice(s.length - tail)
}

/**
 * Half-hide a sensitive value (date of birth, home address) until the person asks to see it —
 * enough to recognise it, not to copy it. Everyday contact details (phone, email, emergency
 * contact) are never hidden. `kind`: 'email' keeps the domain, 'date' keeps the year,
 * 'address' hides the street line and keeps the city onwards. A blank stays blank ("—").
 */
export function hide(show, v, kind) {
  if (show || v == null || v === '') return v
  const s = String(v)
  if (kind === 'email' && s.includes('@')) {
    const at = s.lastIndexOf('@')
    return maskMiddle(s.slice(0, at)) + s.slice(at)
  }
  if (kind === 'date') return s.replace(/\d{4}|\d/g, (m) => (m.length === 4 ? m : DOT))
  if (kind === 'address') {
    const [line, ...rest] = s.split(', ')
    return [maskMiddle(line), ...rest].join(', ')
  }
  return maskMiddle(s)
}

/**
 * The eye that shows / half-hides sensitive details (date of birth, address, ids, bank). They start hidden so a
 * workspace left open at a nursing station, or looked over a shoulder, doesn't show them.
 */
export function RevealToggle({ show, onToggle }) {
  const { t } = useTranslation('me')
  const Icon = show ? EyeOff : Eye
  const label = show ? t('me.shared.hideDetails') : t('me.shared.viewDetails')
  return (
    <button type="button" onClick={onToggle} aria-pressed={show} title={label} aria-label={label}
      className="h-11 w-11 sm:h-8 sm:w-8 inline-flex shrink-0 items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-black/5">
      <Icon className="w-4 h-4" />
    </button>
  )
}

/** A label / value line. Values that are missing read "—" rather than going blank. */
export function Info({ label, value, children, className }) {
  const empty = children == null && (value == null || value === '')
  return (
    <div className={clsx('flex flex-col gap-0.5 min-w-0', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={clsx('text-sm break-words', empty ? 'text-ink-faint' : 'text-ink font-medium')}>
        {children ?? (empty ? '—' : value)}
      </span>
    </div>
  )
}

/** A responsive grid of Info lines — the layout every detail panel on this page uses. */
export function InfoGrid({ children, cols = 2, className }) {
  return (
    <div className={clsx('grid gap-x-6 gap-y-4', cols === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2', className)}>
      {children}
    </div>
  )
}

/** A card of Info lines — plain white, hairline border, no shadow (as Student 360's sections). */
export function InfoPanel({ title, subtitle, icon, actions, cols = 2, children, className }) {
  return (
    <SectionCard icon={icon} title={title} hint={subtitle} actions={actions} className={className}>
      <InfoGrid cols={cols}>{children}</InfoGrid>
    </SectionCard>
  )
}

/** Put on a <DataTable> that sits inside a SectionCard, so the table doesn't draw a second card. */
export const FLAT_TABLE = '!rounded-none !border-0 !shadow-none'

/** Taller buttons on a phone, where they are tapped with a thumb. */
export const TOUCH = 'max-sm:h-auto max-sm:min-h-[44px] max-sm:py-2'

/** A section heading on a tab (outside a panel), as on the ERP overview. */
export function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="font-display text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  )
}

/**
 * One headline figure — calm: white, hairline border, the icon and label in grey, the value in
 * ink (a `tone` only when it means something: danger / warning / success). `onClick` makes it a
 * way into the tab with the detail. `row`: label left, value right on a phone (for a stack of 3).
 */
export function Tile({ icon: Icon, label, value, sub, tone, onClick, row = false, className, children }) {
  const Comp = onClick ? 'button' : 'div'
  const toneText = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-success-600' : 'text-ink'
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick} aria-label={onClick && typeof value !== 'object' ? `${label}: ${value}` : undefined}
      className={clsx('min-w-0 rounded-xl border border-border bg-surface p-3.5 sm:p-4 text-start',
        row ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-1' : 'flex flex-col',
        onClick && 'transition-colors hover:bg-black/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-ink-faint" aria-hidden />}<span className="truncate">{label}</span>
      </span>
      <span className={clsx('font-mono-num tabular-nums font-semibold leading-tight break-words', toneText,
        row ? 'row-span-2 text-lg sm:row-span-1 sm:mt-1.5 sm:text-xl' : 'mt-1.5 text-lg sm:text-xl')}>{value}</span>
      {sub != null && sub !== '' && <span className="mt-0.5 min-w-0 truncate text-xs text-ink-faint">{sub}</span>}
      {children}
    </Comp>
  )
}

/** A quiet "nothing here" inside a card — no dashed box, no tinted circle. */
export function QuietEmpty({ icon: Icon, title, hint, className }) {
  return (
    <div className={clsx('flex flex-col items-center px-4 py-8 text-center', className)}>
      {Icon && <Icon className="mb-2 w-5 h-5 text-ink-faint" aria-hidden />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  )
}

/** "Show all (12)" / "Show less" under a short list. */
export function MoreToggle({ all, total, onToggle, className }) {
  const { t } = useTranslation('me')
  return (
    <button type="button" onClick={onToggle} className={clsx('inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-brand-600 hover:text-brand-700', className)}>
      {all ? t('me.shared.showLess') : t('me.shared.viewAll', { total })}
    </button>
  )
}

/** One line of an address, from the HR record's parts. */
export const addressText = (a) => [a?.line, a?.city, a?.state, a?.pincode].filter(Boolean).join(', ') || null

/** Whole and half days: 1 → "1", 2.5 → "2.5". */
export const daysNum = (n) => Number(n ?? 0).toFixed(1).replace(/\.0$/, '')

/** Only a real array becomes list state — never an error body that slipped through. */
export const list = (v) => (Array.isArray(v) ? v : [])

/** An error a query can be quiet about: the login has no staff record, or the module is off. */
export const isQuietError = (e) => [403, 404].includes(e?.response?.status)

/** A licence or document that has expired, or is inside the warning window HR set. */
export const isDue = (r) => r.state === 'EXPIRED' || r.state === 'EXPIRING'

/** My joining / exit checklists still open, or with something left for me to tick. */
export const openChecklists = (tasks) => list(tasks?.mine).filter((c) => c.status === 'IN_PROGRESS' || list(c.tasks).some((t) => t.canTick && t.status === 'PENDING'))

/** Is it this person's turn on a review? (`team`: one they give as reporting manager.) */
export const myTurn = (r, team) => (team ? r.status === 'MANAGER' || r.status === 'DRAFT' : r.status === 'SELF')
