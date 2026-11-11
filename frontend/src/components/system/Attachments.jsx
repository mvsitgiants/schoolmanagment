import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Eye, FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { DOCUMENT_RECORD_TYPES, FILE_ACCEPT, FILE_CATEGORIES, FILE_MAX_MB, RECORD_TYPES } from '@schoolgiant/shared'
import { deleteFile, downloadFile, fetchFiles, fetchStudentFiles, uploadFile } from '../../api/files'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { usePrompt } from './ConfirmDialog'
import { openDocumentViewer } from './DocumentViewer'
import { Select } from './Form'

const fmtSize = (n) => {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const isImage = (row) => /^image\//i.test(row?.contentType || '')

/**
 * Files on any record — scanned ID, outside reports, referral letters, payment proof.
 * Drag files in, paste a screenshot or use Upload. The server checks each file's real
 * type; removing a file asks why and keeps it in the record's history.
 *
 *   <Attachments entityType="invoice" entityId={bill.id} canAdd={…} />
 *   <Attachments entityType="student" entityId={p.id} studentScope />   // everything about the student
 */
export default function Attachments({ entityType, entityId, studentScope = false, category: defaultCategory = 'OTHER', label: labelProp, canAdd = true, compact = false, hideEmpty = false, onChange }) {
  const { t } = useTranslation('ui')
  const label = labelProp ?? t('ui.attachments.files')
  const { showError, showSuccess } = useSnackbar()
  const { dateTime } = useFormat()
  const prompt = usePrompt()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [category, setCategory] = useState(defaultCategory)
  // "kind of file" only means something for personal documents (a student's birth certificate, a staff ID proof)
  const withKind = DOCUMENT_RECORD_TYPES.includes(entityType)
  const inputRef = useRef(null)

  const load = useCallback(() => {
    if (!entityId) { setItems([]); setLoading(false); return }
    setLoading(true)
    ;(studentScope ? fetchStudentFiles(entityId) : fetchFiles(entityType, entityId))
      .then((data) => setItems(data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [entityType, entityId, studentScope])
  useEffect(() => { load() }, [load])

  const uploadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length || !canAdd) return
    if (!entityId) { showError(t('ui.attachments.saveFirst')); return }
    const big = files.find((f) => f.size > FILE_MAX_MB * 1024 * 1024)
    if (big) { showError(t('ui.attachments.tooBig', { name: big.name, max: FILE_MAX_MB })); return }
    setBusy(true)
    try {
      for (const f of files) await uploadFile(entityType, entityId, f, { category })
      showSuccess(t('ui.attachments.filesAdded', { count: files.length }))
      load()
      onChange?.()
    } catch (err) {
      showError(err.message || t('ui.attachments.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }, [canAdd, entityType, entityId, category, load, onChange, showError, showSuccess, t])

  const onDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files) }
  const onDragOver = (e) => { if (canAdd && Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); setDragging(true) } }
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean)
    if (files.length && canAdd) { e.preventDefault(); uploadFiles(files) }
  }

  const download = async (row) => {
    try {
      const { data } = await downloadFile(row.id)
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = row.fileName || 'file'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      showError(err.message || t('ui.attachments.downloadFailed'))
    }
  }
  const view = (row) => openDocumentViewer({ name: row.fileName, contentType: row.contentType, load: () => downloadFile(row.id), download: () => download(row) })
  const remove = async (row) => {
    const reason = await prompt({ title: t('ui.attachments.removeTitle', { name: row.fileName }), label: t('ui.attachments.removeReason'), placeholder: t('ui.attachments.removePlaceholder'), required: true, confirmLabel: t('ui.common.remove'), tone: 'danger' })
    if (!reason) return
    try { await deleteFile(row.id, reason); showSuccess(t('ui.attachments.removed')); load(); onChange?.() } catch (err) { showError(err.message || t('ui.attachments.removeFailed')) }
  }

  // read-only and nothing attached: say nothing (hideEmpty)
  if (hideEmpty && (loading || !items.length)) return null
  return (
    <div
      className={`relative rounded-lg border bg-surface outline-none transition-colors ${dragging ? 'border-brand-400 ring-2 ring-brand-500/50' : 'border-border'}`}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onPaste={onPaste} tabIndex={0}
    >
      {dragging && <div className="absolute inset-0 z-10 rounded-lg bg-brand-50/90 border-2 border-dashed border-brand-400 flex items-center justify-center text-sm font-medium text-brand-700 pointer-events-none">{t('ui.attachments.dropToAdd')}</div>}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border flex-wrap">
        <span className="text-xs font-semibold text-ink-muted flex items-center gap-1.5"><Paperclip size={13} /> {label}{items.length ? ` (${items.length})` : ''}</span>
        {canAdd && (
          <div className="flex items-center gap-2">
            {withKind && <div className="w-48"><Select aria-label={t('ui.attachments.kindOfFile')} value={category} onChange={(e) => setCategory(e.target.value)} className="!h-8 text-xs">{FILE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></div>}
            <button type="button" onClick={() => inputRef.current?.click()} disabled={!entityId || busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {t('ui.attachments.upload')}
            </button>
          </div>
        )}
        <input ref={inputRef} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(f) }} />
      </div>
      {canAdd && <p className="px-3 py-1.5 text-[11px] text-ink-faint border-b border-border">{t('ui.attachments.hint', { max: FILE_MAX_MB })}</p>}

      <div className={compact ? 'max-h-48 overflow-y-auto' : ''}>
        {loading ? (
          <div className="px-3 py-2.5 space-y-2.5" aria-hidden="true">
            {[0, 1].map((i) => <div key={i} className="h-3.5 rounded bg-black/5 animate-pulse" style={{ width: `${70 - i * 18}%` }} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-ink-faint">{t('ui.attachments.empty')}</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((row) => (
              <li key={row.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                {isImage(row) ? <ImageIcon size={15} className="text-ink-faint shrink-0" /> : <FileText size={15} className="text-ink-faint shrink-0" />}
                <button type="button" onClick={() => view(row)} className="flex-1 min-w-0 text-start group" title={t('ui.attachments.viewName', { name: row.fileName })}>
                  <span className="block truncate text-ink group-hover:text-brand-700 group-hover:underline">{row.title || row.fileName}</span>
                  <span className="block text-[11px] text-ink-faint truncate">
                    {[DOCUMENT_RECORD_TYPES.includes(row.entityType) ? row.categoryLabel : null, studentScope && row.entityType !== 'student' ? t('ui.attachments.onRecord', { type: RECORD_TYPES[row.entityType]?.toLowerCase() }) : null, row.uploadedBy, dateTime(row.uploadedAt)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <span className="text-xs text-ink-faint shrink-0 hidden sm:inline">{fmtSize(row.size)}</span>
                <button type="button" onClick={() => view(row)} className="p-1 rounded hover:bg-bg text-ink-muted" title={t('ui.common.view')}><Eye size={14} /></button>
                <button type="button" onClick={() => download(row)} className="p-1 rounded hover:bg-bg text-ink-muted" title={t('ui.common.download')}><Download size={14} /></button>
                {canAdd && <button type="button" onClick={() => remove(row)} className="p-1 rounded hover:bg-bg text-ink-muted hover:text-danger-500" title={t('ui.common.remove')}><Trash2 size={14} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
