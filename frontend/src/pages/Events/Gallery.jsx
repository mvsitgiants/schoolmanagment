import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, ImagePlus, Images, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { DateInput, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, ProgressBar, Select, StatusPill, Textarea, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteAlbum, fetchAlbum, fetchAlbums, fetchEvents, saveAlbum } from '../../api/events'
import { deleteFile, uploadFile } from '../../api/files'
import { hasPermission } from '../../api/auth'
import { resizeImage } from '../../utils/resizeImage'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { AudienceFields, AuthPhoto } from '../../components/events/EventsKit'

const body = (a, patch = {}) => ({
  title: a.title, date: a.date ?? '', description: a.description ?? '', eventId: a.eventId ?? null, audience: a.audience, classIds: a.classIds, sectionIds: a.sectionIds, branchIds: a.branchIds ?? [],
  published: a.published, coverFileId: a.coverFileId ?? null, ...patch,
})

function AlbumForm({ album, onClose, onSaved }) {
  const { t } = useTranslation('events')
  const { showError } = useSnackbar()
  const { data: events = [] } = useQuery({ queryKey: ['events', 'list', 'ALL'], queryFn: () => fetchEvents({ when: 'ALL' }) })
  const [form, setForm] = useState({ title: album?.title ?? '', date: album?.date ?? localIso(new Date()), description: album?.description ?? '', eventId: album?.eventId ?? '', published: album?.published ?? false })
  const [aud, setAud] = useState({ audience: album?.audience ?? 'EVERYONE', classIds: album?.classIds ?? [], sectionIds: album?.sectionIds ?? [] })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const pickEvent = (e) => {
    const ev = events.find((x) => x.id === e.target.value)
    setForm((f) => ({ ...f, eventId: e.target.value, ...(ev && !f.title && { title: ev.title }), ...(ev && { date: ev.startDate }) }))
    if (ev) setAud({ audience: ev.audience, classIds: ev.classIds, sectionIds: ev.sectionIds })
  }
  const save = useMutation({
    mutationFn: () => saveAlbum(album?.id, { ...form, eventId: form.eventId || null, ...aud, branchIds: album?.branchIds ?? [], coverFileId: album?.coverFileId ?? null }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={album ? t('events.gallery.editTitle') : t('events.gallery.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2} onClick={() => save.mutate()}>{t('events.gallery.save')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('events.gallery.event')} hint={t('events.gallery.eventHint')}>
          <Select value={form.eventId} onChange={pickEvent}><option value="">{t('events.gallery.noEvent')}</option>{events.map((e) => <option key={e.id} value={e.id}>{`${e.title} · ${e.startDate}`}</option>)}</Select>
        </FormField>
        <div className="grid sm:grid-cols-[1fr_170px] gap-3">
          <FormField label={t('events.gallery.albumTitle')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField>
          <FormField label={t('events.gallery.date')}><DateInput value={form.date} onChange={set('date')} /></FormField>
        </div>
        <FormField label={t('events.gallery.description')}><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField>
        <AudienceFields value={aud} onChange={setAud} errors={errors} />
        <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.published} onChange={set('published')} className="rounded border-border text-brand-500" />{t('events.gallery.publish')}</label>
      </div>
    </Modal>
  )
}

function AlbumDrawer({ id, onClose, onEdit }) {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const input = useRef(null)
  const [progress, setProgress] = useState(null)
  const [viewing, setViewing] = useState(null)
  const { data: a } = useQuery({ queryKey: ['events', 'album', id], queryFn: () => fetchAlbum(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['events'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done); if (v.close) onClose() }, onError: (e) => showError(e.message) })
  if (!a) return <Drawer open onClose={onClose} title={t('events.loading')}><span /></Drawer>
  const canAdd = hasPermission('events.gallery.create')
  const canDelete = hasPermission('events.gallery.delete')
  const upload = async (files) => {
    const list = [...files].filter((f) => /^image\//.test(f.type))
    if (!list.length) return
    let done = 0
    let failed = 0
    setProgress({ done, total: list.length })
    for (const f of list) {
      try { await uploadFile('gallery_album', a.id, await resizeImage(f), { category: 'OTHER' }) } catch { failed++ }
      done++
      setProgress({ done, total: list.length })
    }
    setProgress(null)
    refresh()
    if (failed) showError(t('events.gallery.someFailed', { count: failed })); else showSuccess(t('events.gallery.uploaded', { count: list.length }))
  }
  return (
    <Drawer open onClose={onClose} size="2xl" title={a.title} subtitle={[a.date && date(a.date), a.eventTitle, t('events.gallery.photosN', { count: a.photos })].filter(Boolean).join(' · ')}
      footer={<div className="flex flex-wrap gap-2">
        {canAdd && <Button icon={ImagePlus} loading={!!progress} onClick={() => input.current?.click()}>{t('events.gallery.addPhotos')}</Button>}
        {canAdd && <Button variant="secondary" icon={a.published ? EyeOff : Eye} onClick={() => act.mutate({ fn: () => saveAlbum(a.id, body(a, { published: !a.published })), done: a.published ? t('events.gallery.hidden') : t('events.gallery.shown') })}>{a.published ? t('events.gallery.hide') : t('events.gallery.show')}</Button>}
        {canAdd && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(a)}>{t('events.edit')}</Button>}
        {canDelete && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: t('events.gallery.deleteConfirm', { title: a.title }), message: t('events.gallery.deleteHint', { count: a.photos }), confirmLabel: t('events.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteAlbum(a.id), done: t('events.gallery.deleted'), close: true }) }}>{t('events.delete')}</Button>}
      </div>}>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={a.published ? 'success' : 'neutral'}>{a.published ? t('events.gallery.onFamilies') : t('events.gallery.notShown')}</StatusPill>
          {a.description && <span className="text-sm text-ink-muted">{a.description}</span>}
        </div>
        {progress && <div><ProgressBar value={Math.round((progress.done / progress.total) * 100)} /><p className="mt-1 text-xs text-ink-muted">{t('events.gallery.uploading', { done: progress.done, total: progress.total })}</p></div>}
        {!a.photoList.length && !progress && <Note>{t('events.gallery.noPhotos')}</Note>}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {a.photoList.map((p) => (
            <div key={p.id} className="group relative">
              <button type="button" onClick={() => setViewing(p)} className="block w-full"><AuthPhoto fileId={p.id} alt={p.name} className="aspect-square w-full rounded-lg" /></button>
              {a.coverFileId === p.id && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{t('events.gallery.cover')}</span>}
              {canAdd && (
                <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                  {a.coverFileId !== p.id && <Button size="sm" variant="secondary" icon={Star} aria-label={t('events.gallery.makeCover')} onClick={() => act.mutate({ fn: () => saveAlbum(a.id, body(a, { coverFileId: p.id })), done: t('events.gallery.coverSet') })} />}
                  {canDelete && <Button size="sm" variant="secondary" icon={Trash2} aria-label={t('events.delete')} onClick={async () => { if (await confirm({ title: t('events.gallery.deletePhoto'), confirmLabel: t('events.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteFile(p.id, 'Removed from the album'), done: t('events.gallery.photoDeleted') }) }} />}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {viewing && (
        <Modal open onClose={() => setViewing(null)} size="xl" title={viewing.name}>
          <AuthPhoto fileId={viewing.id} alt={viewing.name} className="max-h-[70vh] w-full rounded-lg !object-contain" />
        </Modal>
      )}
    </Drawer>
  )
}

/** Events › Gallery: photo albums — from an event or on their own — shown to families once published. */
export default function Gallery() {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['events', 'albums'], queryFn: fetchAlbums })
  return (
    <PageContainer>
      <PageHeader icon={Images} title={t('events.gallery.title')} subtitle={t('events.gallery.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="events.gallery.create" onClick={() => setEditing('new')}>{t('events.gallery.new')}</HeaderButton>} />
      {isLoading ? <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" /> : !data.length ? <Note>{t('events.gallery.empty')}</Note> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="overflow-hidden rounded-xl border border-border bg-surface text-left hover:border-brand-300">
              {a.coverFileId ? <AuthPhoto fileId={a.coverFileId} alt={a.title} className="aspect-[4/3] w-full" /> : <div className="flex aspect-[4/3] w-full items-center justify-center bg-black/[0.03] text-ink-faint"><Images className="w-8 h-8" /></div>}
              <div className="p-3">
                <p className="truncate text-sm font-medium text-ink">{a.title}</p>
                <p className="text-xs text-ink-faint">{[a.date && date(a.date), t('events.gallery.photosN', { count: a.photos })].filter(Boolean).join(' · ')}</p>
                {!a.published && <span className="mt-1 inline-block text-[11px] text-ink-faint">{t('events.gallery.notShown')}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <AlbumDrawer id={open} onClose={() => setOpen(null)} onEdit={(a) => { setOpen(null); setEditing(a) }} />}
      {editing && <AlbumForm album={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(a) => { setEditing(null); qc.invalidateQueries({ queryKey: ['events'] }); showSuccess(t('events.gallery.saved')); setOpen(a.id) }} />}
    </PageContainer>
  )
}
