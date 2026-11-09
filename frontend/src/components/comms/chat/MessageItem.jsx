import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, FileText, Pencil, Pin, PinOff, GraduationCap, RotateCw, SmilePlus, Trash2,
} from 'lucide-react'
import { CHAT_REACTIONS } from '@schoolgiant/shared'
import { Avatar, openDocumentViewer } from '../../system'
import { downloadFile } from '../../../api/files'
import { hasPermission } from '../../../api/auth'
import { downloadBlob } from '../../../utils/download'
import { useFormat } from '../../../context/SettingsContext'
import { fileSize, systemText } from './chatStore'

const openFile = (a) => openDocumentViewer({
  name: a.fileName, contentType: a.contentType,
  load: () => downloadFile(a.id),
  download: async () => downloadBlob(await downloadFile(a.id), a.fileName),
})

/** An image attachment: fetched with the session (never a public URL), shown as a thumbnail. */
function ImageThumb({ a, compact }) {
  const { t } = useTranslation('comms')
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let made = null
    downloadFile(a.id).then((res) => {
      if (!alive) return
      made = URL.createObjectURL(res.data)
      setUrl(made)
    }).catch(() => alive && setFailed(true))
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [a.id])
  return (
    <button type="button" onClick={() => openFile(a)} className={clsx('block rounded-lg overflow-hidden border border-border bg-bg', compact ? 'w-44 h-32' : 'w-48 h-36 sm:w-56 sm:h-40')} title={a.fileName}>
      {url ? <img src={url} alt={a.fileName} className="w-full h-full object-cover" /> : (
        <span className="w-full h-full flex items-center justify-center text-xs text-ink-faint">{failed ? t('chatMessageImageUnavailable') : t('chatLoading')}</span>
      )}
    </button>
  )
}

function FileChip({ a }) {
  return (
    <button type="button" onClick={() => openFile(a)} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-start hover:bg-bg max-w-[16rem]">
      <span className="w-8 h-8 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink truncate">{a.fileName}</span>
        <span className="block text-[11px] text-ink-faint">{fileSize(a.size)}</span>
      </span>
    </button>
  )
}

// Web links in a message: http(s)://… or www.… (never javascript: or data:), without the
// sentence punctuation that follows them. Text stays text — React escapes it, no HTML.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const TRAILING = /[.,;:!?'"\])}]+$/

