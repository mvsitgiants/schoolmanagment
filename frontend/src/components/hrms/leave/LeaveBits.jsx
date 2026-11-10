import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { StatusPill } from '../../system'
import { useFormat } from '../../../context/SettingsContext'

// Leave pieces shared by Staff & HR › Leave and My workspace (calm: grey and teal; amber only for what waits on someone).

/** A number of days with halves as ½: 9.5 → "9½", 0.5 → "½" (balances move in half days). */
export function halves(n) {
  const v = Math.round(Number(n ?? 0) * 100) / 100
  const whole = Math.trunc(v)
  const frac = Math.abs(v - whole)
  if (frac === 0.5) return `${whole === 0 ? (v < 0 ? '-' : '') : whole}½`
  return frac ? String(v) : String(whole)
}

/** Whole or half days in words: 1 → "1 day", 2.5 → "2½ days", 0.5 → "half a day". */
export function useDaysText() {
  const { t } = useTranslation('hrmsLeave')
  return (n) => {
    const v = Number(n ?? 0)
    if (Math.abs(v) === 0.5) return t('hrmsLeave.bits.halfADay')
    return t('hrmsLeave.bits.days', { count: Math.abs(v) === 1 ? 1 : 2, n: halves(v) })
  }
}

/** "7 Dec 2026", "7 – 9 Dec 2026", "7 Dec 2026, morning". */
export function useLeaveDates() {
  const { t } = useTranslation('hrmsLeave')
  const { date } = useFormat()
  return (l) => {
    if (!l?.from) return ''
    const span = l.to && l.to !== l.from ? t('hrmsLeave.bits.range', { from: date(l.from), to: date(l.to) }) : date(l.from)
    if (!l.halfDay) return span
    return l.half === 'SECOND' ? t('hrmsLeave.bits.afternoon', { dates: span }) : t('hrmsLeave.bits.morning', { dates: span })
  }
}

// waiting is the one that needs someone; the rest are settled and read calmly
const STATUS_TONE = { PENDING: 'warning', APPROVED: 'brand', REJECTED: 'neutral', CANCELLED: 'neutral' }

export function LeaveStatusPill({ status }) {
  const { t } = useTranslation('hrmsLeave')
  return <StatusPill tone={STATUS_TONE[status] ?? 'neutral'}>{t(`hrmsLeave.status.${status}`, { defaultValue: status })}</StatusPill>
}

/** The leave type's name, with "unpaid" when it is. */
export function LeaveTypeName({ name, paid, className }) {
  const { t } = useTranslation('hrmsLeave')
  return (
    <span className={clsx('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span className="text-ink">{name}</span>
      {paid === false && <span className="text-[11px] font-medium text-ink-muted">{t('hrmsLeave.bits.unpaid')}</span>}
    </span>
  )
}

/** What is left of a balance as a thin bar: teal, amber when a quarter or less is left, red when overdrawn. */
export function BalanceBar({ left, of, className }) {
  const total = Number(of) || 0
  const v = Number(left) || 0
  const pct = total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0
  const tone = v < 0 ? 'bg-danger-500' : total > 0 && v <= total * 0.25 ? 'bg-amber-400' : 'bg-brand-500'
  return (
    <span className={clsx('block h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]', className)} aria-hidden>
      <span className={clsx('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </span>
  )
}

/** "9 of 12 days left" / "No balance needed" for one balance row. */
export function useBalanceText() {
  const { t } = useTranslation('hrmsLeave')
  const days = useDaysText()
  return (b) => {
    if (!b) return ''
    if (b.unlimited) return b.taken ? t('hrmsLeave.bits.noLimitTaken', { days: days(b.taken) }) : t('hrmsLeave.bits.noLimit')
    if (!b.ofTotal) return b.available > 0 ? t('hrmsLeave.bits.leftOnly', { days: days(b.available) }) : t('hrmsLeave.bits.noneYet')
    return t('hrmsLeave.bits.leftOf', { left: halves(b.available ?? b.balance), of: days(b.ofTotal) })
  }
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const dowOf = (ymd) => DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()]

/** The short weekday ("Mon") for a date, translated. */
export function useDow() {
  const { t } = useTranslation('hrmsLeave')
  return (ymd) => t(`hrmsLeave.dow.${dowOf(ymd)}`)
}

/** Drop the server cache of everything leave shows. */
export const invalidateLeave = (qc) => {
  for (const k of ['leaves', 'leave', 'leave-summary', 'leave-balances', 'leave-calendar', 'leave-types', 'leave-year-end', 'emp-leave', 'emp-ledger', 'staff-day', 'staff-month']) qc.invalidateQueries({ queryKey: [k] })
  qc.invalidateQueries({ queryKey: ['hrms', 'me'] })
}

/** The API's "fields" errors and message. */
export const fieldErrors = (e) => e?.response?.data?.details?.fields ?? {}
