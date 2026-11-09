import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { COE_SESSION_KINDS } from '@schoolgiant/shared'
import { FormField, Input, Modal, Select } from '../system'
import Button from '../ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { createSession, fetchCoeLookup, updateSession } from '../../api/coe'
import { useSnackbar } from '../../context/SnackbarContext'

/** Create or edit an exam session: name, kind, exam month, year, the program-semesters it covers, revaluation fee. */
export default function SessionForm({ session, onClose, onSaved }) {
  const { t } = useTranslation('coe')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['coe-lookup'], queryFn: fetchCoeLookup })
  const { data: acad } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const programs = lookup?.programs ?? []
  const [form, setForm] = useState(() => ({
    name: session?.name ?? '', kind: session?.kind ?? 'REGULAR', examMonth: session?.examMonth ?? '', academicYearId: session?.academicYearId ?? '',
    fee: session?.revaluationFee ? String(session.revaluationFee / 100) : '',
    targets: session?.targets?.map((x) => ({ programId: x.programId, semester: x.semester })) ?? [],
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setTarget = (i, k) => (e) => setForm((f) => ({ ...f, targets: f.targets.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) }))
  const yearId = form.academicYearId || acad?.currentYear?.id || ''
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, examMonth: form.examMonth || undefined, revaluationFee: form.fee ? Math.round(Number(form.fee) * 100) : 0,
        targets: form.targets.filter((x) => x.programId).map((x) => ({ programId: x.programId, semester: Number(x.semester) })),
      }
      return session ? updateSession(session.id, body) : createSession({ ...body, kind: form.kind, academicYearId: yearId || undefined })
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const addTarget = () => setForm((f) => ({ ...f, targets: [...f.targets, { programId: programs[0]?.id ?? '', semester: 1 }] }))
  return (
    <Modal open onClose={onClose} size="lg" title={session ? t('coe.sessions.editTitle', { name: session.name }) : t('coe.sessions.new')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.targets.some((x) => x.programId)} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><FormField label={t('coe.sessions.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('coe.sessions.namePlaceholder')} /></FormField></div>
        <FormField label={t('coe.sessions.kind')} hint={t(`coe.sessions.kindHint.${form.kind}`)}>
          <Select value={form.kind} onChange={set('kind')} disabled={!!session}>{Object.keys(COE_SESSION_KINDS).map((k) => <option key={k} value={k}>{t(`coe.sessionKinds.${k}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('coe.sessions.examMonth')} error={errors.examMonth}><Input type="month" value={form.examMonth} onChange={set('examMonth')} /></FormField>
        <FormField label={t('coe.sessions.year')}>
          <Select value={yearId} onChange={set('academicYearId')} disabled={!!session}>{(acad?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select>
        </FormField>
        <FormField label={t('coe.sessions.fee')} hint={t('coe.sessions.feeHint')}><Input type="number" min="0" value={form.fee} onChange={set('fee')} placeholder="0" /></FormField>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-ink">{t('coe.sessions.targets')}</p>
          <Button size="sm" variant="ghost" icon={Plus} disabled={!programs.length} onClick={addTarget}>{t('coe.sessions.addTarget')}</Button>
        </div>
        {errors.targets && <p className="text-xs text-danger-600 mb-2">{errors.targets}</p>}
        {form.targets.length === 0 && <p className="text-sm text-ink-faint">{programs.length ? t('coe.sessions.noTargets') : t('coe.sessions.noPrograms')}</p>}
        <div className="space-y-2">
          {form.targets.map((x, i) => {
            const p = programs.find((pp) => pp.id === x.programId)
            return (
              <div key={i} className="grid grid-cols-[1fr_140px_36px] gap-2">
                <Select value={x.programId} onChange={setTarget(i, 'programId')} aria-label={t('coe.sessions.program')}>
                  {programs.map((pp) => <option key={pp.id} value={pp.id}>{pp.code} · {pp.name}</option>)}
                </Select>
                <Select value={x.semester} onChange={setTarget(i, 'semester')} aria-label={t('coe.sessions.semester')}>
                  {Array.from({ length: p?.semesters ?? 8 }, (_, n) => <option key={n + 1} value={n + 1}>{t('coe.semesterN', { n: n + 1 })}</option>)}
                </Select>
                <Button size="sm" variant="ghost" icon={X} aria-label={t('coe.remove')} onClick={() => setForm((f) => ({ ...f, targets: f.targets.filter((_, j) => j !== i) }))} />
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
