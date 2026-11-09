import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronDown, Megaphone, Paperclip, Pin } from 'lucide-react'
import { PillRow, pillClass } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyNoticeFileUrl, familyNotices, familyReadNotice } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const UNREAD = '__unread'
const catKey = (c) => String(c ?? '').replace(/[^A-Za-z]/g, '')

/** Notices and circulars for the picked child; opening one tells the school it was read. */
export default function FamilyNotices() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const { data: rows = [], isLoading, error } = useFamilyQuery(['notices'], () => familyNotices(slug, studentId))
  const read = useMutation({ mutationFn: (noticeId) => familyReadNotice(slug, studentId, noticeId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'notices'] }); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'home'] }) } })
  const toggle = (n) => { setOpen((x) => (x === n.id ? null : n.id)); if (!n.read) read.mutate(n.id) }
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!rows.length) return <FCard><FEmpty icon={Megaphone} title={t('family.notices.none')} /></FCard>
  const cats = [...new Set(rows.map((n) => n.category).filter(Boolean))]
  const unread = rows.filter((n) => !n.read).length
  const shown = filter === UNREAD ? rows.filter((n) => !n.read || n.id === open) : filter ? rows.filter((n) => n.category === filter) : rows
  return (
    <>
      {(cats.length > 1 || unread > 0 || filter) && (
        <PillRow>
          <button type="button" onClick={() => setFilter('')} aria-pressed={!filter} className={pillClass(!filter)}>{t('family.notices.all')} <span className="tabular-nums opacity-70">{rows.length}</span></button>
          {(unread > 0 || filter === UNREAD) && <button type="button" onClick={() => setFilter(UNREAD)} aria-pressed={filter === UNREAD} className={pillClass(filter === UNREAD)}><span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden />{t('family.notices.unread')} <span className="tabular-nums opacity-70">{unread}</span></button>}
          {cats.length > 1 && cats.map((c) => <button key={c} type="button" onClick={() => setFilter(c)} aria-pressed={filter === c} className={pillClass(filter === c)}>{t(`family.notices.categories.${catKey(c)}`, c)}</button>)}
        </PillRow>
      )}
      {!shown.length && <FCard><FEmpty icon={Megaphone} title={t('family.notices.noneHere')} /></FCard>}
      {shown.map((n) => (
        <FCard key={n.id} className={clsx(!n.read && 'border-brand-200')}>
          <button type="button" onClick={() => toggle(n)} className="-m-1 flex w-[calc(100%+0.5rem)] min-h-[44px] items-start gap-3 rounded-xl p-1 text-start" aria-expanded={open === n.id}>
            <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center text-xs font-semibold uppercase tracking-wide text-brand-600">{n.pinned && <Pin className="me-1 inline h-3 w-3" aria-label={t('family.notices.pinned')} />}{t(`family.notices.categories.${catKey(n.category)}`, n.category)}</span>
                <span className="text-xs text-ink-faint">{dateTime(n.publishedAt)}</span>
              </span>
              <span className={clsx('mt-0.5 block text-[15px] leading-snug text-ink break-words', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
              {open !== n.id && (n.body || n.files.length > 0) && (
                <span className="mt-1 block text-sm text-ink-muted line-clamp-2 break-words">
                  {n.files.length > 0 && <Paperclip className="me-1 inline h-3.5 w-3.5 align-[-2px]" aria-label={t('family.notices.hasFiles')} />}{n.body}
                </span>
              )}
            </span>
            <ChevronDown className={clsx('mt-0.5 h-5 w-5 shrink-0 text-ink-faint transition-transform', open === n.id && 'rotate-180')} aria-hidden />
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
      ))}
    </>
  )
}
