import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ROUND_RESULTS, inRunningFor } from '@schoolgiant/shared'
import { Avatar, FormField, Input, Modal, Note, SegmentedControl, TONE } from '../system'
import Button from '../ui/Button'
import { registerForDrive, saveRoundResults, selectCandidates } from '../../api/placements'
import { useSnackbar } from '../../context/SnackbarContext'
import { lakhsToPaise, paiseToLakhs, usePlacementLabels } from './PlacementsKit'

/** Register the picked students: their 10th / 12th marks when the drive asks, and (for staff) overriding the criteria. */
export function RegisterModal({ drive, students, onClose, onDone }) {
  const { t } = useTranslation('placements')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ tenthPct: '', twelfthPct: '', override: false })
  const e = drive.eligibility ?? {}
  const save = useMutation({
    mutationFn: () => registerForDrive(drive.id, { studentIds: students.map((s) => s.id), tenthPct: f.tenthPct === '' ? null : Number(f.tenthPct), twelfthPct: f.twelfthPct === '' ? null : Number(f.twelfthPct), override: f.override }),
    onSuccess: onDone, onError: (err) => showError(err.message),
  })
  return (
    <Modal open onClose={onClose} title={t('placements.register.title', { count: students.length })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('placements.register.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{students.slice(0, 30).map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"><Avatar name={s.name} size={18} soft />{s.name}</span>)}</div>
        {(e.min10th != null || e.min12th != null) && (
          <>
            <Note tone="info">{t('placements.register.marksNote')}</Note>
            <div className="grid grid-cols-2 gap-3">
              {e.min10th != null && <FormField label={t('placements.register.tenth', { min: e.min10th })}><Input type="number" min="0" max="100" value={f.tenthPct} onChange={(x) => setF((v) => ({ ...v, tenthPct: x.target.value }))} /></FormField>}
              {e.min12th != null && <FormField label={t('placements.register.twelfth', { min: e.min12th })}><Input type="number" min="0" max="100" value={f.twelfthPct} onChange={(x) => setF((v) => ({ ...v, twelfthPct: x.target.value }))} /></FormField>}
            </div>
          </>
        )}
        <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" checked={f.override} onChange={(x) => setF((v) => ({ ...v, override: x.target.checked }))} />
          <span>{t('placements.register.override')}<span className="block text-xs text-ink-muted">{t('placements.register.overrideHint')}</span></span></label>
      </div>
    </Modal>
  )
}

/** A round's results: marks and shortlisted / not / absent for each student still in the running. */
export function RoundResultsModal({ drive, onClose, onDone }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { showError } = useSnackbar()
  const firstOpen = drive.rounds.find((r) => !r.done) ?? drive.rounds[0]
  const [roundId, setRoundId] = useState(firstOpen?.id)
  const round = drive.rounds.find((r) => r.id === roundId)
  const eligible = useMemo(() => drive.registrations.filter((g) => g.status !== 'SELECTED' && inRunningFor(drive.rounds, { status: g.status === 'REJECTED' ? 'REGISTERED' : g.status, rounds: Object.entries(g.rounds).map(([k, v]) => ({ roundId: k, result: v.result })) }, roundId)), [drive, roundId])
  const [edits, setEdits] = useState({})
  const [done, setDone] = useState(!!round?.done)
  const val = (g) => edits[`${roundId}:${g.id}`] ?? { marks: g.rounds[roundId]?.marks ?? '', result: g.rounds[roundId]?.result ?? null }
  const put = (g, patch) => setEdits((e) => ({ ...e, [`${roundId}:${g.id}`]: { ...val(g), ...patch } }))
  const save = useMutation({
    mutationFn: () => saveRoundResults(drive.id, roundId, {
      results: eligible.map((g) => { const v = val(g); return { registrationId: g.id, marks: v.marks === '' ? null : Number(v.marks), result: v.result } }).filter((r) => r.result || r.marks != null),
      done,
    }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  const allPass = () => setEdits((e) => ({ ...e, ...Object.fromEntries(eligible.map((g) => [`${roundId}:${g.id}`, { ...val(g), result: 'PASS' }])) }))
  return (
    <Modal open onClose={onClose} size="lg" title={t('placements.rounds.title')} footer={<>
      <label className="me-auto inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />{t('placements.rounds.markDone')}</label>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <SegmentedControl value={roundId} onChange={(v) => { setRoundId(v); setDone(!!drive.rounds.find((r) => r.id === v)?.done) }} options={drive.rounds.map((r, i) => ({ value: r.id, label: `${i + 1}. ${r.name}` }))} />
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>{t('placements.rounds.inRunning', { count: eligible.length })}{round?.maxMarks != null && ` · ${t('placements.rounds.outOf', { max: round.maxMarks })}`}</span>
          {eligible.length > 0 && <Button size="sm" variant="ghost" onClick={allPass}>{t('placements.rounds.allPass')}</Button>}
        </div>
        {!eligible.length ? <Note tone="info">{t('placements.rounds.none')}</Note> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {eligible.map((g) => {
              const v = val(g)
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Avatar name={g.name} size={28} soft />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{g.name}</span><span className="block text-xs text-ink-faint">{[g.program ?? g.classShort, g.cgpa != null && `CGPA ${g.cgpa}`].filter(Boolean).join(' · ')}</span></span>
                  <Input className="w-20" type="number" min="0" max={round?.maxMarks ?? undefined} value={v.marks} onChange={(e) => put(g, { marks: e.target.value })} placeholder={t('placements.rounds.marks')} />
                  <span className="flex gap-1">
                    {Object.keys(ROUND_RESULTS).map((r) => {
                      const on = v.result === r
                      const tone = TONE[ROUND_RESULTS[r].tone]
                      return <button key={r} type="button" onClick={() => put(g, { result: on ? null : r })} className={clsx('rounded-lg border px-2 py-1 text-xs font-semibold transition-colors', on ? [tone.bg, tone.text, tone.border] : 'border-border text-ink-muted hover:bg-black/[0.03]')}>{L.result(r)}</button>
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** The final selections: an offer each at this CTC and role. */
export function SelectModal({ drive, candidates, onClose, onDone }) {
  const { t } = useTranslation('placements')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ ctc: paiseToLakhs(drive.ctcMax ?? drive.ctcMin), role: drive.roles?.[0]?.title ?? '', joiningDate: '', location: drive.location ?? '' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => selectCandidates(drive.id, { registrationIds: candidates.map((c) => c.id), ctc: lakhsToPaise(f.ctc) ?? undefined, role: f.role, joiningDate: f.joiningDate, location: f.location }),
    onSuccess: onDone, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('placements.select.title', { count: candidates.length })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!(Number(f.ctc) > 0)} onClick={() => save.mutate()}>{t('placements.select.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{candidates.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"><Avatar name={s.name} size={18} soft />{s.name}</span>)}</div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('placements.select.ctc')} required><Input type="number" min="0" step="0.1" value={f.ctc} onChange={set('ctc')} /></FormField>
          <FormField label={t('placements.select.role')}><Input value={f.role} onChange={set('role')} /></FormField>
          <FormField label={t('placements.select.joining')}><Input type="date" value={f.joiningDate} onChange={set('joiningDate')} /></FormField>
          <FormField label={t('placements.select.location')}><Input value={f.location} onChange={set('location')} /></FormField>
        </div>
        <Note tone="info">{t('placements.select.note')}</Note>
      </div>
    </Modal>
  )
}
