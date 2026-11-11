import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { DateInput, DataTable, FormField, Input, Modal, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { fetchAcademicLookup } from '../../api/academics'
import { createWindow, fetchRegistrationLookup, updateWindow } from '../../api/registration'
import { useSnackbar } from '../../context/SnackbarContext'

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

/**
 * Create a registration window (program, semester, year, dates, credit limits — the offerings start from the
 * curriculum) or edit one, including its offerings (compulsory, elective group, seats) and elective groups.
 */
export default function WindowForm({ window: w, onClose, onSaved }) {
  const { t } = useTranslation('registration')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['registration-lookup'], queryFn: fetchRegistrationLookup })
  const { data: acad } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const programs = lookup?.programs ?? []
  const [form, setForm] = useState(() => ({
    programId: w?.programId ?? '', semester: w?.semester ?? 1, academicYearId: w?.academicYearId ?? '',
    opensOn: w?.opensOn ?? '', closesOn: w?.closesOn ?? '', minCredits: w?.minCredits ?? '', maxCredits: w?.maxCredits ?? '',
    requireApproval: w?.requireApproval ?? true, notes: w?.notes ?? '',
    offerings: (w?.offerings ?? []).map((o) => ({ ...o, group: o.group ?? '', seats: o.seats ?? '' })),
    groups: (w?.groups ?? []).map((g) => ({ ...g })),
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setOff = (i, k) => (e) => setForm((f) => ({ ...f, offerings: f.offerings.map((o, j) => (j === i ? { ...o, [k]: e?.target ? e.target.value : e } : o)) }))
  const setGroup = (i, k) => (e) => setForm((f) => ({ ...f, groups: f.groups.map((g, j) => (j === i ? { ...g, [k]: e.target.value } : g)) }))
  const programId = form.programId || programs[0]?.id || ''
  const program = programs.find((p) => p.id === programId)
  const yearId = form.academicYearId || acad?.currentYear?.id || ''
  const save = useMutation({
    mutationFn: () => {
      const common = {
        opensOn: form.opensOn, closesOn: form.closesOn, minCredits: numOrNull(form.minCredits), maxCredits: numOrNull(form.maxCredits),
        requireApproval: !!form.requireApproval, notes: form.notes || undefined,
      }
      if (!w) return createWindow({ ...common, programId, semester: Number(form.semester), academicYearId: yearId || undefined })
      return updateWindow(w.id, {
        ...common, semester: Number(form.semester),
        offerings: form.offerings.map((o) => ({ courseId: o.courseId, mandatory: !!o.mandatory, group: o.mandatory ? null : o.group || null, seats: numOrNull(o.seats) })),
        groups: form.groups.filter((g) => g.code).map((g) => ({ code: g.code, name: g.name || undefined, minPick: Number(g.minPick) || 0, maxPick: Number(g.maxPick) || 1 })),
      })
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size={w ? 'xl' : 'lg'} title={w ? t('registration.windows.editTitle', { program: w.programCode, semester: w.semester }) : t('registration.windows.new')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!programId || !form.opensOn || !form.closesOn} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2"><FormField label={t('registration.windows.program')} required error={errors.programId}>
          <Select value={programId} onChange={set('programId')} disabled={!!w}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </FormField></div>
        <FormField label={t('registration.windows.semester')} required error={errors.semester}>
          <Select value={form.semester} onChange={set('semester')} disabled={!!w}>
            {Array.from({ length: program?.semesters ?? w?.semester ?? 8 }, (_, i) => <option key={i + 1} value={i + 1}>{t('registration.semesterN', { n: i + 1 })}</option>)}
          </Select>
        </FormField>
        <FormField label={t('registration.windows.year')}>
          <Select value={yearId} onChange={set('academicYearId')} disabled={!!w}>
            {(acad?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('registration.windows.opensOn')} required error={errors.opensOn}><DateInput value={form.opensOn} onChange={set('opensOn')} /></FormField>
        <FormField label={t('registration.windows.closesOn')} required error={errors.closesOn} hint={t('registration.windows.closesOnHint')}><DateInput value={form.closesOn} onChange={set('closesOn')} /></FormField>
        <FormField label={t('registration.windows.minCredits')} hint={!w ? t('registration.windows.creditsHint') : undefined} error={errors.minCredits}><Input type="number" value={form.minCredits} onChange={set('minCredits')} /></FormField>
        <FormField label={t('registration.windows.maxCredits')} error={errors.maxCredits}><Input type="number" value={form.maxCredits} onChange={set('maxCredits')} /></FormField>
        <div className="flex items-end gap-2 pb-2 text-sm text-ink-muted"><Switch checked={!!form.requireApproval} onChange={set('requireApproval')} label={t('registration.windows.requireApproval')} />{t('registration.windows.requireApproval')}</div>
        <div className="sm:col-span-3"><FormField label={t('registration.windows.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField></div>
      </div>
      {!w && <p className="mt-3 text-xs text-ink-faint">{t('registration.windows.offeringsLater')}</p>}
      {w && (
        <>
          <div className="mt-6">
            <p className="text-sm font-semibold text-ink mb-2">{t('registration.windows.offerings')}</p>
            {errors.offerings && <p className="text-xs text-danger-600 mb-2">{errors.offerings}</p>}
            <DataTable dense rows={form.offerings.map((o, i) => ({ ...o, i, id: o.courseId }))} emptyTitle={t('registration.windows.noOfferings')} columns={[
              { key: 'code', header: t('registration.course'), render: (v, o) => <span><b className="text-ink">{v}</b> <span className="text-ink-muted">{o.title}</span></span> },
              { key: 'credits', header: t('registration.credits'), align: 'right', width: 70 },
              { key: 'mandatory', header: t('registration.windows.compulsory'), width: 100, render: (v, o) => <Switch size="sm" checked={!!v} onChange={setOff(o.i, 'mandatory')} label={t('registration.windows.compulsory')} /> },
              { key: 'group', header: t('registration.windows.group'), width: 110, render: (v, o) => <Select value={v} onChange={setOff(o.i, 'group')} disabled={o.mandatory} aria-label={t('registration.windows.group')}>
                <option value="">—</option>{form.groups.filter((g) => g.code).map((g) => <option key={g.code} value={g.code}>{g.code}</option>)}
              </Select> },
              { key: 'seats', header: t('registration.windows.seats'), width: 100, render: (v, o) => <Input type="number" value={v} onChange={setOff(o.i, 'seats')} placeholder={t('registration.windows.noLimit')} aria-label={t('registration.windows.seats')} /> },
            ]} />
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ink">{t('registration.windows.groups')}</p>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, groups: [...f.groups, { code: '', name: '', minPick: 1, maxPick: 1 }] }))}>{t('registration.windows.addGroup')}</Button>
            </div>
            {errors.groups && <p className="text-xs text-danger-600 mb-2">{errors.groups}</p>}
            <DataTable dense rows={form.groups.map((g, i) => ({ ...g, i, id: String(i) }))} emptyTitle={t('registration.windows.noGroups')} columns={[
              { key: 'code', header: t('registration.windows.groupCode'), width: 110, render: (v, g) => <Input value={v} onChange={setGroup(g.i, 'code')} maxLength={10} aria-label={t('registration.windows.groupCode')} /> },
              { key: 'name', header: t('registration.windows.groupName'), render: (v, g) => <Input value={v ?? ''} onChange={setGroup(g.i, 'name')} maxLength={60} aria-label={t('registration.windows.groupName')} /> },
              { key: 'minPick', header: t('registration.windows.minPick'), width: 90, render: (v, g) => <Input type="number" value={v} onChange={setGroup(g.i, 'minPick')} aria-label={t('registration.windows.minPick')} /> },
              { key: 'maxPick', header: t('registration.windows.maxPick'), width: 90, render: (v, g) => <Input type="number" value={v} onChange={setGroup(g.i, 'maxPick')} aria-label={t('registration.windows.maxPick')} /> },
              { key: 'x', header: '', width: 44, render: (_, g) => <Button size="sm" variant="ghost" icon={X} aria-label={t('registration.remove')} onClick={() => setForm((f) => ({ ...f, groups: f.groups.filter((_, j) => j !== g.i) }))} /> },
            ]} />
          </div>
        </>
      )}
    </Modal>
  )
}
