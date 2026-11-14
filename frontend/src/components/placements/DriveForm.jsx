import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { DRIVE_MODES, ROUND_KINDS } from '@schoolgiant/shared'
import { DateInput, Drawer, FormField, FormSection, Input, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { saveDrive } from '../../api/placements'
import { useSnackbar } from '../../context/SnackbarContext'
import { lakhsToPaise, paiseToLakhs, usePlacementLabels, usePlacementsMeta } from './PlacementsKit'

const DEFAULT_ROUNDS = [{ name: '', kind: 'APTITUDE' }, { name: '', kind: 'TECHNICAL' }, { name: '', kind: 'HR' }]
const num = (v) => (v === '' || v == null ? null : Number(v))
const str = (v) => (v == null ? '' : String(v))

/** The drive form's starting values: from a drive (edit) or blank with the usual three rounds (new). CTC is typed in lakh a year. */
export function driveFormValues(d, L) {
  if (!d) {
    return {
      companyId: '', title: '', mode: 'ON_CAMPUS', roles: [{ title: '', openings: '', ctc: '' }], ctcMin: '', ctcMax: '', location: '', startDate: '', endDate: '', opensOn: '', closesOn: '',
      programIds: [], batches: [], classIds: [], minCgpa: '', maxBacklogs: '', min10th: '', min12th: '', note: '', description: '',
      rounds: DEFAULT_ROUNDS.map((r) => ({ ...r, name: L.round(r.kind), date: '', maxMarks: '' })),
    }
  }
  const e = d.eligibility ?? {}
  return {
    companyId: d.companyId, title: d.title, mode: d.mode ?? 'ON_CAMPUS', roles: (d.roles ?? []).map((r) => ({ title: r.title, openings: str(r.openings), ctc: paiseToLakhs(r.ctc) })),
    ctcMin: paiseToLakhs(d.ctcMin), ctcMax: paiseToLakhs(d.ctcMax), location: d.location ?? '', startDate: d.startDate ?? '', endDate: d.endDate ?? '',
    opensOn: d.registration?.opensOn ?? '', closesOn: d.registration?.closesOn ?? '',
    programIds: e.programIds ?? [], batches: e.batches ?? [], classIds: e.classIds ?? [], minCgpa: str(e.minCgpa), maxBacklogs: str(e.maxBacklogs), min10th: str(e.min10th), min12th: str(e.min12th), note: e.note ?? '',
    description: d.description ?? '', rounds: (d.rounds ?? []).map((r) => ({ id: r.id, name: r.name, kind: r.kind, date: r.date ?? '', maxMarks: str(r.maxMarks) })),
  }
}

/** Toggle chips: pick any of the options. */
function Chips({ options, value, onChange }) {
  const has = (v) => value.some((x) => String(x) === String(v))
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(has(o.value) ? value.filter((x) => String(x) !== String(o.value)) : [...value, o.value])}
          className={clsx('rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors', has(o.value) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:bg-black/[0.03]')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** What the API takes from the form: empty roles and rounds dropped, lakh → paise. */
export function driveBody(f) {
  return {
    companyId: f.companyId, title: f.title, mode: f.mode, location: f.location, startDate: f.startDate, endDate: f.endDate, description: f.description,
    roles: f.roles.filter((r) => r.title.trim()).map((r) => ({ title: r.title, openings: num(r.openings), ctc: lakhsToPaise(r.ctc) })),
    ctcMin: lakhsToPaise(f.ctcMin), ctcMax: lakhsToPaise(f.ctcMax),
    registration: { opensOn: f.opensOn, closesOn: f.closesOn },
    eligibility: { programIds: f.programIds, batches: f.batches.map(Number), classIds: f.classIds, minCgpa: num(f.minCgpa), maxBacklogs: num(f.maxBacklogs), min10th: num(f.min10th), min12th: num(f.min12th), note: f.note },
    rounds: f.rounds.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name, kind: r.kind, date: r.date, maxMarks: num(r.maxMarks) })),
  }
}

/** Enough to save: a company and a drive name. */
export const driveReady = (f) => !!f.companyId && f.title.trim().length >= 2

