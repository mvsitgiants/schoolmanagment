import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES, GENDERS } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Modal, Select, Textarea } from '../system'
import Button from '../ui/Button'
import PrintImageField from '../print/PrintImageField'
import { fetchRoles } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { updateEmployee } from '../../api/hrms'
import { useSnackbar } from '../../context/SnackbarContext'
import { useHrLabels, useHrMeta } from './HrKit'

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'

/** The form's starting values from a staff record (edit) or blank (add). */
export function employeeFormValues(e0 = {}) {
  const e = e0 ?? {}
  return {
    name: e.name ?? '', employeeCode: e.employeeCode ?? '', designation: e.designation ?? '', category: e.category ?? 'TEACHING', employmentType: e.employmentType ?? 'PERMANENT',
    departmentId: e.departmentId ?? '', branchId: e.branchId ?? '', reportingManagerId: e.reportingManagerId ?? '', joiningDate: e.joiningDate ?? '', confirmationDate: e.confirmationDate ?? '',
    photo: e.photo ?? '', gender: e.gender ?? '', dob: e.dob ?? '', bloodGroup: e.bloodGroup ?? '', mobile: e.mobile ?? '', email: e.email ?? '',
    qualifications: e.qualifications ?? '', experienceYears: e.experienceYears ?? '', subjects: (e.subjects ?? []).join(', '),
    weeklyOffDays: e.weeklyOffDays ?? [], notes: e.notes ?? '', changeNote: '', geofenceExempt: !!e.geofenceExempt,
    login: 'none', userId: '', loginEmail: '', roleId: '',
  }
}

/** What the API takes from the form. Adding: the sign-in choice; editing: the note on the change. */
export function employeeBody(form, { editing = false } = {}) {
  const b = {
    name: form.name, employeeCode: form.employeeCode, designation: form.designation, category: form.category, employmentType: form.employmentType,
    departmentId: form.departmentId || null, branchId: form.branchId || null, reportingManagerId: form.reportingManagerId || null,
    joiningDate: form.joiningDate, confirmationDate: form.confirmationDate, photo: form.photo, gender: form.gender, dob: form.dob, bloodGroup: form.bloodGroup,
    mobile: form.mobile, email: form.email, qualifications: form.qualifications, experienceYears: form.experienceYears,
    subjects: form.subjects.split(',').map((s) => s.trim()).filter(Boolean), weeklyOffDays: form.weeklyOffDays, notes: form.notes, geofenceExempt: form.geofenceExempt,
  }
  if (editing) return { ...b, changeNote: form.changeNote }
  if (form.login === 'link') b.userId = form.userId || null
  if (form.login === 'new') b.login = { email: form.loginEmail || form.email, roleIds: form.roleId ? [form.roleId] : [], invite: true }
  return b
}

/** The two things a staff record cannot be saved without. */
export const employeeReady = (form) => form.name.trim().length >= 2 && !!form.joiningDate

/**
 * Add / edit form for a staff member, in sections. Controlled: `value` + `onChange(next)`; `errors` are the API's
 * field errors. `employee` (editing) hides the sign-in choice and shows the note on the change.
 * Salary, bank and ID numbers are not here — they are on the staff profile.
 */
