import clsx from 'clsx'

const COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
}

/**
 * Label-over-value facts in a tidy grid — the "details" block of a drawer or record page.
 * Each fact: small muted label, then the value in ink; empty values show an em dash.
 *
 *   <FactGrid cols={3} items={[
 *     { label: t('…phone'), value: p.phone, icon: Phone },
 *     { label: t('…uhid'), value: p.uhid, mono: true },
 *     { label: t('…address'), value: p.address, span: 'full' },
 *   ]} />
 *
 * A fact with `text: true` is long free text (notes, findings): normal weight, line breaks kept.
 * `twoOnPhone` keeps two columns on phones (for short values like dates and IDs).
 * `boxed` puts each fact in its own soft tile (good for 3–6 headline facts);
 * the default is an airy grid with no chrome (good inside a Panel).
 */
export default function FactGrid({ items = [], cols = 2, boxed = false, twoOnPhone = false, className, children }) {
  const list = items.filter((x) => x && !x.hidden)
  return (
    <dl className={clsx('grid gap-x-6', boxed ? 'gap-y-3' : 'gap-y-4', twoOnPhone ? clsx('grid-cols-2', cols === 3 && 'lg:grid-cols-3', cols >= 4 && 'lg:grid-cols-4') : COLS[cols] ?? COLS[2], className)}>
      {list.map((f, i) => <Fact key={f.key ?? i} {...f} boxed={boxed} />)}
      {children}
    </dl>
  )
}

export function Fact({ label, value, icon: Icon, hint, mono = false, text = false, span, tone, boxed = false, className, children }) {
  const content = children ?? value
  const empty = content == null || content === '' || (Array.isArray(content) && content.length === 0)
  return (
    <div className={clsx('min-w-0', span === 'full' && 'col-span-full', span === 2 && 'sm:col-span-2',
      boxed && 'rounded-lg border border-border bg-bg px-3.5 py-2.5', className)}>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </dt>
      <dd className={clsx('mt-1 text-sm break-words', text ? 'font-normal whitespace-pre-line leading-relaxed' : 'font-medium',
        empty ? 'text-ink-faint' : tone === 'danger' ? 'text-danger-600' : tone === 'success' ? 'text-success-600' : tone === 'warning' ? 'text-amber-600' : 'text-ink',
        mono && 'font-mono-num tabular-nums')}>
        {empty ? '—' : content}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}
