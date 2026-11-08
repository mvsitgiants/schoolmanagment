import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { EyeOff, Lock, LockOpen, MessagesSquare, Plus, Send } from 'lucide-react'
import { CHAT_MAX } from '@schoolgiant/shared'
import { ControlChip, Modal, Note, PageContainer, PageHeader, Panel, SearchInput, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchConversation, fetchConversations, moderateConversation, replyConversation, startConversation } from '../../api/communication'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function StartModal({ onClose, onStarted }) {
  const { t } = useTranslation('communication')
  const { showError } = useSnackbar()
  const [studentId, setStudentId] = useState('')
  const [text, setText] = useState('')
  const go = useMutation({ mutationFn: () => startConversation(studentId, text), onSuccess: onStarted, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('communication.chat.startTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={Send} loading={go.isPending} disabled={!studentId || !text.trim()} onClick={() => go.mutate()}>{t('communication.chat.send')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4"><StudentPicker value={studentId} onChange={(id) => setStudentId(id)} /></div>
        <Textarea rows={4} value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('communication.chat.placeholder')} />
        <Note>{t('communication.chat.startHint')}</Note>
      </div>
    </Modal>
  )
}

function Thread({ id }) {
  const { t } = useTranslation('communication')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const [text, setText] = useState('')
  const end = useRef(null)
  const { data: c, isLoading } = useQuery({ queryKey: ['conversation', id], queryFn: () => fetchConversation(id), refetchInterval: 20_000 })
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [c?.messages?.length])
  const after = (d) => { qc.setQueryData(['conversation', id], d); qc.invalidateQueries({ queryKey: ['conversations'] }) }
  const reply = useMutation({ mutationFn: () => replyConversation(id, text), onSuccess: (d) => { after(d); setText('') }, onError: (e) => showError(e.message) })
  const mod = useMutation({ mutationFn: (body) => moderateConversation(id, body), onSuccess: after, onError: (e) => showError(e.message) })
  if (isLoading || !c) return <p className="text-sm text-ink-faint p-5">{t('communication.loading')}</p>
  return (
    <div className="flex flex-col h-[70vh]">
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{t('communication.chat.familyOf', { name: c.studentName })}</p>
          <p className="text-xs text-ink-muted truncate">{[c.admissionNo, c.subjectName, !c.mine ? c.staffName : null, c.familyMobile].filter(Boolean).join(' · ')}</p>
        </div>
        {c.canModerate && <Button size="sm" variant="ghost" icon={c.closed ? LockOpen : Lock} onClick={() => mod.mutate({ close: !c.closed })}>{c.closed ? t('communication.chat.reopen') : t('communication.chat.close')}</Button>}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-bg">
        {c.messages.map((m) => (
          <div key={m.id} className={clsx('flex', m.from === 'STAFF' ? 'justify-end' : 'justify-start')}>
            <div className={clsx('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm', m.from === 'STAFF' ? 'bg-brand-500 text-white' : 'bg-surface border border-border text-ink', m.hidden && 'opacity-60')}>
              {m.hidden && <p className="text-xs italic mb-0.5">{t('communication.chat.hidden')}</p>}
              {m.text !== null && <p className="whitespace-pre-line break-words">{m.text}</p>}
              <p className={clsx('mt-1 text-[11px] flex items-center gap-2', m.from === 'STAFF' ? 'text-white/70' : 'text-ink-faint')}>
                {m.byName} · {dateTime(m.at)}
                {c.canModerate && !m.hidden && <button type="button" title={t('communication.chat.hide')} aria-label={t('communication.chat.hide')} className="hover:underline"
                  onClick={async () => { if (await confirm({ title: t('communication.chat.hideConfirm'), message: t('communication.chat.hideHint'), tone: 'danger', confirmLabel: t('communication.chat.hide') })) mod.mutate({ messageId: m.id }) }}><EyeOff size={12} /></button>}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {c.mine && !c.closed && hasPermission('communication.chat.create') ? (
        <div className="border-t border-border p-3 flex gap-2 items-end">
          <Textarea rows={2} className="flex-1" value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('communication.chat.placeholder')}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) reply.mutate() }} />
          <Button icon={Send} loading={reply.isPending} disabled={!text.trim()} onClick={() => reply.mutate()} aria-label={t('communication.chat.send')} />
        </div>
      ) : <p className="border-t border-border p-3 text-xs text-ink-muted">{c.closed ? t('communication.chat.closedNote') : t('communication.chat.readOnly')}</p>}
    </div>
  )
}

