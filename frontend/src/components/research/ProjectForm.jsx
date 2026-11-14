import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RESEARCH_AGENCIES, RESEARCH_PROJECT_STATUS, projectUtilisation } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Modal, PillRow, Select, Textarea, pillClass } from '../system'
import Button from '../ui/Button'
import { saveProject } from '../../api/research'
import { useSnackbar } from '../../context/SnackbarContext'
import { StaffChips, StaffSelect, paiseOf, rupeesOf, useResearchLabels, useResearchMeta } from './ResearchKit'

/** Received and utilised against what was sanctioned, as one bar: utilised (solid) inside received (light). */
export function UtilisationBar({ p }) {
  const { t } = useTranslation('research')
  if (!p.sanctioned) return <span className="text-ink-faint">—</span>
  const rec = Math.min(100, (p.received / p.sanctioned) * 100)
  const used = Math.min(100, (p.utilised / p.sanctioned) * 100)
  return (
    <span className="inline-flex w-36 flex-col gap-1" title={t('research.projects.utilisationTip', { received: p.receivedPct, utilised: p.utilisedPct })}>
      <span className="relative h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <span className="absolute inset-y-0 start-0 rounded-full bg-brand-200" style={{ width: `${rec}%` }} />
        <span className="absolute inset-y-0 start-0 rounded-full bg-brand-500" style={{ width: `${used}%` }} />
      </span>
      <span className="flex justify-between text-[11px] tabular-nums text-ink-faint">
        <span>{t('research.projects.usedPct', { pct: p.utilisedPct })}</span>
        <span>{t('research.projects.recPct', { pct: p.receivedPct })}</span>
      </span>
    </span>
  )
}

/** The project form's starting values: from a project (edit) or blank (new). Money is typed in rupees. */
export function projectFormValues(project) {
  return {
    title: project?.title ?? '', piId: project?.piId ?? '', coPiIds: project?.coPiIds ?? [], agency: project?.agency ?? 'DST', agencyName: project?.agencyName ?? '',
    scheme: project?.scheme ?? '', referenceNo: project?.referenceNo ?? '', departmentId: project?.departmentId ?? '',
    sanctioned: rupeesOf(project?.sanctioned), received: rupeesOf(project?.received), utilised: rupeesOf(project?.utilised),
    appliedOn: project?.appliedOn ?? '', sanctionedOn: project?.sanctionedOn ?? '', startDate: project?.startDate ?? '', endDate: project?.endDate ?? '',
    status: project?.status ?? 'APPLIED', notes: project?.notes ?? '',
  }
}

/** The money typed in rupees, in paise as the API keeps it. */
export const projectMoney = (form) => ({ sanctioned: paiseOf(form.sanctioned), received: paiseOf(form.received), utilised: paiseOf(form.utilised) })

/** What the API takes from the form. */
export const projectBody = (form) => ({ ...form, ...projectMoney(form), departmentId: form.departmentId || null, coPiIds: form.coPiIds })

/** Enough to save: a title of 3+ letters and a principal investigator. */
export const projectReady = (form) => form.title.trim().length >= 3 && !!form.piId

/**
 * A project's fields in sections — the New project page and the Edit pop-up both use it.
 * Controlled: `value` + `onChange(next)`.
 */
