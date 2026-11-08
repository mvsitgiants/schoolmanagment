import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, Paperclip } from 'lucide-react'
import { SUBMISSION_STATUS } from '@schoolgiant/shared'
import { SegmentedControl, StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyFileUrl, familyHomework } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function FamilyHomework() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [when, setWhen] = useState('OPEN')
  const { data: d, isLoading, error } = useFamilyQuery(['homework', when], () => familyHomework(slug, studentId, when))
  return (
    <>
      <SegmentedControl value={when} onChange={setWhen} options={[{ value: 'OPEN', label: t('family.homework.upcoming') }, { value: 'PAST', label: t('family.homework.past') }]} />
      {isLoading ? <FSkeleton className="h-64" /> : error ? <FError error={error} /> : !d?.items.length ? (
        <FCard><FEmpty icon={BookOpenCheck} title={when === 'OPEN' ? t('family.homework.noneUpcoming') : t('family.homework.nonePast')} /></FCard>
      ) : d.items.map((h) => (
        <FCard key={h.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{h.subject}</p>
              <p className="mt-0.5 text-[15px] font-semibold text-ink break-words">{h.title}</p>
            </div>
            {h.needsSubmission && <StatusPill tone={SUBMISSION_STATUS[h.status]?.tone}>{t(`family.submission.${h.status}`, h.statusLabel)}</StatusPill>}
          </div>
          {h.details && <p className="mt-2 text-sm text-ink whitespace-pre-line break-words">{h.details}</p>}
          <p className={`mt-2 text-sm ${h.dueDate === d.today ? 'text-danger-700 font-medium' : 'text-ink-muted'}`}>
            {h.dueDate === d.today ? t('family.homework.dueToday') : t('family.homework.due', { date: date(h.dueDate) })}{h.teacher ? ` · ${h.teacher}` : ''}
          </p>
          {h.remark && <p className="mt-1 text-sm text-ink-muted italic">“{h.remark}”</p>}
          {h.files.length > 0 && (
            <div className="mt-3 space-y-1">
              {h.files.map((f) => (
                <a key={f.id} href={familyFileUrl(slug, studentId, h.id, f.id)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm text-ink hover:bg-black/[0.02]">
                  <Paperclip className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-ink-faint">{size(f.size)}</span>
                </a>
              ))}
            </div>
          )}
        </FCard>
      ))}
    </>
  )
}
