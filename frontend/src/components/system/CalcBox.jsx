import clsx from 'clsx'

/**
 * Shows the arithmetic behind a number instead of just the number: a list of
 * inputs, then the formula worked through to the answer. Use it wherever a
 * figure is derived (OEE, costing, a tax split, a payroll line) so a user who
 * disagrees with it can see where it came from.
 *
 *   <CalcBox
 *     lines={[['Run time', '6.2 h'], ['Planned time', '8.0 h']]}
 *     total={['Availability', '77.5%']}
 *     formula={<>Availability = run ÷ planned = 6.2 ÷ 8.0 = <b>77.5%</b></>}
 *   />
 */
export default function CalcBox({ lines = [], total, formula, footnote, className }) {
  return (
    <div className={clsx('rounded-lg border border-border bg-bg px-3.5 py-3 font-mono-num', className)}>
      {lines.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-0.5 text-xs">
          <span className="font-sans text-ink-muted">{label}</span>
          <span className="text-ink">{value}</span>
        </div>
      ))}
      {total && (
        <div className="flex justify-between gap-3 mt-1.5 pt-1.5 border-t border-border text-sm font-semibold">
          <span className="font-sans text-ink">{total[0]}</span>
          <span className="text-ink">{total[1]}</span>
        </div>
      )}
      {formula && (
        <div className="mt-2 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {formula}
        </div>
      )}
      {footnote && <p className="font-sans text-[11px] text-ink-faint mt-2">{footnote}</p>}
    </div>
  )
}