/** Parent–teacher chat: the teacher's inbox (and, for moderators, everyone's). */
export default function Chat() {
  const { t } = useTranslation('communication')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const openId = params.get('c')
  const [all, setAll] = useState(false)
  const [search, setSearch] = useState('')
  const [starting, setStarting] = useState(false)
  const q = useDebouncedValue(search.trim(), 250)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['conversations', all, q], queryFn: () => fetchConversations({ all: all ? '1' : undefined, search: q || undefined }), refetchInterval: 30_000 })
  const canModerate = hasPermission('communication.chat.moderate')

  return (
    <PageContainer>
      <PageHeader icon={MessagesSquare} title={t('communication.chat.title')} subtitle={t('communication.chat.subtitle')}
        actions={hasPermission('communication.chat.create') && <Button icon={Plus} onClick={() => setStarting(true)}>{t('communication.chat.start')}</Button>} />
      <div className="grid lg:grid-cols-[22rem_1fr] gap-4 items-start">
        <Panel flush>
          <div className="p-3 border-b border-border space-y-2">
            <SearchInput value={search} onChange={setSearch} placeholder={t('communication.chat.search')} />
            {canModerate && <ControlChip label={t('communication.chat.showing')} value={all ? t('communication.chat.everyone') : t('communication.chat.mine')} active={all} options={[t('communication.chat.mine'), t('communication.chat.everyone')]} onChange={(v) => setAll(v === t('communication.chat.everyone'))} />}
          </div>
          <div className="max-h-[64vh] overflow-y-auto divide-y divide-border">
            {isLoading && <p className="p-4 text-sm text-ink-faint">{t('communication.loading')}</p>}
            {!isLoading && !rows.length && <p className="p-4 text-sm text-ink-faint">{t('communication.chat.empty')}</p>}
            {rows.map((c) => (
              <button key={c.id} type="button" onClick={() => setParams({ c: c.id })} className={clsx('w-full text-start px-4 py-3 hover:bg-bg', openId === c.id && 'bg-brand-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink truncate">{c.studentName}</span>
                  {c.mine && c.unreadStaff > 0 && <span className="rounded-full bg-brand-500 text-white text-[11px] px-1.5 min-w-[1.25rem] text-center">{c.unreadStaff}</span>}
                </div>
                <p className="text-xs text-ink-faint truncate">{[c.section, !c.mine ? c.staffName : c.subjectName].filter(Boolean).join(' · ')}</p>
                <p className="text-sm text-ink-muted truncate">{c.lastFrom === 'STAFF' ? `${t('communication.chat.you')}: ` : ''}{c.lastText}</p>
                {c.lastAt && <p className="text-[11px] text-ink-faint">{dateTime(c.lastAt)}</p>}
              </button>
            ))}
          </div>
        </Panel>
        <Panel flush>
          {openId ? <Thread id={openId} /> : <p className="p-8 text-center text-sm text-ink-faint">{t('communication.chat.pick')}</p>}
        </Panel>
      </div>
      {starting && <StartModal onClose={() => setStarting(false)} onStarted={(d) => { qc.invalidateQueries({ queryKey: ['conversations'] }); setStarting(false); setParams({ c: d.id }); showSuccess(t('communication.chat.started')) }} />}
    </PageContainer>
  )
}
