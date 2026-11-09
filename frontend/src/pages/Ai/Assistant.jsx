import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Gauge, MessageSquarePlus, ShieldCheck, Sparkles, Square } from 'lucide-react'
import { AI_MAX_TURNS, AI_TOOLS } from '@schoolgiant/shared'
import { Note, PageContainer, PageHeader, Panel, ProgressBar, Tag } from '../../components/system'
import Button from '../../components/ui/Button'
import AiGate, { useAiStatus } from '../../components/ai/AiGate'
import { AssistantAvatar, ChatMessage, TOOL_ICONS } from '../../components/ai/ChatKit'
import { askAssistant } from '../../api/ai'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'

const NS = 'ai'
const STORE = 'sg-ai-chat'
const SUGGESTIONS = [
  { key: 'attendance', tool: 'attendance_summary' },
  { key: 'dues', tool: 'fee_dues' },
  { key: 'results', tool: 'exam_results' },
  { key: 'leave', tool: 'staff_on_leave' },
  { key: 'events', tool: 'upcoming_events' },
  { key: 'periods', tool: 'timetable_today' },
]
let seq = 0
const newId = () => `m${Date.now().toString(36)}${seq++}`

function loadChat() {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '[]').filter((m) => m && (m.role === 'user' || m.role === 'assistant')) } catch { return [] }
}
function keepChat(messages) {
  try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-AI_MAX_TURNS * 2))) } catch { /* private window */ }
}

/** The turns the server gets: plain text, starting with a question, the last AI_MAX_TURNS exchanges. */
function historyOf(messages) {
  const turns = messages.filter((m) => m.content?.trim()).map((m) => ({ role: m.role, content: m.content.slice(0, 6000) })).slice(-AI_MAX_TURNS * 2)
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

const compact = (n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n ?? 0))

/** This month's AI use, from the usage log. */
function UsagePanel() {
  const { t, i18n } = useTranslation(NS)
  const { number } = useFormat()
  const { data } = useAiStatus()
  const u = data?.usage
  if (!u) return null
  const tokens = u.inputTokens + u.outputTokens
  const monthLabel = new Intl.DateTimeFormat(i18n.language || 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${u.month}-15T00:00:00Z`))
  const features = ['ASSISTANT', 'QUESTION_PAPERS', 'REMARKS']
  const most = Math.max(1, ...features.map((f) => u.byFeature?.[f]?.calls ?? 0))
  return (
    <Panel title={t('ai.usage.title')} subtitle={monthLabel} icon={Gauge} iconTone="violet">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-bg px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t('ai.usage.requests')}</p>
          <p className="font-display text-2xl font-bold text-ink tabular-nums">{number(u.calls)}</p>
        </div>
        <div className="rounded-lg bg-bg px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t('ai.usage.tokens')}</p>
          <p className="font-display text-2xl font-bold text-ink tabular-nums">{compact(tokens)}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {features.map((f) => {
          const n = u.byFeature?.[f]?.calls ?? 0
          return (
            <div key={f}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink">{t(`ai.usage.features.${f}`)}</span>
                <span className="tabular-nums text-ink-muted">{number(n)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-black/5"><div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${(n / most) * 100}%` }} /></div>
            </div>
          )
        })}
      </div>
      {u.cap > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-baseline justify-between text-xs mb-1.5">
            <span className="font-medium text-ink">{t('ai.usage.allowance')}</span>
            <span className="tabular-nums text-ink-muted">{t('ai.usage.ofCap', { used: compact(tokens), cap: compact(u.cap) })}</span>
          </div>
          <ProgressBar showValue={false} value={Math.min(100, (tokens / u.cap) * 100)} tone={u.capReached ? 'danger' : tokens / u.cap > 0.8 ? 'warning' : 'brand'} />
        </div>
      )}
    </Panel>
  )
}

/** What the assistant can look up (and so what the user can ask). */
function ToolsPanel() {
  const { t } = useTranslation(NS)
  return (
    <Panel title={t('ai.assistant.canLookUp')} icon={Sparkles}>
      <ul className="space-y-2.5">
        {AI_TOOLS.map((name) => {
          const Icon = TOOL_ICONS[name]
          return (
            <li key={name} className="flex items-center gap-2.5 text-sm text-ink">
              <span className="h-7 w-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon className="w-3.5 h-3.5" aria-hidden /></span>
              {t(`ai.assistant.tools.${name}.name`)}
            </li>
          )
        })}
      </ul>
      <Note className="mt-4" icon={ShieldCheck}>{t('ai.assistant.privacy')}</Note>
    </Panel>
  )
}

