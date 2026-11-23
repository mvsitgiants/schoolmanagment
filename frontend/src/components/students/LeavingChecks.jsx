import { useTranslation } from 'react-i18next'
import { formatINR } from '@schoolgiant/shared'
import { StatusPill } from '../system'
import { useFormat } from '../../context/SettingsContext'

/**
 * What the records say is open for a student leaving: dues the family must clear before the TC (fees due by the
 * leaving date, library books and fines) and things the school winds up (hostel bed, bus route, canteen balance,
 * fee bills for after the leaving date). Only the modules that are switched on are checked.
 */
export default function LeavingChecks({ data, compact = false }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  if (!data) return <div className="h-20 rounded-xl bg-black/5 animate-pulse" />
  if (!data.checks.length) return null
  const money = (p) => formatINR(p ?? 0)
  const text = (c) => {
    switch (c.key) {
      case 'fees': return c.ok ? t('students.leaving.feesOk') : t('students.leaving.feesDue', { amount: money(c.total), bills: c.bills.map((b) => `${b.installment} (${date(b.dueDate)})`).join(', ') })
      case 'laterBills': return t('students.leaving.laterBills', { count: c.bills.length, amount: money(c.total) })
      case 'library': return c.ok ? t('students.leaving.libraryOk') : [c.booksOut.length ? t('students.leaving.booksOut', { count: c.booksOut.length, titles: c.booksOut.map((b) => b.title).join(', ') }) : null, c.fineTotal ? t('students.leaving.fines', { amount: money(c.fineTotal) }) : null].filter(Boolean).join(' · ')
      case 'hostel': return c.ok ? t('students.leaving.hostelOk') : t('students.leaving.hostelBed', { place: [c.block, c.room && t('students.leaving.room', { n: c.room }), c.bed && t('students.leaving.bed', { n: c.bed })].filter(Boolean).join(', ') })
      case 'transport': return c.ok ? t('students.leaving.transportOk') : t('students.leaving.onRoute', { route: c.route ?? '', stop: c.stop ?? '' })
      case 'canteen': return c.ok ? t('students.leaving.canteenOk') : t('students.leaving.walletLeft', { amount: money(c.balance) })
      default: return c.key
    }
  }
  const pill = (c) => (c.ok ? <StatusPill tone="success">{t('students.leaving.clear')}</StatusPill>
    : c.kind === 'DUE' ? <StatusPill tone="danger">{t('students.leaving.due')}</StatusPill>
      : <StatusPill tone="warning">{t('students.leaving.toDo')}</StatusPill>)
  // the clear ones only add noise in the form; the issue step shows everything
  const rows = compact ? data.checks.filter((c) => !c.ok) : data.checks
  return (
    <div className="rounded-xl border border-border bg-black/[0.015] p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('students.leaving.title', { date: date(data.leavingDate) })}</p>
      {!rows.length ? <p className="text-sm text-ink-muted">{t('students.leaving.allClear')}</p> : rows.map((c) => (
        <div key={c.key} className="flex items-start gap-2 text-sm">
          <span className="shrink-0">{pill(c)}</span>
          <span className="min-w-0 text-ink break-words">{text(c)}</span>
        </div>
      ))}
    </div>
  )
}
