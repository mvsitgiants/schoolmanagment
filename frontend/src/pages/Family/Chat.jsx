import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronLeft, MessagesSquare, PenLine, Send } from 'lucide-react'
import { CHAT_MAX } from '@schoolgiant/shared'
import { Avatar, Note } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyChatSend, familyChatTeachers, familyChatThread, familyChats } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** "07:09 pm" for today, the date for anything older — short enough for a list row on a phone. */
function useWhen() {
  const { date, time } = useFormat()
  return (at) => {
    if (!at) return ''
    const day = date(new Date(at)) // in the school's timezone
    return day === date(new Date()) ? time(at) : day
  }
}

/** One conversation with a teacher: a header, the messages, and a box to write (kept at the bottom of the screen). */
function Thread({ teacher, conversationId, onBack, onStarted }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const [text, setText] = useState('')
  const end = useRef(null)
  const { data: c, isLoading, error } = useFamilyQuery(['chat', conversationId ?? 'new'], () => familyChatThread(slug, studentId, conversationId), { enabled: !!conversationId, refetchInterval: 20_000 })
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [c?.messages?.length, conversationId])
  const send = useMutation({
    mutationFn: () => familyChatSend(slug, studentId, { staffUserId: teacher.id, text }),
    onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'chat', d.id], d); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'chats'] }); setText(''); if (!conversationId) onStarted(d.id) },
  })
  const messages = c?.messages ?? []
  const canSend = text.trim() && !send.isPending
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-surface md:h-[calc(100dvh-240px)] md:min-h-[420px]" aria-label={teacher.name}>
      <header className="flex items-center gap-2 border-b border-border px-2 py-2 md:px-4">
        <button type="button" onClick={onBack} aria-label={t('family.chat.back')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-black/[0.04] md:hidden">
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden />
        </button>
        <Avatar name={teacher.name} size={40} soft />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{teacher.name}</p>
          {teacher.role && <p className="truncate text-xs text-ink-muted">{teacher.role}</p>}
        </div>
      </header>

      <div className="flex-1 space-y-2 px-3 py-4 md:overflow-y-auto md:px-4">
        {isLoading && conversationId ? <FSkeleton className="h-48" /> : error ? <FError error={error} /> : (
          <>
            {!messages.length && (
              <div className="py-6 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><PenLine className="h-6 w-6" aria-hidden /></span>
                <p className="mt-3 text-sm text-ink-muted">{t('family.chat.firstHint', { name: teacher.name })}</p>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.from === 'FAMILY'
              return (
                <div key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={clsx('max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px]', mine ? 'rounded-ee-md bg-brand-500 text-white' : 'rounded-es-md border border-border bg-black/[0.03] text-ink')}>
                    {m.hidden ? <p className="text-sm italic opacity-80">{t('family.chat.removed')}</p> : <p className="whitespace-pre-line break-words">{m.text}</p>}
                    <p className={clsx('mt-1 text-[11px]', mine ? 'text-white/75' : 'text-ink-faint')}>{dateTime(m.at)}</p>
                  </div>
                </div>
              )
            })}
            <div ref={end} />
          </>
        )}
      </div>

      {c?.closed ? <div className="p-3"><Note>{t('family.chat.closed')}</Note></div> : (
        // on a phone the box sticks just above the bottom bar, so it stays in reach while reading a long thread
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] rounded-b-2xl border-t border-border bg-surface px-3 pb-3 pt-2 md:static md:px-4">
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="family-chat-text">{t('family.chat.placeholder')}</label>
            <textarea id="family-chat-text" rows={2} value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('family.chat.placeholder')}
              className="max-h-40 min-h-[48px] flex-1 resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
            <button type="button" disabled={!canSend} onClick={() => send.mutate()} aria-label={t('family.chat.send')}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-black/10 disabled:text-ink-faint">
              <Send className={clsx('h-5 w-5 rtl:-scale-x-100', send.isPending && 'animate-pulse')} aria-hidden />
            </button>
          </div>
          {send.error && <p className="mt-2 text-sm text-danger-700">{send.error.message}</p>}
          <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{t('family.chat.etiquette')}</p>
        </div>
      )}
    </section>
  )
}