function Chat() {
  const { t } = useTranslation(NS)
  const qc = useQueryClient()
  const userName = getCurrentUser()?.user?.name ?? ''
  const canAsk = hasPermission('ai.assistant.ask')
  const [messages, setMessages] = useState(loadChat)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const stopper = useRef(null)
  const scroller = useRef(null)
  const input = useRef(null)

  useEffect(() => { keepChat(messages.filter((m) => !m.pending)) }, [messages])
  useEffect(() => { if (messages.length) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => () => stopper.current?.abort(), [])

  const patch = (id, fn) => setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)))

  const ask = async (text) => {
    const q = String(text ?? '').trim()
    if (!q || busy) return
    const userMsg = { id: newId(), role: 'user', content: q }
    const reply = { id: newId(), role: 'assistant', content: '', tools: [], pending: true }
    const history = historyOf([...messages, userMsg])
    setMessages((list) => [...list, userMsg, reply])
    setDraft('')
    setBusy(true)
    const ac = new AbortController()
    stopper.current = ac
    try {
      await askAssistant(history, (event, data) => {
        if (event === 'text') patch(reply.id, (m) => ({ ...m, content: m.content + (data?.t ?? '') }))
        else if (event === 'tool') patch(reply.id, (m) => ({ ...m, tools: [...m.tools, data] }))
        else if (event === 'refused') patch(reply.id, (m) => ({ ...m, note: t('ai.assistant.refused') }))
        else if (event === 'truncated') patch(reply.id, (m) => ({ ...m, note: t('ai.assistant.truncated') }))
        else if (event === 'error') patch(reply.id, (m) => ({ ...m, error: data?.message || t('ai.assistant.failed') }))
      }, { signal: ac.signal })
    } catch (err) {
      if (err?.name === 'AbortError') patch(reply.id, (m) => ({ ...m, note: t('ai.assistant.stopped') }))
      else patch(reply.id, (m) => ({ ...m, error: err?.message || t('ai.assistant.failed') }))
    } finally {
      patch(reply.id, (m) => ({ ...m, pending: false }))
      setBusy(false)
      stopper.current = null
      qc.invalidateQueries({ queryKey: ['ai-status'] })
      input.current?.focus()
    }
  }

  const reset = () => { stopper.current?.abort(); setMessages([]); setDraft('') }
  const empty = !messages.length

  return (
    <Panel
      className="h-[calc(100dvh-12.5rem)] min-h-[520px]" bodyClassName="p-0 flex flex-col min-h-0"
      title={t('ai.assistant.chatTitle')} subtitle={t('ai.assistant.chatSubtitle')} icon={Sparkles}
      actions={!empty && <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={reset}>{t('ai.assistant.newChat')}</Button>}
    >
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5">
        {empty ? (
          <div className="min-h-full flex flex-col"><div className="m-auto w-full flex flex-col items-center text-center gap-5 py-6">
            <AssistantAvatar size={56} />
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">{t('ai.assistant.hello', { name: userName.split(' ')[0] || t('ai.assistant.there') })}</h2>
              <p className="text-sm text-ink-muted mt-1 max-w-md">{t('ai.assistant.intro')}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
              {SUGGESTIONS.map((s) => {
                const Icon = TOOL_ICONS[s.tool]
                return (
                  <button key={s.key} type="button" disabled={!canAsk} onClick={() => ask(t(`ai.assistant.suggestions.${s.key}`))}
                    className="group text-start rounded-xl border border-border bg-surface hover:border-brand-300 hover:bg-brand-50/40 px-3.5 py-3 flex items-start gap-3 transition-colors disabled:opacity-60">
                    <span className="h-8 w-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 group-hover:bg-brand-100"><Icon className="w-4 h-4" aria-hidden /></span>
                    <span className="text-sm text-ink leading-snug">{t(`ai.assistant.suggestions.${s.key}`)}</span>
                  </button>
                )
              })}
            </div>
          </div></div>
        ) : (
          <div className="space-y-5 max-w-3xl mx-auto">
            {messages.map((m) => <ChatMessage key={m.id} msg={m} userName={userName} streaming={m.pending} />)}
          </div>
        )}
      </div>
      <div className="border-t border-border p-3 sm:p-4 bg-surface">
        <form className="max-w-3xl mx-auto flex items-end gap-2 rounded-2xl border border-border bg-bg/60 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 px-3 py-2"
          onSubmit={(e) => { e.preventDefault(); ask(draft) }}>
          <textarea
            ref={input}
            rows={1}
            value={draft}
            disabled={!canAsk}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(draft) } }}
            placeholder={canAsk ? t('ai.assistant.placeholder') : t('ai.assistant.cannotAsk')}
            aria-label={t('ai.assistant.placeholder')}
            className="flex-1 resize-none bg-transparent border-0 shadow-none outline-none focus:outline-none focus:ring-0 focus:border-0 focus:shadow-none text-sm text-ink placeholder:text-ink-faint max-h-40 py-1.5"
            style={{ fieldSizing: 'content' }}
          />
          {busy
            ? <Button size="sm" variant="secondary" icon={Square} onClick={() => stopper.current?.abort()} aria-label={t('ai.assistant.stop')}>{t('ai.assistant.stop')}</Button>
            : <Button size="sm" type="submit" icon={ArrowUp} disabled={!draft.trim() || !canAsk} aria-label={t('ai.assistant.send')}>{t('ai.assistant.send')}</Button>}
        </form>
        <p className="max-w-3xl mx-auto mt-1.5 text-[11px] text-ink-faint text-center">{t('ai.assistant.disclaimer')}</p>
      </div>
    </Panel>
  )
}

/** AI › Assistant: ask about the institution's own data; answers stream in, with the lookups it made shown as chips. */
export default function Assistant() {
  const { t } = useTranslation(NS)
  const { data } = useAiStatus()
  return (
    <PageContainer>
      <PageHeader icon={Sparkles} title={t('ai.assistant.title')} subtitle={t('ai.assistant.subtitle')}
        actions={data?.configured ? <Tag tone="info" icon={Sparkles}>{t('ai.common.poweredBy')}</Tag> : null} />
      <AiGate feature="assistant">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
          <Chat />
          <div className="space-y-4">
            <UsagePanel />
            <ToolsPanel />
          </div>
        </div>
      </AiGate>
    </PageContainer>
  )
}
