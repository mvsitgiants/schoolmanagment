import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, CalendarDays, Clock, GraduationCap, IndianRupee, Search, Sparkles, UserX, UsersRound } from 'lucide-react'
import { Avatar } from '../system'

const NS = 'ai'

// The assistant chat's pieces: the message bubbles, a small markdown renderer for the answers, the
// "looked up …" chips for tool calls and the typing dots.

export const TOOL_ICONS = {
  attendance_summary: UsersRound, fee_dues: IndianRupee, exam_results: GraduationCap, student_lookup: Search,
  staff_on_leave: UserX, upcoming_events: CalendarDays, timetable_today: Clock,
}

/** "**bold**" and "`code`" inside a line. */
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="px-1 py-0.5 rounded bg-black/5 text-[12px] font-mono-num">{p.slice(1, -1)}</code>
    return <Fragment key={i}>{p}</Fragment>
  })
}

/** The answer's text: paragraphs, bullet and numbered lists, and simple pipe tables. */
export function RichText({ text }) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n')
  const blocks = []
  for (const line of lines) {
    const last = blocks.at(-1)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    const row = /^\s*\|.*\|\s*$/.test(line)
    if (row) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue // the --- separator
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim())
      if (last?.kind === 'table') last.rows.push(cells)
      else blocks.push({ kind: 'table', rows: [cells] })
    } else if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1])
      else blocks.push({ kind: 'ul', items: [bullet[1]] })
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[2])
      else blocks.push({ kind: 'ol', items: [numbered[2]] })
    } else if (!line.trim()) {
      blocks.push({ kind: 'gap' })
    } else if (last?.kind === 'p') {
      last.lines.push(line)
    } else {
      blocks.push({ kind: 'p', lines: [line] })
    }
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink break-words">
      {blocks.map((b, i) => {
        if (b.kind === 'gap') return null
        if (b.kind === 'p') return <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ''))}</Fragment>)}</p>
        if (b.kind === 'ul') return <ul key={i} className="list-disc ps-5 space-y-1 marker:text-ink-faint">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
        if (b.kind === 'ol') return <ol key={i} className="list-decimal ps-5 space-y-1 marker:text-ink-faint">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
        const [head, ...body] = b.rows
        const cols = Math.max(...b.rows.map((r) => r.length))
        return (
          <div key={i} className="overflow-x-auto rounded-lg border border-border">
            <div role="table" className="grid min-w-max text-[13px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(6rem, auto))` }}>
              {head.map((c, j) => <div role="columnheader" key={`h${j}`} className="px-3 py-1.5 bg-bg font-semibold text-ink-muted border-b border-border">{inline(c)}</div>)}
              {body.map((r, ri) => r.map((c, j) => <div role="cell" key={`${ri}-${j}`} className={clsx('px-3 py-1.5 tabular-nums', ri < body.length - 1 && 'border-b border-border/60')}>{inline(c)}</div>))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** What a tool call looked at, for its chip: "Class 8", "Half-yearly · 8-A", "12 Nov – 30 Nov". */
function scopeOf(args = {}) {
  const bits = [args.exam, args.section, args.class, args.name, args.teacher].filter(Boolean)
  if (args.date) bits.push(args.date)
  if (args.from || args.to) bits.push([args.from, args.to].filter(Boolean).join(' – '))
  return bits.join(' · ')
}

/** "Looked up fee dues for Class 8" — one per tool call. */
export function ToolChip({ call }) {
  const { t } = useTranslation(NS)
  const Icon = TOOL_ICONS[call.name] ?? Search
  const what = scopeOf(call.args)
  const label = what ? t(`ai.assistant.tools.${call.name}.for`, { what }) : t(`ai.assistant.tools.${call.name}.all`)
  const warn = call.denied || call.failed
  return (
    <span className={clsx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium max-w-full',
      warn ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-brand-50/70 border-brand-100 text-brand-700')}>
      {warn ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden /> : <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{call.denied ? t('ai.assistant.toolDenied', { label }) : label}</span>
    </span>
  )
}

/** Three bouncing dots while the answer is on its way. */
export function TypingDots() {
  const { t } = useTranslation(NS)
  return (
    <span className="inline-flex items-center gap-1 py-1" role="status" aria-label={t('ai.assistant.thinking')}>
      {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  )
}

/** The assistant's avatar: a gradient disc with the sparkle. */
export function AssistantAvatar({ size = 32 }) {
  return (
    <span className="rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-white flex items-center justify-center shrink-0 shadow-sm" style={{ width: size, height: size }}>
      <Sparkles className="w-4 h-4" aria-hidden />
    </span>
  )
}

/** One turn: the user's question on the right, the assistant's answer (chips, then text) on the left. */
export function ChatMessage({ msg, userName, streaming }) {
  const { t } = useTranslation(NS)
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-se-md bg-brand-500 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">{msg.content}</div>
        <Avatar name={userName} size={32} soft className="shrink-0 hidden sm:flex" />
      </div>
    )
  }
  const empty = !msg.content && !msg.tools?.length
  return (
    <div className="flex gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 max-w-[92%] sm:max-w-[80%] flex flex-col gap-2">
        {msg.tools?.length > 0 && <div className="flex flex-wrap gap-1.5">{msg.tools.map((c, i) => <ToolChip key={i} call={c} />)}</div>}
        {(msg.content || streaming || empty || msg.error) && (
          <div className={clsx('rounded-2xl rounded-ss-md border px-4 py-3 shadow-sm', msg.error ? 'bg-danger-50 border-danger-500/20' : 'bg-surface border-border')}>
            {msg.content ? <RichText text={msg.content} /> : streaming ? <TypingDots /> : msg.error ? null : <p className="text-sm text-ink-muted">{t('ai.assistant.noAnswer')}</p>}
            {msg.content && streaming && <span className="inline-block w-1.5 h-4 align-middle ms-0.5 bg-brand-400 animate-pulse rounded-sm" aria-hidden />}
            {msg.error && <p className={clsx('text-xs text-danger-700', msg.content && 'mt-1.5')}>{msg.error}</p>}
          </div>
        )}
        {msg.note && <p className="text-xs text-ink-faint">{msg.note}</p>}
      </div>
    </div>
  )
}
