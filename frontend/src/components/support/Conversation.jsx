import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Loader2, Lock, Paperclip, Send, X } from 'lucide-react'
import { FILE_ACCEPT, FILE_MAX_MB, SUPPORT_FILES_MAX } from '@schoolgiant/shared'
import { Textarea, openDocumentViewer } from '../system'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// One support request's conversation, for both sides: the school's Help & support page and the team's console.
// `side`: whose screen it is ('SCHOOL' | 'SUPPORT') — their own messages sit on the right. The team also sees its
// internal notes (amber, with a lock). Files open in the app's viewer.

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export function FileChip({ file, loadFile, onRemove }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink">
      <Paperclip className="w-3.5 h-3.5 text-ink-faint shrink-0" />
      {loadFile ? (
        <button type="button" className="truncate hover:underline" onClick={() => openDocumentViewer({ name: file.name, contentType: file.mime, load: () => loadFile(file.id) })}>{file.name}</button>
      ) : <span className="truncate">{file.name}</span>}
      <span className="text-ink-faint shrink-0">{size(file.size)}</span>
      {onRemove && <button type="button" onClick={onRemove} className="text-ink-faint hover:text-danger-600" aria-label="×"><X className="w-3.5 h-3.5" /></button>}
    </span>
  )
}

export function Messages({ messages, side, loadFile }) {
  const { t } = useTranslation('ui')
  const { dateTime } = useFormat()
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = m.from === side
        return (
          <li key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
            <div className={clsx('max-w-[85%] rounded-xl px-3.5 py-2.5 border',
              m.internal ? 'bg-amber-50 border-amber-400/40' : mine ? 'bg-brand-50 border-brand-200' : 'bg-surface border-border')}>
              <p className="text-[11px] text-ink-muted mb-1 flex items-center gap-1.5">
                {m.internal && <Lock className="w-3 h-3" />}
                <span className="font-medium text-ink">{m.from === 'SUPPORT' ? (side === 'SCHOOL' ? t('ui.support.team') : m.byName) : m.byName}</span>
                <span>· {dateTime(m.at)}</span>
                {m.internal && <span>· {t('ui.support.internalNote')}</span>}
              </p>
              <p className="text-sm text-ink whitespace-pre-line break-words">{m.body}</p>
              {m.files?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{m.files.map((f) => <FileChip key={f.id} file={f} loadFile={loadFile} />)}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The reply box: text and up to five files (each goes up as it is picked; the message carries their ids).
 * `extra`: controls beside the send button (the team's status choice and internal-note switch).
 */
export function ReplyBox({ onSend, uploadFile, placeholder, sendLabel, extra, disabled, busy }) {
  const { t } = useTranslation('ui')
  const { showError } = useSnackbar()
  const input = useRef(null)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const pick = async (list) => {
    const chosen = Array.from(list ?? []).slice(0, SUPPORT_FILES_MAX - files.length)
    for (const f of chosen) {
      if (f.size > FILE_MAX_MB * 1024 * 1024) { showError(t('ui.support.tooBig', { max: FILE_MAX_MB })); continue }
      setUploading(true)
      try { const saved = await uploadFile(f); setFiles((x) => [...x, saved]) } catch (e) { showError(e.message) } finally { setUploading(false) }
    }
  }
  const send = async () => {
    if (!body.trim()) return
    const ok = await onSend({ body: body.trim(), fileIds: files.map((f) => f.id) })
    if (ok !== false) { setBody(''); setFiles([]) }
  }
  return (
    <div className="space-y-2" onPaste={(e) => { const fl = Array.from(e.clipboardData?.files ?? []); if (fl.length) { e.preventDefault(); pick(fl) } }}>
      <Textarea rows={4} maxLength={5000} value={body} disabled={disabled} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} />
      {files.length > 0 && <div className="flex flex-wrap gap-1.5">{files.map((f) => <FileChip key={f.id} file={f} onRemove={() => setFiles((x) => x.filter((y) => y.id !== f.id))} />)}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon={uploading ? Loader2 : Paperclip} disabled={disabled || uploading || files.length >= SUPPORT_FILES_MAX} onClick={() => input.current?.click()}>{t('ui.support.attach')}</Button>
        <span className="text-[11px] text-ink-faint hidden sm:inline">{t('ui.support.attachHint', { max: FILE_MAX_MB })}</span>
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {extra}
          <Button icon={Send} loading={busy} disabled={disabled || uploading || !body.trim()} onClick={send}>{sendLabel ?? t('ui.support.send')}</Button>
        </span>
      </div>
      <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const fl = Array.from(e.target.files ?? []); e.target.value = ''; pick(fl) }} />
    </div>
  )
}
