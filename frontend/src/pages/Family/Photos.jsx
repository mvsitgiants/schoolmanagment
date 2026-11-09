import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, Images, X } from 'lucide-react'
import { SideNav, SideNavLayout } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyAlbum, familyAlbums, familyPhotoUrl } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** One photo full screen: save it, step to the next / previous (buttons, arrow keys), close. */
function Viewer({ photos, index, url, onIndex, onClose }) {
  const { t } = useTranslation('family')
  const p = photos[index]
  const step = useCallback((n) => onIndex((index + n + photos.length) % photos.length), [index, photos.length, onIndex])
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [step, onClose])
  const nav = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20'
  return (
    <div role="dialog" aria-modal="true" aria-label={p.name} className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="px-2 text-sm text-white/80 tabular-nums">{t('family.photos.position', { n: index + 1, total: photos.length })}</span>
        <div className="flex items-center gap-1">
          <a href={`${url(p)}?download=1`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm text-white hover:bg-white/10"><Download className="h-4 w-4" aria-hidden />{t('family.photos.save')}</a>
          <button type="button" onClick={onClose} aria-label={t('family.photos.close')} className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10"><X className="h-5 w-5" aria-hidden /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={onClose}>
        <img src={url(p)} alt={p.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
      {photos.length > 1 && (
        <div className="flex items-center justify-center gap-6 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => step(-1)} aria-label={t('family.photos.prev')} className={nav}><ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden /></button>
          <button type="button" onClick={() => step(1)} aria-label={t('family.photos.next')} className={nav}><ChevronRight className="h-6 w-6 rtl:rotate-180" aria-hidden /></button>
        </div>
      )}
    </div>
  )
}

function Album({ id, onBack }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [big, setBig] = useState(null)
  const { data: a, isLoading, error } = useFamilyQuery(['album', id], () => familyAlbum(slug, studentId, id))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const url = (p) => familyPhotoUrl(slug, studentId, a.id, p.id)
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-medium text-brand-700"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('family.photos.back')}</button>
      <FCard>
        <p className="text-[17px] font-semibold leading-snug text-ink break-words">{a.title}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{[a.date && date(a.date), t('family.photos.count', { count: a.photos.length })].filter(Boolean).join(' · ')}</p>
        {a.description && <p className="mt-2 text-sm text-ink-muted break-words">{a.description}</p>}
        <div className="-mx-2 mt-3 grid grid-cols-3 gap-1 sm:gap-1.5">
          {a.photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setBig(i)} className="block overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={p.name}>
              <img src={url(p)} alt={p.name} loading="lazy" className="aspect-square w-full bg-black/[0.04] object-cover transition-transform hover:scale-[1.03]" />
            </button>
          ))}
        </div>
      </FCard>
      {big !== null && a.photos[big] && <Viewer photos={a.photos} index={big} url={url} onIndex={setBig} onClose={() => setBig(null)} />}
    </>
  )
}

/** The family app › Photos: the school's albums for the child's class; an album opens with the others alongside. */
export default function FamilyPhotos() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [open, setOpen] = useState(null)
  const { data, isLoading, error } = useFamilyQuery(['albums'], () => familyAlbums(slug, studentId))
  useEffect(() => { setOpen(null) }, [studentId])
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.length) return <FCard><FEmpty icon={Images} title={t('family.photos.none')} /></FCard>
  if (open) {
    return (
      <SideNavLayout nav={data.length > 1 && (
        <SideNav title={t('family.photos.albums')} value={open} onChange={setOpen}
          items={data.map((a) => ({ id: a.id, label: a.title, icon: Images, hint: a.date ? date(a.date) : undefined, count: a.photos }))} />
      )}>
        <Album key={open} id={open} onBack={() => setOpen(null)} />
      </SideNavLayout>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {data.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="group flex min-w-0 flex-col justify-start overflow-hidden rounded-2xl border border-border bg-surface text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="relative block">
            {a.coverFileId
              ? <img src={familyPhotoUrl(slug, studentId, a.id, a.coverFileId)} alt="" loading="lazy" className="aspect-[4/3] w-full bg-black/[0.04] object-cover transition-transform group-hover:scale-[1.03]" />
              : <span className="flex aspect-[4/3] w-full items-center justify-center bg-brand-50 text-brand-300"><Images className="h-10 w-10" aria-hidden /></span>}
            <span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums"><Images className="h-3 w-3" aria-hidden />{a.photos}</span>
          </span>
          <span className="block p-2.5">
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{a.title}</span>
            {a.date && <span className="mt-0.5 block text-xs text-ink-muted">{date(a.date)}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
