import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, Camera, Check, CheckCircle2, CircleAlert, Eye, FileText, FolderSearch, RotateCcw, Upload, X } from 'lucide-react'
import { FILE_ACCEPT, FILE_CATEGORIES, FILE_MAX_MB, FILE_VERIFY_STATUS, TWO_SIDED_CATEGORIES } from '@schoolgiant/shared'
import { FormField, Input, Modal, SegmentedControl, Select, StatusPill } from '../system'
import CameraCapture from '../system/CameraCapture'
import AddFileMenu from '../system/AddFileMenu'
import ReuseFiles from '../system/ReuseFiles'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// The documents of an admission, checklist first: what the campus asks for (each needed to admit or able to come
// later), then anything else. Each document is a PDF or photos — taken with the phone's camera or chosen — with the
// side for cards (Aadhaar front and back) and a caption. Used by New admission (files wait in the browser until the
// student is saved) and by a family's admission form (files go up at once); the caller keeps the list.
//
//   items: [{ key, category, side?, title?, fileName, size, contentType, url? (a preview), verification? }]
//   onAdd(file, { category, side, title }) · onRemove(item) · onView?(item) · onVerify?(item, status) (Student 360: the office's check)
//   reuse?: { entityType, entityId, onPicked } — a saved record (Student 360): also "Choose from existing" (the student's
//   other papers, or a file from the document library's folders), filed as the row's kind

const fmtSize = (n) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const isImage = (it) => /^image\//i.test(it?.contentType || '')

/** Docs on the checklist that are needed to admit and have nothing yet. */
export function missingNow(checklist, items) {
  return (checklist ?? []).filter((d) => d.when === 'NOW' && !items.some((it) => it.category === d.category))
}

