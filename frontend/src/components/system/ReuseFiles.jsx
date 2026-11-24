import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, FileText, FolderClosed, FolderSearch } from 'lucide-react'
import { downloadFile, fetchReusable, linkFile } from '../../api/files'
import { fetchFolders } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import Modal from './Modal'
import SegmentedControl from './SegmentedControl'
import SearchInput from './SearchInput'
import { Select } from './Form'
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
 * "Choose from existing", two places to look:
 *   This student — the papers the school already holds about this record's student (given at admission, on the
 *                  student record, for a scholarship);
 *   Library      — files in the document library's folders (a day's scans, forms), searched or one folder at a time.
 * Picking one uses it here — nothing is uploaded again.
 *
 *   <ReuseFiles entityType="scholarship_doc" entityId={docId} onClose={…} onPicked={…} />
 *   fileAs: file the picked ones as this kind (a student's checklist row: “Aadhaar”)
 */
export default function ReuseFiles({ entityType, entityId, category, fileAs, title, onClose, onPicked }) {
  const { t } = useTranslation('ui')
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const canLibrary = hasPermission('documents.library.view')
  const [tab, setTab] = useState('student')
  const [folderId, setFolderId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const own = useQuery({ queryKey: ['files-reusable', entityType, entityId], queryFn: () => fetchReusable(entityType, entityId), enabled: !!entityId })
  const lib = useQuery({ queryKey: ['files-reusable', entityType, entityId, 'library', folderId, q], queryFn: () => fetchReusable(entityType, entityId, { from: 'library', folderId, search: q }), enabled: !!entityId && canLibrary && tab === 'library' })
  const { data: folders = [] } = useQuery({ queryKey: ['doc-library', 'folders'], queryFn: fetchFolders, enabled: canLibrary && tab === 'library' })
  // nothing of the student's own yet: look in the library straight away
  useEffect(() => { if (canLibrary && own.isSuccess && !own.data?.length) setTab('library') }, [canLibrary, own.isSuccess, own.data?.length])
  const { data: files = [], isLoading } = tab === 'library' ? lib : own
  // the same kind first (an Aadhaar for an Aadhaar), then the rest
  const sorted = category && tab === 'student' ? [...files].sort((a, b) => Number(b.category === category) - Number(a.category === category)) : files
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const use = async () => {
    setBusy(true)
    try {
      for (const id of picked) await linkFile({ entityType, entityId, fileId: id, ...(fileAs && { category: fileAs }), ...(title && { title }) })
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
      {canLibrary && (
        <SegmentedControl className="mb-3" value={tab} onChange={setTab} options={[
          { value: 'student', label: t('ui.reuse.tabStudent', { count: own.data?.length ?? 0 }) },
          { value: 'library', label: t('ui.reuse.tabLibrary'), icon: FolderClosed },
        ]} />
      )}
      <p className="mb-3 text-sm text-ink-muted">{tab === 'library' ? t('ui.reuse.hintLibrary') : t('ui.reuse.hint')}</p>
      {tab === 'library' && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder={t('ui.reuse.search')} />
          <div className="sm:w-56">
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label={t('ui.reuse.folder')}>
              <option value="">{t('ui.reuse.allFolders')}</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{`${f.name} (${f.files})`}</option>)}
            </Select>
          </div>
        </div>
      )}
      {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-black/[0.05]" /> : !sorted.length ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FolderSearch className="h-8 w-8 text-ink-faint" aria-hidden />
          <p className="text-sm text-ink-muted">{tab === 'library' ? (q || folderId ? t('ui.reuse.noneFound') : t('ui.reuse.noneLibrary')) : t('ui.reuse.none')}</p>
          {tab === 'student' && canLibrary && <Button size="sm" variant="secondary" icon={FolderClosed} onClick={() => setTab('library')}>{t('ui.reuse.lookLibrary')}</Button>}
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
                  <p className="truncate text-[11px] text-ink-faint">{[f.folder, f.category !== 'OTHER' && f.categoryLabel, f.side, date(f.uploadedAt)].filter(Boolean).join(' · ')}</p>
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
