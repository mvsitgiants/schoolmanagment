import { useTranslation } from 'react-i18next'
import { CalendarClock, Ticket, Trophy } from 'lucide-react'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyDocUrl, familyResults } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

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
      {d.upcoming.map((e) => (
        <FCard key={e.candidateId} title={e.exam} action={<a href={familyDocUrl(slug, 'HALL_TICKET', e.candidateId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 min-h-[44px]"><Ticket className="w-4 h-4" />{t('family.results.hallTicket')}</a>}>
          <div className="divide-y divide-border -my-2">
            {e.papers.map((p) => (
              <div key={`${p.subject}-${p.date}`} className="py-2.5 flex items-center gap-3 text-sm">
                <CalendarClock className="w-4 h-4 text-ink-faint shrink-0" aria-hidden />
                <span className="w-24 shrink-0 text-ink-muted">{p.date ? date(p.date) : '—'}</span>
                <span className="flex-1 font-medium text-ink">{p.subject}</span>
                {p.startTime && <span className="text-ink-faint">{p.startTime}</span>}
              </div>
            ))}
          </div>
        </FCard>
      ))}
      <FCard title={t('family.results.title')}>
        {d.results.length ? (
          <div className="divide-y divide-border -my-2">
            {d.results.map((r) => (
              <FRow key={r.candidateId} href={familyDocUrl(slug, 'REPORT_CARD', r.candidateId)} icon={Trophy} tone={r.result === 'FAIL' ? 'danger' : 'success'}
                title={r.exam}
                subtitle={[r.pct !== null && r.pct !== undefined ? `${r.pct}%` : null, r.grade, r.rank ? t('family.results.rank', { rank: r.rank }) : null, t(`family.result.${r.result}`, r.resultLabel)].filter(Boolean).join(' · ')}
                meta={t('family.results.openCard')} />
            ))}
          </div>
        ) : <FEmpty icon={Trophy} title={t('family.results.none')} hint={t('family.results.noneHint')} />}
      </FCard>
    </>
  )
}
