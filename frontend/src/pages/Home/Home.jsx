import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BellRing, ChevronRight } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { PageContainer } from '../../components/system'
import { fetchCommandCentre } from '../../api/dashboard'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { navFor } from '../../catalog/nav'
import { iconFor } from '../../catalog/icons'

const greetingKey = () => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'home.goodMorning'
  if (h >= 12 && h < 17) return 'home.goodAfternoon'
  return 'home.goodEvening'
}

/** For people with the command centre: today in one line — attendance, fees, what's waiting. */
function TodayStrip() {
  const { t } = useTranslation('dashboard')
  const { data: d } = useQuery({ queryKey: ['command-centre'], queryFn: fetchCommandCentre, staleTime: 60_000 })
  if (!d) return null
  const bits = [
    d.attendance && t('dashboard.today.attendance', { pct: d.attendance.pct ?? '—', marked: d.attendance.marked, total: d.attendance.sections }),
    d.fees && t('dashboard.today.fees', { amount: formatINR(d.fees.today, { decimals: 0 }) }),
    d.students && t('dashboard.today.students', { count: d.students.active }),
  ].filter(Boolean)
  const waiting = d.pending.reduce((n, p) => n + p.count, 0)
  if (!bits.length && !waiting) return null
  return (
    <Link to="/dashboard/command" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 hover:bg-brand-100/70">
      <span className="font-semibold">{t('dashboard.today.title')}</span>
      {bits.map((b) => <span key={b}>{b}</span>)}
      {waiting > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><BellRing size={14} /> {t('dashboard.today.waiting', { count: waiting })}</span>}
      <ChevronRight size={16} className="ms-auto" />
    </Link>
  )
}

/**
 * Home for every signed-in user: a greeting and one tile per module they can open,
 * grouped like the menu. Role dashboards (principal, teacher, accountant) replace the
 * tiles as their modules are built.
 */
export default function Home() {
  const { t } = useTranslation(['dashboard', 'common'])
  const cl = useCatalogLabel()
  const me = useAuthUser()
  const nav = useMemo(() => navFor(me), [me])
  const firstName = (me?.user?.name || '').split(' ')[0]
  const greeting = t(`common:${greetingKey()}`)
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <PageContainer className="pb-12">
      <div className="min-w-0">
        <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink tracking-tight">
          {firstName ? t('dashboard:homeHero.greetingName', { greeting, name: firstName }) : greeting}
        </h1>
        <p className="mt-0.5 text-[13px] sm:text-sm text-ink-muted flex flex-wrap items-center gap-x-2">
          {me?.tenant?.name && <span className="font-medium text-ink truncate">{me.tenant.name}</span>}
          {me?.tenant?.name && <span aria-hidden="true" className="text-ink-faint">·</span>}
          <span>{today}</span>
        </p>
      </div>

      {hasPermission('dashboard.command.view') && <TodayStrip />}

      {nav.map((cat) => (
        <section key={cat.id} className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{cl.category(cat)}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cat.modules.map((m) => {
              const Icon = iconFor(m.icon)
              return (
                <Link key={m.id} to={m.pages[0].path}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card hover:border-brand-200 hover:bg-bg transition-colors">
                  <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}1a`, color: cat.color }}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink truncate">{cl.module(m)}</span>
                    <span className="block text-xs text-ink-muted truncate">{m.pages.slice(0, 3).map((p) => cl.page(m.id, p)).join(' · ')}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-ink-muted" />
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </PageContainer>
  )
}