/** @mentions and @channel highlighted in a run of plain text. */
function withMentions(text, re, meName, onDark, keyBase) {
  if (!re) return [text]
  const out = []
  let last = 0
  let m
  re.lastIndex = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const mine = m[1] === meName || m[1] === 'channel'
    out.push(<span key={`${keyBase}-${m.index}`} className={clsx('font-semibold rounded px-0.5', onDark ? 'bg-white/20 text-white' : mine ? 'bg-amber-100 text-amber-700' : 'text-brand-700')}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Message text with links clickable and @mentions / @channel highlighted. */
function RichText({ text, names = [], meName, onDark }) {
  if (!text) return null
  const tokens = ['channel', ...names].filter(Boolean).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${tokens.join('|')})`, 'g')
  const out = []
  let last = 0
  for (const hit of text.matchAll(URL_RE)) {
    const url = hit[0].replace(TRAILING, '')
    if (!/^(?:https?:\/\/|www\.)\S/i.test(url)) continue
    if (hit.index > last) out.push(...withMentions(text.slice(last, hit.index), re, meName, onDark, `t${last}`))
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    out.push(
      <a key={`u${hit.index}`} href={href} target="_blank" rel="noopener noreferrer"
        className={clsx('underline underline-offset-2 break-all', onDark ? 'text-white' : 'text-brand-600 hover:text-brand-700')}>
        {url}
      </a>,
    )
    last = hit.index + url.length
  }
  if (last < text.length) out.push(...withMentions(text.slice(last), re, meName, onDark, `t${last}`))
  return <span className="whitespace-pre-wrap break-words">{out}</span>
}

/** A student named in a message: a chip that opens the profile for those who may see it. */
export function StudentChip({ student }) {
  const { t } = useTranslation('comms')
  const body = <><GraduationCap className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{student.display}</span></>
  const cls = 'inline-flex items-center gap-1.5 max-w-full rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700'
  return hasPermission('students.profile.view')
    ? <Link to={`/students/profile/${student.id}`} className={clsx(cls, 'hover:bg-violet-100')} title={t('chatMessageOpenStudent')}>{body}</Link>
    : <span className={cls}>{body}</span>
}

function Receipt({ state }) {
  const { t } = useTranslation('comms')
  if (state === 'pending') return <Clock className="w-3 h-3 text-ink-faint" aria-label={t('chatMessageSending')} />
  if (state === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-danger-500" aria-label={t('chatMessageNotSent')} />
  if (state === 'seen') return <CheckCheck className="w-3.5 h-3.5 text-brand-500" aria-label={t('chatMessageSeen')} />
  if (state === 'sent') return <Check className="w-3.5 h-3.5 text-ink-faint" aria-label={t('chatMessageSent')} />
  return null
}

function SeenBy({ names }) {
  const { t } = useTranslation('comms')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!names?.length) return null
  return (
    <span className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] text-ink-muted hover:text-ink hover:underline">{t('chatMessageSeenBy', { n: names.length })}</button>
      {open && (
        <span className="absolute end-0 bottom-6 z-20 w-56 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-pop py-1.5 text-start">
          {names.map((n) => <span key={n} className="flex items-center gap-2 px-3 py-1 text-xs text-ink truncate"><Avatar name={n} size={18} soft />{n}</span>)}
        </span>
      )}
    </span>
  )
}

const ActionBtn = ({ icon: Icon, label, onClick, danger }) => (
  <button type="button" onClick={onClick} title={label} aria-label={label}
    className={clsx('w-7 h-7 rounded-md flex items-center justify-center', danger ? 'text-danger-500 hover:bg-danger-50' : 'text-ink-muted hover:bg-bg hover:text-ink')}>
    <Icon className="w-3.5 h-3.5" />
  </button>
)

function MessageItem({
  m, me, meName, grouped, receipt, seenBy, canModerate, canPin, canPost, selected, highlighted, compact,
  onSelect, onReply, onEdit, onDelete, onReact, onPin, onRetry, onJump,
}) {
  const { t } = useTranslation(['comms', 'common'])
  const { time } = useFormat()
  const [reacting, setReacting] = useState(false)
  const mine = m.senderId === me

  if (m.kind === 'SYSTEM') {
    return <div className="flex justify-center my-2"><span className="text-[11px] text-ink-muted bg-bg border border-border rounded-full px-3 py-1">{systemText(m, t)}</span></div>
  }

  const canAct = !m.deleted && !m.pending && !m.failed
  const actions = canAct && (
    <div className={clsx('absolute -top-3 z-10 items-center gap-0.5 rounded-lg border border-border bg-surface shadow-card px-0.5', mine ? 'end-2' : 'start-2', selected ? 'flex' : 'hidden md:group-hover:flex')}>
      <ActionBtn icon={SmilePlus} label={t('chatMessageReact')} onClick={() => setReacting((r) => !r)} />
      {canPost && <ActionBtn icon={CornerUpLeft} label={t('chatMessageReply')} onClick={() => onReply(m)} />}
      {mine && <ActionBtn icon={Pencil} label={t('common:actions.edit')} onClick={() => onEdit(m)} />}
      {canPin && <ActionBtn icon={m.pinned ? PinOff : Pin} label={m.pinned ? t('chatChannelInfoUnpin') : t('chatMessagePin')} onClick={() => onPin(m)} />}
      {(mine || canModerate) && <ActionBtn icon={Trash2} label={t('common:actions.remove')} danger onClick={() => onDelete(m)} />}
      {reacting && (
        <span className="absolute top-8 z-20 flex gap-0.5 rounded-lg border border-border bg-surface shadow-pop p-1" style={mine ? { right: 0 } : { left: 0 }}>
          {CHAT_REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => { setReacting(false); onReact(m, e) }} className="w-8 h-8 rounded-md hover:bg-bg text-base leading-none">{e}</button>
          ))}
        </span>
      )}
    </div>
  )

  return (
    <div id={`msg-${m.id}`} className={clsx('group relative flex gap-2', compact ? 'px-2.5' : 'px-3 sm:px-4', grouped ? 'mt-0.5' : compact ? 'mt-2' : 'mt-2.5', mine && 'flex-row-reverse')}
      onClick={(e) => { if (!e.target.closest('button,a')) onSelect(selected ? null : m.id) }}>
      {!mine && (grouped ? <span className={clsx('shrink-0', compact ? 'w-7' : 'w-8')} /> : <Avatar name={m.senderName} size={compact ? 28 : 32} className="mt-0.5" />)}
      <div className={clsx('min-w-0 flex flex-col', compact ? 'max-w-[85%]' : 'max-w-[85%] sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        {!grouped && !mine && <span className="text-xs font-medium text-ink mb-0.5 px-1">{m.senderName}</span>}
        <div className={clsx(
          'relative rounded-2xl px-3 py-1.5 text-sm transition-shadow',
          m.deleted ? 'bg-bg border border-dashed border-border text-ink-faint italic' : mine ? 'bg-brand-500 text-white' : 'bg-surface border border-border text-ink',
          mine ? 'rounded-tr-md' : 'rounded-tl-md',
          highlighted && 'ring-2 ring-amber-400',
        )}>
          {m.deleted ? (
            <span>{m.moderated ? t('chatMessageRemovedByAdmin') : t('chatMessageRemoved')}</span>
          ) : (
            <div className="space-y-1.5">
              {m.replyTo && (
                <button type="button" onClick={() => onJump(m.replyTo.id)} className={clsx('block w-full text-start rounded-md border-s-[3px] px-2 py-1 text-xs', mine ? 'bg-white/15 border-white/60 text-white/90' : 'bg-bg border-brand-400 text-ink-muted')}>
                  <span className={clsx('block font-medium', mine ? 'text-white' : 'text-brand-700')}>{m.replyTo.senderName}</span>
                  <span className="line-clamp-2">{m.replyTo.preview}</span>
                </button>
              )}
              {m.pinned && <span className={clsx('flex items-center gap-1 text-[10px] uppercase tracking-wide', mine ? 'text-white/80' : 'text-ink-faint')}><Pin className="w-3 h-3" /> {t('chatChannelInfoPinnedTab')}</span>}
              {m.text && <RichText text={m.text} names={m.mentionNames} meName={meName} onDark={mine} />}
              {m.student && <div><StudentChip student={m.student} /></div>}
              {m.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.attachments.map((a) => (a.image ? <ImageThumb key={a.id} a={a} compact={compact} /> : <FileChip key={a.id} a={a} />))}
                </div>
              )}
            </div>
          )}
          {actions}
        </div>
        {m.reactions?.length > 0 && (
          <div className={clsx('flex flex-wrap gap-1 mt-1', mine && 'justify-end')}>
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" onClick={() => onReact(m, r.emoji)}
                className={clsx('h-6 px-1.5 rounded-full border text-xs flex items-center gap-1', r.userIds.includes(me) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted')}>
                <span>{r.emoji}</span><span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className={clsx('flex items-center gap-1.5 mt-0.5 px-1 text-[11px] text-ink-faint', mine && 'flex-row-reverse')}>
          <span>{time(m.createdAt)}</span>
          {m.editedAt && !m.deleted && <span>· {t('chatMessageEdited')}</span>}
          {mine && <Receipt state={receipt} />}
          {mine && m.failed && <button type="button" onClick={() => onRetry(m)} className="flex items-center gap-1 text-danger-500 hover:underline"><RotateCw className="w-3 h-3" /> {t('chatMessageRetry')}</button>}
          {mine && seenBy && <SeenBy names={seenBy} />}
        </div>
      </div>
    </div>
  )
}

export default memo(MessageItem)
