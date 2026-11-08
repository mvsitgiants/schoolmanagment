import { useTranslation } from 'react-i18next'
import { BookOpen, ExternalLink, Library, Paperclip } from 'lucide-react'
import { StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyEbookFileUrl, familyLibrary } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { formatINR } from '@schoolgiant/shared'

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The family app › Library: books out and when they're due, fines, the e-library. */
export default function FamilyLibrary() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['library'], () => familyLibrary(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  return (
    <>
      <FCard title={t('family.library.out')}>
        {!d.out.length ? <FEmpty icon={Library} title={t('family.library.noneOut')} /> : (
          <div className="divide-y divide-border">
            {d.out.map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2">
                <BookOpen className="w-5 h-5 shrink-0 text-ink-faint" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{l.title}</p>
                  <p className="text-xs text-ink-muted">{t('family.library.dueOn', { date: date(l.dueOn) })}</p>
                </div>
                {l.state === 'OVERDUE'
                  ? <StatusPill tone="danger">{t('family.library.late', { count: l.daysLate })}</StatusPill>
                  : <StatusPill tone={l.daysLeft <= 1 ? 'warning' : 'neutral'}>{l.daysLeft === 0 ? t('family.library.dueToday') : t('family.library.daysLeft', { count: l.daysLeft })}</StatusPill>}
              </div>
            ))}
          </div>
        )}
        {d.out.some((l) => l.fineSoFar > 0) && <p className="mt-2 text-xs text-danger-600">{t('family.library.fineSoFar', { amount: formatINR(d.out.reduce((n, l) => n + l.fineSoFar, 0)) })}</p>}
      </FCard>
      {d.owed > 0 && (
        <FCard title={t('family.library.fines')}>
          <div className="divide-y divide-border">
            {d.fines.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0"><span className="block text-ink">{t(`family.library.reasons.${f.reason}`)}</span>{f.title && <span className="block text-xs text-ink-muted truncate">{f.title}</span>}</span>
                <span className="font-medium text-ink">{formatINR(f.amount)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t('family.library.payAtLibrary', { amount: formatINR(d.owed) })}</p>
        </FCard>
      )}
      {d.ebooks.length > 0 && (
        <FCard title={t('family.library.ebooks')}>
          <div className="divide-y divide-border">
            {d.ebooks.map((e) => (
              <div key={e.id} className="py-2">
                <p className="text-sm font-medium text-ink">{e.title}</p>
                {(e.authors.length > 0 || e.category) && <p className="text-xs text-ink-muted">{[e.authors.join(', '), e.category].filter(Boolean).join(' · ')}</p>}
                {e.description && <p className="mt-1 text-xs text-ink-muted line-clamp-2">{e.description}</p>}
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><ExternalLink className="w-4 h-4" />{t('family.library.open')}</a>}
                  {e.files.map((f) => <a key={f.id} href={familyEbookFileUrl(slug, studentId, e.id, f.id)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><Paperclip className="w-4 h-4" />{f.name} <span className="text-xs text-ink-faint">({size(f.size)})</span></a>)}
                </div>
              </div>
            ))}
          </div>
        </FCard>
      )}
      {d.past.length > 0 && (
        <FCard title={t('family.library.past')}>
          <div className="divide-y divide-border">
            {d.past.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate text-ink">{l.title}</span>
                <span className="shrink-0 text-xs text-ink-muted">{l.status === 'LOST' ? t('family.library.lost') : date(l.returnedOn)}</span>
              </div>
            ))}
          </div>
        </FCard>
      )}
    </>
  )
}