/** A conversation or a teacher in the inbox: avatar, name, last line, unread count. */
function InboxRow({ active, onClick, name, line, when, unread, bold }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
      className={clsx('flex w-full min-h-[64px] items-center gap-3 rounded-xl px-2 py-2.5 text-start transition-colors', active ? 'bg-brand-50' : 'hover:bg-black/[0.03] active:bg-black/[0.05]')}>
      <Avatar name={name} size={44} soft />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx('truncate text-[15px] text-ink', bold ? 'font-semibold' : 'font-medium')}>{name}</span>
          {when && <span className={clsx('shrink-0 text-[11px] md:hidden', unread ? 'font-semibold text-brand-700' : 'text-ink-faint')}>{when}</span>}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={clsx('line-clamp-2 text-sm', bold ? 'text-ink' : 'text-ink-muted')}>{line}</span>
          {unread > 0 && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">{unread}</span>}
        </span>
        {when && <span className={clsx('mt-0.5 hidden text-[11px] md:block', unread ? 'font-semibold text-brand-700' : 'text-ink-faint')}>{when}</span>}
      </span>
    </button>
  )
}

/**
 * Messages with the child's teachers. Phones: the inbox, then a conversation full width (Back returns).
 * Wider screens: the inbox on the left, the open conversation on the right.
 */
export default function FamilyChat() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const when = useWhen()
  const [open, setOpen] = useState(null) // { teacher, conversationId }
  const { data: convos = [], isLoading, error } = useFamilyQuery(['chats'], () => familyChats(slug, studentId), { refetchInterval: 30_000 })
  const { data: teachers = [] } = useFamilyQuery(['chat-teachers'], () => familyChatTeachers(slug, studentId))
  useEffect(() => { setOpen(null) }, [studentId])
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const withConvo = new Set(convos.map((c) => c.staffUserId))
  const teacherOf = (c) => teachers.find((x) => x.id === c.staffUserId) ?? { id: c.staffUserId, name: c.staffName, role: c.subjectName }
  const others = teachers.filter((x) => !withConvo.has(x.id))
  const isOpen = (teacherId) => open?.teacher.id === teacherId

  return (
    <div className="flex min-w-0 gap-4">
      <div className={clsx('min-w-0 flex-1 space-y-4 md:w-72 md:flex-none md:shrink-0', open && 'hidden md:block')}>
        <FCard title={t('family.chat.conversations')} className="md:[&>div:last-child]:p-2">
          {convos.length ? (
            <div className="-mx-2 -my-2 space-y-0.5 md:mx-0 md:my-0">
              {convos.map((c) => (
                <InboxRow key={c.id} active={isOpen(c.staffUserId)} onClick={() => setOpen({ teacher: teacherOf(c), conversationId: c.id })}
                  name={c.staffName} when={when(c.lastAt)} unread={c.unread} bold={c.unread > 0}
                  line={`${c.lastFrom === 'FAMILY' ? `${t('family.chat.you')}: ` : ''}${c.lastText ?? ''}`} />
              ))}
            </div>
          ) : <FEmpty icon={MessagesSquare} title={t('family.chat.none')} hint={t('family.chat.noneHint')} />}
        </FCard>
        <FCard title={t('family.chat.writeTo')} className="md:[&>div:last-child]:p-2">
          {teachers.length ? (
            others.length ? (
              <div className="-mx-2 -my-2 space-y-0.5 md:mx-0 md:my-0">
                {others.map((x) => <InboxRow key={x.id} active={isOpen(x.id)} onClick={() => setOpen({ teacher: x, conversationId: null })} name={x.name} line={x.role || ''} />)}
              </div>
            ) : <p className="text-sm text-ink-muted">{t('family.chat.allStarted')}</p>
          ) : <p className="text-sm text-ink-muted">{t('family.chat.noTeachers')}</p>}
        </FCard>
      </div>

      {open ? (
        <Thread key={`${open.teacher.id}-${open.conversationId ?? 'new'}`} teacher={open.teacher} conversationId={open.conversationId}
          onBack={() => setOpen(null)} onStarted={(id) => setOpen((o) => ({ ...o, conversationId: id }))} />
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-border md:flex md:h-[calc(100dvh-240px)] md:min-h-[420px]">
          <FEmpty icon={MessagesSquare} title={t('family.chat.pickTitle')} hint={t('family.chat.pickHint')} />
        </div>
      )}
    </div>
  )
}
