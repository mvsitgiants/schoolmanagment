import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarRange, CheckCircle2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { academicYearFor, defaultTerms } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createYear, deleteYear, fetchYears, makeYearCurrent, updateYear } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** A new year's suggested dates: the year starting the day after the latest one ends, in two terms. */
function suggestion(years) {
  const latest = [...years].sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
  const start = latest
    ? new Date(Date.parse(`${latest.endDate}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const y = academicYearFor(start, latest ? Number(start.slice(5, 7)) : 4)
  return { ...y, terms: defaultTerms(y) }
}

function YearForm({ year, years, onClose, onSaved }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => (year ? { ...year, terms: year.terms.map(({ name, startDate, endDate }) => ({ name, startDate, endDate })) } : suggestion(years)))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setTerm = (i, k) => (e) => setForm((f) => ({ ...f, terms: f.terms.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) }))
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, startDate: form.startDate, endDate: form.endDate, terms: form.terms, ...(year && { closed: !!form.closed }) }
      return year ? updateYear(year.id, body) : createYear(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={year ? t('academics.years.editTitle', { name: year.name }) : t('academics.years.newYear')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.startDate || !form.endDate} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-3 gap-4">
        <FormField label={t('academics.years.name')} required error={errors.name} hint={t('academics.years.nameHint')}><Input value={form.name} onChange={set('name')} placeholder="2027-28" /></FormField>
        <FormField label={t('academics.years.startDate')} required error={errors.startDate}><Input type="date" value={form.startDate} onChange={set('startDate')} /></FormField>
        <FormField label={t('academics.years.endDate')} required error={errors.endDate}><Input type="date" value={form.endDate} onChange={set('endDate')} /></FormField>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-ink">{t('academics.years.terms')}</p>
          <Button size="sm" variant="ghost" icon={Plus} disabled={form.terms.length >= 6} onClick={() => setForm((f) => ({ ...f, terms: [...f.terms, { name: t('academics.years.termN', { n: f.terms.length + 1 }), startDate: '', endDate: '' }] }))}>{t('academics.years.addTerm')}</Button>
        </div>
        {form.terms.length === 0 && <p className="text-sm text-ink-faint">{t('academics.years.noTerms')}</p>}
        <div className="space-y-3">
          {form.terms.map((term, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-start">
              <FormField label={i === 0 ? t('academics.years.termName') : undefined} error={errors[`terms.${i}.name`]}><Input value={term.name} onChange={setTerm(i, 'name')} /></FormField>
              <FormField label={i === 0 ? t('academics.years.from') : undefined} error={errors[`terms.${i}.startDate`]}><Input type="date" value={term.startDate} onChange={setTerm(i, 'startDate')} /></FormField>
              <FormField label={i === 0 ? t('academics.years.to') : undefined} error={errors[`terms.${i}.endDate`]}><Input type="date" value={term.endDate} onChange={setTerm(i, 'endDate')} /></FormField>
              <Button size="sm" variant="ghost" icon={X} aria-label={t('academics.years.removeTerm')} title={t('academics.years.removeTerm')} className={i === 0 ? 'mt-6' : ''}
                onClick={() => setForm((f) => ({ ...f, terms: f.terms.filter((_, j) => j !== i) }))} />
            </div>
          ))}
        </div>
      </div>

      {year && (
        <label className="mt-6 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">
          <span><span className="block font-medium">{t('academics.years.closed')}</span><span className="block text-xs text-ink-muted">{t('academics.years.closedHint')}</span></span>
          <Switch checked={!!form.closed} onChange={set('closed')} label={t('academics.years.closed')} disabled={year.isCurrent} />
        </label>
      )}
    </Modal>
  )
}

export default function Years() {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['academic-years'], queryFn: fetchYears })
  const [editing, setEditing] = useState(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); qc.invalidateQueries({ queryKey: ['academic-lookup'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })

  const status = (y) => (y.isCurrent ? <StatusPill tone="success">{t('academics.years.current')}</StatusPill> : y.closed ? <StatusPill tone="neutral">{t('academics.years.closedPill')}</StatusPill> : <StatusPill tone="info">{t('academics.years.planned')}</StatusPill>)

  return (
    <PageContainer>
      <PageHeader icon={CalendarRange} title={t('academics.years.title')} subtitle={t('academics.years.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('academics.years.newYear')}</HeaderButton>} />
      <Note className="mb-4">{t('academics.years.note')}</Note>
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        columns={[
          { key: 'name', header: t('academics.years.year'), mobilePrimary: true, render: (v) => <span className="font-medium text-ink font-mono-num">{v}</span> },
          { key: 'startDate', header: t('academics.years.dates'), render: (v, r) => <span className="text-sm text-ink-muted">{date(v)} – {date(r.endDate)}</span> },
          { key: 'terms', header: t('academics.years.terms'), mobileHidden: true, render: (v) => (v.length ? <span className="text-sm text-ink-muted">{v.map((x) => x.name).join(' · ')}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'sectionCount', header: t('academics.years.sections'), align: 'right' },
          { key: 'isCurrent', header: t('academics.years.status'), render: (_, r) => status(r) },
          { key: 'id', header: '', align: 'right', width: 140, render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('academics.years.edit') && !r.isCurrent && !r.closed && (
                <Button size="sm" variant="ghost" icon={CheckCircle2} title={t('academics.years.makeCurrent')} aria-label={t('academics.years.makeCurrent')}
                  onClick={async () => { if (await confirm({ title: t('academics.years.makeCurrentConfirm.title', { name: r.name }), message: t('academics.years.makeCurrentConfirm.message'), confirmLabel: t('academics.years.makeCurrent') })) act.mutate({ fn: () => makeYearCurrent(r.id), done: t('academics.years.nowCurrent', { name: r.name }) }) }} />
              )}
              {hasPermission('academics.years.edit') && <Button size="sm" variant="ghost" icon={Pencil} title={t('actions.edit')} aria-label={t('actions.edit')} onClick={() => setEditing(r)} />}
              {hasPermission('academics.years.delete') && !r.isCurrent && (
                <Button size="sm" variant="ghost" icon={Trash2} title={t('actions.delete')} aria-label={t('actions.delete')}
                  onClick={async () => { if (await confirm({ title: t('academics.years.deleteConfirm.title', { name: r.name }), message: t('academics.years.deleteConfirm.message'), tone: 'danger', confirmLabel: t('actions.delete') })) act.mutate({ fn: () => deleteYear(r.id), done: t('academics.years.deleted') }) }} />
              )}
            </div>
          ) },
        ]}
        onRowClick={hasPermission('academics.years.edit') ? setEditing : undefined}
        emptyIcon={CalendarRange} emptyTitle={t('academics.years.emptyTitle')} emptyHint={t('academics.years.emptyHint')}
      />
      {editing && <YearForm year={editing === 'new' ? null : editing} years={rows} onClose={() => setEditing(null)} onSaved={() => { refresh(); showSuccess(t('academics.years.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
