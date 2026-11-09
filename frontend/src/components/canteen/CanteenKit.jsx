import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Ban, Coffee, Cookie, Soup, Sparkles } from 'lucide-react'
import { CANTEEN_CATEGORY_BY, CANTEEN_MARK_BY, CANTEEN_ORDER_STATUS, CANTEEN_TXN_TYPES, formatINR, hasSpendLimit } from '@schoolgiant/shared'
import { StatusPill, TONE } from '../system'

// Building blocks shared by the canteen screens (menu, counter, wallets) and the family app's canteen page.

export const CATEGORY_ICON = { SNACK: Cookie, MEAL: Soup, BEVERAGE: Coffee }
export const categoryTone = (c) => CANTEEN_CATEGORY_BY[c]?.tone ?? 'neutral'

/** Labels in the canteen namespace for the shared codes. */
export function useCanteenLabels() {
  const { t } = useTranslation('canteen')
  return {
    category: (v) => t(`canteen.categories.${v}`, v),
    mark: (v) => t(`canteen.marks.${v}`, v),
    tag: (v) => t(`canteen.tags.${v}`, v),
    day: (v) => t(`canteen.days.${v}`, v),
    txn: (v) => t(`canteen.txn.${v}`, v),
    status: (v) => t(`canteen.orderStatus.${v}`, v),
    pay: (v) => t(`canteen.payModes.${v}`, v),
    mode: (v) => t(`canteen.modes.${v}`, v),
    topup: (v) => t(`canteen.topupStatus.${v}`, v),
  }
}

/** The square-with-a-dot mark printed on Indian food packets: green veg, red non-veg, amber egg. */
export function FoodMark({ mark, size = 14, className }) {
  const { t } = useTranslation('canteen')
  const tone = TONE[CANTEEN_MARK_BY[mark]?.tone ?? 'neutral']
  return (
    <span role="img" aria-label={t(`canteen.marks.${mark}`, mark)} title={t(`canteen.marks.${mark}`, mark)}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-[3px] border-2 bg-surface', tone.border, className)} style={{ width: size, height: size }}>
      <span className={clsx('rounded-full', tone.dot)} style={{ width: size * 0.45, height: size * 0.45 }} />
    </span>
  )
}

export function OrderPill({ status }) {
  const L = useCanteenLabels()
  return <StatusPill tone={CANTEEN_ORDER_STATUS[status]?.tone}>{L.status(status)}</StatusPill>
}

export function TxnPill({ type }) {
  const L = useCanteenLabels()
  return <StatusPill tone={CANTEEN_TXN_TYPES[type]?.tone} dot={false}>{L.txn(type)}</StatusPill>
}

/**
 * A menu tile: coloured by category, the food mark, the price, a SPECIAL ribbon, greyed when sold out or ruled out.
 * `onClick` makes it a button (the counter adds it to the cart).
 */
export function ItemTile({ item, onClick, qty = 0, blocked, footer, compact = false }) {
  const { t } = useTranslation('canteen')
  const L = useCanteenLabels()
  const tone = TONE[categoryTone(item.category)]
  const Icon = CATEGORY_ICON[item.category] ?? Cookie
  const off = item.soldOut || !!blocked || item.active === false
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick && !off ? onClick : undefined} disabled={onClick ? off : undefined}
      className={clsx('relative flex flex-col rounded-xl border bg-surface text-start transition-all min-w-0',
        off ? 'opacity-55' : onClick && 'hover:shadow-card hover:-translate-y-px active:translate-y-0',
        qty > 0 ? 'border-brand-400 ring-2 ring-brand-200' : 'border-border', compact ? 'p-2.5' : 'p-3')}>
      <span className={clsx('absolute inset-x-0 top-0 h-1 rounded-t-xl', tone.fill)} />
      <span className="flex items-start gap-2">
        <span className={clsx('flex shrink-0 items-center justify-center rounded-lg', tone.bg, tone.text, compact ? 'h-8 w-8' : 'h-10 w-10')}><Icon className={compact ? 'w-4 h-4' : 'w-5 h-5'} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5"><FoodMark mark={item.mark} size={12} /><span className="text-sm font-semibold text-ink line-clamp-2 leading-snug">{item.name}</span></span>
          <span className="mt-0.5 block text-[11px] text-ink-faint">{L.category(item.category)}</span>
        </span>
        {qty > 0 && <span className="absolute -top-2 -end-2 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-brand-500 px-1.5 text-xs font-bold text-white shadow">{qty}</span>}
      </span>
      <span className="mt-2 flex items-end justify-between gap-2">
        <span className="font-mono-num text-base font-bold text-ink">{formatINR(item.price)}
          {item.special && item.menuPrice != null && item.menuPrice !== item.price && <span className="ms-1.5 text-xs font-normal text-ink-faint line-through">{formatINR(item.menuPrice)}</span>}
        </span>
        {item.special && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"><Sparkles className="w-3 h-3" />{t('canteen.menu.special')}</span>}
      </span>
      {(item.tags ?? []).length > 0 && !compact && (
        <span className="mt-1.5 flex flex-wrap gap-1">{item.tags.map((x) => <span key={x} className="rounded-md bg-black/[0.05] px-1.5 py-px text-[10px] font-medium text-ink-muted">{L.tag(x)}</span>)}</span>
      )}
      {(item.soldOut || blocked) && (
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-danger-600"><Ban className="w-3 h-3" />{item.soldOut ? t('canteen.menu.soldOut') : t('canteen.counter.blockedByFamily')}</span>
      )}
      {footer}
    </Tag>
  )
}

/** Spend today against the family's daily limit: a bar, amber near it, red at it. */
export function SpendBar({ spent = 0, limit, className }) {
  const { t } = useTranslation('canteen')
  if (!hasSpendLimit(limit)) return <p className={clsx('text-xs text-ink-muted', className)}>{t('canteen.wallet.noLimitSpent', { spent: formatINR(spent) })}</p>
  const pct = Math.min(100, (spent / limit) * 100)
  return (
    <div className={className}>
      <div className="flex justify-between text-xs text-ink-muted"><span>{t('canteen.wallet.spentToday', { spent: formatINR(spent) })}</span><span>{t('canteen.wallet.limit', { limit: formatINR(limit) })}</span></div>
      <div className="mt-1 h-2 rounded-full bg-black/[0.06] overflow-hidden"><div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-danger-500' : pct >= 80 ? 'bg-amber-400' : 'bg-success-500')} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/** The big balance figure, red when low. */
export function Balance({ value, low, size = 'lg' }) {
  return <span className={clsx('font-mono-num font-bold tabular-nums', size === 'lg' ? 'text-3xl' : 'text-xl', low ? 'text-danger-600' : 'text-ink')}>{formatINR(value ?? 0)}</span>
}