export function ProjectFields({ value: form, onChange, errors = {}, editing = false }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const { data: meta } = useResearchMeta()
  const set = (k) => (e) => onChange({ ...form, [k]: e?.target ? e.target.value : e })
  const money = projectMoney(form)
  const u = projectUtilisation(money)
  const staff = meta?.staff ?? []
  return (
    <div className="space-y-5">
      <FormSection title={t('research.projects.form.project')} hint={t('research.projects.form.projectHint')}>
        <div className="space-y-4">
          <FormField label={t('research.projects.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField>
          <FormField label={t('research.projects.status')}>
            <PillRow>
              {Object.keys(RESEARCH_PROJECT_STATUS).map((s) => (
                <button key={s} type="button" aria-pressed={form.status === s} className={pillClass(form.status === s)} onClick={() => onChange({ ...form, status: s })}>{L.project(s)}</button>
              ))}
            </PillRow>
          </FormField>
        </div>
      </FormSection>

      <FormSection title={t('research.projects.form.team')} hint={t('research.projects.form.teamHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('research.projects.pi')} required error={errors.piId}>
            <StaffSelect value={form.piId} staff={staff} exclude={form.coPiIds} placeholder={t('research.projects.pickPi')} onChange={(piId) => onChange({ ...form, piId: piId ?? '' })} />
          </FormField>
          <FormField label={t('research.projects.department')} error={errors.departmentId} hint={editing ? undefined : t('research.projects.departmentHint')}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('research.projects.piDepartment')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('research.projects.coPis')} error={errors.coPiIds} className="sm:col-span-2">
            <StaffChips value={form.coPiIds} staff={staff} exclude={form.piId ? [form.piId] : []} placeholder={t('research.projects.addCoPi')} onChange={(coPiIds) => onChange({ ...form, coPiIds })} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={t('research.projects.form.funding')} hint={t('research.projects.form.fundingHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('research.projects.agency')} required>
            <Select value={form.agency} onChange={set('agency')}>{RESEARCH_AGENCIES.map((a) => <option key={a.value} value={a.value}>{L.agency(a.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('research.projects.agencyName')} hint={t('research.projects.agencyNameHint')}><Input value={form.agencyName} onChange={set('agencyName')} /></FormField>
          <FormField label={t('research.projects.scheme')}><Input value={form.scheme} onChange={set('scheme')} /></FormField>
          <FormField label={t('research.projects.referenceNo')} error={errors.referenceNo}><Input value={form.referenceNo} onChange={set('referenceNo')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('research.projects.form.money')} hint={t('research.projects.form.moneyHint')}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label={t('research.projects.sanctioned')} error={errors.sanctioned}><Input type="number" min="0" step="0.01" value={form.sanctioned} onChange={set('sanctioned')} /></FormField>
            <FormField label={t('research.projects.received')} error={errors.received}><Input type="number" min="0" step="0.01" value={form.received} onChange={set('received')} /></FormField>
            <FormField label={t('research.projects.utilised')} error={errors.utilised}><Input type="number" min="0" step="0.01" value={form.utilised} onChange={set('utilised')} /></FormField>
          </div>
          {money.sanctioned > 0 && <UtilisationBar p={{ ...money, ...u }} />}
        </div>
      </FormSection>

      <FormSection title={t('research.projects.form.dates')} hint={t('research.projects.form.datesHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('research.projects.appliedOn')} error={errors.appliedOn}><DateInput value={form.appliedOn} onChange={set('appliedOn')} /></FormField>
          <FormField label={t('research.projects.sanctionedOn')} error={errors.sanctionedOn}><DateInput value={form.sanctionedOn} onChange={set('sanctionedOn')} /></FormField>
          <FormField label={t('research.projects.startDate')} error={errors.startDate}><DateInput value={form.startDate} onChange={set('startDate')} /></FormField>
          <FormField label={t('research.projects.endDate')} error={errors.endDate}><DateInput value={form.endDate} onChange={set('endDate')} /></FormField>
          <FormField label={t('research.projects.notes')} className="sm:col-span-2 xl:col-span-4"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
        </div>
      </FormSection>
    </div>
  )
}

/** Edit a project in a pop-up (a new project has its own page: pages/Research/NewProject.jsx). */
export default function ProjectForm({ project, onClose, onSaved }) {
  const { t } = useTranslation('research')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => projectFormValues(project))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveProject(project.id, projectBody(form)),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={t('research.projects.editTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!projectReady(form)} onClick={() => save.mutate()}>{t('research.projects.save')}</Button>
    </>}>
      <ProjectFields value={form} onChange={setForm} errors={errors} editing />
    </Modal>
  )
}
