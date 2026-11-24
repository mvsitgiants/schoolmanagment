import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Camera, Expand, FileText, ImageOff, Upload } from 'lucide-react'
import { FILE_MAX_MB } from '@schoolgiant/shared'
import { openDocumentViewer } from '../system/DocumentViewer'
import Button from '../ui/Button'
import { downloadFile, fetchFiles, uploadFile } from '../../api/files'
import { useSnackbar } from '../../context/SnackbarContext'

const isImage = (f) => /^image\//i.test(f?.contentType ?? '')
const isPdf = (f) => /pdf/i.test(f?.contentType ?? '')

/**
 * The photo or scan of one document, large enough to read while deciding, with the other pages as thumbnails and a
 * button to add one. Files sit on the student's wallet document (kept for next year).
 */
export default function DocPreview({ docId, label, paperCopy = false, canAdd, ensureDoc, onChanged }) {
  const { t } = useTranslation('scholarships')
  const { showError, showSuccess } = useSnackbar()
  const inputRef = useRef(null)
  const cameraRef = useRef(null)
  const [selId, setSelId] = useState(null)
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const { data: files = [], refetch, isLoading } = useQuery({ queryKey: ['scholarship-doc-files', docId], queryFn: () => fetchFiles('scholarship_doc', docId), enabled: !!docId })
  const list = files.filter((f) => !f.deleted)
  const sel = list.find((f) => f.id === selId) ?? list[list.length - 1] // the newest first: a page sent again is what to check

  useEffect(() => {
    if (!sel || (!isImage(sel) && !isPdf(sel))) { setUrl(null); return undefined }
    let gone = false
    let made = null
    downloadFile(sel.id).then((r) => { if (gone) return; made = URL.createObjectURL(r.data); setUrl(made) }).catch(() => setUrl(null))
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [sel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    const big = picked.find((f) => f.size > FILE_MAX_MB * 1024 * 1024)
    if (big) { showError(t('scholarships.family.tooBig', { max: FILE_MAX_MB })); return }
    setBusy(true)
    try {
      const id = docId ?? (await ensureDoc())
      for (const f of picked) await uploadFile('scholarship_doc', id, f, { title: label })
      showSuccess(t('scholarships.review.added', { count: picked.length }))
      await refetch()
      onChanged?.()
    } catch (err) { showError(err.message) } finally { setBusy(false) }
  }
  const openLarge = () => sel && openDocumentViewer({ name: sel.fileName, contentType: sel.contentType, load: () => downloadFile(sel.id) })

  return (
    <div className="space-y-3">
      <div className="relative flex min-h-[18rem] items-center justify-center overflow-hidden rounded-xl border border-border bg-bg">
        {isLoading && docId ? <div className="h-72 w-full animate-pulse bg-black/[0.04]" /> : !sel ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <ImageOff className="h-8 w-8 text-ink-faint" aria-hidden />
            <p className="text-sm text-ink-muted">{paperCopy ? t('scholarships.review.paperOnly') : t('scholarships.review.noFile')}</p>
          </div>
        ) : isImage(sel) && url ? (
          <img src={url} alt={sel.fileName} className="max-h-[60vh] w-full cursor-zoom-in object-contain" onClick={openLarge} />
        ) : isPdf(sel) && url ? (
          <iframe src={url} title={sel.fileName} className="h-[60vh] w-full" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-8 text-center"><FileText className="h-8 w-8 text-ink-faint" aria-hidden /><p className="text-sm text-ink">{sel.fileName}</p></div>
        )}
        {sel && <Button size="sm" variant="secondary" icon={Expand} className="absolute end-2 top-2" onClick={openLarge}>{t('scholarships.review.openLarge')}</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {list.length > 1 && list.map((f, i) => (
          <button key={f.id} type="button" onClick={() => setSelId(f.id)}
            className={clsx('rounded-lg border px-2.5 py-1 text-xs', f.id === sel?.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:text-ink')}>
            {t('scholarships.review.page', { n: i + 1 })}
          </button>
        ))}
        {sel && <span className="text-xs text-ink-faint">{t('scholarships.review.sentBy', { name: sel.uploadedBy ?? '—' })}</span>}
        {canAdd && (
          <div className="ms-auto flex flex-wrap gap-2">
            {/* the phone's or tablet's camera opens straight away (on a computer it falls back to picking a picture) */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={add} />
            <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={add} />
            <Button size="sm" variant="secondary" icon={Camera} loading={busy} onClick={() => cameraRef.current?.click()}>{t('scholarships.review.camera')}</Button>
            <Button size="sm" variant="ghost" icon={Upload} disabled={busy} onClick={() => inputRef.current?.click()}>{t('scholarships.review.chooseFile')}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
