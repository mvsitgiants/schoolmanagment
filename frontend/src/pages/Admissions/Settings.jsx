import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, DoorOpen, ExternalLink, Plus, Printer, Settings2, X } from 'lucide-react'
import QrCode from '../../components/scan/QrCode'
import { printQrPoster } from '../../components/scan/printPoster'
import { CYCLE_STATUS, MERIT_BASES } from '@schoolgiant/shared'
import { DateInput, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchForms } from '../../api/forms'
import { createCycle, fetchCycles, setCycleStatus, updateCycle } from '../../api/admissions'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const blankClass = { classId: '', seats: '40', minAge: '', maxAge: '', meritBasis: 'TEST', testRequired: true }

function CycleForm({ cycle, onClose, onSaved }) {
  const { t } = useTranslation('admissions')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data: forms } = useQuery({ queryKey: ['forms', 'ADMISSION'], queryFn: () => fetchForms({ use: 'ADMISSION', status: 'PUBLISHED' }) })
  const [form, setForm] = useState(() => ({
    name: cycle?.name ?? '', academicYearId: cycle?.academicYearId ?? '', opensOn: cycle?.opensOn ?? '', closesOn: cycle?.closesOn ?? '', formId: cycle?.formId ?? '', instructions: cycle?.instructions ?? '',
    classes: cycle?.classes?.map((c) => ({ classId: c.classId, seats: String(c.seats), minAge: c.minAge ?? '', maxAge: c.maxAge ?? '', meritBasis: c.meritBasis, testRequired: !!c.testRequired })) ?? [{ ...blankClass }],
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setRow = (i, k, v) => setForm((f) => ({ ...f, classes: f.classes.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))
  const body = () => ({ ...form, classes: form.classes.filter((c) => c.classId).map((c) => ({ ...c, seats: Number(c.seats) || 0 })) })
  const save = useMutation({ mutationFn: () => (cycle ? updateCycle(cycle.id, body()) : createCycle(body())), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  const formList = Array.isArray(forms) ? forms : forms?.data ?? []
  return (
    <Modal open onClose={onClose} size="xl" title={cycle ? t('admissions.settings.editTitle') : t('admissions.settings.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 3 || !form.classes.some((c) => c.classId)} onClick={() => save.mutate()}>{t('admissions.settings.save')}</Button>
    </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('admissions.settings.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('admissions.settings.namePlaceholder')} /></FormField>
          <FormField label={t('admissions.settings.year')} hint={t('admissions.settings.yearHint')}>
            <Select value={form.academicYearId} onChange={set('academicYearId')}><option value="">—</option>{(lookup?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.settings.opensOn')}><DateInput value={form.opensOn} onChange={set('opensOn')} /></FormField>
          <FormField label={t('admissions.settings.closesOn')} error={errors.closesOn}><DateInput value={form.closesOn} min={form.opensOn || undefined} onChange={set('closesOn')} /></FormField>
          <FormField label={t('admissions.settings.extraForm')} hint={t('admissions.settings.extraFormHint')} error={errors.formId}>
            <Select value={form.formId} onChange={set('formId')}><option value="">{t('admissions.settings.noForm')}</option>{formList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
          </FormField>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-ink-muted">{t('admissions.settings.classes')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, classes: [...f.classes, { ...blankClass }] }))}>{t('admissions.settings.addClass')}</Button>
          </div>
          <div className="space-y-2">
            {form.classes.map((c, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[1.4fr_.6fr_.6fr_.6fr_1.4fr_auto_auto] gap-2 items-end">
                <FormField label={i === 0 ? t('admissions.form.class') : undefined}><Select value={c.classId} onChange={(e) => setRow(i, 'classId', e.target.value)}><option value="">{t('admissions.form.pick')}</option>{(lookup?.classes ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
                <FormField label={i === 0 ? t('admissions.settings.seats') : undefined}><Input type="number" min="0" value={c.seats} onChange={(e) => setRow(i, 'seats', e.target.value)} /></FormField>
                <FormField label={i === 0 ? t('admissions.settings.minAge') : undefined}><Input type="number" min="0" value={c.minAge} onChange={(e) => setRow(i, 'minAge', e.target.value)} /></FormField>
                <FormField label={i === 0 ? t('admissions.settings.maxAge') : undefined}><Input type="number" min="0" value={c.maxAge} onChange={(e) => setRow(i, 'maxAge', e.target.value)} /></FormField>
                <FormField label={i === 0 ? t('admissions.settings.basis') : undefined}><Select value={c.meritBasis} onChange={(e) => setRow(i, 'meritBasis', e.target.value)}>{MERIT_BASES.map((b) => <option key={b.value} value={b.value}>{t(`admissions.bases.${b.value}`, b.label)}</option>)}</Select></FormField>
                <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted h-9"><input type="checkbox" checked={c.testRequired} onChange={(e) => setRow(i, 'testRequired', e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('admissions.settings.test')}</label>
                <Button size="sm" variant="ghost" icon={X} aria-label={t('admissions.settings.removeClass')} onClick={() => setForm((f) => ({ ...f, classes: f.classes.filter((_, j) => j !== i) }))} />
              </div>
            ))}
          </div>
          {errors.classes && <p className="text-xs text-danger-600 mt-1">{errors.classes}</p>}
        </div>
        <FormField label={t('admissions.settings.instructions')} hint={t('admissions.settings.instructionsHint')}><Textarea rows={3} value={form.instructions} onChange={set('instructions')} /></FormField>
      </div>
    </Modal>
  )
}

export default function AdmissionSettings() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['admission-cycles'], queryFn: fetchCycles })
  const act = useMutation({ mutationFn: ({ id, status }) => setCycleStatus(id, status), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admission-cycles'] }); showSuccess(t('admissions.settings.statusSaved')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('admissions.settings.edit')
  const slug = getCurrentUser()?.tenant?.slug
  const link = slug ? `${window.location.origin}/apply/${slug}` : null
  const copy = async () => { try { await navigator.clipboard.writeText(link); showSuccess(t('admissions.settings.copied')) } catch { showError(link) } }

  return (
    <PageContainer>
      <PageHeader icon={Settings2} title={t('admissions.settings.title')} subtitle={t('admissions.settings.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="admissions.settings.edit" onClick={() => setEditing('new')}>{t('admissions.settings.new')}</HeaderButton>} />
      {link && (
        <Panel className="mb-4" title={t('admissions.settings.publicTitle')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono-num text-sm break-all flex-1">{link}</span>
            <Button size="sm" variant="ghost" icon={Copy} onClick={copy}>{t('admissions.settings.copy')}</Button>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"><ExternalLink size={14} />{t('admissions.settings.open')}</a>
          </div>
          <p className="text-xs text-ink-muted mt-2">{t('admissions.settings.publicHint')} {hasPermission('core.settings.view') && <Link to="/core/settings" className="text-brand-600 hover:underline">{t('admissions.settings.goSettings')}</Link>}</p>
          <div className="mt-4 flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-border bg-bg p-4">
            <QrCode value={`${link}?tab=enquire`} size={132} label={t('admissions.settings.posterTitle')} className="rounded-lg bg-white p-1.5 shrink-0" />
            <div className="min-w-0 text-center sm:text-start">
              <p className="font-semibold text-ink">{t('admissions.settings.posterTitle')}</p>
              <p className="text-sm text-ink-muted mt-0.5">{t('admissions.settings.posterHint')}</p>
              <Button size="sm" variant="secondary" icon={Printer} className="mt-2"
                onClick={() => printQrPoster({ title: t('admissions.settings.posterHeading'), text: t('admissions.settings.posterText'), url: `${link}?tab=enquire` })}>{t('admissions.settings.printPoster')}</Button>
            </div>
          </div>
        </Panel>
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        columns={[
          { key: 'name', header: t('admissions.settings.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.yearName, r.opensOn && `${date(r.opensOn)} – ${r.closesOn ? date(r.closesOn) : '…'}`].filter(Boolean).join(' · ')}</p></div> },
          { key: 'classes', header: t('admissions.settings.classes'), render: (v) => <div className="flex flex-wrap gap-x-3 gap-y-1.5">{v.map((c) => <ColorChip key={c.classId} label={c.className} seed={c.classId} sub={t('admissions.settings.seatLine', { taken: c.offered + c.admitted, seats: c.seats, apps: c.applications })} />)}</div> },
          { key: 'status', header: t('admissions.statusLabel'), render: (v) => <StatusPill tone={CYCLE_STATUS[v]?.tone}>{t(`admissions.cycleStatus.${v}`, CYCLE_STATUS[v]?.label)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 200, render: (id, r) => canEdit && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{t('admissions.settings.edit')}</Button>
              {r.status !== 'OPEN' && <Button size="sm" variant="secondary" icon={DoorOpen} onClick={() => act.mutate({ id, status: 'OPEN' })}>{t('admissions.settings.openCycle')}</Button>}
              {r.status === 'OPEN' && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: t('admissions.settings.closeConfirm', { name: r.name }), confirmLabel: t('admissions.settings.closeCycle') })) act.mutate({ id, status: 'CLOSED' }) }}>{t('admissions.settings.closeCycle')}</Button>}
            </div>
          ) },
        ]}
        onRowClick={canEdit ? (r) => setEditing(r) : undefined}
        emptyIcon={Settings2} emptyTitle={t('admissions.settings.empty')} emptyHint={t('admissions.settings.emptyHint')}
      />
      <Note className="mt-4">{t('admissions.settings.flowHint')}</Note>
      {editing && <CycleForm cycle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admission-cycles'] }); setEditing(null); showSuccess(t('admissions.settings.saved')) }} />}
    </PageContainer>
  )
}
