import LocalNameField, { useLocalNames } from '../localNames/LocalNameField'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Star, X } from 'lucide-react'
import { BLOOD_GROUPS, GENDERS, GUARDIAN_RELATIONS, STUDENT_CATEGORIES, tcMismatch } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Note, Select } from '../system'
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
    previousSchool: { name: '', board: '', lastClass: '', tcNo: '', tcDate: '', nameOnTc: '', dobOnTc: '', mismatchNote: '', ...s?.previousSchool },
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
/** The student's and parents' names in the school's other languages (Settings › Also keep names in); save() after the record. */
export function useStudentNames() {
  const student = useLocalNames('students')
  const parents = useLocalNames('parents')
  return { student, parents, save: async () => { await student.save(); await parents.save() } }
}

/**
 * Admission to a campus that asks for the names in the other languages too (Campuses › names … needed at admission,
 * e.g. the UP Board campus printing in Hindi): whether they are needed, and whether one is still empty — the student's
 * and every parent's whose English name is filled. Editing a student never requires them.
 */
export function useLocalNamesRule(f, names, { editing = false, publicRequired } = {}) {
  // a family's form (no sign-in) is told by the server instead of looking the campus up
  const isPublic = publicRequired !== undefined
  const campus = useCampusOf(f.sectionId, { enabled: !isPublic })
  const langs = names?.student.langs ?? []
  const required = !editing && (isPublic ? !!publicRequired : !!campus?.localNameRequired) && langs.length > 0
  const filled = (n, slot) => n.langs.every((l) => String(n.values[slot]?.[l.code] ?? '').trim())
  const missing = required && (!filled(names.student, 'student') || f.guardians.some((g, i) => g.name.trim() && !filled(names.parents, `g${i}`)))
  return { required, missing, campus, language: langs.map((l) => l.nativeName).join(', ') }
}

/** The campus of a section (its own, or the main one for a section without one) — with what it asks at admission. */
export function useCampusOf(sectionId, { enabled = true } = {}) {
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup, enabled })
  const section = lookup?.sections?.find((s) => s.id === sectionId)
  return section ? lookup?.branches?.find((b) => b.id === section.branchId) ?? (section.branchId ? null : lookup?.branches?.[0]) ?? null : null
}

/**
 * The form as the office fills it, or (`publicForm`) as a family fills it from the link the school sent: no class and
 * section, numbers or dates (the office sets those), nothing looked up behind a sign-in; `publicForm.namesRequired`
 * says whether the campus needs the names in its other languages.
 */
