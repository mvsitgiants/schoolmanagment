import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Star, X } from 'lucide-react'
import { BLOOD_GROUPS, GENDERS, GUARDIAN_RELATIONS, STUDENT_CATEGORIES } from '@schoolgiant/shared'
import { FormField, Input, Panel, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchAcademicLookup } from '../../api/academics'

const blankGuardian = { name: '', relation: '', mobile: '', email: '', occupation: '', isPrimary: false }

/** The form's starting values from a student (edit) or blank (admit). */
export function studentFormValues(s) {
  return {
    sectionId: s?.sectionId ?? '', admissionNo: s?.admissionNo ?? '', admissionDate: s?.admissionDate ?? '', rollNo: s?.rollNo ?? '',
    firstName: s?.firstName ?? '', middleName: s?.middleName ?? '', lastName: s?.lastName ?? '', gender: s?.gender ?? '', dob: s?.dob ?? '',
    bloodGroup: s?.bloodGroup ?? '', category: s?.category ?? '', religion: s?.religion ?? '', nationality: s?.nationality ?? 'Indian', motherTongue: s?.motherTongue ?? '',
    aadhaar: '', apaarId: s?.apaarId ?? '', pen: s?.pen ?? '', mobile: s?.mobile ?? '', email: s?.email ?? '',
    address: { line: '', city: '', state: '', pincode: '', ...s?.address },
    guardians: s?.guardians?.length ? s.guardians.map((g) => ({ ...blankGuardian, ...g })) : [{ ...blankGuardian, relation: 'FATHER', isPrimary: true }, { ...blankGuardian, relation: 'MOTHER' }],
    previousSchool: { name: '', board: '', lastClass: '', tcNo: '', ...s?.previousSchool },
    medical: { allergies: '', conditions: '', notes: '', ...s?.medical },
  }
}

/** What the API takes from the form: blank guardians dropped, Aadhaar only when typed. */
export function studentBody(f, { editing = false } = {}) {
  const { aadhaar, guardians, ...rest } = f
  return {
    ...rest,
    guardians: guardians.filter((g) => g.name.trim()).map(({ _id, id, ...g }) => g),
    ...(aadhaar.trim() || !editing ? { aadhaar: aadhaar.trim() || undefined } : {}),
    ...(editing && { admissionNo: undefined }),
  }
}

/**
 * Admission and edit form for a student. Controlled: `value` + `onChange(next)`. `errors` are the
 * API's field errors (`guardians.0.name` style). `editing` hides the admission number (fixed once given).
 */
