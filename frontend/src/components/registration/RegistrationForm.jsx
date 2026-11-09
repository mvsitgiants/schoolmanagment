import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertTriangle, Check, Lock } from 'lucide-react'
import { checkRegistration } from '@schoolgiant/shared'
import { CodeBadge, LevelBar, Modal, Note, StatusPill } from '../system'
import Button from '../ui/Button'
import { fetchRegistrationForm, saveRegistration } from '../../api/registration'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * A student's course selection in a window, entered by staff for the student: compulsory courses, then each elective
 * group with its pick range. Credits, seats and prerequisites show as you pick; the server checks everything again.
 */
export default function RegistrationForm({ windowId, studentId, onClose, onSaved }) {
  const { t } = useTranslation('registration')
  const { showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['reg-form', windowId, studentId], queryFn: () => fetchRegistrationForm(windowId, studentId) })
  const [picked, setPicked] = useState([])
  const [serverErrors, setServerErrors] = useState([])
  useEffect(() => {
    if (!data) return
    setPicked(data.registration?.courseIds ?? data.offerings.filter((o) => o.mandatory).map((o) => o.courseId))
  }, [data])
  const courses = useMemo(() => new Map((data?.offerings ?? []).map((o) => [o.courseId, o])), [data])
  const check = data ? checkRegistration(data.window, courses, picked) : { credits: 0, errors: [] }
  const toggle = (o) => setPicked((p) => (p.includes(o.courseId) ? p.filter((x) => x !== o.courseId) : [...p, o.courseId]))
  const save = useMutation({
    mutationFn: () => saveRegistration(windowId, studentId, picked),
    onSuccess: onSaved,
    onError: (e) => { setServerErrors(e.response?.data?.details?.errors ?? []); showError(e.message) },
  })
  if (isLoading || !data) return <Modal open onClose={onClose} title={t('registration.requests.loading')}><p className="text-sm text-ink-faint">{t('registration.requests.loading')}</p></Modal>
  const w = data.window
  const closed = w.status !== 'OPEN'
  const sections = [
    { key: 'core', title: t('registration.requests.compulsory'), items: data.offerings.filter((o) => o.mandatory) },
    ...w.groups.map((g) => ({ key: g.code, title: g.name || g.code, hint: t('registration.windows.pickRange', { min: g.minPick, max: g.maxPick }), items: data.offerings.filter((o) => !o.mandatory && o.group === g.code), group: g })),
    { key: 'other', title: t('registration.requests.otherCourses'), items: data.offerings.filter((o) => !o.mandatory && !o.group) },
  ].filter((s) => s.items.length)
  const problems = serverErrors.length ? serverErrors : check.errors
  const say = (e) => {
    const o = courses.get(String(e.courseId))
    const g = w.groups.find((x) => x.code === e.group)
    return t(`registration.errors.${e.code}`, {
      code: o?.code ?? '', group: g?.name || g?.code || '', min: g?.minPick ?? w.minCredits, max: g?.maxPick ?? w.maxCredits,
      credits: check.credits, needs: o?.prerequisites?.join(', ') ?? '', seats: o?.seats ?? '', defaultValue: e.message,
    })
  }
  return (
    <Modal open onClose={onClose} size="lg" title={t('registration.requests.formTitle', { name: data.student.name })}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button loading={save.isPending} disabled={closed || !picked.length} onClick={() => save.mutate()}>{data.registration ? t('registration.requests.saveChanges') : t('registration.requests.register')}</Button>
      </>}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-ink-muted">{[data.student.registerNo || data.student.admissionNo, `${w.programCode} · ${t('registration.semesterN', { n: w.semester })}`].join(' · ')}</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">{t('registration.requests.creditsOf', { credits: check.credits, min: w.minCredits ?? '—', max: w.maxCredits ?? '—' })}</span>
          <LevelBar bare value={check.credits} max={w.maxCredits || check.credits || 1} highIsBad dangerAt={(w.maxCredits ?? Infinity) + 0.01} warnAt={w.maxCredits ?? Infinity} width="w-28" />
        </div>
      </div>
      {closed && <Note tone="warning" className="mb-3">{t('registration.requests.closedNote')}</Note>}
      {data.registration && <div className="mb-3"><StatusPill tone={data.registration.status === 'APPROVED' ? 'success' : data.registration.status === 'REJECTED' ? 'danger' : 'warning'}>{t(`registration.regStatus.${data.registration.status}`)}</StatusPill>{data.registration.note && <span className="ms-2 text-xs text-ink-muted">{data.registration.note}</span>}</div>}
      <div className="space-y-4">
        {sections.map((s) => {
          const n = s.items.filter((o) => picked.includes(o.courseId)).length
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-sm font-semibold text-ink">{s.title}</p>
                {s.hint && <span className={clsx('text-xs', s.group && (n < s.group.minPick || n > s.group.maxPick) ? 'text-danger-600 font-medium' : 'text-ink-faint')}>{s.hint} · {t('registration.requests.picked', { n })}</span>}
              </div>
              <div className="grid gap-1.5">
                {s.items.map((o) => {
                  const on = picked.includes(o.courseId)
                  const full = o.seatsLeft === 0 && !(data.registration?.courseIds ?? []).includes(o.courseId)
                  const blocked = !o.prerequisitesMet
                  return (
                    <button key={o.courseId} type="button" onClick={() => toggle(o)} aria-pressed={on} disabled={closed}
                      className={clsx('flex items-center gap-3 rounded-lg border px-3 py-2 text-start transition-colors', on ? 'border-brand-300 bg-brand-50' : 'border-border bg-surface hover:bg-bg')}>
                      <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-border')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                      <CodeBadge>{o.code}</CodeBadge>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{o.title}</span>
                      {blocked && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger-600"><Lock className="h-3 w-3" />{t('registration.requests.needs', { codes: o.prerequisites.join(', ') })}</span>}
                      {o.seats ? <span className={clsx('text-[11px] tabular-nums', full ? 'text-danger-600 font-semibold' : 'text-ink-faint')}>{full ? t('registration.requests.full') : t('registration.requests.seatsLeft', { n: o.seatsLeft })}</span> : null}
                      <span className="w-16 text-right text-xs font-semibold text-ink-muted tabular-nums">{t('registration.requests.creditsN', { n: o.credits })}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {problems.length > 0 && (
        <Note tone={serverErrors.length ? 'danger' : 'warning'} icon={AlertTriangle} className="mt-4">
          <ul className="space-y-0.5">{problems.map((e, i) => <li key={i}>{say(e)}</li>)}</ul>
        </Note>
      )}
    </Modal>
  )
}
