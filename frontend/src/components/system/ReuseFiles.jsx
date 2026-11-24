import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, FileText, FolderSearch } from 'lucide-react'
import { downloadFile, fetchReusable, linkFile } from '../../api/files'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import Modal from './Modal'
import Button from '../ui/Button'

/** A picture's thumbnail, fetched once it scrolls into view. */
function Thumb({ file }) {
  const ref = useRef(null)
  const [url, setUrl] = useState(null)
  const [seen, setSeen] = useState(false)
  const image = /^image\//i.test(file.contentType ?? '')
  useEffect(() => {
    if (!image || !ref.current) return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '150px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [image])
  useEffect(() => {
    if (!seen) return undefined
    let made = null
    let gone = false
    downloadFile(file.id).then((r) => { if (gone) return; made = URL.createObjectURL(r.data); setUrl(made) }).catch(() => {})
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [seen, file.id])
  return (
    <div ref={ref} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-bg">
      {url ? <img src={url} alt={file.fileName} className="h-full w-full object-cover" /> : <FileText className="h-7 w-7 text-ink-faint" aria-hidden />}
    </div>
  )
}

/**
 * "Choose from existing": the papers the school already holds about this record's student (given at admission, on
 * the student record, for a scholarship). Picking one uses it here — nothing is uploaded or copied again.
 *
 *   <ReuseFiles entityType="scholarship_doc" entityId={docId} onClose={…} onPicked={…} />
 */
export default function ReuseFiles({ entityType, entityId, category, title, onClose, onPicked }) {
  const { t } = useTranslation('ui')
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const { data: files = [], isLoading } = useQuery({ queryKey: ['files-reusable', entityType, entityId], queryFn: () => fetchReusable(entityType, entityId), enabled: !!entityId })
  // the same kind first (an Aadhaar for an Aadhaar), then the rest
  const sorted = category ? [...files].sort((a, b) => Number(b.category === category) - Number(a.category === category)) : files
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const use = async () => {
    setBusy(true)
    try {
      for (const id of picked) await linkFile({ entityType, entityId, fileId: id, ...(title && { title }) })
      showSuccess(t('ui.reuse.used', { count: picked.length }))
      onPicked?.()
      onClose()
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={t('ui.reuse.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('ui.common.cancel')}</Button>
      <Button icon={Check} loading={busy} disabled={!picked.length} onClick={use}>{t('ui.reuse.use', { count: picked.length })}</Button>
    </>}>
      <p className="mb-3 text-sm text-ink-muted">{t('ui.reuse.hint')}</p>
      {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-black/[0.05]" /> : !sorted.length ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FolderSearch className="h-8 w-8 text-ink-faint" aria-hidden />
          <p className="text-sm text-ink-muted">{t('ui.reuse.none')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sorted.map((f) => {
            const on = picked.includes(f.id)
            return (
              <button key={f.id} type="button" onClick={() => toggle(f.id)} aria-pressed={on}
                className={clsx('relative overflow-hidden rounded-xl border bg-surface text-start transition-colors', on ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border hover:border-brand-300')}>
                {on && <span className="absolute end-2 top-2 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white"><Check className="h-4 w-4" aria-hidden /></span>}
                <Thumb file={f} />
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-ink" title={f.fileName}>{f.title || f.fileName}</p>
                  <p className="truncate text-[11px] text-ink-faint">{[f.categoryLabel, f.side, date(String(f.uploadedAt).slice(0, 10))].filter(Boolean).join(' · ')}</p>
                  {f.verification?.status === 'VERIFIED' && <p className="mt-0.5 text-[11px] font-medium text-success-700">{t('ui.reuse.checked')}</p>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
