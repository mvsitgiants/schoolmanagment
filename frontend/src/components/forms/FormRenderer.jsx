import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { COMPUTED_TYPES, computeForm, isVisible, scoreBand } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Select, Textarea } from '../system'

const GRID = { 1: 'grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' }
const Chip = ({ on, children, onClick, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className={clsx('text-xs px-2.5 py-1 rounded-full border transition', on ? 'bg-brand-500 text-white border-brand-500' : 'border-border text-ink-muted hover:border-ink-faint', disabled && 'opacity-60 cursor-default')}>
    {children}
  </button>
)

function Field({ f, values, set, readOnly, error }) {
  const { t } = useTranslation('ui')
  const v = values[f.key]
  if (f.type === 'INFO') return <p className="sm:col-span-full flex gap-2 text-xs text-ink-muted bg-bg border border-border rounded-md px-3 py-2"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{f.label}</p>
  const label = `${f.label}${f.unit && ['NUMBER', 'CALC'].includes(f.type) ? ` (${f.unit})` : ''}`
  const wide = ['TEXTAREA', 'MULTI', 'SCORE'].includes(f.type)
  let control
  if (f.type === 'CALC' || f.type === 'TOTAL') {
    const band = f.type === 'TOTAL' ? scoreBand(f, v) : null
    control = <p className="h-9 flex items-center text-sm font-semibold text-ink tabular-nums">{v === '' || v === undefined ? <span className="font-normal text-ink-faint">—</span> : <>{v}{band && <span className="ms-2 text-xs font-medium text-brand-700 bg-brand-50 rounded px-1.5 py-0.5">{band.label}</span>}</>}</p>
  } else if (readOnly) {
    const text = Array.isArray(v) ? v.join(', ') : f.type === 'YESNO' ? (v === 'YES' ? t('common.yes') : v === 'NO' ? t('common.no') : '') : f.type === 'SCORE' ? f.options?.find((o) => String(o.points) === String(v))?.label : v
    control = <p className="text-sm text-ink whitespace-pre-wrap min-h-[1.5rem]">{text || <span className="text-ink-faint">—</span>}</p>
  } else if (f.type === 'TEXTAREA') control = <Textarea rows={2} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />
  else if (f.type === 'NUMBER') control = <Input inputMode="decimal" value={v ?? ''} onChange={(e) => set(f.key, e.target.value.replace(/[^\d.-]/g, ''))} />
  else if (f.type === 'DATE') control = <DateInput value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />
  else if (f.type === 'SELECT') control = <Select value={v ?? ''} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
  else if (f.type === 'MULTI') {
    const arr = [].concat(v ?? [])
    control = <div className="flex flex-wrap gap-1.5 pt-1">{(f.options ?? []).map((o) => <Chip key={o} on={arr.includes(o)} onClick={() => set(f.key, arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}>{o}</Chip>)}</div>
  } else if (f.type === 'YESNO') control = <div className="flex gap-1.5 pt-1">{[['YES', t('common.yes')], ['NO', t('common.no')]].map(([val, l]) => <Chip key={val} on={v === val} onClick={() => set(f.key, v === val ? '' : val)}>{l}</Chip>)}</div>
  else if (f.type === 'SCORE') control = <div className="flex flex-wrap gap-1.5 pt-1">{(f.options ?? []).map((o) => <Chip key={o.label} on={String(v) === String(o.points)} onClick={() => set(f.key, String(v) === String(o.points) ? '' : String(o.points))}>{o.label} · {o.points}</Chip>)}</div>
  else control = <Input value={v ?? ''} maxLength={300} onChange={(e) => set(f.key, e.target.value)} />
  return (
    <div className={clsx(wide && 'sm:col-span-full')}>
      <FormField label={label} required={f.required && !readOnly && !COMPUTED_TYPES.includes(f.type)} error={error} hint={!readOnly ? f.help : undefined}>{control}</FormField>
    </div>
  )
}

/**
 * Fills (or shows) one form from the form builder. Calculated fields and score totals
 * work out as you type; fields with "show only if" appear when their answer is given.
 *
 *   <FormRenderer definition={version.definition} values={values} onChange={setValues} errors={…} />
 */
export default function FormRenderer({ definition, values = {}, onChange, readOnly = false, errors = {} }) {
  const all = computeForm(definition, values)
  const set = (key, v) => onChange?.(computeForm(definition, { ...values, [key]: v }))
  return (
    <div className="space-y-5">
      {(definition?.sections ?? []).map((s, i) => {
        const fields = (s.fields ?? []).filter((f) => isVisible(f, all))
        if (!fields.length) return null
        return (
          <section key={i}>
            {s.title && <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-2">{s.title}</p>}
            <div className={clsx('grid gap-x-4 gap-y-3', GRID[s.columns] ?? GRID[1])}>
              {fields.map((f) => <Field key={f.key} f={f} values={all} set={set} readOnly={readOnly} error={errors[f.key]} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