export default function StudentForm({ value: f, onChange, errors = {}, editing = false, aadhaarSet = false }) {
  const { t } = useTranslation('students')
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const set = (k) => (e) => onChange({ ...f, [k]: e?.target ? e.target.value : e })
  const setIn = (group, k) => (e) => onChange({ ...f, [group]: { ...f[group], [k]: e.target.value } })
  const setG = (i, k) => (e) => onChange({ ...f, guardians: f.guardians.map((g, j) => (j === i ? { ...g, [k]: e.target.value } : g)) })
  const makePrimary = (i) => onChange({ ...f, guardians: f.guardians.map((g, j) => ({ ...g, isPrimary: j === i })) })
  const [more, setMore] = useState(editing)

  // sections of the current year, grouped by class
  const groups = useMemo(() => {
    const byClass = new Map()
    for (const s of lookup?.sections ?? []) {
      const c = lookup.classes.find((x) => x.id === s.classId)
      if (!byClass.has(s.classId)) byClass.set(s.classId, { name: c?.name ?? '', items: [] })
      byClass.get(s.classId).items.push(s)
    }
    return [...byClass.values()]
  }, [lookup])

  return (
    <div className="space-y-6">
      <Panel title={t('students.form.placement')} subtitle={lookup?.currentYear ? t('students.form.placementHint', { year: lookup.currentYear.name }) : undefined}>
        <div className="grid sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <FormField label={t('students.form.section')} required error={errors.sectionId}>
              <Select value={f.sectionId} onChange={set('sectionId')}>
                <option value="">{t('students.form.pickSection')}</option>
                {groups.map((g) => <optgroup key={g.name} label={g.name}>{g.items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>)}
              </Select>
            </FormField>
            {!groups.length && <p className="text-xs text-ink-muted mt-1">{t('students.form.noSections')}</p>}
          </div>
          <FormField label={t('students.form.rollNo')} error={errors.rollNo}><Input value={f.rollNo} onChange={set('rollNo')} maxLength={10} /></FormField>
          {!editing && <FormField label={t('students.form.admissionNo')} error={errors.admissionNo} hint={t('students.form.admissionNoHint')}><Input value={f.admissionNo} onChange={set('admissionNo')} maxLength={30} /></FormField>}
          <FormField label={t('students.form.admissionDate')} error={errors.admissionDate} hint={editing ? undefined : t('students.form.admissionDateHint')}><Input type="date" value={f.admissionDate} onChange={set('admissionDate')} /></FormField>
        </div>
      </Panel>

      <Panel title={t('students.form.student')}>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('students.form.firstName')} required error={errors.firstName}><Input value={f.firstName} onChange={set('firstName')} /></FormField>
          <FormField label={t('students.form.middleName')} error={errors.middleName}><Input value={f.middleName} onChange={set('middleName')} /></FormField>
          <FormField label={t('students.form.lastName')} error={errors.lastName}><Input value={f.lastName} onChange={set('lastName')} /></FormField>
          <FormField label={t('students.form.gender')} error={errors.gender}>
            <Select value={f.gender} onChange={set('gender')}><option value="">{t('students.notSet')}</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`students.genders.${g.value}`, g.label)}</option>)}</Select>
          </FormField>
          <FormField label={t('students.form.dob')} error={errors.dob}><Input type="date" value={f.dob} onChange={set('dob')} /></FormField>
          <FormField label={t('students.form.bloodGroup')} error={errors.bloodGroup}>
            <Select value={f.bloodGroup} onChange={set('bloodGroup')}><option value="">{t('students.notSet')}</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
          </FormField>
        </div>
        {more ? (
          <div className="grid sm:grid-cols-4 gap-4 mt-4">
            <FormField label={t('students.form.category')} error={errors.category}>
              <Select value={f.category} onChange={set('category')}><option value="">{t('students.notSet')}</option>{STUDENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`students.categories.${c.value}`, c.label)}</option>)}</Select>
            </FormField>
            <FormField label={t('students.form.religion')} error={errors.religion}><Input value={f.religion} onChange={set('religion')} /></FormField>
            <FormField label={t('students.form.nationality')} error={errors.nationality}><Input value={f.nationality} onChange={set('nationality')} /></FormField>
            <FormField label={t('students.form.motherTongue')} error={errors.motherTongue}><Input value={f.motherTongue} onChange={set('motherTongue')} /></FormField>
            <FormField label={t('students.form.aadhaar')} error={errors.aadhaar} hint={aadhaarSet ? t('students.form.aadhaarKeep') : t('students.form.aadhaarHint')}><Input value={f.aadhaar} onChange={set('aadhaar')} inputMode="numeric" maxLength={14} placeholder={aadhaarSet ? '•••• •••• ••••' : ''} /></FormField>
            <FormField label={t('students.form.apaarId')} error={errors.apaarId}><Input value={f.apaarId} onChange={set('apaarId')} maxLength={20} /></FormField>
            <FormField label={t('students.form.pen')} error={errors.pen}><Input value={f.pen} onChange={set('pen')} maxLength={20} /></FormField>
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="mt-3 text-sm text-brand-600 hover:underline">{t('students.form.moreDetails')}</button>
        )}
      </Panel>

      <Panel title={t('students.form.guardians')} subtitle={t('students.form.guardiansHint')}
        actions={<Button size="sm" variant="ghost" icon={Plus} disabled={f.guardians.length >= 6} onClick={() => onChange({ ...f, guardians: [...f.guardians, { ...blankGuardian }] })}>{t('students.form.addGuardian')}</Button>}>
        {errors.guardians && <p className="text-sm text-danger-600 mb-3">{errors.guardians}</p>}
        <div className="space-y-4">
          {f.guardians.map((g, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="grid sm:grid-cols-[1.4fr_1fr_1fr_1.2fr] gap-3">
                <FormField label={t('students.form.guardianName')} error={errors[`guardians.${i}.name`]}><Input value={g.name} onChange={setG(i, 'name')} /></FormField>
                <FormField label={t('students.form.relation')}>
                  <Select value={g.relation ?? ''} onChange={setG(i, 'relation')}><option value="">{t('students.notSet')}</option>{GUARDIAN_RELATIONS.map((r) => <option key={r.value} value={r.value}>{t(`students.relations.${r.value}`, r.label)}</option>)}</Select>
                </FormField>
                <FormField label={t('students.form.mobile')} error={errors[`guardians.${i}.mobile`]}><Input value={g.mobile ?? ''} onChange={setG(i, 'mobile')} inputMode="tel" placeholder="98450 12345" /></FormField>
                <FormField label={t('students.form.email')} error={errors[`guardians.${i}.email`]}><Input type="email" value={g.email ?? ''} onChange={setG(i, 'email')} /></FormField>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                <div className="w-full sm:w-64"><Input value={g.occupation ?? ''} onChange={setG(i, 'occupation')} placeholder={t('students.form.occupation')} aria-label={t('students.form.occupation')} /></div>
                <div className="flex items-center gap-1">
                  {g.isPrimary
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-2 py-0.5"><Star className="w-3 h-3" />{t('students.form.primary')}</span>
                    : <Button size="sm" variant="ghost" icon={Star} onClick={() => makePrimary(i)}>{t('students.form.makePrimary')}</Button>}
                  {f.guardians.length > 1 && <Button size="sm" variant="ghost" icon={X} aria-label={t('students.form.removeGuardian')} title={t('students.form.removeGuardian')} onClick={() => onChange({ ...f, guardians: f.guardians.filter((_, j) => j !== i) })} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={t('students.form.contact')}>
        <div className="grid sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2"><FormField label={t('students.form.addressLine')}><Input value={f.address.line} onChange={setIn('address', 'line')} /></FormField></div>
          <FormField label={t('students.form.city')}><Input value={f.address.city} onChange={setIn('address', 'city')} /></FormField>
          <FormField label={t('students.form.pincode')}><Input value={f.address.pincode} onChange={setIn('address', 'pincode')} inputMode="numeric" maxLength={10} /></FormField>
          <FormField label={t('students.form.state')}><Input value={f.address.state} onChange={setIn('address', 'state')} /></FormField>
          <FormField label={t('students.form.studentMobile')} error={errors.mobile} hint={t('students.form.studentMobileHint')}><Input value={f.mobile} onChange={set('mobile')} inputMode="tel" /></FormField>
          <FormField label={t('students.form.studentEmail')} error={errors.email}><Input type="email" value={f.email} onChange={set('email')} /></FormField>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title={t('students.form.previousSchool')}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><FormField label={t('students.form.schoolName')}><Input value={f.previousSchool.name} onChange={setIn('previousSchool', 'name')} /></FormField></div>
            <FormField label={t('students.form.board')}><Input value={f.previousSchool.board} onChange={setIn('previousSchool', 'board')} placeholder="CBSE" /></FormField>
            <FormField label={t('students.form.lastClass')}><Input value={f.previousSchool.lastClass} onChange={setIn('previousSchool', 'lastClass')} /></FormField>
            <FormField label={t('students.form.tcNo')}><Input value={f.previousSchool.tcNo} onChange={setIn('previousSchool', 'tcNo')} /></FormField>
          </div>
        </Panel>
        <Panel title={t('students.form.medical')}>
          <div className="grid gap-4">
            <FormField label={t('students.form.allergies')}><Input value={f.medical.allergies} onChange={setIn('medical', 'allergies')} /></FormField>
            <FormField label={t('students.form.conditions')}><Input value={f.medical.conditions} onChange={setIn('medical', 'conditions')} /></FormField>
            <FormField label={t('students.form.medicalNotes')}><Textarea rows={2} value={f.medical.notes} onChange={setIn('medical', 'notes')} /></FormField>
          </div>
        </Panel>
      </div>
    </div>
  )
}
