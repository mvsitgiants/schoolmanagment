import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { FileText, Play, Save } from 'lucide-react'
import { REPORT_GROUPS } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SearchInput } from '../../components/system'
import Button from '../../components/ui/Button'
import { ParamsForm, ResultTable, defaultParams } from '../../components/reports/ReportParts'
import { createSavedReport, fetchReportLibrary, runReport } from '../../api/reports'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function SaveModal({ report, params, columns, onClose }) {
  const { t } = useTranslation('reports')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [name, setName] = useState(t(`reports.list.${report.id}.label`, report.label))
  const save = useMutation({
    mutationFn: () => createSavedReport({ name, reportId: report.id, params, columns }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-reports'] }); showSuccess(t('reports.saved')); onClose() },
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('reports.saveTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>{t('reports.save')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('reports.name')} required><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <Note>{t('reports.saveHint')}</Note>
      </div>
    </Modal>
  )
}

/** Report library: pick a report, set its inputs, run, export — or save it for the builder. */
export default function Library() {
  const { t } = useTranslation('reports')
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [params, setParamsUrl] = useSearchParams()
  const { data: library = [], isLoading, error } = useQuery({ queryKey: ['report-library'], queryFn: fetchReportLibrary })
  const [reportId, setReportId] = useState(params.get('report') ?? '')
  const report = library.find((r) => r.id === reportId)
  const [values, setValues] = useState({})
  const [columns, setColumns] = useState([])
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!reportId && library.length) setReportId(library[0].id) }, [library, reportId])
  useEffect(() => { if (report) { setValues(defaultParams(report)); setColumns(report.columns.map((c) => c.key)); setResult(null); setErrors({}); setParamsUrl({ report: report.id }, { replace: true }) } }, [report?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: () => runReport(report.id, values, columns.length === report.columns.length ? undefined : columns),
    onSuccess: (r) => { setResult(r); setErrors({}) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const q = search.trim().toLowerCase()
  const name = (r) => t(`reports.list.${r.id}.label`, r.label)
  const groups = useMemo(() => REPORT_GROUPS.map((g) => ({ ...g, reports: library.filter((r) => r.group === g.id && (!q || name(r).toLowerCase().includes(q) || r.desc.toLowerCase().includes(q))) })).filter((g) => g.reports.length), [library, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const canRun = hasPermission('reports.library.run')

  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('reports.title')} subtitle={t('reports.subtitle')} />
      {error && <Note tone="warning">{error.message}</Note>}
      {!isLoading && !library.length && <Note>{t('reports.noneAvailable')}</Note>}
      <div className="grid lg:grid-cols-[18rem_1fr] gap-4 items-start">
        <Panel flush>
          <div className="p-3 border-b border-border"><SearchInput value={search} onChange={setSearch} placeholder={t('reports.search')} /></div>
          <nav className="max-h-[70vh] overflow-y-auto py-2">
            {groups.map((g) => (
              <div key={g.id} className="mb-2">
                <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t(`reports.groups.${g.id}`, g.label)}</p>
                {g.reports.map((r) => (
                  <button key={r.id} type="button" onClick={() => setReportId(r.id)}
                    className={clsx('w-full text-start px-4 py-2 text-sm', r.id === reportId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink hover:bg-bg')}>
                    {name(r)}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </Panel>
        {report && (
          <div className="space-y-4 min-w-0">
            <Panel title={name(report)} subtitle={t(`reports.list.${report.id}.desc`, report.desc)}
              actions={<>
                {hasPermission('reports.builder.create') && <Button size="sm" variant="secondary" icon={Save} onClick={() => setSaving(true)}>{t('reports.saveAs')}</Button>}
                <Button size="sm" icon={Play} loading={run.isPending} disabled={!canRun || !columns.length} onClick={() => run.mutate()}>{t('reports.run')}</Button>
              </>}>
              <ParamsForm report={report} value={values} onChange={setValues} errors={errors} />
              <details className="mt-4">
                <summary className="text-xs font-medium text-ink-muted cursor-pointer">{t('reports.columnsPick', { shown: columns.length, total: report.columns.length })}</summary>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2">
                  {report.columns.map((c) => (
                    <label key={c.key} className="inline-flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={columns.includes(c.key)} onChange={() => setColumns((x) => (x.includes(c.key) ? x.filter((k) => k !== c.key) : report.columns.map((y) => y.key).filter((k) => x.includes(k) || k === c.key)))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                      {t(`reports.columns.${report.id}.${c.key}`, c.label)}
                    </label>
                  ))}
                </div>
              </details>
              {!canRun && <Note tone="warning" className="mt-3">{t('reports.cantRun')}</Note>}
            </Panel>
            {result && result.report.id === report.id && <>
              <p className="text-xs text-ink-muted">{t('reports.ranAt', { at: dateTime(result.generatedAt), count: result.rows.length })}{result.paramsLabel ? ` · ${result.paramsLabel}` : ''}</p>
              <ResultTable result={result} />
            </>}
          </div>
        )}
      </div>
      {saving && report && <SaveModal report={report} params={values} columns={columns.length === report.columns.length ? [] : columns} onClose={() => setSaving(false)} />}
    </PageContainer>
  )
}
