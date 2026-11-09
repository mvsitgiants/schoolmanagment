import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Block, Chip, ThinBar, sectionName } from './liveKit'

// The syllabus against the year plan, calmly: one grey line of totals, then the subjects most behind — a thin bar for
// what is taught with a tick where the plan says it should be by today; the gap in amber only when more than one
// topic behind. "See all" opens every row, or a class × subject grid on a single grey→amber scale.

const gap = (r) => (r.expectedPct ?? r.pct) - r.pct
const behindOrder = (a, b) => b.behind - a.behind || gap(b) - gap(a) || a.order - b.order || a.section.localeCompare(b.section)

function Row({ r }) {
  const { t } = useTranslation('dashboard')
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="min-w-0 truncate text-[12.5px] text-ink">
        {sectionName(r.className, r.section)} · {r.subject}
        {r.teacher?.name && <span className="ms-1.5 text-ink-faint">{t('dashboard.live.syllabus.taughtBy', { name: r.teacher.name })}</span>}
      </span>
      <span className={clsx('text-[11.5px]', r.behind > 1 ? 'font-medium text-amber-600' : 'text-ink-muted')}>
        {r.expectedPct != null ? t('dashboard.live.syllabus.doneShould', { done: r.pct, expected: r.expectedPct }) : t('dashboard.live.syllabus.done', { done: r.pct })}
      </span>
      {r.behind > 1 && <span className="col-span-2 -mt-0.5 text-[11px] text-amber-600">{t('dashboard.live.syllabus.behindTopics', { count: r.behind })}</span>}
      <ThinBar className="col-span-2" value={r.pct} tick={r.expectedPct} title={t('dashboard.live.syllabus.barTitle', { done: r.pct, expected: r.expectedPct ?? '–', topics: r.topics })} />
    </li>
  )
}

/** Class × subject, each cell the class average; shade by how far short of the plan (none → grey, far → amber). */
function Grid({ rows }) {
  const { t } = useTranslation('dashboard')
  const { classes, subjects, cell } = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = `${r.classId}|${r.subject}`
      if (!m.has(k)) m.set(k, { classId: r.classId, className: r.className, order: r.order, n: 0, pct: 0, exp: 0, expN: 0 })
      const c = m.get(k)
      c.n++; c.pct += r.pct
      if (r.expectedPct != null) { c.exp += r.expectedPct; c.expN++ }
    }
    const cls = [...new Map([...m.values()].map((c) => [c.classId, { id: c.classId, name: c.className, order: c.order }])).values()].sort((a, b) => a.order - b.order)
    return { classes: cls, subjects: [...new Set(rows.map((r) => r.subject))].sort(), cell: (cid, sub) => m.get(`${cid}|${sub}`) }
  }, [rows])
  const shade = (short) => (short <= 0 ? 'bg-black/[0.04] text-ink-muted' : short <= 5 ? 'bg-amber-50 text-ink' : short <= 15 ? 'bg-amber-100 text-ink' : 'bg-amber-200 text-ink')
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <div className="grid gap-px text-[10.5px]" style={{ gridTemplateColumns: `84px repeat(${subjects.length}, minmax(40px, 1fr))`, minWidth: 84 + subjects.length * 42 }}>
        <span />
        {subjects.map((s) => <span key={s} className="truncate px-0.5 pb-1 text-center text-ink-faint" title={s}>{s.slice(0, 4)}</span>)}
        {classes.map((c) => (
          <div key={c.id} className="contents">
            <span className="truncate py-1 text-ink-muted">{c.name}</span>
            {subjects.map((s) => {
              const x = cell(c.id, s)
              if (!x) return <span key={s} />
              const pct = Math.round(x.pct / x.n)
              const exp = x.expN ? Math.round(x.exp / x.expN) : null
              return (
                <span key={s} className={clsx('flex items-center justify-center rounded-sm py-1 tabular-nums', shade(exp == null ? 0 : exp - pct))}
                  title={t('dashboard.live.syllabus.cellTitle', { cls: c.name, subject: s, done: pct, expected: exp ?? '–' })}>{pct}</span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SyllabusPanel({ syllabus, className }) {
  const { t } = useTranslation('dashboard')
  const [view, setView] = useState('TOP')
  const rows = useMemo(() => [...syllabus.rows].sort(behindOrder), [syllabus.rows])
  const top = rows.filter((r) => r.behind > 0 || gap(r) > 0).slice(0, 8)
  return (
    <Block title={t('dashboard.live.syllabus.title')} className={className}
      actions={<Link to="/homework/syllabus" className="text-xs font-medium text-brand-600 hover:underline">{t('dashboard.live.syllabus.link')}</Link>}>
      <div className="space-y-3 px-4 py-3">
        <p className="text-[12px] text-ink-muted">
          {t('dashboard.live.syllabus.totals', { count: syllabus.behindRows, sections: syllabus.sectionsBehind, done: syllabus.avgPct ?? 0, expected: syllabus.avgExpected ?? 0 })}
        </p>
        {view !== 'TOP' && (
          <div className="flex gap-1.5">
            <Chip active={view === 'LIST'} onClick={() => setView('LIST')}>{t('dashboard.live.syllabus.list')}</Chip>
            <Chip active={view === 'GRID'} onClick={() => setView('GRID')}>{t('dashboard.live.syllabus.grid')}</Chip>
          </div>
        )}
        {view === 'GRID' ? <><p className="text-[11.5px] text-ink-faint">{t('dashboard.live.syllabus.gridLegend')}</p><Grid rows={rows} /></> : (view === 'TOP' ? top : rows).length ? (
          <ul className={clsx('space-y-2.5', view === 'LIST' && 'max-h-[420px] overflow-y-auto pe-1 [scrollbar-width:thin]')}>
            {(view === 'TOP' ? top : rows).map((r) => <Row key={`${r.sectionId}:${r.subjectId}`} r={r} />)}
          </ul>
        ) : <p className="text-sm text-ink-muted">{t('dashboard.live.syllabus.allOnTrack')}</p>}
      </div>
      <button type="button" onClick={() => setView(view === 'TOP' ? 'LIST' : 'TOP')} className="w-full border-t border-border px-4 py-2 text-start text-xs font-medium text-ink-muted hover:text-ink">
        {view === 'TOP' ? t('dashboard.live.syllabus.seeAll', { count: rows.length }) : t('dashboard.live.syllabus.seeTop')}
      </button>
    </Block>
  )
}
