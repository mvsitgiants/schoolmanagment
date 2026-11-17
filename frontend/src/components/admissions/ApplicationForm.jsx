import { useTranslation } from 'react-i18next'
import { BLOOD_GROUPS, GENDERS, GUARDIAN_RELATIONS, STUDENT_CATEGORIES, tcMismatch } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Note, Select } from '../system'
import FormRenderer from '../forms/FormRenderer'
import LocalNameField from '../localNames/LocalNameField'

export const emptyApplication = (cycle) => ({
  cycleId: cycle?.id ?? '', classId: '',
  child: {
    firstName: '', middleName: '', lastName: '', dob: '', gender: '', bloodGroup: '', category: '', religion: '', nationality: 'Indian', motherTongue: '', aadhaar: '',
    previousSchool: { name: '', board: '', lastClass: '', tcNo: '', tcDate: '', nameOnTc: '', dobOnTc: '' },
  },
  parent: { name: '', relation: 'MOTHER', mobile: '', email: '', occupation: '' },
  otherParent: { name: '', relation: 'FATHER', mobile: '' },
  address: { line: '', city: '', state: '', pincode: '' },
  medical: { allergies: '', conditions: '', notes: '' },
  answers: {},
})

const childName = (c) => [c?.firstName, c?.middleName, c?.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')

/** The names typed in other languages, for the API: { child: { hi }, parent: { hi }, otherParent: { hi } } (none = undefined). */
export function applicationLocalNames(names) {
  if (!names?.langs?.length) return undefined
  const out = {}
  for (const slot of ['child', 'parent', 'otherParent']) {
    const v = Object.fromEntries(Object.entries(names.values[slot] ?? {}).filter(([, x]) => String(x ?? '').trim()))
    if (Object.keys(v).length) out[slot] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Are the names in other languages filled for the child and each parent named (when the school needs them)? */
export function applicationNamesMissing(v, names, required) {
  if (!required || !names?.langs?.length) return false
  const filled = (slot) => names.langs.every((l) => String(names.values[slot]?.[l.code] ?? '').trim())
  return !filled('child') || (v.parent.name.trim() && !filled('parent')) || (v.otherParent?.name?.trim() && !filled('otherParent'))
}

/**
 * The application in the shape of New admission's form, so the same review (AdmissionReview) reads it back:
 * the child's fields at the top, the parents as guardians, and names under the slots the review looks for.
 */
export function applicationAsStudent(v, names) {
  const form = {
    ...v.child, previousSchool: v.child.previousSchool, address: v.address, medical: v.medical,
    guardians: [{ ...v.parent, isPrimary: true }, ...(v.otherParent?.name ? [{ ...v.otherParent }] : [])],
  }
  const view = names?.langs?.length ? {
    student: { langs: names.langs, values: { student: names.values.child } },
    parents: { langs: names.langs, values: { g0: names.values.parent, g1: names.values.otherParent } },
  } : null
  return { form, names: view }
}

/** A body the API takes: empty strings left out (blank optional fields). */
export function applicationBody(v) {
  const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, x]) => x !== '' && x !== undefined && x !== null).map(([k, x]) => [k, typeof x === 'object' && !Array.isArray(x) ? strip(x) : x]))
  return strip(v)
}

const GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'

/**
 * The application: the cycle and class, the child, the parents, the address and the cycle's extra questions —
 * each a FormSection card. Used on the admission desk's New application page and on the public application page.
 * `cycles` carry their classes and extra form.
 */
/**
 * `names`: the boxes for the names in the school's other languages (usePlainLocalNames, slots child · parent ·
 * otherParent); `namesRequired`: they must be filled.
 */
