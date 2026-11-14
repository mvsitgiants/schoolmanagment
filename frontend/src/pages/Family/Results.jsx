import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Award, CalendarClock, ChevronRight, Lock, Ticket, Trophy } from 'lucide-react'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyDocUrl, familyResults } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** Why something is on hold, in plain words — only the reasons the school lets the family see. */
function useWhy() {
  const { t } = useTranslation('family')
  const { currencyValue } = useFormat()
  return (reasons = []) => reasons.map((r) => (r.kind === 'FEES' ? t('family.hold.why.FEES', { amount: currencyValue(r.amount / 100) })
    : r.kind === 'ATTENDANCE' ? t('family.hold.why.ATTENDANCE', { pct: r.pct, below: r.below }) : r.text)).filter(Boolean).join(' · ')
}

/** "On hold — please contact the school office", and why when the school says so. */
function OnHold({ what, reasons }) {
  const { t } = useTranslation('family')
  const why = useWhy()(reasons)
  return (
    <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{t(`family.hold.${what}`)}{why && <span className="mt-0.5 block text-xs text-amber-800">{why}</span>}</span>
    </div>
  )
}

export default function FamilyResults() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['results'], () => familyResults(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d) return null
  return (
    <>
      {d.year && <YearCard y={d.year} href={familyDocUrl(slug, 'YEAR_REPORT_CARD', studentId)} />}
      {d.upcoming.map((e) => (
        <FCard key={e.candidateId} title={e.exam} action={!e.admitCard?.held && <a href={familyDocUrl(slug, 'HALL_TICKET', e.candidateId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 min-h-[44px]"><Ticket className="w-4 h-4" />{t('family.results.hallTicket')}</a>}>
          {e.admitCard?.held && <div className="mb-3"><OnHold what="admitCard" reasons={e.admitCard.reasons} /></div>}
          <div className="divide-y divide-border -my-2">
            {e.papers.map((p) => (
              <div key={`${p.subject}-${p.date}`} className="py-2.5 flex items-center gap-3 text-sm">
                <CalendarClock className="w-4 h-4 text-ink-faint shrink-0" aria-hidden />
                <span className="w-24 shrink-0 text-ink-muted tabular-nums">{p.date ? date(p.date) : '—'}</span>
                <span className="min-w-0 flex-1 font-medium text-ink break-words">{p.subject}</span>
                {p.startTime && <span className="shrink-0 text-ink-faint tabular-nums">{p.startTime}</span>}
              </div>
            ))}
          </div>
        </FCard>
      ))}
      <FCard title={t('family.results.title')}>
        {d.results.length ? (
          <div className="divide-y divide-border -my-2">
            {d.results.map((r) => {
              if (r.held) return (
                <div key={r.candidateId} className="space-y-2 px-1 py-3">
                  <p className="text-[15px] font-medium leading-snug text-ink break-words">{r.exam}</p>
                  <OnHold what="result" reasons={r.reasons} />
                </div>
              )
              const fail = r.result === 'FAIL'
              const has = r.pct !== null && r.pct !== undefined
              return (
                <a key={r.candidateId} href={familyDocUrl(slug, 'REPORT_CARD', r.candidateId)} target="_blank" rel="noreferrer" className="flex min-h-[72px] items-center gap-3 px-1 py-3 hover:bg-black/[0.02] active:bg-black/[0.04]">
                  <span className={clsx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl', fail ? 'bg-danger-50 text-danger-700' : 'bg-success-50 text-success-700')}>
                    {r.grade ? <span className="text-base font-bold leading-none">{r.grade}</span> : <Trophy className="h-5 w-5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug text-ink break-words">{r.exam}</span>
                    {has && (
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]"><span className={clsx('block h-full rounded-full', fail ? 'bg-danger-500' : 'bg-brand-500')} style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} /></span>
                        <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{r.pct}%</span>
                      </span>
                    )}
                    <span className="mt-1 block text-xs text-ink-muted">{[r.rank ? t('family.results.rank', { rank: r.rank }) : null, t(`family.result.${r.result}`, r.resultLabel), t('family.results.openCard')].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden />
                </a>
              )
            })}
          </div>
        ) : <FEmpty icon={Trophy} title={t('family.results.none')} hint={t('family.results.noneHint')} />}
      </FCard>
    </>
  )
}

const RESULT_TONE = { PASS: 'bg-success-50 text-success-700 border-success-200', COMPARTMENT: 'bg-amber-50 text-amber-800 border-amber-200', FAIL: 'bg-danger-50 text-danger-700 border-danger-200', INCOMPLETE: 'bg-black/[0.04] text-ink-muted border-border' }

/** The year-end result: overall %, grade and result, a bar per subject, and the annual report card. */
function YearCard({ y, href }) {
  const { t } = useTranslation('family')
  const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n * 10) / 10}%`)
  return (
    <FCard title={t('family.results.yearTitle', { year: y.year })} action={<a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-600"><Award className="h-4 w-4" />{t('family.results.yearCard')}</a>}>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <span className="text-2xl font-bold tabular-nums leading-none">{y.pct === null ? '—' : Math.round(y.pct)}</span>
          <span className="text-[11px] font-medium">{y.grade ? t('family.results.grade', { grade: y.grade }) : '%'}</span>
        </div>
        <div className="min-w-0 flex-1">
          <span className={clsx('inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold', RESULT_TONE[y.result])}>{t(`family.yearResult.${y.result}`, y.resultLabel)}</span>
          {y.failed.length > 0 && <p className="mt-1 text-xs text-ink-muted">{t('family.results.yearBelow', { subjects: y.failed.join(', ') })}</p>}
          {y.attendancePct !== null && y.attendancePct !== undefined && <p className="mt-1 text-xs text-ink-muted">{t('family.results.yearAttendance', { pct: Math.round(y.attendancePct) })}</p>}
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {y.subjects.map((x) => (
          <li key={x.subject} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-ink">{x.subject}</span>
              <span className={clsx('shrink-0 tabular-nums', x.pass === false ? 'font-semibold text-danger-600' : 'text-ink-muted')}>{pct(x.pct)}{x.grade ? ` · ${x.grade}` : ''}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div className={clsx('h-full rounded-full', x.pass === false ? 'bg-danger-500' : 'bg-brand-500')} style={{ width: `${Math.max(0, Math.min(100, x.pct ?? 0))}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {y.weights.length > 0 && <p className="mt-3 text-[11px] text-ink-faint">{t('family.results.yearHow', { parts: y.weights.map((w) => `${w.name} ${Math.round(w.share)}%`).join(' · ') })}</p>}
      {y.remark && <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-ink">“{y.remark}”</p>}
    </FCard>
  )
}
