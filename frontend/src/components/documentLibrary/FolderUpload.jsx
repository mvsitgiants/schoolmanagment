import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Camera, FolderClosed, FolderPlus, Upload, X } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import { FormField, Input, Modal, Select } from '../system'
import Button from '../ui/Button'
import { FileIcon, fmtSize, useFileLabels } from './LibraryKit'
import { uploadFile } from '../../api/files'
import { createFolder, fetchFolders, updateFolder } from '../../api/documentLibrary'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Put files in the library: pick a folder the school already has, or make a new one, then choose files (or take a
 * photo). Each file lands in that folder and can be used again on any student's record later ("Choose from existing").
 *
 *   <FolderUpload folderId={current} onClose={…} onDone={(folder) => …} />
 */
export function FolderUpload({ folderId, onClose, onDone }) {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: folders = [], isLoading } = useQuery({ queryKey: ['doc-library', 'folders'], queryFn: fetchFolders })
  const [mode, setMode] = useState(null) // 'existing' | 'new' — null until the folders are known
  const [pick, setPick] = useState(folderId ?? '')
  const [name, setName] = useState('')
  const [kind, setKind] = useState('OTHER')
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(null) // { done, total }
  const [error, setError] = useState({})
  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const how = mode ?? (isLoading ? 'existing' : folders.length ? 'existing' : 'new')

  const add = (e) => {
    const list = [...(e.target.files ?? [])]
    e.target.value = ''
    if (list.length) setFiles((x) => [...x, ...list])
  }
  const save = async () => {
    const err = {}
    if (how === 'existing' && !pick) err.folder = t('documentLibrary.upload.pickFolder')
    if (how === 'new' && !name.trim()) err.name = t('documentLibrary.folders.nameNeeded')
    if (!files.length) err.files = t('documentLibrary.upload.pickFiles')
    setError(err)
    if (Object.keys(err).length) return
    setProgress({ done: 0, total: files.length })
    try {
      const folder = how === 'new' ? await createFolder({ name: name.trim() }) : folders.find((f) => f.id === pick)
      let done = 0
      for (const f of files) {
        await uploadFile('doc_folder', folder.id, f, { category: kind, title: files.length === 1 ? title.trim() : undefined })
        done += 1
        setProgress({ done, total: files.length })
      }
      qc.invalidateQueries({ queryKey: ['doc-library'] })
      showSuccess(t('documentLibrary.upload.done', { count: files.length, folder: folder.name }))
      onDone?.(folder)
      onClose()
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['doc-library'] })
      showError(e.message)
      setProgress(null)
    }
  }
  const busy = !!progress

  return (
    <Modal open onClose={busy ? () => {} : onClose} size="md" title={t('documentLibrary.upload.title')} footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>{t('documentLibrary.common.cancel')}</Button>
      <Button icon={Upload} loading={busy} onClick={save}>
        {busy ? t('documentLibrary.upload.progress', { done: progress.done, total: progress.total }) : (files.length ? t('documentLibrary.upload.save', { count: files.length }) : t('documentLibrary.upload.button'))}
      </Button>
    </>}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{t('documentLibrary.upload.where')}</p>
          <div className="grid grid-cols-2 gap-2">
            {[['existing', FolderClosed, t('documentLibrary.upload.existing')], ['new', FolderPlus, t('documentLibrary.upload.new')]].map(([k, Icon, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={how === k} disabled={k === 'existing' && !isLoading && !folders.length}
                className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-start text-sm disabled:opacity-50',
                  how === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:text-ink')}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />{label}
              </button>
            ))}
          </div>
        </div>
        {how === 'existing' ? (
          <FormField label={t('documentLibrary.upload.folder')} required error={error.folder}>
            <Select value={pick} onChange={(e) => setPick(e.target.value)} placeholder={t('documentLibrary.upload.pickFolder')}>
              <option value="">{t('documentLibrary.upload.pickFolder')}</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{`${f.name} (${t('documentLibrary.folders.files', { count: f.files })})`}</option>)}
            </Select>
          </FormField>
        ) : (
          <FormField label={t('documentLibrary.folders.name')} required error={error.name} hint={t('documentLibrary.folders.nameHint')}>
            <Input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('documentLibrary.folders.namePlaceholder')} />
          </FormField>
        )}

        <FormField label={t('documentLibrary.upload.kind')} hint={t('documentLibrary.upload.kindHint')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {FILE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.kind(c.value)}</option>)}
          </Select>
        </FormField>
        {files.length <= 1 && (
          <FormField label={t('documentLibrary.upload.titleLabel')} hint={t('documentLibrary.upload.titleHint')}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
        )}

        <div>
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,video/mp4,video/webm" className="hidden" onChange={add} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={add} />
          <div className={clsx('rounded-xl border border-dashed p-4 text-center', error.files ? 'border-danger-500' : 'border-border')}>
            <p className="text-sm text-ink-muted">{t('documentLibrary.upload.filesHint')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="secondary" icon={Upload} disabled={busy} onClick={() => fileRef.current?.click()}>{t('documentLibrary.upload.chooseFiles')}</Button>
              <Button size="sm" variant="secondary" icon={Camera} disabled={busy} onClick={() => cameraRef.current?.click()}>{t('documentLibrary.upload.camera')}</Button>
            </div>
            {error.files && <p className="mt-2 text-xs text-danger-600">{error.files}</p>}
          </div>
          {files.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <FileIcon file={{ contentType: f.type }} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                  <span className="text-xs tabular-nums text-ink-faint">{fmtSize(f.size)}</span>
                  {!busy && (
                    <button type="button" className="rounded p-1 text-ink-faint hover:bg-bg hover:text-ink" aria-label={t('documentLibrary.upload.removeFile', { name: f.name })}
                      onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" aria-hidden /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Make a folder, or rename one. */
export function FolderNameModal({ folder, onClose, onDone }) {
  const { t } = useTranslation('documentLibrary')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [name, setName] = useState(folder?.name ?? '')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim()) { setErr(t('documentLibrary.folders.nameNeeded')); return }
    setBusy(true)
    try {
      const f = folder ? await updateFolder(folder.id, { name: name.trim() }) : await createFolder({ name: name.trim() })
      qc.invalidateQueries({ queryKey: ['doc-library'] })
      showSuccess(folder ? t('documentLibrary.folders.renamed') : t('documentLibrary.folders.made', { name: f.name }))
      onDone?.(f)
      onClose()
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={folder ? t('documentLibrary.folders.renameTitle') : t('documentLibrary.folders.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('documentLibrary.common.cancel')}</Button>
      <Button icon={folder ? undefined : FolderPlus} loading={busy} onClick={save}>{folder ? t('documentLibrary.folders.saveName') : t('documentLibrary.folders.make')}</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <FormField label={t('documentLibrary.folders.name')} required error={err} hint={t('documentLibrary.folders.nameHint')}>
          <Input value={name} maxLength={60} autoFocus onChange={(e) => { setName(e.target.value); setErr(null) }} placeholder={t('documentLibrary.folders.namePlaceholder')} />
        </FormField>
      </form>
    </Modal>
  )
}
