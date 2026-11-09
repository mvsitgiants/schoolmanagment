import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Fingerprint, HeartPulse, MapPinHouse, Pencil, School, UserRound } from 'lucide-react'
import { ProgressBar, SectionCard, TONE } from '../../system'
import Button from '../../ui/Button'
import { useFormat } from '../../../context/SettingsContext'
import { MissingLine } from './kit'

/**
 * Which of the details a school is expected to keep are filled (photo, personal, ID numbers, address, a parent's
 * mobile). Previous school and health notes are optional and don't count against it.
 */
export function completenessOf(s, hasPhoto, t) {
  const g = (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
  const checks = [
    [t('students.photo.title'), hasPhoto],
    [t('students.form.dob'), s.dob], [t('students.form.gender'), s.gender], [t('students.form.bloodGroup'), s.bloodGroup],
    [t('students.form.category'), s.category], [t('students.form.religion'), s.religion], [t('students.form.nationality'), s.nationality],
    [t('students.form.motherTongue'), s.motherTongue],
    [t('students.form.aadhaar'), s.aadhaarSet], [t('students.form.apaarId'), s.apaarId], [t('students.form.pen'), s.pen],
    [t('students.form.addressLine'), s.address?.line], [t('students.form.city'), s.address?.city], [t('students.form.pincode'), s.address?.pincode],
    [t('students.profile.complete.parentMobile'), g?.mobile],
  ]
  const missing = checks.filter(([, v]) => !v).map(([label]) => label)
  return { pct: Math.round(((checks.length - missing.length) / checks.length) * 100), missing, total: checks.length, filled: checks.length - missing.length }
}

/** "Profile 80% complete" with a bar and what is missing. */
export function CompletenessBar({ c, compact = false, onEdit, className }) {
  const { t } = useTranslation('students')
  const tone = c.pct >= 90 ? 'success' : c.pct >= 60 ? 'warning' : 'danger'
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">{t('students.profile.complete.title', { pct: c.pct })}</p>
        {onEdit && <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{t('students.profile.complete.fill')}</Button>}
        {!onEdit && <span className={clsx('text-xs font-semibold tabular-nums', TONE[tone].text)}>{c.filled}/{c.total}</span>}
      </div>
      <ProgressBar value={c.pct} tone={tone} showValue={false} className="mt-2" />
      {c.missing.length > 0 && (
        <p className={clsx('mt-2 text-xs text-ink-faint', compact && 'line-clamp-2')}>
          <span className="font-medium text-ink-muted">{t('students.profile.complete.missing')}</span> {c.missing.join(' · ')}
        </p>
      )}
    </div>
  )
}

/** One group of details: the filled ones as label / value, the empty ones folded into a single "Not filled" line. */
function Group({ icon, title, fields, actions, className }) {
  const filled = fields.filter((f) => f.value != null && f.value !== '' && f.value !== false)
  const empty = fields.filter((f) => !(f.value != null && f.value !== '' && f.value !== false)).map((f) => f.label)
  return (
    <SectionCard icon={icon} title={title} actions={actions} className={className}>
      {filled.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
          {filled.map((f) => (
            <div key={f.label} className={clsx('min-w-0', f.full && 'sm:col-span-2')}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{f.label}</dt>
              <dd className={clsx('mt-0.5 break-words text-sm text-ink', f.mono ? 'font-mono-num' : 'font-medium', f.text && 'whitespace-pre-line font-normal')}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <MissingLine items={empty} className={filled.length ? 'mt-3.5 border-t border-border pt-3' : ''} />
    </SectionCard>
  )
}

/** Student 360 › Profile: every personal detail, grouped, with how complete the record is. */
export default function ProfileTab({ s, completeness, canEdit, onEdit, canReveal, reveal, onReveal }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const opt = (group, v) => (v ? t(`students.${group}.${v}`, v) : null)
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-surface p-4">
        <CompletenessBar c={completeness} onEdit={canEdit && completeness.missing.length ? onEdit : undefined} />
      </section>
      {/* two stacks rather than a grid, so a short card doesn’t leave a hole beside a long one */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <Group icon={UserRound} title={t('students.profile.groups.personal')} fields={[
            { label: t('students.form.dob'), value: s.dob ? `${date(s.dob)}${s.age != null ? ` · ${t('students.directory.age', { count: s.age })}` : ''}` : null },
            { label: t('students.form.gender'), value: opt('genders', s.gender) },
            { label: t('students.form.bloodGroup'), value: s.bloodGroup },
            { label: t('students.form.category'), value: opt('categories', s.category) },
            { label: t('students.form.religion'), value: s.religion },
            { label: t('students.form.nationality'), value: s.nationality },
            { label: t('students.form.motherTongue'), value: s.motherTongue },
            { label: t('students.form.admissionDate'), value: s.admissionDate ? date(s.admissionDate) : null },
          ]} />
          <Group icon={MapPinHouse} title={t('students.form.contact')} fields={[
            { label: t('students.form.addressLine'), value: s.address?.line, full: true },
            { label: t('students.form.city'), value: s.address?.city },
            { label: t('students.form.state'), value: s.address?.state },
            { label: t('students.form.pincode'), value: s.address?.pincode, mono: true },
            { label: t('students.form.studentMobile'), value: s.mobile, mono: true },
            { label: t('students.form.studentEmail'), value: s.email },
          ]} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Group icon={Fingerprint} title={t('students.profile.groups.identity')}
            actions={canReveal && s.aadhaarSet && <Button size="sm" variant="ghost" className="-my-1" icon={reveal ? EyeOff : Eye} onClick={onReveal}>{reveal ? t('students.profile.hideIds') : t('students.profile.showIds')}</Button>}
            fields={[
              { label: t('students.form.admissionNo'), value: s.admissionNo, mono: true },
              { label: t('students.form.aadhaar'), value: s.aadhaar, mono: true },
              { label: t('students.form.apaarId'), value: s.apaarId, mono: true },
              { label: t('students.form.pen'), value: s.pen, mono: true },
            ]} />
          <Group icon={School} title={t('students.form.previousSchool')} fields={[
            { label: t('students.form.schoolName'), value: s.previousSchool?.name, full: true },
            { label: t('students.form.board'), value: s.previousSchool?.board },
            { label: t('students.form.lastClass'), value: s.previousSchool?.lastClass },
            { label: t('students.form.tcNo'), value: s.previousSchool?.tcNo, mono: true },
          ]} />
          <Group icon={HeartPulse} title={t('students.form.medical')} fields={[
            { label: t('students.form.allergies'), value: s.medical?.allergies },
            { label: t('students.form.conditions'), value: s.medical?.conditions },
            { label: t('students.form.medicalNotes'), value: s.medical?.notes, text: true, full: true },
          ]} />
        </div>
      </div>
    </div>
  )
}
