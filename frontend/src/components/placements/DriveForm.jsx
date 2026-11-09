import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { DRIVE_MODES, ROUND_KINDS } from '@schoolgiant/shared'
import { Drawer, FormField, Input, Select, Textarea } from '../system'
import Button from '../ui/Button'
import { saveDrive } from '../../api/placements'
import { useSnackbar } from '../../context/SnackbarContext'
import { lakhsToPaise, paiseToLakhs, usePlacementLabels, usePlacementsMeta } from './PlacementsKit'

const DEFAULT_ROUNDS = [{ name: '', kind: 'APTITUDE' }, { name: '', kind: 'TECHNICAL' }, { name: '', kind: 'HR' }]
const num = (v) => (v === '' || v == null ? null : Number(v))
const str = (v) => (v == null ? '' : String(v))

function fromDrive(d, t, L) {
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

/** Create or edit a drive: company, roles and CTC, dates, the registration window, who may apply and the rounds. */
export default function DriveForm({ drive, onClose, onSaved }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { showError } = useSnackbar()
  const { data: meta } = usePlacementsMeta()
  const [f, setF] = useState(() => fromDrive(drive, t, L))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  const setRow = (list, i, k) => (e) => setF((x) => ({ ...x, [list]: x[list].map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) }))
  const move = (i, by) => setF((x) => { const r = [...x.rounds]; const [it] = r.splice(i, 1); r.splice(i + by, 0, it); return { ...x, rounds: r } })
  const save = useMutation({
    mutationFn: () => saveDrive(drive?.id, {
      companyId: f.companyId, title: f.title, mode: f.mode, location: f.location, startDate: f.startDate, endDate: f.endDate, description: f.description,
      roles: f.roles.filter((r) => r.title.trim()).map((r) => ({ title: r.title, openings: num(r.openings), ctc: lakhsToPaise(r.ctc) })),
      ctcMin: lakhsToPaise(f.ctcMin), ctcMax: lakhsToPaise(f.ctcMax),
      registration: { opensOn: f.opensOn, closesOn: f.closesOn },
      eligibility: { programIds: f.programIds, batches: f.batches.map(Number), classIds: f.classIds, minCgpa: num(f.minCgpa), maxBacklogs: num(f.maxBacklogs), min10th: num(f.min10th), min12th: num(f.min12th), note: f.note },
      rounds: f.rounds.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name, kind: r.kind, date: r.date, maxMarks: num(r.maxMarks) })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const thisYear = new Date().getFullYear()
  const batches = [...new Set([...(meta?.batches ?? []), thisYear - 3, thisYear - 2, thisYear - 1].map(Number))].sort((a, b) => b - a)
  const section = 'rounded-xl border border-border p-3 space-y-3'
  const h = 'text-sm font-semibold text-ink'
  return (
    <Drawer open onClose={onClose} size="2xl" title={drive ? t('placements.driveForm.editTitle') : t('placements.driveForm.newTitle')} subtitle={drive?.title}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!f.companyId || f.title.trim().length < 2} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('placements.driveForm.company')} required error={errors.companyId}>
            <Select value={f.companyId} onChange={set('companyId')}>
              <option value="">{t('placements.driveForm.pickCompany')}</option>
              {(meta?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('placements.driveForm.title')} required error={errors.title}><Input value={f.title} onChange={set('title')} placeholder={t('placements.driveForm.titleHint')} /></FormField>
          <FormField label={t('placements.driveForm.mode')}><Select value={f.mode} onChange={set('mode')}>{DRIVE_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select></FormField>
          <FormField label={t('placements.driveForm.location')}><Input value={f.location} onChange={set('location')} /></FormField>
          <FormField label={t('placements.driveForm.startDate')}><Input type="date" value={f.startDate} onChange={set('startDate')} /></FormField>
          <FormField label={t('placements.driveForm.endDate')} error={errors.endDate}><Input type="date" value={f.endDate} onChange={set('endDate')} /></FormField>
        </div>

        <div className={section}>
          <div className="flex items-center justify-between"><p className={h}>{t('placements.driveForm.roles')}</p>
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setF((x) => ({ ...x, roles: [...x.roles, { title: '', openings: '', ctc: '' }] }))}>{t('placements.driveForm.addRole')}</Button></div>
          {f.roles.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2">
              <Input value={r.title} onChange={setRow('roles', i, 'title')} placeholder={t('placements.driveForm.roleTitle')} />
              <Input type="number" min="0" value={r.openings} onChange={setRow('roles', i, 'openings')} placeholder={t('placements.driveForm.openings')} />
              <Input type="number" min="0" step="0.1" value={r.ctc} onChange={setRow('roles', i, 'ctc')} placeholder={t('placements.driveForm.lpa')} />
              <Button size="sm" variant="ghost" icon={X} aria-label={t('placements.driveForm.remove')} onClick={() => setF((x) => ({ ...x, roles: x.roles.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('placements.driveForm.ctcMin')}><Input type="number" min="0" step="0.1" value={f.ctcMin} onChange={set('ctcMin')} /></FormField>
            <FormField label={t('placements.driveForm.ctcMax')} error={errors.ctcMax}><Input type="number" min="0" step="0.1" value={f.ctcMax} onChange={set('ctcMax')} /></FormField>
          </div>
        </div>

        <div className={section}>
          <p className={h}>{t('placements.driveForm.registration')}</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('placements.driveForm.opensOn')}><Input type="date" value={f.opensOn} onChange={set('opensOn')} /></FormField>
            <FormField label={t('placements.driveForm.closesOn')} error={errors['registration.closesOn']}><Input type="date" value={f.closesOn} onChange={set('closesOn')} /></FormField>
          </div>
        </div>

        <div className={section}>
          <p className={h}>{t('placements.driveForm.whoMayApply')}</p>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField label={t('placements.driveForm.minCgpa')}><Input type="number" min="0" max="10" step="0.1" value={f.minCgpa} onChange={set('minCgpa')} /></FormField>
            <FormField label={t('placements.driveForm.maxBacklogs')}><Input type="number" min="0" value={f.maxBacklogs} onChange={set('maxBacklogs')} /></FormField>
            <FormField label={t('placements.driveForm.min10th')}><Input type="number" min="0" max="100" value={f.min10th} onChange={set('min10th')} /></FormField>
            <FormField label={t('placements.driveForm.min12th')}><Input type="number" min="0" max="100" value={f.min12th} onChange={set('min12th')} /></FormField>
          </div>
          <FormField label={t('placements.driveForm.criteriaNote')}><Input value={f.note} onChange={set('note')} /></FormField>
        </div>

        <div className={section}>
          <div className="flex items-center justify-between"><p className={h}>{t('placements.driveForm.rounds')}</p>
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setF((x) => ({ ...x, rounds: [...x.rounds, { name: '', kind: 'OTHER', date: '', maxMarks: '' }] }))}>{t('placements.driveForm.addRound')}</Button></div>
          {!f.rounds.length && <p className="text-xs text-ink-faint">{t('placements.driveForm.noRounds')}</p>}
          {f.rounds.map((r, i) => (
            <div key={r.id ?? `n${i}`} className="grid grid-cols-[1.6rem_1fr_9rem] items-center gap-2 sm:grid-cols-[1.6rem_1fr_9rem_9rem_5rem_auto]">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
              <Input value={r.name} onChange={setRow('rounds', i, 'name')} placeholder={t('placements.driveForm.roundName')} />
              <Select value={r.kind} onChange={setRow('rounds', i, 'kind')}>{ROUND_KINDS.map((k) => <option key={k.value} value={k.value}>{L.round(k.value)}</option>)}</Select>
              <Input type="date" value={r.date} onChange={setRow('rounds', i, 'date')} />
              <Input type="number" min="0" value={r.maxMarks} onChange={setRow('rounds', i, 'maxMarks')} placeholder={t('placements.driveForm.maxMarks')} />
              <span className="flex gap-0.5">
                <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} aria-label={t('placements.driveForm.up')} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === f.rounds.length - 1} aria-label={t('placements.driveForm.down')} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={X} aria-label={t('placements.driveForm.remove')} onClick={() => setF((x) => ({ ...x, rounds: x.rounds.filter((_, j) => j !== i) }))} />
              </span>
            </div>
          ))}
        </div>
        <FormField label={t('placements.driveForm.description')}><Textarea rows={3} value={f.description} onChange={set('description')} /></FormField>
      </div>
    </Drawer>
  )
}
