import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Hash, Image as ImageIcon, ImagePlus, Images, LayoutGrid, Megaphone, MousePointerClick, PanelTop, Phone, Plus, Trash2, Type, Upload, X } from 'lucide-react'
import { SITE_BLOCK_BY, SITE_LIMITS } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, Select, Textarea, useConfirm } from '../system'
import Button from '../ui/Button'
import { deleteSiteImage, fetchSiteImages, staffImageUrl, uploadSiteImage } from '../../api/website'
import { hasPermission } from '../../api/auth'
import { resizeImage } from '../../utils/resizeImage'
import { useSnackbar } from '../../context/SnackbarContext'

export const BLOCK_ICON = { HERO: PanelTop, TEXT: Type, GALLERY: Images, STATS: Hash, CARDS: LayoutGrid, CTA: MousePointerClick, CONTACT: Phone, NOTICES: Megaphone, EVENTS: CalendarDays }
export const BLOCK_TONE = { HERO: 'brand', TEXT: 'neutral', GALLERY: 'pink', STATS: 'violet', CARDS: 'sky', CTA: 'orange', CONTACT: 'teal', NOTICES: 'info', EVENTS: 'success' }

const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file) })

/** Shrink a picture until it is under the site's limit (≈300 KB), then hand back its data URL. */
async function pictureDataUrl(file) {
  for (const [max, quality] of [[1600, 0.82], [1280, 0.75], [960, 0.68], [720, 0.6]]) {
    const out = await resizeImage(file, { max, quality, minBytes: 0 })
    if (out.size <= SITE_LIMITS.imageBytes) return readAsDataUrl(out)
  }
  return null
}

