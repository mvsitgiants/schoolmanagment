import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Camera, FileText, Image as ImageIcon, Link2, Paperclip, PlayCircle, RotateCw, Trash2, X } from 'lucide-react'
import { FormField, Input, Modal, Note, SearchInput, SegmentedControl, Select, Skeleton } from '../system'
import Button from '../ui/Button'
import { fetchContentLibrary, fetchMyContent } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { fmtSize } from '../../pages/Lms/CreateContent'

// Pieces of the Subject hub (pages/Homework/Hub.jsx): file chips, the camera, the library picker, the unit dialog.

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/** Attached files as chips: icon, name, size and a remove button. They wrap on narrow screens. */
export function FileChips({ files, onRemove, disabled }) {
  const { t } = useTranslation('hub')
  if (!files?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('hub.files.title')}>
      {files.map((f) => {
        const Icon = f.mime?.startsWith('image/') ? ImageIcon : f.mime === 'application/pdf' ? FileText : Paperclip
        return (
          <li key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface py-1 ps-2.5 pe-1 text-xs">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
            <span className="min-w-0 truncate text-ink">{f.name}</span>
            <span className="shrink-0 text-ink-faint">{fmtSize(f.size)}</span>
            {onRemove && (
              <button type="button" disabled={disabled} onClick={() => onRemove(f)} aria-label={t('hub.files.remove', { name: f.name })} title={t('hub.files.remove', { name: f.name })}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-black/[0.05] hover:text-ink [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Draw an image (or video frame) onto a canvas, turned `turns` quarter-turns, at most 2000px on its long side. */
function toCanvas(source, w, h, turns) {
  const scale = Math.min(1, 2000 / Math.max(w, h))
  const sw = Math.round(w * scale)
  const sh = Math.round(h * scale)
  const side = turns % 2 === 1
  const c = document.createElement('canvas')
  c.width = side ? sh : sw
  c.height = side ? sw : sh
  const g = c.getContext('2d')
  g.translate(c.width / 2, c.height / 2)
  g.rotate((turns * Math.PI) / 2)
  g.drawImage(source, -sw / 2, -sh / 2, sw, sh)
  return c
}

/**
 * Scan with camera: a photo of a book page, added to the topic as a picture (an attached file, shown in the text).
 * Phones open their camera app; computers show the webcam and take a snapshot. The photo can be turned before adding.
 */
export function CameraCapture({ onClose, onPhoto, busy }) {
  const { t } = useTranslation('hub')
  const video = useRef(null)
  const input = useRef(null)
  const [stream, setStream] = useState(null)
  const [failed, setFailed] = useState(false)
  const [shot, setShot] = useState(null) // { img: HTMLImageElement | HTMLCanvasElement, w, h }
  const [turns, setTurns] = useState(0)
  const [preview, setPreview] = useState('')
  const touch = isTouch()

  useEffect(() => {
    if (touch || shot) return undefined
    let live = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setFailed(true); return undefined }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => { if (cancelled) { s.getTracks().forEach((x) => x.stop()); return } live = s; setStream(s); if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) } })
      .catch(() => setFailed(true))
    return () => { cancelled = true; live?.getTracks().forEach((x) => x.stop()) }
  }, [touch, shot])

  useEffect(() => {
    if (!shot) { setPreview(''); return }
    setPreview(toCanvas(shot.img, shot.w, shot.h, turns).toDataURL('image/jpeg', 0.7))
  }, [shot, turns])

  const snap = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const c = toCanvas(v, v.videoWidth, v.videoHeight, 0)
    stream?.getTracks().forEach((x) => x.stop())
    setStream(null)
    setTurns(0)
    setShot({ img: c, w: c.width, h: c.height })
  }
  const fromFile = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => { setTurns(0); setShot({ img, w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }
  const add = () => {
    toCanvas(shot.img, shot.w, shot.h, turns).toBlob((blob) => {
      if (blob) onPhoto(new File([blob], `${t('hub.camera.fileName')}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.85)
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t('hub.camera.title')} footer={shot ? <>
      <Button variant="secondary" icon={Camera} onClick={() => { setShot(null); if (touch) input.current?.click() }}>{t('hub.camera.retake')}</Button>
      <Button loading={busy} onClick={add}>{t('hub.camera.add')}</Button>
    </> : <Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button>}>
      <div className="min-h-[60dvh] space-y-3 sm:min-h-0">
        {shot ? (
          <>
            <div className="grid place-items-center rounded-lg border border-border bg-bg p-2">
              {preview && <img src={preview} alt={t('hub.camera.preview')} className="max-h-[55dvh] w-auto max-w-full rounded" />}
            </div>
            <div className="flex justify-center">
              <Button variant="secondary" icon={RotateCw} onClick={() => setTurns((n) => (n + 1) % 4)}>{t('hub.camera.rotate')}</Button>
            </div>
          </>
        ) : touch || failed ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-700"><Camera className="h-7 w-7" aria-hidden /></span>
            <p className="max-w-xs text-sm text-ink-muted">{failed && !touch ? t('hub.camera.noCamera') : t('hub.camera.hint')}</p>
            <Button icon={Camera} onClick={() => input.current?.click()}>{touch ? t('hub.camera.open') : t('hub.camera.choose')}</Button>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-black">
              <video ref={video} playsInline muted className="aspect-video w-full object-contain" />
            </div>
            <p className="text-center text-xs text-ink-muted">{t('hub.camera.frame')}</p>
            <div className="flex justify-center"><Button icon={Camera} disabled={!stream} onClick={snap}>{t('hub.camera.snap')}</Button></div>
          </>
        )}
        <input ref={input} type="file" accept="image/*" capture={touch ? 'environment' : undefined} className="hidden" onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </Modal>
  )
}

const KIND_ICON = { VIDEO: PlayCircle, LINK: Link2 }

/**
 * Add from library: content already shared (the Content library, or the teacher's own when they can't open the
 * library) — other topics' material included. Picking one hands it to `onPick` to copy into this topic.
 */
export function LibraryPicker({ classId, subjectId, exceptId, onPick, onClose, busy }) {
  const { t } = useTranslation('hub')
  const [scope, setScope] = useState('SUBJECT')
  const [search, setSearch] = useState('')
  const library = hasPermission('lms.content-library.view')
  const params = { page: 1, pageSize: 30, search: search || undefined, ...(scope === 'SUBJECT' && { classId, subjectId }) }
  const { data, isLoading } = useQuery({
    queryKey: ['hub-library', library, params],
    queryFn: () => (library ? fetchContentLibrary(params) : fetchMyContent(params)),
  })
  const rows = (data?.data ?? []).filter((r) => r.id !== exceptId)
  return (
    <Modal open onClose={onClose} size="lg" title={t('hub.library.title')} footer={<Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button>}>
      <div className="min-h-[70dvh] space-y-3 sm:min-h-0">
        <p className="text-sm text-ink-muted">{t('hub.library.hint')}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder={t('hub.library.search')} className="min-w-0 flex-1" />
          <SegmentedControl value={scope} onChange={setScope} options={[{ value: 'SUBJECT', label: t('hub.library.thisSubject') }, { value: 'ALL', label: t('hub.library.everything') }]} />
        </div>
        {isLoading ? <Skeleton className="h-48" /> : !rows.length ? <p className="py-8 text-center text-sm text-ink-faint">{t('hub.library.none')}</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind] ?? FileText
              return (
                <li key={r.id}>
                  <button type="button" disabled={busy} onClick={() => onPick(r)} className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-start hover:bg-black/[0.02] disabled:opacity-60">
                    <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{[r.className, r.subject, r.topic].filter(Boolean).join(' · ')}{r.files?.length ? ` · ${t('hub.library.files', { count: r.files.length })}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-brand-700">{r.kind === 'VIDEO' || r.kind === 'LINK' ? t('hub.library.addLink') : t('hub.library.addCopy')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Add a unit, or rename it and change its months; removing it is here too. */
export function UnitModal({ unit, months, onSave, onDelete, onClose, saving }) {
  const { t } = useTranslation('hub')
  const [f, setF] = useState({ name: unit?.name ?? '', fromMonth: unit?.fromMonth ?? '', toMonth: unit?.toMonth ?? '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))
  const monthName = (ym) => {
    const [y, m] = ym.split('-').map(Number)
    return `${t(`hub.months.${m}`)} ${y}`
  }
  const save = () => onSave(f).catch((e) => setErrors(e.response?.data?.details?.fields ?? {}))
  return (
    <Modal open onClose={onClose} title={unit ? t('hub.unit.editTitle') : t('hub.unit.newTitle')} footer={<>
      {unit && onDelete && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-700" onClick={onDelete}>{t('hub.unit.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('hub.cancel')}</Button>
      <Button loading={saving} disabled={!f.name.trim()} onClick={save}>{unit ? t('hub.unit.save') : t('hub.unit.add')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('hub.unit.name')} required error={errors.name}>
          <Input value={f.name} onChange={set('name')} maxLength={120} placeholder={t('hub.unit.namePlaceholder')} autoFocus />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('hub.unit.from')} error={errors.fromMonth}>
            <Select value={f.fromMonth} onChange={set('fromMonth')}>
              <option value="">{t('hub.unit.anyMonth')}</option>
              {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hub.unit.to')} error={errors.toMonth}>
            <Select value={f.toMonth} onChange={set('toMonth')}>
              <option value="">{t('hub.unit.anyMonth')}</option>
              {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </Select>
          </FormField>
        </div>
        <Note tone="info">{t('hub.unit.monthsHint')}</Note>
      </div>
    </Modal>
  )
}
