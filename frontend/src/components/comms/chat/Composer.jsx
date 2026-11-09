import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AtSign, CornerUpLeft, FileText, GraduationCap, Loader2, Paperclip, Pencil, SendHorizontal, X } from 'lucide-react'
import { CHAT_ATTACHMENTS_MAX, CHAT_MESSAGE_MAX, FILE_ACCEPT, FILE_MAX_MB } from '@schoolgiant/shared'
import { Avatar, Modal } from '../../system'
import Button from '../../ui/Button'
import StudentPicker from '../../fees/StudentPicker'
import { fetchChatMembers, uploadChatAttachment } from '../../../api/comms'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useSnackbar } from '../../../context/SnackbarContext'
import { errText, getDraft, setDraft } from './chatStore'

const MENTION_AT = /(?:^|\s)@([^\s@]{0,30})$/

/**
 * Multi-line message box: Enter sends, Shift+Enter is a new line, ↑ in an empty box edits
 * your last message, Esc cancels a reply / edit. "@" opens the people picker (and @channel
 * for the chat's admins); files and a student chip can ride along. Unsent text is kept per chat (`draftKey`,
 * default the chat id). A direct chat that does not exist yet passes `ensureChannel` (makes it,
 * resolves its id) so a file can be attached before the first message.
 */
