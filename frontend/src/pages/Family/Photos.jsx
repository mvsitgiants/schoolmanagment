import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Download, Images } from 'lucide-react'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyAlbum, familyAlbums, familyPhotoUrl } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

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
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><ChevronLeft className="w-4 h-4" />{t('family.photos.back')}</button>
      <FCard>
        <p className="text-[15px] font-semibold text-ink">{a.title}</p>
        {a.date && <p className="text-xs text-ink-muted">{date(a.date)}</p>}
        {a.description && <p className="mt-1 text-sm text-ink-muted">{a.description}</p>}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {a.photos.map((p) => (
            <button key={p.id} type="button" onClick={() => setBig(p)} className="block">
              <img src={url(p)} alt={p.name} loading="lazy" className="aspect-square w-full rounded-lg object-cover bg-black/[0.04]" />
            </button>
          ))}
        </div>
      </FCard>
      {big && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setBig(null)}>
          <div className="flex justify-end gap-4 p-3">
            <a href={`${url(big)}?download=1`} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-white"><Download className="w-4 h-4" />{t('family.photos.save')}</a>
            <button type="button" className="min-h-[44px] text-sm text-white">{t('family.photos.close')}</button>
          </div>
          <img src={url(big)} alt={big.name} className="m-auto max-h-[85vh] max-w-full object-contain" />
        </div>
      )}
    </>
  )
}

/** The family app › Photos: the school's albums for the child's class, one at a time. */
export default function FamilyPhotos() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [open, setOpen] = useState(null)
  const { data, isLoading, error } = useFamilyQuery(['albums'], () => familyAlbums(slug, studentId))
  if (open) return <Album id={open} onBack={() => setOpen(null)} />
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.length) return <FCard><FEmpty icon={Images} title={t('family.photos.none')} /></FCard>
  return (
    <div className="grid grid-cols-2 gap-3">
      {data.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="overflow-hidden rounded-2xl bg-white text-left shadow-sm">
          {a.coverFileId && <img src={familyPhotoUrl(slug, studentId, a.id, a.coverFileId)} alt={a.title} loading="lazy" className="aspect-[4/3] w-full object-cover bg-black/[0.04]" />}
          <div className="p-2.5">
            <p className="truncate text-sm font-medium text-ink">{a.title}</p>
            <p className="text-xs text-ink-muted">{[a.date && date(a.date), t('family.photos.count', { count: a.photos })].filter(Boolean).join(' · ')}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
