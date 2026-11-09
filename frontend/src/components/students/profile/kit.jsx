import { useCallback } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  CONCESSION_STATUS, INVOICE_STATUS, LEAVE_STATUS, MARK_BY, MESSAGE_STATUSES, NOTIFY_EVENT_BY, OFFER_STATUS, OUTPASS_STATUS, RESULT_STATUS,
  SUBMISSION_STATUS, YEAR_RESULT,
} from '@schoolgiant/shared'
import { TONE, hueTone } from '../../system'

// Small shared pieces of the Student 360 page (pages/Students/Profile.jsx). Presentation only — the data is the
// student record (GET /students/:id) and the overview (GET /students/:id/overview).

/** Only a real array becomes list state. */
export const list = (v) => (Array.isArray(v) ? v : [])

/** A section came back broken (the server logged it): show a quiet line instead of the card's body. */
export const broken = (v) => !!v?.error

/** Attendance / marks % tone: red under the floor, amber under 90 (attendance) or 60 (marks), else green. */
export const pctTone = (pct, floor = 75, good = 90) => (pct == null ? 'neutral' : pct < floor ? 'danger' : pct < good ? 'warning' : 'success')

/** Mark → tone and fill class for the attendance heat-map. */
export const MARK_FILL = { P: 'bg-emerald-500', A: 'bg-rose-500', L: 'bg-amber-400', HD: 'bg-sky-400', LV: 'bg-violet-400' }

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
export { addDays }

/** "2026-10" → "Oct" in the reader's language (no hard-coded month names). */
export function useMonthShort() {
  const { i18n } = useTranslation()
  return useCallback((ym) => new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`)), [i18n.language])
}

/** "2026-11-10" → "Tue" in the reader's language. */
export function useWeekdayShort() {
  const { i18n } = useTranslation()
  return useCallback((ymd) => new Intl.DateTimeFormat(i18n.language || 'en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`)), [i18n.language])
}

/**
 * Labels and tones for the other modules' statuses shown on this page — each read from that module's own words
 * (attendance, homework, exams, fees …), falling back to the shared English label.
 */
export function useLabels() {
  const { t } = useTranslation('students')
  return {
    mark: (s) => t(`attendance:attendance.marks.${s}`, MARK_BY[s]?.label ?? s),
    markTone: (s) => MARK_BY[s]?.tone ?? 'neutral',
    leave: (s) => t(`attendance:attendance.leave.status.${s}`, LEAVE_STATUS[s]?.label ?? s),
    leaveTone: (s) => LEAVE_STATUS[s]?.tone ?? 'neutral',
    homework: (s) => t(`homework:homework.status.${s}`, SUBMISSION_STATUS[s]?.label ?? s),
    homeworkTone: (s) => SUBMISSION_STATUS[s]?.tone ?? 'neutral',
    result: (s) => t(`exams:exams.result.${s}`, RESULT_STATUS[s]?.label ?? s),
    resultTone: (s) => RESULT_STATUS[s]?.tone ?? 'neutral',
    yearResult: (s) => t(`exams:exams.yearResults.result.${s}`, YEAR_RESULT[s]?.label ?? s),
    yearResultTone: (s) => YEAR_RESULT[s]?.tone ?? 'neutral',
    invoice: (s) => t(`fees:fees.invoiceStatus.${s}`, INVOICE_STATUS[s]?.label ?? s),
    invoiceTone: (s) => INVOICE_STATUS[s]?.tone ?? 'neutral',
    payMode: (m, fallback) => t(`fees:fees.modes.${m}`, fallback ?? m),
    concession: (s) => t(`fees:fees.concessionStatus.${s}`, CONCESSION_STATUS[s]?.label ?? s),
    concessionTone: (s) => CONCESSION_STATUS[s]?.tone ?? 'neutral',
    outpass: (s) => t(`hostel:hostel.outpassStatus.${s}`, OUTPASS_STATUS[s]?.label ?? s),
    outpassTone: (s) => OUTPASS_STATUS[s]?.tone ?? 'neutral',
    fineReason: (r, fallback) => t(`library:library.fineReasons.${r}`, fallback ?? r),
    rideMode: (m) => t(`transport:transport.modes.${m}`, m),
    offer: (s) => t(`placements:placements.offerStatus.${s}`, OFFER_STATUS[s]?.label ?? s),
    offerTone: (s) => OFFER_STATUS[s]?.tone ?? 'neutral',
    visitOutcome: (o) => t(`health:health.outcomes.${o}`, o),
    enrolment: (s) => t(`programs:programs.enrolmentStatus.${s}`, s),
    channel: (c) => t(`communication:communication.channels.${c}`, c),
    msgStatus: (s) => t(`communication:communication.log.status.${s}`, MESSAGE_STATUSES[s]?.label ?? s),
    msgTone: (s) => MESSAGE_STATUSES[s]?.tone ?? 'neutral',
    msgEvent: (e) => (e ? t(`communication:communication.log.events.${e.replace(/\./g, '_')}`, NOTIFY_EVENT_BY[e]?.label ?? e) : t('students.profile.messages.message')),
    certKind: (k, fallback) => t(`certificates:certificates.kinds.${k}.label`, fallback ?? k),
  }
}

