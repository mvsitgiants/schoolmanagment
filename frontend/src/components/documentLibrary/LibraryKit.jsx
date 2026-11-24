import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Download, File, FileImage, FileSpreadsheet, FileText, FileVideo, FolderDown } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import { Drawer, FormField, Modal, Note, Select, Skeleton, StatusPill } from '../system'
import { openDocumentViewer } from '../system/DocumentViewer'
import Button from '../ui/Button'
import { downloadFile } from '../../api/files'
import { downloadZip, fetchLibrary } from '../../api/documentLibrary'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

export const isImage = (f) => /^image\//i.test(f?.contentType ?? '')
export const fmtSize = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`)

/** The right picture of a file type. */
export function FileIcon({ file, className = 'h-5 w-5' }) {
  const ct = file?.contentType ?? ''
  const Icon = /^image\//.test(ct) ? FileImage : /pdf|word|text/.test(ct) ? FileText : /sheet|excel|csv/.test(ct) ? FileSpreadsheet : /^video\//.test(ct) ? FileVideo : File
  return <Icon className={clsx('text-ink-muted', className)} aria-hidden />
}

/** A file's label in the reader's language: its own title, else its kind, else its file name. */
export function useFileLabels() {
  const { t } = useTranslation('documentLibrary')
  return {
    kind: (k) => t(`documentLibrary.kind.${k}`, k),
    source: (s) => t(`documentLibrary.source.${s}`, s),
    person: (p) => t(`documentLibrary.person.${p}`, p),
  }
}

/** A picture's thumbnail, fetched only once it scrolls into view; other files show their type. */
export function Thumb({ file, className }) {
  const ref = useRef(null)
  const [url, setUrl] = useState(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!isImage(file) || !ref.current) return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [file])
  useEffect(() => {
    if (!seen) return undefined
    let made = null
    let gone = false
    downloadFile(file.id).then((r) => { if (gone) return; made = URL.createObjectURL(r.data); setUrl(made) }).catch(() => {})
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [seen, file.id])
  return (
    <div ref={ref} className={clsx('flex items-center justify-center overflow-hidden bg-bg', className)}>
      {url ? <img src={url} alt={file.fileName} className="h-full w-full object-cover" /> : <FileIcon file={file} className="h-8 w-8" />}
    </div>
  )
}

export const openFile = (f) => openDocumentViewer({ name: f.fileName, contentType: f.contentType, load: () => downloadFile(f.id) })

/** "Checked" / "Not checked yet" / "Not accepted" for personal documents; nothing for the school's own files. */
export function CheckedPill({ file }) {
  const { t } = useTranslation('documentLibrary')
  if (!file.personal || file.source === 'scholarship_doc') return null
  const st = file.verification?.status ?? 'PENDING'
  return <StatusPill tone={st === 'VERIFIED' ? 'success' : st === 'REJECTED' ? 'danger' : 'neutral'}>{t(`documentLibrary.checked.${st}`)}</StatusPill>
}

/**
 * A whole class's documents as one ZIP, a folder per student — all of them or only some kinds (e.g. the birth
 * certificate and photo for board registration).
 */
export function ClassZip({ meta, onClose }) {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const { showError, showSuccess } = useSnackbar()
  const [classId, setClassId] = useState(meta?.classes?.[0]?.id ?? '')
  const [sectionId, setSectionId] = useState('')
  const [kinds, setKinds] = useState([])
  const [busy, setBusy] = useState(false)
  const sections = (meta?.sections ?? []).filter((s) => s.classId === classId)
  const className = meta?.classes?.find((c) => c.id === classId)?.name ?? ''
  const toggle = (k) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))
  const go = async () => {
    setBusy(true)
    try {
      const section = sections.find((s) => s.id === sectionId)
      await downloadZip({ classId: sectionId ? undefined : classId, sectionId: sectionId || undefined, kinds: kinds.length ? kinds : undefined, name: `${className}${section ? `-${section.name}` : ''}-documents` })
      showSuccess(t('documentLibrary.zip.started'))
      onClose()
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={t('documentLibrary.zip.classTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('documentLibrary.common.cancel')}</Button>
      <Button icon={FolderDown} loading={busy} disabled={!classId} onClick={go}>{t('documentLibrary.zip.download')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('documentLibrary.filter.class')}>
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId('') }}>{(meta?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </FormField>
          <FormField label={t('documentLibrary.filter.section')}>
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">{t('documentLibrary.filter.allSections')}</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">{t('documentLibrary.zip.kinds')}</p>
          <div className="flex flex-wrap gap-2">
            {FILE_CATEGORIES.filter((c) => c.value !== 'HR_DOCUMENT').map((c) => (
              <label key={c.value} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm hover:bg-bg">
                <input type="checkbox" checked={kinds.includes(c.value)} onChange={() => toggle(c.value)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                {L.kind(c.value)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-faint">{t('documentLibrary.zip.kindsHint')}</p>
        </div>
        <Note>{t('documentLibrary.zip.classHint')}</Note>
      </div>
    </Modal>
  )
}

/** One student's or staff member's folder: every document, by kind, newest first — preview or download all. */
export function PersonFolder({ person, onClose }) {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const params = person.kind === 'STUDENT' ? { studentId: person.id } : { employeeId: person.id }
  const { data, isLoading } = useQuery({ queryKey: ['doc-library', 'person', params], queryFn: () => fetchLibrary({ ...params, pageSize: 200 }) })
  const groups = useMemo(() => {
    const m = new Map()
    for (const f of data?.rows ?? []) {
      const k = f.category ?? 'OTHER'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(f)
    }
    return [...m.entries()]
  }, [data])
  const all = async () => {
    setBusy(true)
    try { await downloadZip({ ...params, name: `${person.sub ?? ''} ${person.name ?? ''}`.trim() || 'documents' }) } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  return (
    <Drawer open onClose={onClose} size="lg" subtitle={[L.person(person.kind), person.sub, person.classShort].filter(Boolean).join(' · ')} title={person.name ?? '—'}
      footer={<Button icon={Download} loading={busy} disabled={!data?.rows?.length} onClick={all}>{t('documentLibrary.folder.downloadAll', { count: data?.total ?? 0 })}</Button>}>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !groups.length ? <p className="text-sm text-ink-muted">{t('documentLibrary.folder.empty')}</p> : (
        <div className="space-y-5">
          {groups.map(([kind, files]) => (
            <section key={kind}>
              <h3 className="mb-2 text-sm font-semibold text-ink">{L.kind(kind)} <span className="font-normal text-ink-faint">· {files.length}</span></h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {files.map((f) => (
                  <button key={f.id} type="button" onClick={() => openFile(f)} className="overflow-hidden rounded-xl border border-border bg-surface text-start hover:border-brand-300">
                    <Thumb file={f} className="aspect-[4/3] w-full" />
                    <div className="p-2">
                      <p className="truncate text-xs font-medium text-ink" title={f.fileName}>{f.title || f.fileName}</p>
                      <p className="truncate text-[11px] text-ink-faint">{L.source(f.source)} · {dateTime(f.uploadedAt)}</p>
                      <div className="mt-1"><CheckedPill file={f} /></div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  )
}
