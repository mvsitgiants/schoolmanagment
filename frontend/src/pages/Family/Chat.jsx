import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronLeft, MessagesSquare, Send, UserRound } from 'lucide-react'
import { CHAT_MAX } from '@schoolgiant/shared'
import { Note, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyChatSend, familyChatTeachers, familyChatThread, familyChats } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** One conversation with a teacher: the messages, and a box to write. */
function Thread({ teacher, conversationId, onBack }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const [text, setText] = useState('')
  const end = useRef(null)
  const { data: c, isLoading, error } = useFamilyQuery(['chat', conversationId ?? 'new'], () => familyChatThread(slug, studentId, conversationId), { enabled: !!conversationId, refetchInterval: 20_000 })
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [c?.messages?.length])
  const send = useMutation({
    mutationFn: () => familyChatSend(slug, studentId, { staffUserId: teacher.id, text }),
    onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'chat', d.id], d); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'chats'] }); setText(''); if (!conversationId) onBack(d.id) },
  })
  const messages = c?.messages ?? []
  return (
    <>
      <FCard>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => onBack(null)} aria-label={t('family.chat.back')} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink truncate">{teacher.name}</p>
            <p className="text-xs text-ink-muted truncate">{teacher.role}</p>
          </div>
        </div>
      </FCard>
      {isLoading && conversationId ? <FSkeleton className="h-48" /> : error ? <FError error={error} /> : (
        <div className="space-y-2">
          {!messages.length && <p className="text-center text-sm text-ink-muted py-4">{t('family.chat.firstHint', { name: teacher.name })}</p>}
          {messages.map((m) => (
            <div key={m.id} className={clsx('flex', m.from === 'FAMILY' ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px]', m.from === 'FAMILY' ? 'bg-brand-500 text-white' : 'bg-surface border border-border text-ink')}>
                {m.hidden ? <p className="italic text-sm opacity-80">{t('family.chat.removed')}</p> : <p className="whitespace-pre-line break-words">{m.text}</p>}
                <p className={clsx('mt-1 text-[11px]', m.from === 'FAMILY' ? 'text-white/70' : 'text-ink-faint')}>{dateTime(m.at)}</p>
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      {c?.closed ? <Note>{t('family.chat.closed')}</Note> : (
        <FCard>
          <Textarea rows={3} value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('family.chat.placeholder')} />
          {send.error && <p className="mt-2 text-sm text-danger-700">{send.error.message}</p>}
          <Button className="w-full mt-3" icon={Send} loading={send.isPending} disabled={!text.trim()} onClick={() => send.mutate()}>{t('family.chat.send')}</Button>
          <p className="mt-2 text-xs text-ink-muted">{t('family.chat.etiquette')}</p>
        </FCard>
      )}
    </>
  )
}

/** Messages with the child's teachers: the conversations, and the teachers you can write to. */
export default function FamilyChat() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { dateTime } = useFormat()
  const [open, setOpen] = useState(null) // { teacher, conversationId }
  const { data: convos = [], isLoading, error } = useFamilyQuery(['chats'], () => familyChats(slug, studentId), { refetchInterval: 30_000 })
  const { data: teachers = [] } = useFamilyQuery(['chat-teachers'], () => familyChatTeachers(slug, studentId))
  useEffect(() => { setOpen(null) }, [studentId])
  if (open) return <Thread teacher={open.teacher} conversationId={open.conversationId} onBack={(id) => setOpen(id ? { ...open, conversationId: id } : null)} />
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const withConvo = new Set(convos.map((c) => c.staffUserId))
  const teacherOf = (c) => teachers.find((x) => x.id === c.staffUserId) ?? { id: c.staffUserId, name: c.staffName, role: c.subjectName }
  return (
    <>
      <FCard title={t('family.chat.conversations')}>
        {convos.length ? (
          <div className="divide-y divide-border -my-2">
            {convos.map((c) => (
              <FRow key={c.id} icon={MessagesSquare} onClick={() => setOpen({ teacher: teacherOf(c), conversationId: c.id })}
                title={c.staffName} subtitle={`${c.lastFrom === 'FAMILY' ? `${t('family.chat.you')}: ` : ''}${c.lastText ?? ''}`} meta={c.lastAt ? dateTime(c.lastAt) : undefined}
                right={c.unread > 0 ? <span className="rounded-full bg-brand-500 text-white text-xs px-2 py-0.5">{c.unread}</span> : null} />
            ))}
          </div>
        ) : <FEmpty icon={MessagesSquare} title={t('family.chat.none')} hint={t('family.chat.noneHint')} />}
      </FCard>
      <FCard title={t('family.chat.writeTo')}>
        {teachers.length ? (
          <div className="divide-y divide-border -my-2">
            {teachers.filter((x) => !withConvo.has(x.id)).map((x) => <FRow key={x.id} icon={UserRound} onClick={() => setOpen({ teacher: x, conversationId: null })} title={x.name} subtitle={x.role || undefined} />)}
            {teachers.every((x) => withConvo.has(x.id)) && <p className="py-3 text-sm text-ink-muted">{t('family.chat.allStarted')}</p>}
          </div>
        ) : <p className="text-sm text-ink-muted">{t('family.chat.noTeachers')}</p>}
      </FCard>
    </>
  )
}
