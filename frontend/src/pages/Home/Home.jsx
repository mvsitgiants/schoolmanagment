import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { PageContainer } from '../../components/system'
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
