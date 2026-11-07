import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RANGE_PRESETS, formatINR } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Select } from '../system'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchExams } from '../../api/exams'
import { getCurrentUser } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

/** The default inputs of a report: each param's default (date ranges stay as presets). */
export const defaultParams = (report) => Object.fromEntries((report?.params ?? []).filter((p) => p.default !== undefined).map((p) => [p.key, p.default]))

/** A report's inputs. Date ranges offer presets (This month …) or two dates; a saved report keeps the preset. */
export function ParamsForm({ report, value, onChange, errors = {} }) {
  const { t } = useTranslation('reports')
  const enabled = new Set(getCurrentUser()?.enabledModules ?? [])
  const needs = (type) => report.params.some((p) => p.type === type)
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup, enabled: needs('section') })
  const { data: exams } = useQuery({ queryKey: ['exams', ''], queryFn: () => fetchExams(), enabled: needs('exam') && enabled.has('exams') })
  const set = (k, v) => onChange({ ...value, [k]: v })
  const label = (p) => t(`reports.params.${report.id}.${p.key}`, p.label)
  if (!report.params.length) return <p className="text-sm text-ink-faint">{t('reports.noInputs')}</p>
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {report.params.map((p) => {
        const v = value[p.key]
        if (p.type === 'dateRange') {
          const custom = typeof v === 'object' && v !== null
          return (
            <div key={p.key} className={custom ? 'sm:col-span-2 lg:col-span-3 grid sm:grid-cols-3 gap-4' : ''}>
              <FormField label={label(p)} required={p.required} error={errors[p.key]}>
                <Select value={custom ? 'custom' : v ?? ''} onChange={(e) => set(p.key, e.target.value === 'custom' ? { from: '', to: '' } : e.target.value)}>
                  {RANGE_PRESETS.map((r) => <option key={r} value={r}>{t(`reports.ranges.${r}`)}</option>)}
                  <option value="custom">{t('reports.ranges.custom')}</option>
                </Select>
              </FormField>
              {custom && <>
                <FormField label={t('reports.from')}><Input type="date" value={v.from} max={v.to || undefined} onChange={(e) => set(p.key, { ...v, from: e.target.value })} /></FormField>
                <FormField label={t('reports.to')}><Input type="date" value={v.to} min={v.from || undefined} onChange={(e) => set(p.key, { ...v, to: e.target.value })} /></FormField>
              </>}
            </div>
          )
        }
        if (p.type === 'date') {
          return (
            <FormField key={p.key} label={label(p)} required={p.required} error={errors[p.key]} hint={v === 'today' ? t('reports.alwaysToday') : undefined}>
              <Input type="date" value={v === 'today' ? '' : v ?? ''} onChange={(e) => set(p.key, e.target.value || 'today')} />
            </FormField>
          )
        }
        if (p.type === 'number') {
          return <FormField key={p.key} label={label(p)} required={p.required} error={errors[p.key]}><Input type="number" min={p.min} max={p.max} value={v ?? ''} onChange={(e) => set(p.key, e.target.value)} /></FormField>
        }
        if (p.options === 'months') {
          return (
            <FormField key={p.key} label={label(p)} required={p.required} error={errors[p.key]}>
              <Select value={String(v ?? 'thisMonth')} onChange={(e) => set(p.key, e.target.value)}>
                <option value="thisMonth">{t('reports.thisMonth')}</option>
                {MONTHS.map((m) => <option key={m} value={String(m)}>{t(`reports.months.${m}`)}</option>)}
              </Select>
            </FormField>
          )
        }
        if (p.type === 'section') {
          return (
            <FormField key={p.key} label={label(p)} required={p.required} error={errors[p.key]}>
              <Select value={v ?? ''} onChange={(e) => set(p.key, e.target.value || undefined)}>
                <option value="">{p.required ? t('reports.pick') : t('reports.allClasses')}</option>
                {(lookup?.sections ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </FormField>
          )
        }
        if (p.type === 'exam') {
          return (
            <FormField key={p.key} label={label(p)} required={p.required} error={errors[p.key]}>
              <Select value={v ?? ''} onChange={(e) => set(p.key, e.target.value || undefined)}>
                <option value="">{t('reports.pick')}</option>
                {(exams?.exams ?? []).filter((e) => e.status !== 'DRAFT').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </FormField>
          )
        }
        return null
      })}
    </div>
  )
}

/** A run's rows with its columns formatted by kind, totals underneath, CSV export. */
export function ResultTable({ result, exportName }) {
  const { t } = useTranslation('reports')
  const { date } = useFormat()
  const fmt = (c, v) => {
    if (v === null || v === undefined || v === '') return <span className="text-ink-faint">—</span>
    if (c.type === 'money') return formatINR(Number(v))
    if (c.type === 'pct') return `${v}%`
    if (c.type === 'date') return date(v)
    return v
  }
  const id = result.report.id
  const columns = result.columns.map((c) => ({
    key: c.key, header: t(`reports.columns.${id}.${c.key}`, c.label), align: ['number', 'money', 'pct'].includes(c.type) ? 'right' : undefined,
    nowrap: c.type === 'date', sortable: true, render: (v) => fmt(c, v),
  }))
  return (
    <DataTable
      rows={result.rows.map((r, i) => ({ ...r, __i: i }))}
      rowKey="__i"
      columns={columns}
      dense
      exportable exportName={exportName ?? id}
      maxHeight="65vh"
      totals={result.totals ? Object.fromEntries(Object.entries(result.totals).map(([k, v]) => [k, fmt(result.columns.find((c) => c.key === k), v)])) : undefined}
      totalsLabel={t('reports.total')}
      emptyTitle={t('reports.noRows')}
    />
  )
}
