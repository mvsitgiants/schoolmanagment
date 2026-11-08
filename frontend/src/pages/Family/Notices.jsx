import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown, Megaphone, Paperclip, Pin } from 'lucide-react'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyNoticeFileUrl, familyNotices, familyReadNotice } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const catKey = (c) => String(c ?? '').replace(/[^A-Za-z]/g, '')

/** Notices and circulars for the picked child; opening one tells the school it was read. */
export default function FamilyNotices() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const [open, setOpen] = useState(null)
  const { data: rows = [], isLoading, error } = useFamilyQuery(['notices'], () => familyNotices(slug, studentId))
  const read = useMutation({ mutationFn: (noticeId) => familyReadNotice(slug, studentId, noticeId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'notices'] }); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'home'] }) } })
  const toggle = (n) => { setOpen((x) => (x === n.id ? null : n.id)); if (!n.read) read.mutate(n.id) }
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!rows.length) return <FCard><FEmpty icon={Megaphone} title={t('family.notices.none')} /></FCard>
  return rows.map((n) => (
    <FCard key={n.id}>
      <button type="button" onClick={() => toggle(n)} className="w-full text-start flex items-start gap-3" aria-expanded={open === n.id}>
        <span className={clsx('mt-1.5 w-2 h-2 rounded-full shrink-0', n.read ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-brand-600">{n.pinned && <Pin className="inline w-3 h-3 me-1" aria-hidden />}{t(`family.notices.categories.${catKey(n.category)}`, n.category)}</span>
          <span className={clsx('block mt-0.5 text-[15px] text-ink break-words', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
          <span className="block text-xs text-ink-faint mt-0.5">{dateTime(n.publishedAt)}</span>
        </span>
        <ChevronDown className={clsx('w-5 h-5 text-ink-faint shrink-0 transition-transform', open === n.id && 'rotate-180')} aria-hidden />
      </button>
      {open === n.id && (
        <div className="mt-3 ps-5">
          {n.body && <p className="text-[15px] text-ink whitespace-pre-line break-words">{n.body}</p>}
          {n.files.length > 0 && (
            <div className="mt-3 space-y-1">
              {n.files.map((f) => (
                <a key={f.id} href={familyNoticeFileUrl(slug, studentId, n.id, f.id)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm text-ink hover:bg-black/[0.02]">
                  <Paperclip className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="flex-1 truncate">{f.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </FCard>
  ))
}
