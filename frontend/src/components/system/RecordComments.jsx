import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, MessageSquare, Send, Trash2 } from 'lucide-react'
import { COMMENT_MAX } from '@schoolgiant/shared'
import Button from '../ui/Button'
import { addComment, deleteComment, editComment, fetchComments } from '../../api/files'
import useAuthUser from '../../hooks/useAuthUser'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useConfirm } from './ConfirmDialog'

const relTime = (iso, t) => {
  const s = Math.round((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return t('ui.comments.justNow')
  if (s < 3600) return t('ui.comments.minAgo', { n: Math.round(s / 60) })
  if (s < 86400) return t('ui.comments.hoursAgo', { n: Math.round(s / 3600) })
  return null
}
const initials = (name) => (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const onSubmitKey = (fn) => (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.repeat) { e.preventDefault(); fn() } }
const area = 'w-full border border-border rounded px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500/25 bg-white'

/**
 * Staff discussion on any record — "parent will pay the balance on Friday",
 * "report requested from the outside lab". Replies are one level deep; the author can
 * edit for a day and delete. Not for formal records: those live in their own module.
 *
 *   <RecordComments entityType="invoice" entityId={bill.id} />
 */
export default function RecordComments({ entityType, entityId, label: labelProp, compact = false }) {
  const { t } = useTranslation('ui')
  const label = labelProp ?? t('ui.comments.discussion')
  const { showError } = useSnackbar()
  const { dateTime } = useFormat()
  const confirm = useConfirm()
  const me = useAuthUser()
  const myId = me?.user?.id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [editId, setEditId] = useState(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(() => {
    if (!entityId) { setItems([]); setLoading(false); return }
    setLoading(true)
    fetchComments(entityType, entityId).then((d) => setItems(d ?? [])).catch(() => setItems([])).finally(() => setLoading(false))
  }, [entityType, entityId])
  useEffect(() => { load() }, [load])

  const post = async (body, parentId) => {
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      const created = await addComment(entityType, entityId, body, parentId)
      setItems((xs) => [...xs, created])
      setText(''); setReplyTo(null); setReplyText('')
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  const saveEdit = async () => {
    if (!editText.trim() || busy) return
    setBusy(true)
    try {
      const updated = await editComment(editId, editText)
      setItems((xs) => xs.map((c) => (c.id === editId ? updated : c)))
      setEditId(null)
    } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  const remove = async (c) => {
    if (!(await confirm({ title: t('ui.comments.deleteTitle'), message: c.body.slice(0, 80), tone: 'danger', confirmLabel: t('ui.common.delete') }))) return
    try { await deleteComment(c.id); setItems((xs) => xs.filter((x) => x.id !== c.id && x.parentId !== c.id)) } catch (e) { showError(e.message) }
  }

  const mine = (c) => c.authorId === myId
  const roots = items.filter((c) => !c.parentId)
  const repliesOf = (id) => items.filter((c) => c.parentId === id)

  const Row = ({ c, isReply }) => (
    <li className={`flex gap-2.5 ${isReply ? 'ms-7' : ''}`}>
      <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold bg-brand-50 text-brand-600">{initials(c.authorName)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-faint flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-ink">{c.authorName}</span>
          <span>{relTime(c.createdAt, t) || dateTime(c.createdAt)}</span>
          {c.edited && <span>· {t('ui.comments.edited')}</span>}
        </p>
        {editId === c.id ? (
          <div className="mt-1 space-y-1.5">
            <textarea rows={2} autoFocus value={editText} maxLength={COMMENT_MAX} onChange={(e) => setEditText(e.target.value)} onKeyDown={onSubmitKey(saveEdit)} className={area} />
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={saveEdit} disabled={!editText.trim()}>{t('ui.common.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>{t('ui.common.cancel')}</Button>
            </div>
          </div>
        ) : <p className="text-sm text-ink whitespace-pre-wrap mt-0.5 break-words">{c.body}</p>}
        {editId !== c.id && (
          <div className="flex gap-3 mt-1 text-[11px] text-ink-faint">
            {!isReply && <button type="button" className="hover:text-ink" onClick={() => { setReplyTo(c.id); setReplyText('') }}>{t('ui.comments.reply')}</button>}
            {mine(c) && <button type="button" className="hover:text-ink" onClick={() => { setEditId(c.id); setEditText(c.body) }}>{t('ui.common.edit')}</button>}
            {(mine(c) || me?.fullAccess) && <button type="button" className="hover:text-danger-600 inline-flex items-center gap-0.5" onClick={() => remove(c)}><Trash2 size={11} /> {t('ui.common.delete')}</button>}
          </div>
        )}
        {replyTo === c.id && (
          <div className="mt-2 flex gap-2 items-start">
            <CornerDownRight size={14} className="text-ink-faint mt-2 shrink-0 hidden sm:block rtl:-scale-x-100" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <textarea rows={2} autoFocus value={replyText} maxLength={COMMENT_MAX} onChange={(e) => setReplyText(e.target.value)} placeholder={t('ui.comments.writeReply')} onKeyDown={onSubmitKey(() => post(replyText, c.id))} className={area} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>{t('ui.common.cancel')}</Button>
                <Button size="sm" loading={busy} disabled={!replyText.trim()} onClick={() => post(replyText, c.id)}>{t('ui.comments.reply')}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </li>
  )

  if (!loading && items.length === 0 && !expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="w-full flex items-center gap-1.5 text-xs text-ink-faint border border-dashed border-border rounded-lg px-3 py-2 hover:bg-bg hover:text-ink-muted">
        <MessageSquare size={13} /> {t('ui.comments.collapsedPrompt', { label })}
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-ink-muted flex items-center gap-1.5"><MessageSquare size={13} /> {label}{items.length ? ` (${items.length})` : ''}</span>
      </div>
      <div className={`px-3 py-3 ${compact ? 'max-h-64 overflow-y-auto' : ''}`}>
        {loading ? <div className="h-10 rounded bg-black/5 animate-pulse" /> : roots.length === 0 ? <p className="text-xs text-ink-faint">{t('ui.comments.empty')}</p> : (
          <ul className="space-y-3">
            {roots.map((c) => (
              <div key={c.id} className="space-y-2.5">
                <Row c={c} />
                {repliesOf(c.id).map((r) => <Row key={r.id} c={r} isReply />)}
              </div>
            ))}
          </ul>
        )}
      </div>
      <div className="px-3 py-2.5 border-t border-border space-y-2">
        <textarea rows={2} value={text} maxLength={COMMENT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('ui.comments.addPlaceholder')} autoFocus={expanded && items.length === 0} onKeyDown={onSubmitKey(() => post(text))} className={area} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint hidden sm:inline">{t('ui.comments.sendHint')}</span>
          <Button size="sm" icon={Send} loading={busy} disabled={!text.trim()} onClick={() => post(text)} className="ms-auto">{t('ui.comments.comment')}</Button>
        </div>
      </div>
    </div>
  )
}
