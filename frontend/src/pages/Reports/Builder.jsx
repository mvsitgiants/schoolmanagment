import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ChevronLeft, Pencil, Play, Plus, Trash2, Users, Wrench } from 'lucide-react'
import { REPORT_FREQUENCIES } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Select, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { ParamsForm, ResultTable, defaultParams } from '../../components/reports/ReportParts'
import { createSavedReport, deleteSavedReport, fetchReportLibrary, fetchSavedReports, runSavedReport, updateSavedReport } from '../../api/reports'
import { fetchRoles, fetchUsers } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const HOURS = Array.from({ length: 24 }, (_, h) => h)

function Editor({ saved, library, onClose, onSaved }) {
  const { t } = useTranslation('reports')
  const { showError } = useSnackbar()
  const canShare = hasPermission('reports.builder.share')
  const canSchedule = hasPermission('reports.builder.schedule')
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: canShare })
  const { data: users } = useQuery({ queryKey: ['users', 'report-recipients'], queryFn: () => fetchUsers({ pageSize: 100, status: 'ACTIVE' }), enabled: canSchedule })
  const [form, setForm] = useState(() => ({
    name: saved?.name ?? '', reportId: saved?.reportId ?? library[0]?.id ?? '', params: saved?.params ?? defaultParams(library[0]), columns: saved?.columns ?? [],
    sharedRoleIds: saved?.sharedRoleIds ?? [],
    schedule: { active: false, frequency: 'WEEKLY', hour: 7, userIds: [], emails: [], ...(saved?.schedule ?? {}) },
  }))
  const [emailText, setEmailText] = useState((saved?.schedule?.emails ?? []).join(', '))
  const [errors, setErrors] = useState({})
  const report = library.find((r) => r.id === form.reportId)
  const setSched = (k, v) => setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }))
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const body = () => ({ ...form, schedule: { ...form.schedule, hour: Number(form.schedule.hour), emails: emailText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) } })
  const save = useMutation({
    mutationFn: () => (saved ? updateSavedReport(saved.id, body()) : createSavedReport(body())),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const userRows = users?.data ?? []
  return (
    <Modal open onClose={onClose} size="xl" title={saved ? t('reports.builder.editTitle') : t('reports.builder.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !report} onClick={() => save.mutate()}>{t('reports.save')}</Button>
    </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('reports.name')} required error={errors.name}><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('reports.builder.namePlaceholder')} /></FormField>
          <FormField label={t('reports.builder.report')} required>
            <Select value={form.reportId} onChange={(e) => { const r = library.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, reportId: e.target.value, params: defaultParams(r), columns: [] })) }}>
              {library.map((r) => <option key={r.id} value={r.id}>{t(`reports.list.${r.id}.label`, r.label)}</option>)}
            </Select>
          </FormField>
        </div>
        {report && <>
          <ParamsForm report={report} value={form.params} onChange={(params) => setForm((f) => ({ ...f, params }))} errors={errors} />
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('reports.builder.columns')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {report.columns.map((c) => {
                const on = !form.columns.length || form.columns.includes(c.key)
                return (
                  <label key={c.key} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={on} onChange={() => {
                      const all = report.columns.map((x) => x.key)
                      const cur = form.columns.length ? form.columns : all
                      const next = toggle(cur, c.key)
                      setForm((f) => ({ ...f, columns: next.length === all.length ? [] : all.filter((k) => next.includes(k)) }))
                    }} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                    {t(`reports.columns.${report.id}.${c.key}`, c.label)}
                  </label>
                )
              })}
            </div>
          </div>
        </>}
        {canShare && (
          <div>
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('reports.builder.shareWith')}</p>
            <div className="flex flex-wrap gap-2">
              {roles.filter((r) => !r.fullAccess).map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={form.sharedRoleIds.includes(r.id)} onChange={() => setForm((f) => ({ ...f, sharedRoleIds: toggle(f.sharedRoleIds, r.id) }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  {r.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1">{t('reports.builder.shareHint')}</p>
          </div>
        )}
        {canSchedule && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={form.schedule.active} onChange={(e) => setSched('active', e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t('reports.builder.sendOnSchedule')}
            </label>
            {form.schedule.active && <>
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField label={t('reports.builder.frequency')}>
                  <Select value={form.schedule.frequency} onChange={(e) => setSched('frequency', e.target.value)}>{REPORT_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{t(`reports.frequency.${f.value}`, f.label)}</option>)}</Select>
                </FormField>
                <FormField label={t('reports.builder.at')}>
                  <Select value={String(form.schedule.hour)} onChange={(e) => setSched('hour', Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00`}</option>)}</Select>
                </FormField>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-muted mb-1.5">{t('reports.builder.people')}</p>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {userRows.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-bg">
                      <input type="checkbox" checked={form.schedule.userIds.includes(u.id)} onChange={() => setSched('userIds', toggle(form.schedule.userIds, u.id))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                      <span className="flex-1">{u.name}</span><span className="text-xs text-ink-faint">{u.designation ?? ''}</span>
                    </label>
                  ))}
                </div>
              </div>
              <FormField label={t('reports.builder.emails')} hint={t('reports.builder.emailsHint')} error={errors.schedule}><Input value={emailText} onChange={(e) => setEmailText(e.target.value)} placeholder="principal@school.in, chairman@trust.org" /></FormField>
            </>}
          </div>
        )}
      </div>
    </Modal>
  )
}

function RunView({ id, onBack }) {
  const { t } = useTranslation('reports')
  const { dateTime } = useFormat()
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['saved-report-run', id], queryFn: () => runSavedReport(id) })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('reports.builder.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{data?.saved.name ?? '…'}</p>
            {data && <p className="text-xs text-ink-muted">{t(`reports.list.${data.report.id}.label`, data.report.label)}{data.paramsLabel ? ` · ${data.paramsLabel}` : ''} · {t('reports.ranAt', { at: dateTime(data.generatedAt), count: data.rows.length })}</p>}
          </div>
        </div>
        <Button size="sm" variant="secondary" icon={Play} loading={isFetching} onClick={() => refetch()}>{t('reports.runAgain')}</Button>
      </div>
      {isLoading && <p className="text-sm text-ink-faint">{t('reports.loading')}</p>}
      {error && <Note tone="warning">{error.message}</Note>}
      {data && <ResultTable result={data} exportName={data.saved.name} />}
    </div>
  )
}

/** Saved reports: a library report with its inputs and columns, shared with roles, sent on a schedule. */
export default function Builder() {
  const { t } = useTranslation('reports')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const runId = params.get('run')
  const [editing, setEditing] = useState(null)
  const { data: library = [] } = useQuery({ queryKey: ['report-library'], queryFn: fetchReportLibrary })
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['saved-reports'], queryFn: fetchSavedReports })
  const remove = useMutation({ mutationFn: (id) => deleteSavedReport(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-reports'] }); showSuccess(t('reports.builder.deleted')) }, onError: (e) => showError(e.message) })
  const libLabel = useMemo(() => new Map(library.map((r) => [r.id, t(`reports.list.${r.id}.label`, r.label)])), [library, t])
  const freq = (s) => t(`reports.frequency.${s.frequency}`, s.frequency)

  return (
    <PageContainer>
      <PageHeader icon={Wrench} title={t('reports.builder.title')} subtitle={t('reports.builder.subtitle')}
        actions={!runId && library.length > 0 && <HeaderButton icon={Plus} variant="primary" requires="reports.builder.create" onClick={() => setEditing('new')}>{t('reports.builder.new')}</HeaderButton>} />
      {runId ? <RunView id={runId} onBack={() => setParams({})} /> : (
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          columns={[
            { key: 'name', header: t('reports.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{libLabel.get(r.reportId) ?? r.label}</p></div> },
            { key: 'owner', header: t('reports.builder.owner'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{r.mine ? t('reports.builder.you') : v}{r.sharedRoleIds.length > 0 && <span className="ms-1 inline-flex items-center gap-0.5 text-xs text-ink-faint"><Users size={12} /> {r.sharedRoleIds.length}</span>}</span> },
            { key: 'schedule', header: t('reports.builder.schedule'), render: (s, r) => (s.active
              ? <div><StatusPill tone="info">{`${freq(s)} · ${String(s.hour).padStart(2, '0')}:00`}</StatusPill>{r.lastError ? <p className="text-xs text-danger-600 mt-0.5 line-clamp-1">{r.lastError}</p> : r.lastRunAt && <p className="text-xs text-ink-faint mt-0.5">{t('reports.builder.lastSent', { at: dateTime(r.lastRunAt), count: r.lastRows ?? 0 })}</p>}</div>
              : <span className="text-xs text-ink-faint">{t('reports.builder.notScheduled')}</span>) },
            { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {r.canRun && <Button size="sm" variant="ghost" icon={Play} title={t('reports.run')} aria-label={t('reports.run')} onClick={() => setParams({ run: id })} />}
                {r.mine && hasPermission('reports.builder.edit') && <Button size="sm" variant="ghost" icon={Pencil} title={t('reports.builder.edit')} aria-label={t('reports.builder.edit')} onClick={() => setEditing(r)} />}
                {r.mine && hasPermission('reports.builder.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('reports.builder.delete')} aria-label={t('reports.builder.delete')}
                  onClick={async () => { if (await confirm({ title: t('reports.builder.deleteConfirm', { name: r.name }), tone: 'danger', confirmLabel: t('reports.builder.delete') })) remove.mutate(id) }} />}
              </div>
            ) },
          ]}
          onRowClick={(r) => r.canRun && setParams({ run: r.id })}
          emptyIcon={CalendarClock} emptyTitle={t('reports.builder.empty')} emptyHint={t('reports.builder.emptyHint')}
        />
      )}
      {editing && <Editor saved={editing === 'new' ? null : editing} library={library} onClose={() => setEditing(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['saved-reports'] }); setEditing(null); showSuccess(t('reports.saved')) }} />}
    </PageContainer>
  )
}
