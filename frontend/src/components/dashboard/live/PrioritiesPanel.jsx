import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  AlertOctagon, BookOpenCheck, CalendarX2, CheckCircle2, ChevronRight, ClipboardList, HeartPulse, IndianRupee, Library, MessageSquareWarning, Moon, UserX, Users,
} from 'lucide-react'
import { formatINRCompact } from '@schoolgiant/shared'
import { Panel, TONE } from '../../system'

// What needs the principal first, ranked: red (act now), amber (today), blue (keep an eye on) — each with how many,
// a line saying what it is, and a button to the screen that fixes it.

const ICON = {
  uncovered: UserX, unmarked: CalendarX2, teachersAway: Users, notIn: Users, syllabus: BookOpenCheck, approvals: ClipboardList,
  absentStreak: AlertOctagon, feesOverdue: IndianRupee, libraryOverdue: Library, complaints: MessageSquareWarning, incidents: HeartPulse, hostelLate: Moon,
}
const SEVERITY = { high: 'danger', medium: 'warning', low: 'info' }

function detail(p, t) {
  const list = (xs) => xs?.length ? xs.join(', ') : ''
  switch (p.key) {
    case 'uncovered': return t('dashboard.live.priorities.detail.uncovered', { list: list(p.sections) })
    case 'unmarked': return t('dashboard.live.priorities.detail.unmarked', { time: p.by, list: list(p.sections) })
    case 'teachersAway': case 'notIn': case 'absentStreak': return list(p.names)
    case 'syllabus': return t('dashboard.live.priorities.detail.syllabus', { count: p.topics })
    case 'approvals': return (p.parts ?? []).map((x) => t(`dashboard.live.priorities.parts.${x.key}`, { count: x.count })).join(' · ')
    case 'feesOverdue': return t('dashboard.live.priorities.detail.feesOverdue', { amount: formatINRCompact(p.amount ?? 0) })
    default: return t(`dashboard.live.priorities.detail.${p.key}`)
  }
}

export default function PrioritiesPanel({ priorities, className }) {
  const { t } = useTranslation('dashboard')
  return (
    <Panel title={t('dashboard.live.priorities.title')} subtitle={t('dashboard.live.priorities.subtitle')} icon={AlertOctagon} iconTone="danger" className={className} flush>
      {priorities.length ? (
        <ol className="divide-y divide-border">
          {priorities.map((p, i) => {
            const tone = TONE[SEVERITY[p.severity] ?? 'info']
            const Icon = ICON[p.key] ?? AlertOctagon
            return (
              <li key={p.key} className="relative flex min-w-0 items-center gap-3 px-4 py-3">
                <span className={clsx('absolute inset-y-2 start-0 w-1 rounded-e-full', tone.fill)} aria-hidden />
                <span className="w-4 shrink-0 text-[11px] font-semibold text-ink-faint tabular-nums">{i + 1}</span>
                <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', tone.bg, tone.text, tone.border)}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{t(`dashboard.live.priorities.title_${p.key}`, { count: p.count })}</p>
                  <p className="line-clamp-2 text-[11.5px] text-ink-muted">{detail(p, t)}</p>
                </div>
                <span className={clsx('shrink-0 font-display text-xl font-bold tabular-nums', tone.text)}>{p.count}</span>
                <Link to={p.link} aria-label={t('dashboard.live.priorities.go')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-700">
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
          <p className="text-sm font-semibold text-ink">{t('dashboard.live.priorities.clear')}</p>
          <p className="text-xs text-ink-faint">{t('dashboard.live.priorities.clearHint')}</p>
        </div>
      )}
    </Panel>
  )
}
