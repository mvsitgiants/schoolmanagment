import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { TONE } from './tokens'
import Avatar from './Avatar'

/**
 * The one board in the app. Columns of cards, scrolling sideways when there are more
 * columns than fit — the shape every pipeline, queue and stage view had been rebuilding
 * for itself, each slightly differently.
 *
 *   <KanbanBoard
 *     columns={[{ key: 'TODO', label: 'To do', tone: 'neutral', icon: Check, hint: '…' }]}
 *     items={rows}
 *     columnOf={(row) => row.status}
 *     renderCard={(row) => <KanbanCard title={row.name} tag="BILLING" … />}
 *     onCardClick={open}
 *   />
 *
 * `renderCard` returns the body; <KanbanCard> gives it the standard anatomy (title,
 * coloured tag, meta line, avatar) so cards read the same wherever they appear.
 */
export default function KanbanBoard({
  columns = [],
  items = [],
  columnOf,
  renderCard,
  onCardClick,
  loading = false,
  emptyText,
  minColumnWidth = 260,
  maxHeight = '64vh',
  className,
}) {
  const { t } = useTranslation('ui')
  const grouped = {}
  for (const c of columns) grouped[c.key] = []
  for (const row of items) {
    const key = columnOf ? columnOf(row) : row.status
    if (grouped[key]) grouped[key].push(row)
  }

  return (
    <div className={clsx('overflow-x-auto scroll-thin -mx-1 px-1 pb-1', className)}>
      <div
        className="grid grid-flow-col gap-3 min-w-max xl:min-w-0"
        style={{ gridAutoColumns: `minmax(${minColumnWidth}px, 1fr)` }}
      >
        {columns.map((col) => {
          const rows = grouped[col.key] ?? []
          const Icon = col.icon
          const tone = TONE[col.tone] ?? TONE.neutral
          return (
            <section key={col.key} className="rounded-xl bg-bg border border-border flex flex-col">
              <header className="px-3.5 pt-3 pb-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted truncate">
                    {col.label}
                  </h3>
                  {Icon && <Icon className={clsx('w-3.5 h-3.5 shrink-0', tone.text)} />}
                  <span className="ms-auto text-[11px] font-mono-num text-ink-faint shrink-0">{rows.length}</span>
                </div>
                {(col.hint || col.sub) && (
                  <p className="text-[11px] text-ink-faint leading-snug mt-1 truncate" title={col.hint || col.sub}>
                    {col.hint || col.sub}
                  </p>
                )}
              </header>

              <div
                className="flex-1 overflow-y-auto scroll-thin px-2 pb-2 flex flex-col gap-2 min-h-[120px]"
                style={{ maxHeight }}
              >
                {loading ? (
                  <p className="text-[11px] text-ink-faint px-1.5 py-3">{t('ui.common.loading')}</p>
                ) : rows.length === 0 ? (
                  <p className="text-[11px] text-ink-faint px-1.5 py-4 text-center">{col.emptyText || (emptyText ?? t('ui.common.nothingHere'))}</p>
                ) : rows.map((row, i) => {
                  const body = renderCard ? renderCard(row, col) : <KanbanCard title={String(row.name ?? row.id)} />
                  const key = row.id ?? i
                  if (!onCardClick) return <div key={key}>{body}</div>
                  return (
                    <div
                      key={key} role="button" tabIndex={0}
                      onClick={() => onCardClick(row, col)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick(row, col) } }}
                      className="text-start cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      {body}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One card. Deliberately a fixed anatomy rather than free-form children, so a card on the
 * CRM board and a card on the service board are read the same way:
 *
 *   title       what this is
 *   tag         one coloured chip — the category, type or label
 *   meta        the quiet line: a code, a date, an amount
 *   avatar      who owns it, bottom-right
 *   actions     only shown on hover, so the board stays calm
 */
export function KanbanCard({ title, subtitle, tag, tagTone = 'brand', meta, metaIcon: MetaIcon, avatar, amount, actions, tone }) {
  const t = TONE[tagTone] ?? TONE.brand
  return (
    <article
      className={clsx(
        'group/card bg-surface border rounded-lg p-3 shadow-card transition-all',
        ' hover:border-brand-300',
        tone === 'danger' ? 'border-danger-200' : 'border-border',
      )}
    >
      <p className="text-[13px] font-medium text-ink leading-snug line-clamp-2" title={title}>{title}</p>
      {subtitle && <p className="text-[11px] text-ink-muted truncate mt-0.5">{subtitle}</p>}

      {tag && (
        <span className={clsx(
          'inline-flex items-center rounded px-1.5 py-0.5 mt-2 text-[10px] font-semibold uppercase tracking-wide border',
          t.bg, t.text, t.border,
        )}>
          {tag}
        </span>
      )}

      {(meta || amount || avatar) && (
        <div className="flex items-center gap-2 mt-2.5">
          {MetaIcon && meta && <MetaIcon className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
          {meta && <span className="text-[11px] text-ink-muted font-mono-num truncate">{meta}</span>}
          {amount && <span className="text-[11px] font-semibold text-ink font-mono-num ms-auto shrink-0">{amount}</span>}
          {avatar && (
            <span className={clsx('shrink-0', amount ? 'ms-2' : 'ms-auto')}>
              <Avatar name={avatar} size={22} />
            </span>
          )}
        </div>
      )}

      {actions && (
        <div className="hidden group-hover/card:flex focus-within:flex items-center gap-1 mt-2 pt-2 border-t border-border">
          {actions}
        </div>
      )}
    </article>
  )
}

/** Shown in place of the board when there is nothing at all to lay out. */
export function KanbanEmpty({ icon: Icon = Inbox, title, hint }) {
  return (
    <div className="border border-dashed border-border rounded-xl bg-surface py-16 px-6 text-center">
      <Icon className="w-6 h-6 mx-auto mb-2 text-ink-faint" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="text-xs text-ink-muted max-w-md mx-auto mt-1">{hint}</p>}
    </div>
  )
}