export default function StudentForm({ value: f, onChange, errors = {}, editing = false, aadhaarSet = false, names, publicForm }) {
  const { t } = useTranslation('students')
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup, enabled: !publicForm })
  const set = (k) => (e) => onChange({ ...f, [k]: e?.target ? e.target.value : e })
  const setIn = (group, k) => (e) => onChange({ ...f, [group]: { ...f[group], [k]: e.target.value } })
  const setG = (i, k) => (e) => onChange({ ...f, guardians: f.guardians.map((g, j) => (j === i ? { ...g, [k]: e.target.value } : g)) })
  const makePrimary = (i) => onChange({ ...f, guardians: f.guardians.map((g, j) => ({ ...g, isPrimary: j === i })) })
  const [more, setMore] = useState(editing || !!publicForm)
  const localRule = useLocalNamesRule(f, names, { editing, publicRequired: publicForm ? !!publicForm.namesRequired : undefined })
  const tc = tcMismatch(f, f.previousSchool)

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

  const remove = (i) => onChange({ ...f, guardians: f.guardians.filter((_, j) => j !== i) })
  return (
    <div className="space-y-5">
      {!publicForm && <FormSection title={t('students.form.placement')} hint={lookup?.currentYear ? t('students.form.placementHint', { year: lookup.currentYear.name }) : undefined}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
          <FormField label={t('students.form.admissionDate')} error={errors.admissionDate} hint={editing ? undefined : t('students.form.admissionDateHint')}><DateInput value={f.admissionDate} onChange={set('admissionDate')} /></FormField>
        </div>
      </FormSection>}

      <FormSection title={t('students.form.student')} hint={t('students.form.studentHint')}
        actions={!more && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setMore(true)}>{t('students.form.moreDetails')}</Button>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('students.form.firstName')} required error={errors.firstName}><Input value={f.firstName} onChange={set('firstName')} /></FormField>
          <FormField label={t('students.form.middleName')} error={errors.middleName}><Input value={f.middleName} onChange={set('middleName')} /></FormField>
          <FormField label={t('students.form.lastName')} error={errors.lastName}><Input value={f.lastName} onChange={set('lastName')} /></FormField>
          {names && <LocalNameField names={names.student} slot="student" required={localRule.required} english={[f.firstName, f.middleName, f.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')} label={t('students.form.fullName')} />}
          <FormField label={t('students.form.gender')} error={errors.gender}>
            <Select value={f.gender} onChange={set('gender')}><option value="">{t('students.notSet')}</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`students.genders.${g.value}`, g.label)}</option>)}</Select>
          </FormField>
          <FormField label={t('students.form.dob')} error={errors.dob}><DateInput value={f.dob} onChange={set('dob')} /></FormField>
          <FormField label={t('students.form.bloodGroup')} error={errors.bloodGroup}>
            <Select value={f.bloodGroup} onChange={set('bloodGroup')}><option value="">{t('students.notSet')}</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
          </FormField>
          <FormField label={t('students.form.studentMobile')} error={errors.mobile}><Input value={f.mobile} onChange={set('mobile')} inputMode="tel" placeholder={t('students.form.studentMobileHint')} /></FormField>
          <FormField label={t('students.form.studentEmail')} error={errors.email}><Input type="email" value={f.email} onChange={set('email')} /></FormField>
          {more && (
            <>
              <FormField label={t('students.form.category')} error={errors.category}>
                <Select value={f.category} onChange={set('category')}><option value="">{t('students.notSet')}</option>{STUDENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`students.categories.${c.value}`, c.label)}</option>)}</Select>
              </FormField>
              <FormField label={t('students.form.religion')} error={errors.religion}><Input value={f.religion} onChange={set('religion')} /></FormField>
              <FormField label={t('students.form.nationality')} error={errors.nationality}><Input value={f.nationality} onChange={set('nationality')} /></FormField>
              <FormField label={t('students.form.motherTongue')} error={errors.motherTongue}><Input value={f.motherTongue} onChange={set('motherTongue')} /></FormField>
              <FormField label={t('students.form.aadhaar')} error={errors.aadhaar} hint={aadhaarSet ? t('students.form.aadhaarKeep') : t('students.form.aadhaarHint')}><Input value={f.aadhaar} onChange={set('aadhaar')} inputMode="numeric" maxLength={14} placeholder={aadhaarSet ? '•••• •••• ••••' : ''} /></FormField>
              <FormField label={t('students.form.apaarId')} error={errors.apaarId}><Input value={f.apaarId} onChange={set('apaarId')} maxLength={20} /></FormField>
              <FormField label={t('students.form.pen')} error={errors.pen}><Input value={f.pen} onChange={set('pen')} maxLength={20} /></FormField>
            </>
          )}
        </div>
      </FormSection>

      <FormSection title={t('students.form.guardians')} hint={t('students.form.guardiansHint')} bodyClassName="!p-0"
        actions={<Button size="sm" variant="ghost" icon={Plus} disabled={f.guardians.length >= 6} onClick={() => onChange({ ...f, guardians: [...f.guardians, { ...blankGuardian }] })}>{t('students.form.addGuardian')}</Button>}>
        {errors.guardians && <p className="text-sm text-danger-600 px-4 pt-3">{errors.guardians}</p>}
        <div className="divide-y divide-border">
          {f.guardians.map((g, i) => (
            <div key={i} className="px-4 py-3">
              {/* who gets the family's messages, and remove — above the fields so they never sit on a row of their own */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <button type="button" onClick={() => makePrimary(i)} disabled={g.isPrimary}
                  className={g.isPrimary
                    ? 'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium text-brand-700 bg-brand-50'
                    : 'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium text-ink-muted hover:bg-black/[0.04] hover:text-ink'}>
                  <Star className={g.isPrimary ? 'w-3.5 h-3.5 fill-current' : 'w-3.5 h-3.5'} />
                  {g.isPrimary ? t('students.form.primary') : t('students.form.makePrimary')}
                </button>
                {f.guardians.length > 1 && <Button size="sm" variant="ghost" icon={X} className="-me-2" onClick={() => remove(i)}>{t('students.form.removeGuardian')}</Button>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:items-start">
                <FormField label={t('students.form.guardianName')} error={errors[`guardians.${i}.name`]}><Input value={g.name} onChange={setG(i, 'name')} /></FormField>
                {names && <LocalNameField names={names.parents} slot={`g${i}`} required={localRule.required && !!g.name.trim()} english={g.name} label={t('students.form.guardianName')} />}
                <FormField label={t('students.form.relation')}>
                  <Select value={g.relation ?? ''} onChange={setG(i, 'relation')}><option value="">{t('students.notSet')}</option>{GUARDIAN_RELATIONS.map((r) => <option key={r.value} value={r.value}>{t(`students.relations.${r.value}`, r.label)}</option>)}</Select>
                </FormField>
                <FormField label={t('students.form.mobile')} error={errors[`guardians.${i}.mobile`]}><Input value={g.mobile ?? ''} onChange={setG(i, 'mobile')} inputMode="tel" placeholder="98450 12345" /></FormField>
                <FormField label={t('students.form.email')} error={errors[`guardians.${i}.email`]}><Input type="email" value={g.email ?? ''} onChange={setG(i, 'email')} /></FormField>
                <FormField label={t('students.form.occupation')}><Input value={g.occupation ?? ''} onChange={setG(i, 'occupation')} /></FormField>
              </div>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title={t('students.form.addressOnly')} hint={t('students.form.addressHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="sm:col-span-2 xl:col-span-4"><FormField label={t('students.form.addressLine')}><Input value={f.address.line} onChange={setIn('address', 'line')} /></FormField></div>
          <FormField label={t('students.form.city')}><Input value={f.address.city} onChange={setIn('address', 'city')} /></FormField>
          <FormField label={t('students.form.state')}><Input value={f.address.state} onChange={setIn('address', 'state')} /></FormField>
          <FormField label={t('students.form.pincode')}><Input value={f.address.pincode} onChange={setIn('address', 'pincode')} inputMode="numeric" maxLength={10} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('students.form.previousSchool')} hint={t('students.form.previousSchoolHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3"><FormField label={t('students.form.schoolName')}><Input value={f.previousSchool.name} onChange={setIn('previousSchool', 'name')} /></FormField></div>
          <FormField label={t('students.form.board')}><Input value={f.previousSchool.board} onChange={setIn('previousSchool', 'board')} placeholder="CBSE" /></FormField>
          <FormField label={t('students.form.lastClass')}><Input value={f.previousSchool.lastClass} onChange={setIn('previousSchool', 'lastClass')} /></FormField>
          <FormField label={t('students.form.tcNo')}><Input value={f.previousSchool.tcNo} onChange={setIn('previousSchool', 'tcNo')} /></FormField>
          <FormField label={t('students.form.tcDate')}><DateInput value={f.previousSchool.tcDate} onChange={(v) => onChange({ ...f, previousSchool: { ...f.previousSchool, tcDate: v?.target ? v.target.value : v } })} /></FormField>
          <FormField label={t('students.form.nameOnTc')} hint={t('students.form.nameOnTcHint')}><Input value={f.previousSchool.nameOnTc} onChange={setIn('previousSchool', 'nameOnTc')} /></FormField>
          <FormField label={t('students.form.dobOnTc')}><DateInput value={f.previousSchool.dobOnTc} onChange={(v) => onChange({ ...f, previousSchool: { ...f.previousSchool, dobOnTc: v?.target ? v.target.value : v } })} /></FormField>
        </div>
        {/* the TC must agree with the student: a difference is shown, and saved only with the reason */}
        {tc.any && (
          <div className="mt-4 space-y-3">
            <Note tone="warning">
              {[tc.name && t('students.form.tcNameDiffers', { tc: f.previousSchool.nameOnTc, name: [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ') }),
                tc.dob && t('students.form.tcDobDiffers')].filter(Boolean).join(' ')}
            </Note>
            {!publicForm && (
              <FormField label={t('students.form.mismatchNote')} required error={errors['previousSchool.mismatchNote']} hint={t('students.form.mismatchNoteHint')}>
                <Input value={f.previousSchool.mismatchNote} onChange={setIn('previousSchool', 'mismatchNote')} maxLength={300} />
              </FormField>
            )}
          </div>
        )}
      </FormSection>
      <FormSection title={t('students.form.medical')} hint={t('students.form.medicalHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('students.form.allergies')}><Input value={f.medical.allergies} onChange={setIn('medical', 'allergies')} /></FormField>
          <FormField label={t('students.form.conditions')}><Input value={f.medical.conditions} onChange={setIn('medical', 'conditions')} /></FormField>
          <div className="sm:col-span-2"><FormField label={t('students.form.medicalNotes')}><Input value={f.medical.notes} onChange={setIn('medical', 'notes')} /></FormField></div>
        </div>
      </FormSection>
    </div>
  )
}