/** A picked file or photo: say which side it is and add a caption, then add it. */
function AddDialog({ pending, onClose, onAdd, busy }) {
  const { t } = useTranslation('students')
  const two = TWO_SIDED_CATEGORIES.includes(pending.category)
  const [side, setSide] = useState(pending.side ?? (two ? 'FRONT' : ''))
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!/^image\//.test(pending.file.type)) return undefined
    const u = URL.createObjectURL(pending.file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [pending.file])
  const label = FILE_CATEGORIES.find((c) => c.value === pending.category)?.label
  return (
    <Modal open onClose={onClose} title={t('students.docs.addTitle', { kind: t(`students.docs.kinds.${pending.category}`, label) })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('students.docs.cancel')}</Button>
      <Button loading={busy} onClick={() => onAdd(pending.file, { category: pending.category, side: two ? side : undefined, title: title.trim() })}>{t('students.docs.add')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid place-items-center rounded-lg border border-border bg-bg p-2 min-h-24">
          {url ? <img src={url} alt="" className="max-h-64 w-auto max-w-full rounded" /> : (
            <span className="flex items-center gap-2 text-sm text-ink-muted"><FileText className="w-5 h-5" />{pending.file.name} · {fmtSize(pending.file.size)}</span>
          )}
        </div>
        {two && (
          <FormField label={t('students.docs.side')} hint={t('students.docs.sideHint')}>
            <SegmentedControl size="md" value={side} onChange={setSide} options={[{ value: 'FRONT', label: t('students.docs.front') }, { value: 'BACK', label: t('students.docs.back') }]} />
          </FormField>
        )}
        <FormField label={t('students.docs.caption')} hint={t('students.docs.captionHint')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('students.docs.captionPlaceholder')} />
        </FormField>
      </div>
    </Modal>
  )
}

function ItemRow({ it, onRemove, onView, onVerify, disabled }) {
  const { t } = useTranslation('students')
  const { dateTime } = useFormat()
  const v = it.verification?.status
  const icon = 'p-1.5 rounded text-ink-muted hover:bg-black/[0.04] disabled:opacity-50'
  return (
    <li className="flex items-center gap-3 py-2">
      {isImage(it) && it.url ? <img src={it.url} alt="" className="w-10 h-10 rounded object-cover border border-border shrink-0" />
        : <span className="w-10 h-10 rounded border border-border bg-bg grid place-items-center shrink-0"><FileText className="w-4 h-4 text-ink-faint" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{it.title || it.fileName}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {[it.side && t(`students.docs.${it.side === 'BACK' ? 'back' : 'front'}`), it.title ? it.fileName : null, fmtSize(it.size)].filter(Boolean).join(' · ')}
        </span>
      </span>
      {v && (
        <span title={[it.verification.by, it.verification.at && dateTime(it.verification.at), it.verification.note].filter(Boolean).join(' · ')}>
          <StatusPill tone={FILE_VERIFY_STATUS[v]?.tone}>{t(`students.docs.verify.${v}`)}</StatusPill>
        </span>
      )}
      {onView && <button type="button" onClick={() => onView(it)} className={icon} title={t('students.docs.view')} aria-label={t('students.docs.view')}><Eye className="w-4 h-4" /></button>}
      {onVerify && !v && <>
        <button type="button" disabled={disabled} onClick={() => onVerify(it, 'VERIFIED')} className={`${icon} hover:text-success-600`} title={t('students.docs.markVerified')} aria-label={t('students.docs.markVerified')}><Check className="w-4 h-4" /></button>
        <button type="button" disabled={disabled} onClick={() => onVerify(it, 'REJECTED')} className={`${icon} hover:text-danger-600`} title={t('students.docs.markRejected')} aria-label={t('students.docs.markRejected')}><Ban className="w-4 h-4" /></button>
      </>}
      {onVerify && v && <button type="button" disabled={disabled} onClick={() => onVerify(it, 'PENDING')} className={icon} title={t('students.docs.undoCheck')} aria-label={t('students.docs.undoCheck')}><RotateCcw className="w-4 h-4" /></button>}
      {onRemove && <button type="button" disabled={disabled} onClick={() => onRemove(it)} className="p-1.5 rounded text-ink-muted hover:text-danger-600 hover:bg-black/[0.04] disabled:opacity-50" title={t('students.docs.remove')} aria-label={t('students.docs.remove')}><X className="w-4 h-4" /></button>}
    </li>
  )
}

export default function AdmissionDocuments({ checklist = [], items, onAdd, onRemove, onView, onVerify, reuse, busy = false, readOnly = false }) {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const fileRef = useRef(null)
  const [pending, setPending] = useState(null) // { category, file, side? }
  const [camera, setCamera] = useState(null) // category to take a photo for
  const [picking, setPicking] = useState(null) // category the file input is for
  const [otherKind, setOtherKind] = useState('')
  const [reusing, setReusing] = useState(null) // category to choose an existing file for

  const listed = new Set(checklist.map((d) => d.category))
  const extraKinds = useMemo(() => [...new Set(items.map((it) => it.category).filter((c) => !listed.has(c)))], [items, checklist]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...checklist, ...extraKinds.map((category) => ({ category, when: null }))]
  const otherChoices = FILE_CATEGORIES.filter((c) => !listed.has(c.value) && !extraKinds.includes(c.value))

  const pick = (category) => { setPicking(category); fileRef.current?.click() }
  const chosen = (file) => {
    if (!file) return
    if (file.size > FILE_MAX_MB * 1024 * 1024) { showError(t('students.docs.tooBig', { max: FILE_MAX_MB })); return }
    setPending({ category: picking, file })
  }
  const add = async (file, meta) => {
    try { await onAdd(file, meta); setPending(null) } catch (e) { showError(e.message) }
  }
  const menu = (category) => [
    { key: 'camera', icon: Camera, label: t('students.docs.photo'), hint: t('students.docs.photoMenuHint'), onSelect: () => setCamera(category) },
    { key: 'file', icon: Upload, label: t('students.docs.upload'), hint: t('students.docs.uploadMenuHint'), onSelect: () => pick(category) },
    ...(reuse ? [{ key: 'existing', icon: FolderSearch, label: t('students.docs.existing'), hint: t('students.docs.existingMenuHint'), onSelect: () => setReusing(category) }] : []),
  ]
  const kindLabel = (c) => t(`students.docs.kinds.${c}`, FILE_CATEGORIES.find((x) => x.value === c)?.label ?? c)

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((d) => {
          const mine = items.filter((it) => it.category === d.category)
          const two = TWO_SIDED_CATEGORIES.includes(d.category)
          const sides = two ? ['FRONT', 'BACK'].filter((s) => !mine.some((it) => it.side === s)) : []
          const missing = !mine.length
          return (
            <li key={d.category} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {missing ? <CircleAlert className={d.when === 'NOW' ? 'w-4 h-4 text-amber-600 shrink-0' : 'w-4 h-4 text-ink-faint shrink-0'} /> : <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{kindLabel(d.category)}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {d.when === 'NOW' ? t('students.docs.whenNow') : d.when === 'LATER' ? t('students.docs.whenLater') : t('students.docs.whenExtra')}
                    {two && !missing && sides.length ? ` · ${t('students.docs.sideMissing', { side: t(`students.docs.${sides[0] === 'BACK' ? 'back' : 'front'}`) })}` : ''}
                    {two && missing ? ` · ${t('students.docs.bothSides')}` : ''}
                  </span>
                </span>
                {!readOnly && (
                  <span className="flex w-full items-center gap-1 ps-5 -ms-2 sm:w-auto sm:ps-0 sm:ms-0">
                    <AddFileMenu variant="ghost" label={t('students.docs.addMenu')} disabled={busy} options={menu(d.category)} />
                  </span>
                )}
              </div>
              {mine.length > 0 && <ul className="mt-1 ps-7">{mine.map((it) => <ItemRow key={it.key} it={it} onRemove={readOnly ? null : onRemove} onView={onView} onVerify={readOnly ? null : onVerify} disabled={busy} />)}</ul>}
            </li>
          )
        })}
        {!rows.length && <li className="px-3 py-3 text-sm text-ink-faint">{t('students.docs.noChecklist')}</li>}
      </ul>

      {!readOnly && otherChoices.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-72">
            <FormField label={t('students.docs.other')}>
              <Select value={otherKind} onChange={(e) => setOtherKind(e.target.value)}>
                <option value="">{t('students.docs.pickKind')}</option>
                {otherChoices.map((c) => <option key={c.value} value={c.value}>{kindLabel(c.value)}</option>)}
              </Select>
            </FormField>
          </div>
          <AddFileMenu size="md" label={t('students.docs.addMenu')} disabled={!otherKind || busy} options={menu(otherKind)} />
        </div>
      )}

      <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; chosen(f) }} />
      {camera && (
        <CameraCapture title={t('students.docs.photoTitle', { kind: kindLabel(camera) })} hint={t('students.docs.photoHint')} addLabel={t('students.docs.usePhoto')}
          fileName={kindLabel(camera)} onClose={() => setCamera(null)} onPhoto={(file) => { setPending({ category: camera, file }); setCamera(null) }} />
      )}
      {reusing && <ReuseFiles entityType={reuse.entityType} entityId={reuse.entityId} category={reusing} fileAs={reusing} onClose={() => setReusing(null)} onPicked={reuse.onPicked} />}
      {pending && <AddDialog pending={pending} busy={busy} onClose={() => setPending(null)} onAdd={add} />}
    </div>
  )
}
