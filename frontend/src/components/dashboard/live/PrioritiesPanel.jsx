import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { Block, usePlain } from './liveKit'

// What needs the principal first, most urgent at the top. Each row is a plain sentence — what is wrong and what to
// do about it — with a small tag for how urgent (red "Act now", amber "Today", grey "When you can"), the details in
// grey, and a link to the screen where it is done.

const TAG = { high: 'bg-rose-50 text-rose-700', medium: 'bg-amber-50 text-amber-700', low: 'bg-black/[0.05] text-ink-muted' }

function detail(p, t) {
  const list = (xs) => (xs?.length ? xs.join(', ') : '')
  switch (p.key) {
    case 'uncovered': return t('dashboard.live.priorities.detail.uncovered', { list: list(p.sections) })
    case 'unmarked': return t('dashboard.live.priorities.detail.unmarked', { list: list(p.sections) })
    case 'teachersAway': case 'notIn': case 'absentStreak': return list(p.names)
    case 'syllabus': return t('dashboard.live.priorities.detail.syllabus', { count: p.topics })
    case 'approvals': return (p.parts ?? []).map((x) => t(`dashboard.live.priorities.parts.${x.key}`, { count: x.count })).join(' · ')
    default: return t(`dashboard.live.priorities.detail.${p.key}`, { defaultValue: '' })
  }
}

export default function PrioritiesPanel({ priorities, markBefore, className }) {
  const { t } = useTranslation('dashboard')
  const { clock, money } = usePlain()
  return (
    <Block title={t('dashboard.live.priorities.title')} sub={t('dashboard.live.priorities.subtitle')} className={className}>
      {priorities.length ? (
        <ol className="divide-y divide-border">
          {priorities.map((p) => {
            const more = detail(p, t)
            return (
              <li key={p.key}>
                <Link to={p.link} className="group flex min-w-0 items-center gap-3 px-4 py-2.5 hover:bg-bg">
                  <span className={clsx('w-[92px] shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-medium', TAG[p.severity] ?? TAG.low)}>{t(`dashboard.live.priorities.level.${p.severity}`)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug text-ink">{t(`dashboard.live.priorities.say.${p.key}`, { count: p.count, time: clock(p.by ?? markBefore), amount: money(p.amount ?? 0) })}</span>
                    {more && <span className="block truncate text-[11.5px] text-ink-faint">{more}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint group-hover:text-brand-600 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ol>
      ) : <p className="px-4 py-6 text-sm text-ink-muted">{t('dashboard.live.priorities.clear')}</p>}
    </Block>
  )
}
