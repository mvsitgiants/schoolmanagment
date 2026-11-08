import { useTranslation } from 'react-i18next'
import { BLOOD_GROUPS, GENDERS, GUARDIAN_RELATIONS } from '@schoolgiant/shared'
import { FormField, Input, Select } from '../system'
import FormRenderer from '../forms/FormRenderer'

export const emptyApplication = (cycle) => ({
  cycleId: cycle?.id ?? '', classId: '',
  child: { firstName: '', middleName: '', lastName: '', dob: '', gender: '', bloodGroup: '', previousSchool: { name: '', board: '', lastClass: '' } },
  parent: { name: '', relation: 'MOTHER', mobile: '', email: '', occupation: '' },
  otherParent: { name: '', relation: 'FATHER', mobile: '' },
  address: { line: '', city: '', state: '', pincode: '' },
  answers: {},
})

/** A body the API takes: empty strings left out (blank optional fields). */
export function applicationBody(v) {
  const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, x]) => x !== '' && x !== undefined && x !== null).map(([k, x]) => [k, typeof x === 'object' && !Array.isArray(x) ? strip(x) : x]))
  return strip(v)
}

/**
 * The application: the cycle and class, the child, the parents, the address and the cycle's extra questions.
 * Used at the admission desk and on the public application page. `cycles` carry their classes and extra form.
 */
export default function ApplicationForm({ cycles = [], value, onChange, errors = {}, lockMobile = false }) {
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
  const relation = (path) => (
    <Select {...field(path)}>{GUARDIAN_RELATIONS.map((r) => <option key={r.value} value={r.value}>{t(`admissions.relations.${r.value}`, r.label)}</option>)}</Select>
  )
  return (
    <div className="space-y-6">
      <section className="grid sm:grid-cols-2 gap-4">
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
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-3">{t('admissions.form.child')}</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('admissions.form.firstName')} required error={err('child.firstName')}><Input {...field('child.firstName')} /></FormField>
          <FormField label={t('admissions.form.middleName')}><Input {...field('child.middleName')} /></FormField>
          <FormField label={t('admissions.form.lastName')}><Input {...field('child.lastName')} /></FormField>
          <FormField label={t('admissions.form.dob')} required error={err('child.dob')}><Input type="date" {...field('child.dob')} /></FormField>
          <FormField label={t('admissions.form.gender')} required error={err('child.gender')}>
            <Select {...field('child.gender')}><option value="">{t('admissions.form.pick')}</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`admissions.genders.${g.value}`, g.label)}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.form.bloodGroup')}>
            <Select {...field('child.bloodGroup')}><option value="">—</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
          </FormField>
          <FormField label={t('admissions.form.previousSchool')}><Input {...field('child.previousSchool.name')} /></FormField>
          <FormField label={t('admissions.form.board')}><Input {...field('child.previousSchool.board')} placeholder="CBSE / ICSE / State" /></FormField>
          <FormField label={t('admissions.form.lastClass')}><Input {...field('child.previousSchool.lastClass')} /></FormField>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-3">{t('admissions.form.parent')}</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('admissions.form.parentName')} required error={err('parent.name')}><Input {...field('parent.name')} /></FormField>
          <FormField label={t('admissions.form.relation')}>{relation('parent.relation')}</FormField>
          <FormField label={t('admissions.form.mobile')} required error={err('parent.mobile')} hint={lockMobile ? t('admissions.form.mobileVerified') : undefined}><Input inputMode="numeric" disabled={lockMobile} {...field('parent.mobile')} /></FormField>
          <FormField label={t('admissions.form.email')}><Input type="email" {...field('parent.email')} /></FormField>
          <FormField label={t('admissions.form.occupation')}><Input {...field('parent.occupation')} /></FormField>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <FormField label={t('admissions.form.otherParent')}><Input {...field('otherParent.name')} /></FormField>
          <FormField label={t('admissions.form.relation')}>{relation('otherParent.relation')}</FormField>
          <FormField label={t('admissions.form.mobile')}><Input inputMode="numeric" {...field('otherParent.mobile')} /></FormField>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-3">{t('admissions.form.address')}</h3>
        <div className="grid sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2"><FormField label={t('admissions.form.addressLine')}><Input {...field('address.line')} /></FormField></div>
          <FormField label={t('admissions.form.city')}><Input {...field('address.city')} /></FormField>
          <FormField label={t('admissions.form.pincode')}><Input inputMode="numeric" {...field('address.pincode')} /></FormField>
        </div>
      </section>

      {cycle?.form?.definition && (
        <section>
          <h3 className="text-sm font-semibold text-ink mb-3">{cycle.form.name}</h3>
          <FormRenderer definition={cycle.form.definition} values={value.answers ?? {}} onChange={(answers) => onChange({ ...value, answers })}
            errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('answers.')).map(([k, v]) => [k.slice(8), v]))} />
        </section>
      )}
    </div>
  )
}
