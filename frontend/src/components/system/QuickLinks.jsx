import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * The "Jump to" strip at the bottom of every module overview — one tile per screen in
 * the module.
 *
 *   <QuickLinks links={[{ path: '/sales/invoices', name: 'Invoices', icon: Receipt }]} />
 *
 * Every module had its own copy of this markup, identical except for the grid column
 * count it happened to be written with — so the tiles came out a different size on each
 * overview. The grid auto-fills here instead, which means one module's strip looks like
 * the next whatever number of links it has.
 *
 * Links that carry a `desc` get the wider row layout instead — same styling, but there is
 * room for the sentence. That is decided from the data rather than by the caller, so the
 * two presentations cannot drift apart again.
 */
export default function QuickLinks({ links = [], title: titleProp, className }) {
  const { t } = useTranslation('ui')
  const title = titleProp ?? t('ui.quickLinks.jumpTo')
  const navigate = useNavigate()
  if (links.length === 0) return null
  const described = links.some((l) => l.desc)

  if (described) {
    return (
      <div className={className}>
        {title && (
          <p className="text-xs font-semibold text-ink-muted mb-2 uppercase tracking-wide">{title}</p>
        )}
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(248px,1fr))]">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <button
                key={link.path}
                type="button"
                onClick={() => navigate(link.path)}
                className={clsx(
                  'group flex items-start gap-3 text-start bg-surface border border-border',
                  'rounded-lg p-4 shadow-card hover:border-brand-300 transition-all',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                )}
              >
                <span className="w-9 h-9 rounded-md bg-bg flex items-center justify-center shrink-0 group-hover:bg-brand-50 transition-colors">
                  {Icon && <Icon className="w-4 h-4 text-ink-muted group-hover:text-brand-600" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{link.name}</span>
                  <span className="block text-xs text-ink-muted mt-0.5">{link.desc}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand-500 shrink-0 mt-1 transition-colors rtl:rotate-180" />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {title && (
        <p className="text-xs font-semibold text-ink-muted mb-2 uppercase tracking-wide">{title}</p>
      )}
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(104px,1fr))]">
        {links.map((link) => {
          const Icon = link.icon
          return (
            <button
              key={link.path}
              type="button"
              onClick={() => navigate(link.path)}
              className={clsx(
                'group flex flex-col items-center gap-1.5 text-center bg-surface border border-border',
                'rounded-lg p-3 shadow-card hover:border-brand-300 transition-all',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
              )}
            >
              <span className="w-8 h-8 rounded-md bg-bg flex items-center justify-center group-hover:bg-brand-50 transition-colors">
                {Icon && <Icon className="w-4 h-4 text-ink-muted group-hover:text-brand-600" />}
              </span>
              <p className="text-[11px] font-medium text-ink leading-tight">{link.name}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