/** A picture slot: shows the picture, uploads a new one (resized here), or picks one already uploaded. */
export function ImagePicker({ value, onChange, label }) {
  const { t } = useTranslation('website')
  const { showError, showSuccess } = useSnackbar()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [library, setLibrary] = useState(false)
  const canDelete = hasPermission('website.pages.edit') || hasPermission('website.pages.delete')
  const removeImage = useMutation({
    mutationFn: (img) => deleteSiteImage(img.id),
    onSuccess: (_, img) => { qc.invalidateQueries({ queryKey: ['website', 'images'] }); if (img.id === value) onChange(null); showSuccess(t('website.images.deleted')) },
    onError: (e) => showError(e.message),
  })
  const { data: images = [] } = useQuery({ queryKey: ['website', 'images'], queryFn: fetchSiteImages, enabled: library })
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await pictureDataUrl(file)
      if (!dataUrl) { showError(t('website.images.tooLarge')); return }
      const img = await uploadSiteImage({ name: file.name, dataUrl })
      qc.invalidateQueries({ queryKey: ['website', 'images'] })
      onChange(img.id)
    } catch (e) {
      showError(e.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-ink-muted">{label}</p>}
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-bg">
          {value ? <img src={staffImageUrl(value)} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="w-6 h-6 text-ink-faint" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>{t('website.images.upload')}</Button>
          <Button size="sm" variant="ghost" icon={Images} onClick={() => setLibrary(true)}>{t('website.images.library')}</Button>
          {value && <Button size="sm" variant="ghost" icon={X} onClick={() => onChange(null)}>{t('website.images.remove')}</Button>}
        </div>
      </div>
      {library && (
        <Modal open size="lg" onClose={() => setLibrary(false)} title={t('website.images.libraryTitle')}>
          {!images.length ? <p className="py-8 text-center text-sm text-ink-muted">{t('website.images.none')}</p> : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {images.map((img) => (
                <div key={img.id} className="relative">
                  <button type="button" onClick={() => { onChange(img.id); setLibrary(false) }} className={`block w-full aspect-[4/3] overflow-hidden rounded-lg border-2 ${img.id === value ? 'border-brand-500' : 'border-transparent hover:border-brand-200'}`}>
                    <img src={staffImageUrl(img.id)} alt={img.name} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                  {canDelete && <button type="button" title={t('website.images.delete')} aria-label={t('website.images.delete')} disabled={removeImage.isPending}
                    onClick={async () => { if (await confirm({ title: t('website.images.deleteTitle', { name: img.name }), message: t('website.images.deleteHint'), tone: 'danger', confirmLabel: t('actions.delete') })) removeImage.mutate(img) }}
                    className="absolute top-1.5 end-1.5 rounded-md bg-surface/90 p-1 text-danger-600 shadow-sm hover:bg-surface"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

/** Many pictures at once for a gallery. */
function GalleryUpload({ onAdd, disabled }) {
  const { t } = useTranslation('website')
  const { showError } = useSnackbar()
  const qc = useQueryClient()
  const ref = useRef(null)
  const up = useMutation({
    mutationFn: async (files) => {
      const ids = []
      for (const f of files) {
        const dataUrl = await pictureDataUrl(f)
        if (!dataUrl) { showError(t('website.images.tooLarge')); continue }
        ids.push((await uploadSiteImage({ name: f.name, dataUrl })).id)
      }
      return ids
    },
    onSuccess: (ids) => { qc.invalidateQueries({ queryKey: ['website', 'images'] }); onAdd(ids) },
    onError: (e) => showError(e.message),
  })
  return <>
    <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) up.mutate(fs); e.target.value = '' }} />
    <Button size="sm" variant="secondary" icon={ImagePlus} loading={up.isPending} disabled={disabled} onClick={() => ref.current?.click()}>{t('website.blocks.addPictures')}</Button>
  </>
}

const LinkFields = ({ d, set, t }) => (
  <div className="grid gap-3 sm:grid-cols-2">
    <FormField label={t('website.blocks.buttonLabel')}><Input value={d.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} maxLength={40} /></FormField>
    <FormField label={t('website.blocks.buttonLink')} hint={t('website.blocks.linkHint')}><Input value={d.buttonLink} disabled={d.apply} onChange={(e) => set({ buttonLink: e.target.value })} placeholder="/admissions" /></FormField>
    <label className="sm:col-span-2 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!d.apply} onChange={(e) => set({ apply: e.target.checked })} />{t('website.blocks.applyLink')}</label>
  </div>
)

/** The fields of one block, by type. `onChange(data)` gets the whole new data object. */
export default function BlockEditor({ block, onChange }) {
  const { t } = useTranslation('website')
  const d = block.data
  const set = (patch) => onChange({ ...d, ...patch })
  const setItem = (key, i, patch) => set({ [key]: d[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const removeItem = (key, i) => set({ [key]: d[key].filter((_, j) => j !== i) })
  const max = SITE_BLOCK_BY[block.type]?.max
  const heading = <FormField label={t('website.blocks.heading')}><Input value={d.heading ?? ''} onChange={(e) => set({ heading: e.target.value })} maxLength={120} /></FormField>
  switch (block.type) {
    case 'HERO':
      return <div className="space-y-3">{heading}
        <FormField label={t('website.blocks.subheading')}><Textarea rows={2} value={d.subheading} onChange={(e) => set({ subheading: e.target.value })} maxLength={300} /></FormField>
        <ImagePicker label={t('website.blocks.bannerImage')} value={d.imageId} onChange={(imageId) => set({ imageId })} />
        <LinkFields d={d} set={set} t={t} />
      </div>
    case 'TEXT':
      return <div className="space-y-3">{heading}
        <FormField label={t('website.blocks.body')} hint={t('website.blocks.bodyHint')}><Textarea rows={8} value={d.body} onChange={(e) => set({ body: e.target.value })} maxLength={SITE_LIMITS.textChars} /></FormField>
      </div>
    case 'GALLERY':
      return <div className="space-y-3">{heading}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {d.images.map((g, i) => (
            <div key={`${g.imageId}-${i}`} className="relative rounded-lg border border-border p-1.5">
              <img src={staffImageUrl(g.imageId)} alt="" className="aspect-[4/3] w-full rounded object-cover" />
              <Input className="mt-1.5" value={g.caption} placeholder={t('website.blocks.caption')} onChange={(e) => setItem('images', i, { caption: e.target.value })} maxLength={120} />
              <button type="button" aria-label={t('website.images.remove')} onClick={() => removeItem('images', i)} className="absolute end-2 top-2 rounded-full bg-black/60 p-1 text-white"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <GalleryUpload disabled={d.images.length >= max} onAdd={(ids) => set({ images: [...d.images, ...ids.map((imageId) => ({ imageId, caption: '' }))].slice(0, max) })} />
        <p className="text-xs text-ink-faint">{t('website.blocks.galleryHint', { max })}</p>
      </div>
    case 'STATS':
      return <div className="space-y-3">{heading}
        {d.items.map((s, i) => (
          <div key={i} className="flex items-end gap-2">
            <FormField label={t('website.blocks.statValue')} className="w-28"><Input value={s.value} onChange={(e) => setItem('items', i, { value: e.target.value })} maxLength={20} placeholder="1,200" /></FormField>
            <FormField label={t('website.blocks.statLabel')} className="flex-1"><Input value={s.label} onChange={(e) => setItem('items', i, { label: e.target.value })} maxLength={60} /></FormField>
            <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('website.images.remove')} onClick={() => removeItem('items', i)} />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={Plus} disabled={d.items.length >= max} onClick={() => set({ items: [...d.items, { value: '', label: '' }] })}>{t('website.blocks.addStat')}</Button>
      </div>
    case 'CARDS':
      return <div className="space-y-3">{heading}
        {d.items.map((c, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-start gap-2">
              <FormField label={t('website.blocks.cardTitle')} className="flex-1"><Input value={c.title} onChange={(e) => setItem('items', i, { title: e.target.value })} maxLength={80} /></FormField>
              <Button size="sm" variant="ghost" icon={Trash2} className="mt-6" aria-label={t('website.images.remove')} onClick={() => removeItem('items', i)} />
            </div>
            <FormField label={t('website.blocks.cardText')}><Textarea rows={2} value={c.text} onChange={(e) => setItem('items', i, { text: e.target.value })} maxLength={400} /></FormField>
            <div className="grid gap-3 sm:grid-cols-2 items-end">
              <ImagePicker value={c.imageId} onChange={(imageId) => setItem('items', i, { imageId })} />
              <FormField label={t('website.blocks.cardLink')} hint={t('website.blocks.linkHint')}><Input value={c.link} onChange={(e) => setItem('items', i, { link: e.target.value })} placeholder="/facilities" /></FormField>
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={Plus} disabled={d.items.length >= max} onClick={() => set({ items: [...d.items, { title: '', text: '', imageId: null, link: '' }] })}>{t('website.blocks.addCard')}</Button>
      </div>
    case 'CTA':
      return <div className="space-y-3">{heading}
        <FormField label={t('website.blocks.ctaText')}><Textarea rows={2} value={d.text} onChange={(e) => set({ text: e.target.value })} maxLength={300} /></FormField>
        <LinkFields d={d} set={set} t={t} />
      </div>
    case 'CONTACT':
      return <div className="space-y-3">{heading}
        <FormField label={t('website.blocks.address')}><Textarea rows={2} value={d.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('website.blocks.phone')}><Input value={d.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} /></FormField>
          <FormField label={t('website.blocks.email')}><Input type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} /></FormField>
          <FormField label={t('website.blocks.lat')}><Input type="number" step="any" value={d.lat ?? ''} onChange={(e) => set({ lat: e.target.value === '' ? null : Number(e.target.value) })} placeholder="12.9716" /></FormField>
          <FormField label={t('website.blocks.lng')}><Input type="number" step="any" value={d.lng ?? ''} onChange={(e) => set({ lng: e.target.value === '' ? null : Number(e.target.value) })} placeholder="77.5946" /></FormField>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!d.showMap} onChange={(e) => set({ showMap: e.target.checked })} />{t('website.blocks.showMap')}</label>
        <p className="text-xs text-ink-faint">{t('website.blocks.mapHint')}</p>
      </div>
    case 'NOTICES':
    case 'EVENTS':
      return <div className="space-y-3">{heading}
        <FormField label={t('website.blocks.count')}><Select value={String(d.count)} onChange={(e) => set({ count: Number(e.target.value) })}>{[3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>
        <Note>{block.type === 'NOTICES' ? t('website.blocks.noticesHint') : t('website.blocks.eventsHint')}</Note>
      </div>
    default:
      return null
  }
}
