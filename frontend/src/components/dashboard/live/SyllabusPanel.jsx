import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, ChevronRight } from 'lucide-react'
import { Avatar, ColorChip, Panel, SegmentedControl, TONE } from '../../system'

// The syllabus against the year plan: each class × subject (and section) as a bar — how much is taught, with a tick
// where the plan says it should be by today; red when it is behind. Worst first. A grid view shows every class ×
// subject at once as coloured cells.

/** Done % as a bar, with a tick at the expected %; red when behind the plan, amber when a little short. */
export function SyllabusBar({ row }) {
  const { t } = useTranslation('dashboard')
  const gap = row.expectedPct == null ? 0 : row.expectedPct - row.pct
  const tone = row.behind > 0 || gap > 10 ? 'danger' : gap > 0 ? 'warning' : 'success'
  return (
    <div className="relative h-2 w-full rounded-full bg-black/[0.06]" title={t('dashboard.live.syllabus.barTitle', { done: row.pct, expected: row.expectedPct ?? '—', topics: row.topics })}>
      <div className={clsx('h-full rounded-full', TONE[tone].fill)} style={{ width: `${row.pct}%` }} />
      {row.expectedPct != null && <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink/70" style={{ left: `calc(${row.expectedPct}% - 1px)` }} />}
    </div>
  )
}

const gapTone = (r) => (r.expectedPct == null ? 'neutral' : r.behind > 0 || r.expectedPct - r.pct > 10 ? 'danger' : r.expectedPct - r.pct > 0 ? 'warning' : 'success')

/** Class × subject: each cell the average over the class's sections. */
function HeatGrid({ rows }) {
  const { t } = useTranslation('dashboard')
  const { classes, subjects, cell } = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = `${r.classId}|${r.subject}`
      if (!m.has(k)) m.set(k, { classId: r.classId, className: r.className, order: r.order, subject: r.subject, n: 0, pct: 0, exp: 0, expN: 0, behind: 0, teachers: new Set() })
      const c = m.get(k)
      c.n++; c.pct += r.pct; c.behind += r.behind
      if (r.expectedPct != null) { c.exp += r.expectedPct; c.expN++ }
      if (r.teacher?.name) c.teachers.add(r.teacher.name)
    }
    const cls = [...new Map([...m.values()].map((c) => [c.classId, { id: c.classId, name: c.className, order: c.order }])).values()].sort((a, b) => a.order - b.order)
    const subs = [...new Set([...m.values()].map((c) => c.subject))].sort()
    return { classes: cls, subjects: subs, cell: (cid, sub) => m.get(`${cid}|${sub}`) }
  }, [rows])
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <div className="grid gap-1 text-[10.5px]" style={{ gridTemplateColumns: `88px repeat(${subjects.length}, minmax(42px, 1fr))`, minWidth: 88 + subjects.length * 46 }}>
        <span />
        {subjects.map((s) => <span key={s} className="truncate px-0.5 text-center font-semibold text-ink-muted" title={s}>{s.slice(0, 5)}</span>)}
        {classes.map((c) => (
          <div key={c.id} className="contents">
            <span className="truncate py-1 font-medium text-ink">{c.name}</span>
            {subjects.map((s) => {
              const x = cell(c.id, s)
              if (!x) return <span key={s} className="rounded-md bg-black/[0.03]" />
              const r = { pct: Math.round(x.pct / x.n), expectedPct: x.expN ? Math.round(x.exp / x.expN) : null, behind: x.behind }
              const tone = TONE[gapTone(r)]
              return (
                <span key={s} className={clsx('flex items-center justify-center rounded-md border py-1 font-semibold tabular-nums', tone.bg, tone.text, tone.border)}
                  title={t('dashboard.live.syllabus.cellTitle', { cls: c.name, subject: s, done: r.pct, expected: r.expectedPct ?? '—', teachers: [...x.teachers].join(', ') || '—' })}>
                  {r.pct}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SyllabusPanel({ syllabus }) {
  const { t } = useTranslation('dashboard')
  const [view, setView] = useState('BEHIND')
  const rows = useMemo(() => {
    const gap = (r) => (r.expectedPct ?? r.pct) - r.pct
    return [...syllabus.rows].sort((a, b) => b.behind - a.behind || gap(b) - gap(a) || a.order - b.order)
  }, [syllabus.rows])
  const list = view === 'BEHIND' ? rows.filter((r) => r.behind > 0 || (r.expectedPct != null && r.expectedPct > r.pct)) : rows
  return (
    <Panel title={t('dashboard.live.syllabus.title')} subtitle={t('dashboard.live.syllabus.subtitle', { done: syllabus.avgPct ?? 0, expected: syllabus.avgExpected ?? '—' })} icon={BookOpenCheck} iconTone="brand"
      actions={<Link to="/homework/syllabus" className="flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline">{t('dashboard.live.open')}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden /></Link>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { k: 'behindRows', v: syllabus.behindRows, tone: syllabus.behindRows ? 'danger' : 'success' },
            { k: 'sectionsBehind', v: syllabus.sectionsBehind, tone: syllabus.sectionsBehind ? 'warning' : 'success' },
            { k: 'behindTopics', v: syllabus.behindTopics, tone: syllabus.behindTopics ? 'danger' : 'success' },
          ].map((x) => (
            <div key={x.k} className={clsx('rounded-xl border px-2 py-2', TONE[x.tone].bg, TONE[x.tone].border)}>
              <p className={clsx('font-display text-lg font-bold tabular-nums', TONE[x.tone].text)}>{x.v}</p>
              <p className="text-[10.5px] leading-tight text-ink-muted">{t(`dashboard.live.syllabus.${x.k}`)}</p>
            </div>
          ))}
        </div>
        <SegmentedControl value={view} onChange={setView} options={[
          { value: 'BEHIND', label: t('dashboard.live.syllabus.viewBehind'), count: rows.filter((r) => r.behind > 0 || (r.expectedPct != null && r.expectedPct > r.pct)).length },
          { value: 'ALL', label: t('dashboard.live.syllabus.viewAll'), count: rows.length },
          { value: 'GRID', label: t('dashboard.live.syllabus.viewGrid') },
        ]} />
        {view === 'GRID' ? <HeatGrid rows={rows} /> : list.length ? (
          <ul className="grid max-h-[460px] content-start gap-x-8 gap-y-3 overflow-y-auto pe-1 [scrollbar-width:thin] lg:grid-cols-2">
            {list.map((r) => (
              <li key={`${r.sectionId}:${r.subjectId}`} className="space-y-1.5">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <ColorChip label={r.section} seed={r.classId} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.subject}</span>
                  {r.teacher?.name && <span className="hidden min-w-0 items-center gap-1 truncate text-ink-faint sm:flex"><Avatar name={r.teacher.name} size={16} soft />{r.teacher.name}</span>}
                  <span className={clsx('shrink-0 font-semibold tabular-nums', r.behind ? TONE.danger.text : 'text-ink-muted')}>
                    {r.pct}%<span className="font-normal text-ink-faint">{r.expectedPct != null ? ` / ${r.expectedPct}%` : ''}</span>
                  </span>
                </div>
                <SyllabusBar row={r} />
                {r.behind > 0 && <p className="text-[10.5px] text-rose-600">{t('dashboard.live.syllabus.behindTopics', { count: r.behind })}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="py-6 text-center text-sm text-ink-faint">{t('dashboard.live.syllabus.allOnTrack')}</p>}
        <p className="flex items-center gap-1.5 text-[10.5px] text-ink-faint"><span className="inline-block h-3 w-0.5 rounded bg-ink/70" />{t('dashboard.live.syllabus.legend')}</p>
      </div>
    </Panel>
  )
}
