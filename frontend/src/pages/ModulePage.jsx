import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarClock, Check, Lock } from 'lucide-react'
import { CATEGORY_BY_ID, MODULE_BY_ID, pagePath, permKey } from '@schoolgiant/shared'
import { PageContainer, PageHeader, Panel } from '../components/system'
import { hasPermission } from '../api/auth'
import useAuthUser from '../hooks/useAuthUser'
import { useCatalogLabel } from '../hooks/useCatalogLabel'
import { iconFor } from '../catalog/icons'
import NotFound from './NotFound'

// Roadmap phases from the SchoolGiant product plan (labels: catalog.modulePage.phases.<n> in the catalog locale).
const PHASES = {
  0: 'Phase 0 — Platform', 1: 'Phase 1 — MVP (Nov 2026 – Apr 2027)', 2: 'Phase 2 — Growth (May – Oct 2027)',
  3: 'Phase 3 — Full suite (Nov 2027 – Apr 2028)', 4: 'Phase 4 — Scale (May – Oct 2028)',
}

/**
 * Every catalog page that has no screen yet lands here. The route gate has already
 * checked the module is on and the role may view the page, so this shows what the
 * page will do and exactly which of its actions this user's role allows.
 */
export default function ModulePage() {
  useAuthUser()
  const { t } = useTranslation(['catalog', 'common'])
  const cl = useCatalogLabel()
  const { moduleId, pageId } = useParams()
  const mod = MODULE_BY_ID[moduleId]
  const page = mod?.pages.find((p) => p.id === pageId)
  if (!mod || !page) return <NotFound />

  const Icon = iconFor(mod.icon)
  const cat = CATEGORY_BY_ID[mod.category]
  const phase = page.phase ?? mod.phase
  const siblings = mod.pages.filter((p) => p.id !== page.id && p.nav !== false && hasPermission(permKey(mod.id, p.id, 'view')))

  const modName = cl.module(mod)
  const pageName = cl.page(mod.id, page)

  return (
    <PageContainer>
      <PageHeader icon={Icon} title={pageName} subtitle={`${modName} · ${mod.desc}`} />
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <Panel className="lg:col-span-2">
          <div className="flex items-start gap-4">
            <span className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-brand-50 text-brand-600 border border-brand-100"><CalendarClock className="w-6 h-6" /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{PHASES[phase] ? t(`catalog.modulePage.phases.${phase}`, PHASES[phase]) : t('catalog.modulePage.phaseN', 'Phase {{phase}}', { phase })}</p>
              <h2 className="font-display text-xl font-semibold text-ink mt-1">{t('catalog.modulePage.onTheWay', { defaultValue: 'This screen is on the way' })}</h2>
              <p className="text-sm text-ink-muted mt-1.5 max-w-xl">{t('catalog.modulePage.accessReady', { name: modName, defaultValue: `Your access is already set up: when ${modName} arrives, this page opens for your role with exactly the actions below — nobody needs to change roles again.` })}</p>
            </div>
          </div>
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('catalog.modulePage.roleCapabilities', { defaultValue: 'What your role can do on this page' })}</p>
            <ul className="grid sm:grid-cols-2 gap-2">
              {page.actions.map((a) => {
                const allowed = hasPermission(permKey(mod.id, page.id, a.id))
                return (
                  <li key={a.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${allowed ? 'border-success-500/25 bg-success-50/50 text-ink' : 'border-border text-ink-faint'}`}>
                    {allowed ? <Check className="w-4 h-4 text-success-500" /> : <Lock className="w-3.5 h-3.5" />}
                    <span className="flex-1">{cl.action(a)}</span>
                    {a.sensitive && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-label={t('catalog.modulePage.sensitive', 'Sensitive')} />}
                  </li>
                )
              })}
            </ul>
          </div>
        </Panel>
        {siblings.length > 0 && (
          <Panel title={t('catalog.modulePage.moreInModule', { name: modName, defaultValue: `More in ${modName}` })}>
            <ul className="space-y-1">
              {siblings.map((p) => <li key={p.id}><Link to={pagePath(mod.id, p.id)} className="block px-2 py-1.5 -mx-2 rounded-md text-sm text-ink hover:bg-bg hover:text-brand-600">{cl.page(mod.id, p)}</Link></li>)}
            </ul>
          </Panel>
        )}
      </div>
    </PageContainer>
  )
}
