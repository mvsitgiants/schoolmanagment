import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Plus, Thermometer, X } from 'lucide-react'
import { INCIDENT_SEVERITY, VISIT_OUTCOMES, feverLevel } from '@schoolgiant/shared'
import { FormField, Input, Note, SegmentedControl, Select, StatusPill, Tag } from '../system'
import StudentPicker from '../fees/StudentPicker'
import { fetchHealthBrief, fetchHealthStaff } from '../../api/health'

/** Labels for the health lists (shared values → this namespace's text). */
export function useHealthLabels() {
  const { t } = useTranslation('health')
  return {
    outcome: (v) => t(`health.outcomes.${v}`),
    complaint: (v) => t(`health.complaints.${v}`),
    severity: (v) => t(`health.severity.${v}`),
    incidentStatus: (v) => t(`health.incidentStatus.${v}`),
    kind: (v) => t(`health.incidentKinds.${v}`),
    how: (v) => t(`health.informedHow.${v}`),
    bmiBand: (v) => t(`health.bmiBands.${v}`),
  }
}

export function OutcomePill({ outcome }) {
  const L = useHealthLabels()
  return <StatusPill tone={VISIT_OUTCOMES[outcome]?.tone ?? 'neutral'}>{L.outcome(outcome)}</StatusPill>
}

export function SeverityTag({ severity }) {
  const L = useHealthLabels()
  return <Tag size="xs" tone={INCIDENT_SEVERITY[severity]?.tone ?? 'neutral'}>{L.severity(severity)}</Tag>
}

/** A blood group as a big round badge (the record's leading mark). */
export function BloodBadge({ group, size = 'md' }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 font-display font-bold text-rose-700',
      size === 'lg' ? 'h-14 w-14 text-lg' : 'h-8 w-8 text-[11px]')}>{group || '—'}</span>
  )
}

const FEVER = { HIGH: 'danger', MILD: 'warning', OK: 'success' }
/** A temperature with its colour (fever red, mild amber, normal green). */
export function TempTag({ tempC }) {
  const lvl = feverLevel(tempC)
  if (!lvl) return null
  return <Tag size="xs" tone={FEVER[lvl]} icon={Thermometer}>{`${Number(tempC).toFixed(1)}°C`}</Tag>
}

/** Words as removable chips with an add box (allergies, conditions, witnesses). */
export function ChipsInput({ label, value = [], onChange, placeholder, tone = 'neutral', suggestions = [] }) {
  const { t } = useTranslation('health')
  const [text, setText] = useState('')
  const add = (w) => { const v = String(w ?? text).trim(); if (v && !value.includes(v)) onChange([...value, v]); setText('') }
  const left = suggestions.filter((s) => !value.includes(s))
  return (
    <FormField label={label}>
      <div className="space-y-2">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map((w) => (
              <span key={w} className="inline-flex items-center gap-1">
                <Tag size="sm" tone={tone}>{w}</Tag>
                <button type="button" aria-label={t('health.chips.remove', { word: w })} onClick={() => onChange(value.filter((x) => x !== w))} className="rounded p-0.5 text-ink-faint hover:text-danger-600"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" onClick={() => add()} disabled={!text.trim()} aria-label={t('health.chips.add')} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"><Plus className="h-4 w-4" /></button>
        </div>
        {left.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {left.slice(0, 12).map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-ink-muted hover:border-brand-300 hover:text-brand-700">+ {s}</button>)}
          </div>
        )}
      </div>
    </FormField>
  )
}

/** Student or staff member: a switch, then the student picker or a staff login / typed name. Shows the student's allergies at once. */
export function PersonPicker({ value, onChange, errors = {} }) {
  const { t } = useTranslation('health')
  const isStaff = value.personType === 'STAFF'
  const { data: staff = [] } = useQuery({ queryKey: ['health', 'staff'], queryFn: fetchHealthStaff, enabled: isStaff })
  const { data: brief } = useQuery({ queryKey: ['health', 'brief', value.studentId], queryFn: () => fetchHealthBrief(value.studentId), enabled: !isStaff && !!value.studentId })
  return (
    <div className="space-y-3">
      <SegmentedControl value={value.personType} onChange={(personType) => onChange({ personType, studentId: '', staffUserId: '', staffName: '' })}
        options={[{ value: 'STUDENT', label: t('health.person.student') }, { value: 'STAFF', label: t('health.person.staff') }]} />
      {isStaff ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('health.person.staffLogin')} error={errors.staffUserId}>
            <Select value={value.staffUserId} onChange={(e) => onChange({ ...value, staffUserId: e.target.value, staffName: staff.find((s) => s.id === e.target.value)?.name ?? value.staffName })}>
              <option value="">{t('health.person.pickStaff')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{[s.name, s.designation].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </FormField>
          <FormField label={t('health.person.staffName')}><Input value={value.staffName} onChange={(e) => onChange({ ...value, staffName: e.target.value })} /></FormField>
        </div>
      ) : (
        <StudentPicker value={value.studentId} onChange={(id) => onChange({ ...value, studentId: id })} error={errors.studentId} />
      )}
      {brief && (brief.allergies.length > 0 || brief.conditions?.length > 0) && (
        <Note tone="danger" icon={AlertTriangle}>
          {brief.allergies.length > 0 && <p>{t('health.person.allergic', { list: brief.allergies.join(', ') })}</p>}
          {brief.conditions?.length > 0 && <p>{t('health.person.conditions', { list: brief.conditions.join(', ') })}</p>}
        </Note>
      )}
      {brief?.visits30 >= 3 && <Note tone="warning">{t('health.person.frequent', { count: brief.visits30 })}</Note>}
    </div>
  )
}