export default function Composer({
  channelId, draftKey, ensureChannel, canPost, canModerate, canAttachStudent, isDirect, disabledReason,
  replyTo, editing, onCancelReply, onCancelEdit, onSend, onSaveEdit, onTyping, onEditLast,
}) {
  const { t } = useTranslation(['comms', 'common'])
  const { showError } = useSnackbar()
  const key = draftKey ?? channelId
  const [text, setText] = useState(() => getDraft(key))
  const [picked, setPicked] = useState([]) // [{ id, name }]
  const [files, setFiles] = useState([]) // [{ key, status, id, fileName, contentType, size, image }]
  const [student, setStudent] = useState(null) // { id, display }
  const [studentOpen, setStudentOpen] = useState(false)
  const [studentPick, setStudentPick] = useState('')
  const [mention, setMention] = useState(null) // { q, start }
  const [mentionIdx, setMentionIdx] = useState(0)
  const area = useRef(null)
  const fileInput = useRef(null)
  const uploadTo = useRef(null) // the direct chat made for an attachment before the first message
  const mentionQ = useDebouncedValue(mention?.q ?? '', 150)

  // a fresh box for every chat (with its unsent text); editing loads the message
  useEffect(() => { setText(getDraft(key)); setPicked([]); setFiles([]); setStudent(null); setMention(null); uploadTo.current = null }, [key])
  useEffect(() => {
    if (!editing) return
    setText(editing.text ?? '')
    setPicked((editing.mentions ?? []).map((id, i) => ({ id, name: editing.mentionNames?.[i] })).filter((p) => p.name))
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
  }, [editing])
  useEffect(() => { if (replyTo) area.current?.focus() }, [replyTo])

  // grow with the text, up to about six lines
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const { data: people = [] } = useQuery({
    queryKey: ['chat', 'members', channelId, mentionQ],
    queryFn: () => fetchChatMembers(channelId, mentionQ),
    enabled: !!mention && !!channelId && !isDirect,
    staleTime: 30_000,
  })
  const options = mention ? [
    ...(canModerate && !isDirect && 'channel'.startsWith(mention.q.toLowerCase()) ? [{ id: '@channel', name: 'channel', designation: t('chatComposerEveryoneInChat') }] : []),
    ...people.filter((p) => !p.me),
  ].slice(0, 8) : []
  useEffect(() => { setMentionIdx(0) }, [mentionQ])

  const readMention = (value, caret) => {
    if (isDirect) return setMention(null)
    const m = MENTION_AT.exec(value.slice(0, caret))
    setMention(m ? { q: m[1], start: caret - m[1].length - 1 } : null)
  }

  const pickMention = (p) => {
    const el = area.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, mention.start)
    const insert = `@${p.name} `
    const next = before + insert + text.slice(caret)
    setText(next)
    if (p.id !== '@channel') setPicked((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, { id: p.id, name: p.name }]))
    setMention(null)
    requestAnimationFrame(() => { const pos = before.length + insert.length; el?.focus(); el?.setSelectionRange(pos, pos) })
  }

  const uploading = files.some((f) => f.status === 'uploading')
  const ready = files.filter((f) => f.status === 'done')
  const canSend = canPost && !uploading && (text.trim() || ready.length || student) && text.length <= CHAT_MESSAGE_MAX

  // after an edit, the unsent text comes back; after a send, it is gone
  const reset = () => {
    if (!editing) setDraft(key, '')
    setText(editing ? getDraft(key) : '')
    setPicked([]); setFiles([]); setStudent(null); setMention(null)
  }
  const canAttach = !!(channelId || ensureChannel)

  const submit = () => {
    if (editing) {
      const msg = text.trim()
      onSaveEdit(editing, msg, picked.filter((p) => msg.includes(`@${p.name}`)).map((p) => p.id))
      reset()
      return
    }
    if (!canSend) return
    const msg = text.trim()
    onSend({
      text: msg,
      mentions: picked.filter((p) => msg.includes(`@${p.name}`)).map((p) => p.id),
      mentionNames: picked.filter((p) => msg.includes(`@${p.name}`)).map((p) => p.name),
      mentionChannel: canModerate && /(^|\s)@channel\b/.test(msg),
      attachmentIds: ready.map((f) => f.id),
      attachments: ready.map(({ id, fileName, contentType, size, image }) => ({ id, fileName, contentType, size, image })),
      studentId: student?.id,
      student,
    })
    reset()
  }

  const onKeyDown = (e) => {
    if (mention && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % options.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + options.length) % options.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(options[mentionIdx]); return }
    }
    if (e.key === 'Escape') {
      if (mention) { setMention(null); return }
      if (editing) { onCancelEdit(); reset(); return }
      if (replyTo) { onCancelReply(); return }
    }
    if (e.key === 'ArrowUp' && !text && !editing) { e.preventDefault(); onEditLast(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  const addFiles = async (list) => {
    const room = CHAT_ATTACHMENTS_MAX - files.length
    const chosen = [...list].slice(0, Math.max(0, room))
    if (list.length > chosen.length) showError(t('chatComposerMaxFiles', { max: CHAT_ATTACHMENTS_MAX }))
    if (!chosen.length) return
    let target = channelId || uploadTo.current
    if (!target && ensureChannel) {
      try { target = await ensureChannel(); uploadTo.current = target } catch (err) { showError(errText(err)); return }
    }
    if (!target) return
    for (const file of chosen) {
      if (file.size > FILE_MAX_MB * 1024 * 1024) { showError(t('chatComposerFileTooBig', { name: file.name, max: FILE_MAX_MB })); continue }
      const fkey = `${file.name}-${file.size}-${Math.random()}`
      setFiles((xs) => [...xs, { key: fkey, status: 'uploading', fileName: file.name, size: file.size }])
      try {
        const up = await uploadChatAttachment(target, file)
        setFiles((xs) => xs.map((f) => (f.key === fkey ? { ...f, status: 'done', id: up.id, fileName: up.fileName, contentType: up.contentType, size: up.size, image: /^image\//.test(up.contentType) } : f)))
      } catch (err) {
        setFiles((xs) => xs.filter((f) => f.key !== fkey))
        showError(errText(err))
      }
    }
  }

  if (!canPost) {
    return <div className="shrink-0 border-t border-border px-4 py-3 text-center text-xs text-ink-muted bg-bg">{disabledReason || t('chatComposerReadOnly')}</div>
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface px-2 sm:px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {(replyTo || editing) && (
        <div className="flex items-start gap-2 mb-2 rounded-lg bg-bg border-s-[3px] border-brand-400 px-2.5 py-1.5">
          {editing ? <Pencil className="w-3.5 h-3.5 mt-0.5 text-brand-600 shrink-0" /> : <CornerUpLeft className="w-3.5 h-3.5 mt-0.5 text-brand-600 shrink-0" />}
          <span className="min-w-0 flex-1 text-xs">
            <span className="block font-medium text-brand-700">{editing ? t('chatComposerEditing') : t('chatComposerReplyingTo', { name: replyTo.senderName })}</span>
            {!editing && <span className="block text-ink-muted truncate">{replyTo.text || t('chatAttachment')}</span>}
          </span>
          <button type="button" aria-label={t('common:actions.cancel')} onClick={() => { if (editing) { onCancelEdit(); reset() } else onCancelReply() }} className="w-6 h-6 rounded flex items-center justify-center text-ink-muted hover:bg-surface"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {(files.length > 0 || student) && !editing && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {student && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 ps-2.5 pe-1 py-0.5 text-xs font-medium text-violet-700 max-w-full">
              <GraduationCap className="w-3.5 h-3.5" /><span className="truncate">{student.display}</span>
              <button type="button" aria-label={t('chatComposerRemoveStudent')} onClick={() => setStudent(null)} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-violet-100"><X className="w-3 h-3" /></button>
            </span>
          )}
          {files.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg ps-2 pe-1 py-1 text-xs text-ink max-w-[14rem]">
              {f.status === 'uploading' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-faint" /> : <FileText className="w-3.5 h-3.5 text-brand-600" />}
              <span className="truncate">{f.fileName}</span>
              <button type="button" aria-label={t('chatComposerRemoveFile')} disabled={f.status === 'uploading'} onClick={() => setFiles((xs) => xs.filter((x) => x.key !== f.key))} className="w-5 h-5 rounded flex items-center justify-center hover:bg-surface disabled:opacity-40"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-1">
        {mention && options.length > 0 && (
          <div className="absolute start-0 bottom-full mb-2 w-72 max-w-full rounded-lg border border-border bg-surface shadow-pop py-1 z-20">
            {options.map((p, i) => (
              <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(p) }}
                className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-start', i === mentionIdx ? 'bg-brand-50' : 'hover:bg-bg')}>
                {p.id === '@channel' ? <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"><AtSign className="w-3.5 h-3.5" /></span> : <Avatar name={p.name} size={24} />}
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{p.id === '@channel' ? '@channel' : p.name}{p.online && <span className="ms-1.5 inline-block w-1.5 h-1.5 rounded-full bg-success-500 align-middle" />}</span>
                  {p.designation && <span className="block text-[11px] text-ink-muted truncate">{p.designation}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {!editing && (
          <>
            <button type="button" title={t('chatComposerAttachFiles')} aria-label={t('chatComposerAttachFiles')} disabled={!canAttach || files.length >= CHAT_ATTACHMENTS_MAX}
              onClick={() => fileInput.current?.click()} className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink disabled:opacity-40">
              <Paperclip className="w-[18px] h-[18px]" />
            </button>
            <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = '' }} />
            {canAttachStudent && (
              <button type="button" title={t('chatComposerAttachStudent')} aria-label={t('chatComposerAttachStudent')} onClick={() => { setStudentPick(''); setStudentOpen(true) }}
                className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink">
                <GraduationCap className="w-[18px] h-[18px]" />
              </button>
            )}
          </>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={CHAT_MESSAGE_MAX + 100}
          placeholder={editing ? t('chatComposerEditPlaceholder') : isDirect ? t('chatComposerPlaceholder') : t('chatComposerMentionPlaceholder')}
          onChange={(e) => { setText(e.target.value); if (!editing) setDraft(key, e.target.value); readMention(e.target.value, e.target.selectionStart); if (e.target.value) onTyping() }}
          onKeyDown={onKeyDown}
          onClick={(e) => readMention(e.target.value, e.target.selectionStart)}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onPaste={(e) => { if (e.clipboardData?.files?.length && canAttach && !editing) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
          className="flex-1 min-w-0 resize-none rounded-2xl border border-border bg-bg px-3.5 py-2 text-sm text-ink leading-5 max-h-40 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
        />
        <button type="button" onClick={submit} disabled={editing ? !text.trim() && !editing.attachments?.length : !canSend} aria-label={editing ? t('common:actions.save') : t('chatComposerSend')} title={editing ? t('chatComposerSaveEnter') : t('chatComposerSendEnter')}
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-300 disabled:cursor-not-allowed">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
        </button>
      </div>
      {text.length > CHAT_MESSAGE_MAX - 200 && <p className={clsx('text-[11px] mt-1 text-end', text.length > CHAT_MESSAGE_MAX ? 'text-danger-500' : 'text-ink-faint')}>{text.length} / {CHAT_MESSAGE_MAX}</p>}

      <Modal open={studentOpen} onClose={() => setStudentOpen(false)} title={t('chatComposerAttachStudent')} size="md"
        footer={<Button variant="secondary" onClick={() => setStudentOpen(false)}>{t('common:actions.cancel')}</Button>}>
        <p className="text-xs text-ink-muted mb-3">{t('chatComposerStudentHint')}</p>
        <div className="space-y-3">
          <StudentPicker value={studentPick} onChange={(id, s) => {
            setStudentPick(id)
            if (!id || !s) return
            setStudent({ id: s.id, display: s.admissionNo ? t('studentDisplay', { name: s.name, no: s.admissionNo }) : s.name })
            setStudentOpen(false)
            area.current?.focus()
          }} />
        </div>
      </Modal>
    </div>
  )
}