export default function EmployeeForm({ value: form, onChange, errors = {}, employee = null, autoFocus = false }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { data: meta } = useHrMeta()
  const canUsers = hasPermission('core.users.create')
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: !employee && canUsers })
  const put = (k, v) => onChange({ ...form, [k]: v })
  const set = (k) => (e) => put(k, e.target.value)
  const managers = (meta?.staff ?? []).filter((s) => s.id !== employee?.id)
  const toggleOff = (d) => put('weeklyOffDays', form.weeklyOffDays.includes(d) ? form.weeklyOffDays.filter((x) => x !== d) : [...form.weeklyOffDays, d])

  return (
    <div className="space-y-5">
      <FormSection title={t('hrms.employees.form.person')} hint={t('hrms.employees.form.personHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('hrms.employees.name')} required error={errors.name}><Input autoFocus={autoFocus} value={form.name} onChange={set('name')} /></FormField></div>
          <FormField label={t('hrms.employees.mobile')} error={errors.mobile}><Input value={form.mobile} onChange={set('mobile')} inputMode="tel" /></FormField>
          <FormField label={t('hrms.employees.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
          <FormField label={t('hrms.employees.gender')}>
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">{t('hrms.none')}</option>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`hrms.genders.${g.value}`)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hrms.employees.dob')} error={errors.dob}><DateInput value={form.dob} onChange={set('dob')} /></FormField>
          <div className="sm:col-span-2"><PrintImageField label={t('hrms.employees.photo')} hint={t('hrms.employees.photoHint')} value={form.photo} onChange={(v) => put('photo', v)} error={errors.photo} /></div>
        </div>
      </FormSection>

      <FormSection title={t('hrms.employees.form.job')} hint={t('hrms.employees.form.jobHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('hrms.employees.designation')} error={errors.designation}><Input value={form.designation} onChange={set('designation')} placeholder={t('hrms.employees.designationPlaceholder')} /></FormField></div>
          <FormField label={t('hrms.employees.code')} hint={employee ? undefined : t('hrms.employees.codeHint')} error={errors.employeeCode}><Input value={form.employeeCode} onChange={(e) => put('employeeCode', e.target.value.toUpperCase())} /></FormField>
          <FormField label={t('hrms.employees.joiningDate')} required error={errors.joiningDate}><DateInput value={form.joiningDate} onChange={set('joiningDate')} /></FormField>
          <FormField label={t('hrms.employees.category')} required>
            <Select value={form.category} onChange={set('category')}>{EMPLOYEE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.category(c.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('hrms.employees.employmentType')} required>
            <Select value={form.employmentType} onChange={set('employmentType')}>{EMPLOYMENT_TYPES.map((c) => <option key={c.value} value={c.value}>{L.employment(c.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('hrms.employees.department')}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('hrms.none')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hrms.employees.confirmationDate')} error={errors.confirmationDate}><DateInput value={form.confirmationDate} onChange={set('confirmationDate')} /></FormField>
          <div className="sm:col-span-2">
            <FormField label={t('hrms.employees.manager')} hint={t('hrms.employees.managerHint')} error={errors.reportingManagerId}>
              <Select value={form.reportingManagerId} onChange={set('reportingManagerId')}>
                <option value="">{t('hrms.none')}</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.designation ? `${m.name} · ${m.designation}` : m.name}</option>)}
              </Select>
            </FormField>
          </div>
          {(meta?.branches ?? []).length > 1 && (
            <div className="sm:col-span-2">
              <FormField label={t('hrms.employees.branch')}>
                <Select value={form.branchId} onChange={set('branchId')}>
                  <option value="">{t('hrms.employees.mainCampus')}</option>
                  {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </FormField>
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title={t('hrms.employees.form.background')} hint={t('hrms.employees.form.backgroundHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2 xl:col-span-3"><FormField label={t('hrms.employees.qualifications')}><Input value={form.qualifications} onChange={set('qualifications')} placeholder={t('hrms.employees.qualificationsPlaceholder')} /></FormField></div>
          <FormField label={t('hrms.employees.experience')}><Input type="number" min="0" value={form.experienceYears} onChange={set('experienceYears')} /></FormField>
          {form.category === 'TEACHING' && <div className="sm:col-span-2 xl:col-span-4"><FormField label={t('hrms.employees.subjects')} hint={t('hrms.employees.subjectsHint')}><Input value={form.subjects} onChange={set('subjects')} /></FormField></div>}
        </div>
      </FormSection>

      <FormSection title={t('hrms.employees.form.attendance')} hint={t('hrms.employees.form.attendanceHint')}>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-ink-muted mb-2">{t('hrms.employees.weeklyOff')}</p>
            <div className="flex flex-wrap gap-2">
              {WEEK.map((d) => (
                <label key={d} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={form.weeklyOffDays.includes(d)} onChange={() => toggleOff(d)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  {L.day(d)}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1">{t('hrms.employees.weeklyOffHint')}</p>
          </div>
          <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-ink">
            <input type="checkbox" checked={form.geofenceExempt} onChange={(e) => put('geofenceExempt', e.target.checked)} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
            <span><span className="font-medium">{t('hrms.employees.geofenceExempt')}</span><span className="block text-xs text-ink-muted">{t('hrms.employees.geofenceExemptHint')}</span></span>
          </label>
        </div>
      </FormSection>

      {!employee && (
        <FormSection title={t('hrms.employees.loginTitle')} hint={t('hrms.employees.form.loginHint')}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {['none', 'link', ...(canUsers ? ['new'] : [])].map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="radio" name="login" checked={form.login === k} onChange={() => put('login', k)} className="border-border text-brand-500 focus:ring-brand-500" />
                  {t(`hrms.employees.login.${k}`)}
                </label>
              ))}
            </div>
            {form.login === 'link' && (
              <div className={GRID}>
                <div className="sm:col-span-2">
                  <FormField label={t('hrms.employees.pickLogin')} error={errors.userId}>
                    <Select value={form.userId} onChange={set('userId')}>
                      <option value="">{t('hrms.employees.pickLogin')}</option>
                      {(meta?.unlinkedUsers ?? []).map((u) => <option key={u.id} value={u.id}>{`${u.name} · ${u.email}`}</option>)}
                    </Select>
                  </FormField>
                </div>
              </div>
            )}
            {form.login === 'new' && (
              <div className={GRID}>
                <div className="sm:col-span-2"><FormField label={t('hrms.employees.loginEmail')} hint={t('hrms.employees.loginEmailHint')}><Input type="email" value={form.loginEmail} onChange={set('loginEmail')} placeholder={form.email} /></FormField></div>
                <div className="sm:col-span-2">
                  <FormField label={t('hrms.employees.role')} required>
                    <Select value={form.roleId} onChange={set('roleId')}>
                      <option value="">{t('hrms.employees.pickRole')}</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </FormField>
                </div>
              </div>
            )}
          </div>
        </FormSection>
      )}

      <FormSection title={t('hrms.employees.notes')} hint={t('hrms.employees.form.notesHint')}>
        <div className="space-y-4">
          {employee && <FormField label={t('hrms.employees.changeNote')} hint={t('hrms.employees.changeNoteHint')}><Input value={form.changeNote} onChange={set('changeNote')} /></FormField>}
          <Textarea rows={2} value={form.notes} onChange={set('notes')} aria-label={t('hrms.employees.notes')} />
        </div>
      </FormSection>
    </div>
  )
}

/** Edit a staff record in a pop-up (the profile's "Edit"). Adding a staff member is a full page: pages/Hrms/NewEmployee. */
export function EmployeeEditModal({ employee, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => employeeFormValues(employee))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => updateEmployee(employee.id, employeeBody(form, { editing: true })),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={t('hrms.employees.editTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!employeeReady(form)} onClick={() => save.mutate()}>{t('hrms.employees.save')}</Button>
    </>}>
      <EmployeeForm value={form} onChange={setForm} errors={errors} employee={employee} />
    </Modal>
  )
}
