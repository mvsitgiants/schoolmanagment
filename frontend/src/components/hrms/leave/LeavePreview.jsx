import clsx from 'clsx'
import { Loader2, Presentation, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Note } from '../../system'
import { useFormat } from '../../../context/SettingsContext'
import { halves, useDaysText, useDow } from './LeaveBits'

/**
 * What a leave would cost, from the server's preview: each date and whether it counts (holidays, weekly offs and
 * school vacation are free unless the sandwich rule pulls them in), the balance before and after, the no-leave days
 * it touches, a teacher's lessons on those days, who will approve it — and anything that stops it.
 * Pass the `useQuery` result of previewMyLeave / previewLeaveFor. `self`: worded for the person themselves.
 */
export default function LeavePreview({ query, self = true, name }) {
  const { t } = useTranslation('hrmsLeave')
  const { date } = useFormat()
  const days = useDaysText()
  const dow = useDow()
  const { data: p, error, isFetching } = query
  if (error) return <Note tone="danger">{error.message}</Note>
  if (!p) {
    return isFetching
      ? <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" />{t('hrmsLeave.preview.working')}</p>
      : <p className="text-sm text-ink-faint">{t('hrmsLeave.preview.pick')}</p>
  }
  const free = p.dates.filter((d) => !d.portion).length
  return (
    <div className={clsx('rounded-lg border border-border bg-bg/60', isFetching && 'opacity-70')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5 border-b border-border">
        <p className="text-sm font-semibold text-ink">
          {t(p.leaveType.paid ? 'hrmsLeave.preview.summary' : 'hrmsLeave.preview.summaryUnpaid', { days: days(p.days), type: p.leaveType.name })}
          {free > 0 && <span className="font-normal text-ink-muted"> · {t('hrmsLeave.preview.freeDays', { count: free })}</span>}
        </p>
        {p.leaveType.unlimited
          ? <p className="text-xs text-ink-muted">{t('hrmsLeave.preview.noBalance')}</p>
          : (
            <p className="text-xs text-ink-muted tabular-nums">
              {t('hrmsLeave.preview.before', { n: halves(p.available) })}
              {' → '}
              <span className={clsx('font-semibold', p.after < 0 ? 'text-danger-600' : 'text-ink')}>{t('hrmsLeave.preview.after', { n: halves(p.after) })}</span>
              {p.pending > 0 && <span> · {t('hrmsLeave.preview.waitingHeld', { days: days(p.pending) })}</span>}
            </p>
          )}
      </div>
      <ul className="divide-y divide-border max-h-48 overflow-y-auto scroll-thin">
        {p.dates.map((d) => (
          <li key={d.date} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="text-ink whitespace-nowrap"><span className="text-ink-faint text-xs w-9 inline-block">{dow(d.date)}</span>{date(d.date)}</span>
            <span className={clsx('text-xs text-end', d.portion > 0 ? 'text-ink' : 'text-ink-faint')}>
              {d.portion === 1 && (d.sandwiched ? t('hrmsLeave.preview.countsBetween', { reason: d.reason ?? t('hrmsLeave.preview.dayOff') }) : t('hrmsLeave.preview.counts'))}
              {d.portion === 0.5 && t('hrmsLeave.bits.halfADay')}
              {d.portion === 0 && t('hrmsLeave.preview.free', { reason: d.reason ?? t('hrmsLeave.preview.dayOff') })}
              {d.noLeave && <span className="block text-amber-700">{t('hrmsLeave.preview.noLeaveDay', { name: d.noLeave })}</span>}
            </span>
          </li>
        ))}
      </ul>
      {(p.problems.length > 0 || p.warnings.length > 0 || p.lessons || p.chain) && (
        <div className="p-2.5 border-t border-border space-y-2">
          {p.problems.length > 0 && <Note tone="danger">{p.problems.map((x) => <p key={x.code}>{x.text}</p>)}</Note>}
          {p.warnings.length > 0 && <Note tone="warning">{p.warnings.map((x) => <p key={x}>{x}</p>)}</Note>}
          {p.lessons?.total > 0 && (
            <Note icon={Presentation}>
              {self ? t('hrmsLeave.preview.lessonsMine', { count: p.lessons.total }) : t('hrmsLeave.preview.lessonsTheirs', { count: p.lessons.total, name })}
            </Note>
          )}
          {p.chain && (
            <p className="flex items-start gap-1.5 text-xs text-ink-muted">
              <Route className="w-3.5 h-3.5 mt-px shrink-0 text-ink-faint" aria-hidden />
              <span>{t('hrmsLeave.preview.goesTo', { steps: p.chain.steps.filter((s) => !s.skipped).map((s) => (s.people.length ? `${s.label} (${s.people.slice(0, 2).join(', ')})` : s.label)).join(' → ') })}</span>
            </p>
          )}
        </div>
      )}
      {p.leaveType.sandwich && p.dates.some((d) => d.sandwiched) && <p className="px-3 pb-2.5 text-[11px] text-ink-faint">{t('hrmsLeave.preview.sandwichNote', { type: p.leaveType.name })}</p>}
    </div>
  )
}
