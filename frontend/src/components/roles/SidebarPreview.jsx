import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Home } from 'lucide-react'
import { CATEGORY_BY_ID, visiblePages } from '@schoolgiant/shared'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

/** Live preview of the menu users of this role will see (docs/04 §4.3). */
export default function SidebarPreview({ permissions, enabledModules, fullAccess }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const groups = useMemo(
    () => visiblePages(fullAccess ? ['*'] : permissions, enabledModules).filter((g) => g.module.id !== 'dashboard' || g.pages.length),
    [permissions, enabledModules, fullAccess],
  )
  const pageCount = groups.reduce((n, g) => n + g.pages.length, 0)

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="px-3 py-2 bg-bg border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-muted">{t('admin.sidebarPreview.title')}</span>
        <span className="text-[11px] text-ink-faint tabular-nums">{t('admin.sidebarPreview.modules', { count: groups.length })} · {t('admin.sidebarPreview.pages', { count: pageCount })}</span>
      </div>
      <div className="bg-sidebar text-sidebar-fg/80 p-2.5 max-h-[420px] overflow-y-auto scroll-thin">
        <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-fg"><Home className="w-3.5 h-3.5 opacity-60" /> {t('admin.sidebarPreview.home')}</p>
        {groups.length === 0 && <p className="px-2 py-4 text-xs text-sidebar-fg/50">{t('admin.sidebarPreview.empty')}</p>}
        {groups.map(({ module: m, pages }) => {
          const Icon = iconFor(m.icon)
          return (
            <div key={m.id} className="mt-1.5">
              <p className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-sidebar-fg">
                <span className="w-1 h-1 rounded-full" style={{ background: CATEGORY_BY_ID[m.category]?.color }} />
                <Icon className="w-3.5 h-3.5 opacity-60" />{cl.module(m)}
              </p>
              <ul className="ms-[22px] border-s border-sidebar-fg/10">
                {pages.map((p) => <li key={p.id} className="ps-3 py-0.5 text-[11px] text-sidebar-fg/60 truncate">{cl.page(m, p)}</li>)}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