export default function ApplicationForm({ cycles = [], value, onChange, errors = {}, lockMobile = false, names, namesRequired = false }) {
  const { t } = useTranslation('admissions')
  const cycle = cycles.find((c) => c.id === value.cycleId) ?? null
  const set = (path, v) => {
    const [a, b, c] = path.split('.')
    if (!b) onChange({ ...value, [a]: v })
    else if (!c) onChange({ ...value, [a]: { ...value[a], [b]: v } })
    else onChange({ ...value, [a]: { ...value[a], [b]: { ...value[a][b], [c]: v } } })
  }
  const field = (path) => ({ value: path.split('.').reduce((o, k) => o?.[k], value) ?? '', onChange: (e) => set(path, e.target.value) })
  const err = (path) => errors[path]
  const tc = tcMismatch(value.child, value.child.previousSchool)
  const ln = (slot, english, label, required) => names?.langs?.length ? <LocalNameField names={names} slot={slot} english={english} label={label} required={namesRequired && required} /> : null
  const relation = (path) => (
    <Select {...field(path)}>{GUARDIAN_RELATIONS.map((r) => <option key={r.value} value={r.value}>{t(`admissions.relations.${r.value}`, r.label)}</option>)}</Select>
  )
  return (
    <div className="space-y-5">
      <FormSection title={t('admissions.form.sections.place')} hint={cycle ? t('admissions.form.sections.placeHintCycle', { cycle: cycle.name }) : t('admissions.form.sections.placeHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cycles.length > 1 && (
            <FormField label={t('admissions.form.cycle')} required error={err('cycleId')}>
              <Select value={value.cycleId} onChange={(e) => onChange({ ...value, cycleId: e.target.value, classId: '', answers: {} })}>
                <option value="">{t('admissions.form.pick')}</option>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
          )}
          <FormField label={t('admissions.form.class')} required error={err('classId')}>
            <Select value={value.classId} onChange={(e) => set('classId', e.target.value)}>
              <option value="">{t('admissions.form.pick')}</option>
              {(cycle?.classes ?? []).map((c) => <option key={c.classId} value={c.classId}>{c.className}{c.minAge || c.maxAge ? ` (${t('admissions.form.ages', { min: c.minAge ?? 0, max: c.maxAge ?? '…' })})` : ''}</option>)}
            </Select>
          </FormField>
        </div>
      </FormSection>

      <FormSection title={t('admissions.form.child')} hint={t('admissions.form.sections.childHint')}>
        <div className={GRID}>
          <FormField label={t('admissions.form.firstName')} required error={err('child.firstName')}><Input {...field('child.firstName')} /></FormField>
          <FormField label={t('admissions.form.middleName')} error={err('child.middleName')}><Input {...field('child.middleName')} /></FormField>
          <FormField label={t('admissions.form.lastName')} error={err('child.lastName')}><Input {...field('child.lastName')} /></FormField>
          {ln('child', childName(value.child), t('admissions.form.childFullName'), true)}
          <FormField label={t('admissions.form.dob')} required error={err('child.dob')}><DateInput {...field('child.dob')} /></FormField>
          <FormField label={t('admissions.form.gender')} required error={err('child.gender')}>
            <Select {...field('child.gender')}><option value="">{t('admissions.form.pick')}</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`admissions.genders.${g.value}`, g.label)}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.form.bloodGroup')} error={err('child.bloodGroup')}>
            <Select {...field('child.bloodGroup')}><option value="">—</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.form.category')} error={err('child.category')}>
            <Select {...field('child.category')}><option value="">—</option>{STUDENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`students:students.categories.${c.value}`, c.label)}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.form.religion')} error={err('child.religion')}><Input {...field('child.religion')} /></FormField>
          <FormField label={t('admissions.form.nationality')} error={err('child.nationality')}><Input {...field('child.nationality')} /></FormField>
          <FormField label={t('admissions.form.motherTongue')} error={err('child.motherTongue')}><Input {...field('child.motherTongue')} /></FormField>
          <FormField label={t('admissions.form.aadhaar')} error={err('child.aadhaar')} hint={t('admissions.form.aadhaarHint')}><Input inputMode="numeric" maxLength={14} {...field('child.aadhaar')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('admissions.form.sections.school')} hint={t('admissions.form.sections.schoolHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('admissions.form.schoolName')} error={err('child.previousSchool.name')}><Input {...field('child.previousSchool.name')} /></FormField></div>
          <FormField label={t('admissions.form.board')} error={err('child.previousSchool.board')}><Input {...field('child.previousSchool.board')} placeholder={t('admissions.form.boardExample')} /></FormField>
          <FormField label={t('admissions.form.lastClass')} error={err('child.previousSchool.lastClass')}><Input {...field('child.previousSchool.lastClass')} /></FormField>
          <FormField label={t('admissions.form.tcNo')} error={err('child.previousSchool.tcNo')}><Input {...field('child.previousSchool.tcNo')} /></FormField>
          <FormField label={t('admissions.form.tcDate')} error={err('child.previousSchool.tcDate')}><DateInput {...field('child.previousSchool.tcDate')} /></FormField>
          <FormField label={t('admissions.form.nameOnTc')} hint={t('admissions.form.nameOnTcHint')} error={err('child.previousSchool.nameOnTc')}><Input {...field('child.previousSchool.nameOnTc')} /></FormField>
          <FormField label={t('admissions.form.dobOnTc')} error={err('child.previousSchool.dobOnTc')}><DateInput {...field('child.previousSchool.dobOnTc')} /></FormField>
        </div>
        {tc.any && (
          <Note tone="warning" className="mt-4">
            {[tc.name && t('admissions.form.tcNameDiffers', { tc: value.child.previousSchool.nameOnTc, name: childName(value.child) }), tc.dob && t('admissions.form.tcDobDiffers')].filter(Boolean).join(' ')}
          </Note>
        )}
      </FormSection>

      <FormSection title={t('admissions.form.parent')} hint={t('admissions.form.sections.parentHint')}>
        <div className="space-y-4">
          <div className={GRID}>
            <div className="sm:col-span-2"><FormField label={t('admissions.form.parentName')} required error={err('parent.name')}><Input {...field('parent.name')} /></FormField></div>
            {names?.langs?.length > 0 && <div className="sm:col-span-2">{ln('parent', value.parent.name, t('admissions.form.parentName'), true)}</div>}
            <FormField label={t('admissions.form.relation')} error={err('parent.relation')}>{relation('parent.relation')}</FormField>
            <FormField label={t('admissions.form.mobile')} required error={err('parent.mobile')} hint={lockMobile ? t('admissions.form.mobileVerified') : undefined}><Input inputMode="numeric" disabled={lockMobile} {...field('parent.mobile')} /></FormField>
            <div className="sm:col-span-2"><FormField label={t('admissions.form.email')} error={err('parent.email')}><Input type="email" {...field('parent.email')} /></FormField></div>
            <FormField label={t('admissions.form.occupation')} error={err('parent.occupation')}><Input {...field('parent.occupation')} /></FormField>
          </div>
          <div className={`${GRID} border-t border-border pt-4`}>
            <div className="sm:col-span-2"><FormField label={t('admissions.form.otherParent')} error={err('otherParent.name')}><Input {...field('otherParent.name')} /></FormField></div>
            {names?.langs?.length > 0 && <div className="sm:col-span-2">{ln('otherParent', value.otherParent?.name, t('admissions.form.otherParent'), !!value.otherParent?.name?.trim())}</div>}
            <FormField label={t('admissions.form.relation')} error={err('otherParent.relation')}>{relation('otherParent.relation')}</FormField>
            <FormField label={t('admissions.form.mobile')} error={err('otherParent.mobile')}><Input inputMode="numeric" {...field('otherParent.mobile')} /></FormField>
          </div>
        </div>
      </FormSection>

      <FormSection title={t('admissions.form.address')} hint={t('admissions.form.sections.addressHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('admissions.form.addressLine')} error={err('address.line')}><Input {...field('address.line')} /></FormField></div>
          <FormField label={t('admissions.form.city')} error={err('address.city')}><Input {...field('address.city')} /></FormField>
          <FormField label={t('admissions.form.state')} error={err('address.state')}><Input {...field('address.state')} /></FormField>
          <FormField label={t('admissions.form.pincode')} error={err('address.pincode')}><Input inputMode="numeric" {...field('address.pincode')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('admissions.form.sections.health')} hint={t('admissions.form.sections.healthHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('admissions.form.allergies')} error={err('medical.allergies')}><Input {...field('medical.allergies')} /></FormField>
          <FormField label={t('admissions.form.conditions')} error={err('medical.conditions')}><Input {...field('medical.conditions')} /></FormField>
          <div className="sm:col-span-2"><FormField label={t('admissions.form.medicalNotes')} error={err('medical.notes')}><Input {...field('medical.notes')} /></FormField></div>
        </div>
      </FormSection>

      {cycle?.form?.definition && (
        <FormSection title={cycle.form.name} hint={t('admissions.form.sections.extraHint')}>
          <FormRenderer definition={cycle.form.definition} values={value.answers ?? {}} onChange={(answers) => onChange({ ...value, answers })}
            errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('answers.')).map(([k, v]) => [k.slice(8), v]))} />
        </FormSection>
      )}
    </div>
  )
}