/**
 * One calm headline figure (as My workspace): hairline card, grey icon and label, the value in ink (a tone only when it
 * means something), an optional sub-line and a thin bar. `onClick` makes it a way into the tab with the detail.
 */
export function Kpi({ icon: Icon, label, value, sub, tone, bar, barTone, onClick, className }) {
  const Comp = onClick ? 'button' : 'div'
  const text = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-success-600' : 'text-ink'
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick}
      className={clsx('flex min-w-0 flex-col rounded-xl border border-border bg-surface p-3.5 text-start sm:p-4',
        onClick && 'transition-colors hover:bg-black/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}<span className="truncate">{label}</span>
      </span>
      <span className={clsx('mt-1.5 truncate font-mono-num text-lg font-semibold leading-tight tabular-nums sm:text-xl', text)}>{value}</span>
      {sub != null && sub !== '' && <span className="mt-0.5 min-w-0 truncate text-xs text-ink-faint">{sub}</span>}
      {bar != null && (
        <span className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <span className={clsx('block h-full rounded-full', TONE[barTone ?? tone ?? 'brand']?.fill ?? TONE.brand.fill)} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
      )}
    </Comp>
  )
}

/** A quiet "nothing here" inside a card. */
export function Quiet({ icon: Icon, title, hint, className }) {
  return (
    <div className={clsx('flex flex-col items-center px-4 py-7 text-center', className)}>
      {Icon && <Icon className="mb-2 h-5 w-5 text-ink-faint" aria-hidden />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  )
}

/** A section the server could not read this time. */
export function SectionError() {
  const { t } = useTranslation('students')
  return <p className="px-4 py-6 text-center text-sm text-ink-faint">{t('students.profile.sectionError')}</p>
}

/** A big figure with its label under it — inside cards (year result, wallet balance). */
export function Figure({ value, label, tone, className }) {
  const text = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-success-600' : 'text-ink'
  return (
    <div className={clsx('min-w-0', className)}>
      <p className={clsx('font-display text-2xl font-bold leading-none tabular-nums', text)}>{value}</p>
      {label && <p className="mt-1 truncate text-xs text-ink-faint">{label}</p>}
    </div>
  )
}

/**
 * Horizontal bars, one per row (subjects, months): label, a bar to 100, the figure. `tone` per row, else from the %.
 *   <BarList rows={[{ key, label, pct, value: '54 / 80', tone }]} floor={33} />
 */
export function BarList({ rows = [], floor = 33, good = 60, className }) {
  return (
    <ul className={clsx('flex flex-col gap-2.5', className)}>
      {rows.map((r) => {
        const tone = r.tone ?? pctTone(r.pct, floor, good)
        return (
          <li key={r.key ?? r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
            <span className="flex min-w-0 items-center gap-2">
              <span className={clsx('h-2 w-2 shrink-0 rounded-full', TONE[hueTone(r.seed ?? r.label)].dot)} aria-hidden />
              <span className="truncate text-ink">{r.label}</span>
            </span>
            <span className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
              {r.pct != null && <span className={clsx('block h-full rounded-full', TONE[tone].fill)} style={{ width: `${Math.max(2, Math.min(100, r.pct))}%` }} />}
            </span>
            <span className={clsx('min-w-[4.5rem] text-end text-xs font-semibold tabular-nums', tone === 'neutral' ? 'text-ink-faint' : TONE[tone].text)}>{r.value}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** The fields of a group that are not filled, as one muted line ("Not filled: Religion · Mother tongue"). */
export function MissingLine({ items = [], className }) {
  const { t } = useTranslation('students')
  if (!items.length) return null
  return (
    <p className={clsx('text-xs text-ink-faint', className)}>
      <span className="font-medium text-ink-muted">{t('students.profile.notFilled')}</span> {items.join(' · ')}
    </p>
  )
}

/** A colour key (heat-map legend, bar meanings). */
export function Legend({ items = [], className }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted', className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={clsx('h-2.5 w-2.5 rounded-[3px]', it.fill)} aria-hidden />{it.label}
          {it.count != null && <span className="font-semibold tabular-nums text-ink">{it.count}</span>}
        </span>
      ))}
    </div>
  )
}

/** Digits of a mobile for wa.me — a 10-digit Indian number gets the 91 country code. */
export const waNumber = (m) => {
  const d = String(m ?? '').replace(/\D/g, '')
  return d.length === 10 ? `91${d}` : d
}
