import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { GENDERS, GUARDIAN_RELATIONS, STUDENT_CATEGORIES, tcMismatch } from '@schoolgiant/shared'
import { Note, Panel } from '../system'
import Button from '../ui/Button'
import AdmissionDocuments, { missingNow } from './AdmissionDocuments'
import { useFormat } from '../../context/SettingsContext'

// The whole admission read back before it is saved (New admission) or sent (a family's form): what will be kept,
// in plain sentences, with what is still missing pointed out. "Change" goes back to the form.

function Rows({ rows }) {
  const shown = rows.filter(([, v]) => v != null && String(v).trim() !== '')
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="text-ink min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AdmissionReview({ form: f, names, placement, documents, checklist = [], onEdit, family = false }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const label = (list, v, ns) => (v ? t(`students.${ns}.${v}`, list.find((x) => x.value === v)?.label ?? v) : null)
  const localOf = (n, slot) => (n?.langs ?? []).map((l) => n.values?.[slot]?.[l.code]?.trim()).filter(Boolean).join(' · ')
  const fullName = [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ')
  const tc = tcMismatch(f, f.previousSchool)
  const ps = f.previousSchool ?? {}
  const guardians = f.guardians.map((g, i) => ({ ...g, i })).filter((g) => g.name?.trim())
  const missing = missingNow(checklist, documents ?? [])
  const edit = onEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>{t('students.review.change')}</Button>

  return (
    <div className="space-y-5">
      <Note>{family ? t('students.review.familyIntro') : t('students.review.intro')}</Note>
      <Panel title={t('students.form.student')} actions={edit}>
        <Rows rows={[
          [t('students.review.name'), fullName],
          [t('students.review.localName'), localOf(names?.student, 'student')],
          ...(placement ? [[t('students.form.section'), placement]] : []),
          ...(!family ? [[t('students.form.admissionNo'), f.admissionNo || t('students.review.autoNumber')], [t('students.form.rollNo'), f.rollNo], [t('students.form.admissionDate'), f.admissionDate ? date(f.admissionDate) : t('students.review.today')]] : []),
          [t('students.form.gender'), label(GENDERS, f.gender, 'genders')],
          [t('students.form.dob'), f.dob ? date(f.dob) : null],
          [t('students.form.bloodGroup'), f.bloodGroup],
          [t('students.form.category'), label(STUDENT_CATEGORIES, f.category, 'categories')],
          [t('students.form.religion'), f.religion], [t('students.form.nationality'), f.nationality], [t('students.form.motherTongue'), f.motherTongue],
          [t('students.form.aadhaar'), f.aadhaar ? `•••• •••• ${String(f.aadhaar).replace(/\D/g, '').slice(-4)}` : null],
          [t('students.form.apaarId'), f.apaarId], [t('students.form.pen'), f.pen],
          [t('students.form.studentMobile'), f.mobile], [t('students.form.studentEmail'), f.email],
        ]} />
      </Panel>

      <Panel title={t('students.form.guardians')} actions={edit}>
        {guardians.length ? (
          <div className="space-y-4">
            {guardians.map((g) => (
              <div key={g.i}>
                <p className="text-sm font-medium text-ink mb-1.5">
                  {g.name}{g.isPrimary ? <span className="ms-2 text-xs font-normal text-brand-700">· {t('students.form.primary')}</span> : null}
                </p>
                <Rows rows={[
                  [t('students.review.localName'), localOf(names?.parents, `g${g.i}`)],
                  [t('students.form.relation'), label(GUARDIAN_RELATIONS, g.relation, 'relations')],
                  [t('students.form.mobile'), g.mobile], [t('students.form.email'), g.email], [t('students.form.occupation'), g.occupation],
                ]} />
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-danger-600">{t('students.review.noGuardian')}</p>}
      </Panel>

      {(f.address?.line || f.address?.city || ps.name || f.medical?.allergies || f.medical?.conditions || f.medical?.notes) && (
        <Panel title={t('students.review.more')} actions={edit}>
          <Rows rows={[
            [t('students.form.addressOnly'), [f.address?.line, f.address?.city, f.address?.state, f.address?.pincode].filter(Boolean).join(', ')],
            [t('students.form.previousSchool'), [ps.name, ps.board, ps.lastClass].filter(Boolean).join(' · ')],
            [t('students.form.tcNo'), [ps.tcNo, ps.tcDate ? date(ps.tcDate) : null].filter(Boolean).join(' · ')],
            [t('students.form.nameOnTc'), ps.nameOnTc], [t('students.form.dobOnTc'), ps.dobOnTc ? date(ps.dobOnTc) : null],
            [t('students.form.mismatchNote'), tc.any ? ps.mismatchNote : null],
            [t('students.form.allergies'), f.medical?.allergies], [t('students.form.conditions'), f.medical?.conditions], [t('students.form.medicalNotes'), f.medical?.notes],
          ]} />
          {tc.any && (
            <Note tone="warning" className="mt-3">
              {[tc.name && t('students.form.tcNameDiffers', { tc: ps.nameOnTc, name: fullName }), tc.dob && t('students.form.tcDobDiffers')].filter(Boolean).join(' ')}
            </Note>
          )}
        </Panel>
      )}

      {documents && (
        <Panel title={t('students.docs.title')} actions={edit}>
          <AdmissionDocuments checklist={checklist} items={documents} readOnly />
          {missing.length > 0 && <Note tone="warning" className="mt-3">{t('students.docs.missingNow', { list: missing.map((d) => t(`students.docs.kinds.${d.category}`)).join(', ') })}</Note>}
        </Panel>
      )}
    </div>
  )
}
