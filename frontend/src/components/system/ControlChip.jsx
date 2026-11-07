import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

/**
 * A rounded "view control" chip — icon + `Label: Value` — used in a row above a
 * list to set grouping, sorting, filters and toggles (à la Linear / Height).
 *
 * Two looks:
 *   • active  → soft brand fill  (the control is changing the view from default)
 *   • neutral → white, outlined  (at default, or a plain action)
 *
 * Two modes:
 *   • menu   — pass `onClick`; you own the popover / cycle
 *   • select — pass `options` + `value` + `onChange`; a native <select> overlays
 *              the chip so the browser draws the menu (no extra deps)
 *
 *   <ControlChip icon={Layers} label="Group" value="Status" active
 *     options={['None','Status','Assignee']} onChange={setGroup} />
 *   <ControlChip icon={ArrowUpDown} label="Sort" onClick={openSort} />
 */
export default function ControlChip({
  icon: Icon, label, value, active = false, onClick,
  options, onChange, disabled = false, caret = true, className,
}) {
  const isSelect = Array.isArray(options)
  const norm = isSelect ? options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)) : []

  const base = clsx(
    'relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium',
    'transition-colors select-none whitespace-nowrap',
    active
      ? 'bg-brand-50 text-brand-700 hover:bg-brand-100/70'
      : 'bg-surface text-ink-muted border border-border hover:bg-bg hover:text-ink',
    disabled && 'opacity-50 pointer-events-none',
    className,
  )

  const inner = (
    <>
      {Icon && <Icon size={14} className={active ? 'text-brand-600' : 'text-ink-faint'} />}
      <span>
        {label}{value != null && value !== '' && <>: <span className="font-semibold">{value}</span></>}
      </span>
      {caret && <ChevronDown size={13} className={clsx('shrink-0', active ? 'text-brand-500' : 'text-ink-faint')} />}
    </>
  )

  if (isSelect) {
    return (
      <span className={base}>
        {inner}
        <select
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          aria-label={label}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
        >
          {norm.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </span>
    )
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={base}>
      {inner}
    </button>
  )
}

/** The row that holds ControlChips. Wraps on narrow screens, never scrolls the page. */
export function ViewControls({ children, className }) {
  return <div className={clsx('flex items-center gap-2 flex-wrap min-w-0', className)}>{children}</div>
}