/**
 * A drive's fields in sections: company and dates, roles and package, registration, who may apply, rounds, about.
 * The New drive page and the Edit drawer both use it. Controlled: `value` + `onChange(next)`.
 */
export function DriveFields({ value: f, onChange, errors = {} }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { data: meta } = usePlacementsMeta()
  const set = (k) => (e) => onChange({ ...f, [k]: e?.target ? e.target.value : e })
  const setRow = (list, i, k) => (e) => onChange({ ...f, [list]: f[list].map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) })
  const move = (i, by) => { const r = [...f.rounds]; const [it] = r.splice(i, 1); r.splice(i + by, 0, it); onChange({ ...f, rounds: r }) }
  const thisYear = new Date().getFullYear()
  const batches = [...new Set([...(meta?.batches ?? []), thisYear - 3, thisYear - 2, thisYear - 1].map(Number))].sort((a, b) => b - a)
  return (
    <div className="space-y-5">
      <FormSection title={t('placements.driveForm.drive')} hint={t('placements.driveForm.driveHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('placements.driveForm.company')} required error={errors.companyId} className="sm:col-span-2">
            <Select value={f.companyId} onChange={set('companyId')}>
              <option value="">{t('placements.driveForm.pickCompany')}</option>
              {(meta?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('placements.driveForm.title')} required error={errors.title} className="sm:col-span-2"><Input value={f.title} onChange={set('title')} placeholder={t('placements.driveForm.titleHint')} /></FormField>
          <FormField label={t('placements.driveForm.mode')}><Select value={f.mode} onChange={set('mode')}>{DRIVE_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select></FormField>
          <FormField label={t('placements.driveForm.location')} error={errors.location}><Input value={f.location} onChange={set('location')} /></FormField>
          <FormField label={t('placements.driveForm.startDate')} error={errors.startDate}><DateInput value={f.startDate} onChange={set('startDate')} /></FormField>
          <FormField label={t('placements.driveForm.endDate')} error={errors.endDate}><DateInput value={f.endDate} onChange={set('endDate')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('placements.driveForm.roles')} hint={t('placements.driveForm.rolesHint')}
        actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange({ ...f, roles: [...f.roles, { title: '', openings: '', ctc: '' }] })}>{t('placements.driveForm.addRole')}</Button>}>
        <div className="space-y-3">
          {f.roles.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2">
              <Input value={r.title} onChange={setRow('roles', i, 'title')} placeholder={t('placements.driveForm.roleTitle')} aria-label={t('placements.driveForm.roleTitle')} />
              <Input type="number" min="0" value={r.openings} onChange={setRow('roles', i, 'openings')} placeholder={t('placements.driveForm.openings')} aria-label={t('placements.driveForm.openings')} />
              <Input type="number" min="0" step="0.1" value={r.ctc} onChange={setRow('roles', i, 'ctc')} placeholder={t('placements.driveForm.lpa')} aria-label={t('placements.driveForm.lpa')} />
              <Button size="sm" variant="ghost" icon={X} aria-label={t('placements.driveForm.remove')} onClick={() => onChange({ ...f, roles: f.roles.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <FormField label={t('placements.driveForm.ctcMin')} error={errors.ctcMin}><Input type="number" min="0" step="0.1" value={f.ctcMin} onChange={set('ctcMin')} /></FormField>
            <FormField label={t('placements.driveForm.ctcMax')} error={errors.ctcMax}><Input type="number" min="0" step="0.1" value={f.ctcMax} onChange={set('ctcMax')} /></FormField>
          </div>
        </div>
      </FormSection>

      <FormSection title={t('placements.driveForm.registration')} hint={t('placements.driveForm.registrationHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('placements.driveForm.opensOn')} error={errors['registration.opensOn']}><DateInput value={f.opensOn} onChange={set('opensOn')} /></FormField>
          <FormField label={t('placements.driveForm.closesOn')} error={errors['registration.closesOn']}><DateInput value={f.closesOn} onChange={set('closesOn')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('placements.driveForm.whoMayApply')} hint={t('placements.driveForm.whoMayApplyHint')}>
        <div className="space-y-4">
          {(meta?.programs ?? []).length > 0 && (
            <FormField label={t('placements.driveForm.programs')} error={errors['eligibility.programIds']}>
              <Chips value={f.programIds} onChange={set('programIds')} options={meta.programs.map((p) => ({ value: p.id, label: p.code }))} />
            </FormField>
          )}
          {f.programIds.length > 0 && (
            <FormField label={t('placements.driveForm.batches')} hint={t('placements.driveForm.batchesHint')}>
              <Chips value={f.batches} onChange={set('batches')} options={batches.map((b) => ({ value: b, label: String(b) }))} />
            </FormField>
          )}
          <FormField label={t('placements.driveForm.classes')} hint={t('placements.driveForm.classesHint')}>
            <Chips value={f.classIds} onChange={set('classIds')} options={(meta?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          </FormField>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <FormField label={t('placements.driveForm.minCgpa')}><Input type="number" min="0" max="10" step="0.1" value={f.minCgpa} onChange={set('minCgpa')} /></FormField>
            <FormField label={t('placements.driveForm.maxBacklogs')}><Input type="number" min="0" value={f.maxBacklogs} onChange={set('maxBacklogs')} /></FormField>
            <FormField label={t('placements.driveForm.min10th')}><Input type="number" min="0" max="100" value={f.min10th} onChange={set('min10th')} /></FormField>
            <FormField label={t('placements.driveForm.min12th')}><Input type="number" min="0" max="100" value={f.min12th} onChange={set('min12th')} /></FormField>
          </div>
          <FormField label={t('placements.driveForm.criteriaNote')}><Input value={f.note} onChange={set('note')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('placements.driveForm.rounds')} hint={t('placements.driveForm.roundsHint')}
        actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange({ ...f, rounds: [...f.rounds, { name: '', kind: 'OTHER', date: '', maxMarks: '' }] })}>{t('placements.driveForm.addRound')}</Button>}>
        <div className="space-y-3">
          {!f.rounds.length && <p className="text-xs text-ink-faint">{t('placements.driveForm.noRounds')}</p>}
          {f.rounds.map((r, i) => (
            <div key={r.id ?? `n${i}`} className="grid grid-cols-[1.6rem_1fr_9rem] items-center gap-2 sm:grid-cols-[1.6rem_1fr_9rem_9rem_5rem_auto]">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
              <Input value={r.name} onChange={setRow('rounds', i, 'name')} placeholder={t('placements.driveForm.roundName')} aria-label={t('placements.driveForm.roundName')} />
              <Select value={r.kind} onChange={setRow('rounds', i, 'kind')} aria-label={t('placements.driveForm.roundKind')}>{ROUND_KINDS.map((k) => <option key={k.value} value={k.value}>{L.round(k.value)}</option>)}</Select>
              <DateInput value={r.date} onChange={setRow('rounds', i, 'date')} />
              <Input type="number" min="0" value={r.maxMarks} onChange={setRow('rounds', i, 'maxMarks')} placeholder={t('placements.driveForm.maxMarks')} aria-label={t('placements.driveForm.maxMarks')} />
              <span className="flex gap-0.5">
                <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} aria-label={t('placements.driveForm.up')} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === f.rounds.length - 1} aria-label={t('placements.driveForm.down')} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={X} aria-label={t('placements.driveForm.remove')} onClick={() => onChange({ ...f, rounds: f.rounds.filter((_, j) => j !== i) })} />
              </span>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title={t('placements.driveForm.description')} hint={t('placements.driveForm.descriptionHint')}>
        <Textarea rows={3} value={f.description} onChange={set('description')} aria-label={t('placements.driveForm.description')} />
      </FormSection>
    </div>
  )
}

/** Edit a drive in a drawer (a new drive has its own page: pages/Placements/NewDrive.jsx). */
export default function DriveForm({ drive, onClose, onSaved }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { showError } = useSnackbar()
  const [f, setF] = useState(() => driveFormValues(drive, L))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveDrive(drive.id, driveBody(f)),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open onClose={onClose} size="2xl" title={t('placements.driveForm.editTitle')} subtitle={drive?.title}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!driveReady(f)} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <DriveFields value={f} onChange={setF} errors={errors} />
    </Drawer>
  )
}
