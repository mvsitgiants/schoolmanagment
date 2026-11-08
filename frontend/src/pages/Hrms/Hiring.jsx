import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Briefcase, ChevronLeft, Pencil, Plus, Star, UserCheck } from 'lucide-react'
import { CANDIDATE_SOURCES, CANDIDATE_STAGES, EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES, OPEN_CANDIDATE_STAGES, REQUISITION_STATUSES, toPaise, toRupees } from '@schoolgiant/shared'
import { Attachments, DataTable, Drawer, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill, Textarea, Timeline } from '../../components/system'
import Button from '../../components/ui/Button'
import {
  createCandidate, createRequisition, evaluateCandidate, fetchCandidate, fetchCandidates, fetchRequisitions, hireCandidate, moveCandidate, offerCandidate,
  setRequisitionStatus, updateCandidate, updateRequisition,
} from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels, useHrMeta } from '../../components/hrms/HrKit'

function VacancyForm({ vacancy, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const v = vacancy ?? {}
  const [form, setForm] = useState({ title: v.title ?? '', category: v.category ?? 'TEACHING', employmentType: v.employmentType ?? 'PERMANENT', count: String(v.count ?? 1), departmentId: v.departmentId ?? '', subjects: (v.subjects ?? []).join(', '), description: v.description ?? '', min: v.salaryRange?.min ? String(toRupees(v.salaryRange.min)) : '', max: v.salaryRange?.max ? String(toRupees(v.salaryRange.max)) : '', targetDate: v.targetDate ?? '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => {
      const body = { title: form.title, category: form.category, employmentType: form.employmentType, count: Number(form.count) || 1, departmentId: form.departmentId || null, subjects: form.subjects.split(',').map((s) => s.trim()).filter(Boolean), description: form.description, targetDate: form.targetDate, salaryRange: { min: form.min ? toPaise(form.min) : undefined, max: form.max ? toPaise(form.max) : undefined } }
      return vacancy ? updateRequisition(vacancy.id, body) : createRequisition(body)
    },
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={vacancy ? t('hrms.hiring.editVacancy') : t('hrms.hiring.newVacancy')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.hiring.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><FormField label={t('hrms.hiring.post')} required><Input value={form.title} onChange={set('title')} placeholder={t('hrms.hiring.postPlaceholder')} /></FormField></div>
        <FormField label={t('hrms.employees.category')}><Select value={form.category} onChange={set('category')}>{EMPLOYEE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.category(c.value)}</option>)}</Select></FormField>
        <FormField label={t('hrms.employees.employmentType')}><Select value={form.employmentType} onChange={set('employmentType')}>{EMPLOYMENT_TYPES.map((c) => <option key={c.value} value={c.value}>{L.employment(c.value)}</option>)}</Select></FormField>
        <FormField label={t('hrms.hiring.count')}><Input type="number" min="1" value={form.count} onChange={set('count')} /></FormField>
        <FormField label={t('hrms.employees.department')}>
          <Select value={form.departmentId} onChange={set('departmentId')}><option value="">{t('hrms.none')}</option>{(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </FormField>
        {form.category === 'TEACHING' && <div className="col-span-2"><FormField label={t('hrms.employees.subjects')}><Input value={form.subjects} onChange={set('subjects')} /></FormField></div>}
        <FormField label={t('hrms.hiring.salaryMin')}><Input type="number" min="0" value={form.min} onChange={set('min')} /></FormField>
        <FormField label={t('hrms.hiring.salaryMax')}><Input type="number" min="0" value={form.max} onChange={set('max')} /></FormField>
        <FormField label={t('hrms.hiring.targetDate')}><Input type="date" value={form.targetDate} onChange={set('targetDate')} /></FormField>
        <div className="col-span-2"><FormField label={t('hrms.hiring.description')}><Textarea rows={4} value={form.description} onChange={set('description')} /></FormField></div>
      </div>
    </Modal>
  )
}

function CandidateForm({ candidate, requisitionId, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const { showError } = useSnackbar()
  const c = candidate ?? {}
  const [form, setForm] = useState({ name: c.name ?? '', mobile: c.mobile ?? '', email: c.email ?? '', qualifications: c.qualifications ?? '', experienceYears: c.experienceYears ?? '', currentEmployer: c.currentEmployer ?? '', expected: c.expectedSalary ? String(toRupees(c.expectedSalary)) : '', source: c.source ?? 'OTHER' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, mobile: form.mobile, email: form.email, qualifications: form.qualifications, experienceYears: form.experienceYears, currentEmployer: form.currentEmployer, expectedSalary: form.expected ? toPaise(form.expected) : '', source: form.source }
      return candidate ? updateCandidate(candidate.id, body) : createCandidate({ ...body, requisitionId })
    },
    onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={candidate ? t('hrms.hiring.editCandidate') : t('hrms.hiring.newCandidate')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.hiring.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><FormField label={t('hrms.employees.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField></div>
        <FormField label={t('hrms.employees.mobile')} error={errors.mobile}><Input value={form.mobile} onChange={set('mobile')} inputMode="tel" /></FormField>
        <FormField label={t('hrms.employees.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
        <div className="col-span-2"><FormField label={t('hrms.employees.qualifications')}><Input value={form.qualifications} onChange={set('qualifications')} /></FormField></div>
        <FormField label={t('hrms.employees.experience')}><Input type="number" min="0" value={form.experienceYears} onChange={set('experienceYears')} /></FormField>
        <FormField label={t('hrms.hiring.currentEmployer')}><Input value={form.currentEmployer} onChange={set('currentEmployer')} /></FormField>
        <FormField label={t('hrms.hiring.expected')}><Input type="number" min="0" value={form.expected} onChange={set('expected')} /></FormField>
        <FormField label={t('hrms.hiring.source')}><Select value={form.source} onChange={set('source')}>{CANDIDATE_SOURCES.map((s) => <option key={s} value={s}>{t(`hrms.hiring.sources.${s}`)}</option>)}</Select></FormField>
      </div>
    </Modal>
  )
}

/** One candidate: their step, a demo class or interview to book, feedback, the offer, and joining. */
function CandidateDrawer({ id, onClose, onChanged }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const { data: c } = useQuery({ queryKey: ['candidate', id], queryFn: () => fetchCandidate(id) })
  const [move, setMove] = useState({ stage: '', date: '', time: '', panel: '', note: '' })
  const [ev, setEv] = useState({ rating: 0, note: '' })
  const [offer, setOffer] = useState({ joiningDate: '', salary: '', designation: '' })
  const [hire, setHire] = useState({ reportingManagerId: '' })
  const [editing, setEditing] = useState(false)
  const done = (msg) => () => { qc.invalidateQueries({ queryKey: ['candidate', id] }); onChanged(); showSuccess(msg) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => done(v.done)(), onError: (e) => showError(e.message) })
  const canEdit = hasPermission('hrms.hiring.edit')
  if (!c) return <Drawer open onClose={onClose} title={t('hrms.loading')}><span /></Drawer>
  const closed = ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c.stage)
  const booking = ['DEMO', 'INTERVIEW'].includes(move.stage)
  return (
    <Drawer open onClose={onClose} size="lg" title={c.name} subtitle={[c.requisition?.title, c.mobile].filter(Boolean).join(' · ')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={CANDIDATE_STAGES[c.stage]?.tone}>{L.stage(c.stage)}</StatusPill>
          {c.rating && <span className="inline-flex items-center gap-1 text-sm text-amber-700"><Star className="h-4 w-4" />{c.rating}</span>}
          {c.next?.date && <span className="text-xs text-ink-muted">{t('hrms.hiring.booked', { what: L.stage(c.next.kind), date: date(c.next.date), time: c.next.time ?? '', panel: c.next.panel ?? '' })}</span>}
          {canEdit && <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto" onClick={() => setEditing(true)}>{t('hrms.edit')}</Button>}
        </div>
        <p className="text-sm text-ink-muted">{[c.qualifications, c.experienceYears != null && t('hrms.profile.years', { count: c.experienceYears }), c.currentEmployer].filter(Boolean).join(' · ')}</p>
        {c.expectedSalary ? <p className="text-sm">{t('hrms.hiring.expected')}: <Money value={c.expectedSalary} paise /></p> : null}
        {c.employeeId && <Note tone="success">{t('hrms.hiring.joinedNote')}</Note>}

        {canEdit && !closed && (
          <Panel title={t('hrms.hiring.moveTitle')}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Select value={move.stage} onChange={(e) => setMove((m) => ({ ...m, stage: e.target.value }))} aria-label={t('hrms.hiring.stage')}>
                <option value="">{t('hrms.hiring.pickStage')}</option>
                {Object.keys(CANDIDATE_STAGES).filter((s) => s !== 'HIRED' && s !== 'OFFERED' && s !== c.stage).map((s) => <option key={s} value={s}>{L.stage(s)}</option>)}
              </Select>
              {booking && <Input type="date" value={move.date} onChange={(e) => setMove((m) => ({ ...m, date: e.target.value }))} aria-label={t('hrms.hiring.date')} />}
              {booking && <Input type="time" value={move.time} onChange={(e) => setMove((m) => ({ ...m, time: e.target.value }))} aria-label={t('hrms.hiring.time')} />}
              {booking && <Input value={move.panel} onChange={(e) => setMove((m) => ({ ...m, panel: e.target.value }))} placeholder={t('hrms.hiring.panel')} />}
              <div className="sm:col-span-2"><Input value={move.note} onChange={(e) => setMove((m) => ({ ...m, note: e.target.value }))} placeholder={t('hrms.hiring.note')} /></div>
            </div>
            <Button size="sm" className="mt-3" disabled={!move.stage || (booking && !move.date)} loading={act.isPending}
              onClick={() => act.mutate({ fn: () => moveCandidate(id, { stage: move.stage, note: move.note, next: booking ? { date: move.date, time: move.time, panel: move.panel } : undefined }), done: t('hrms.hiring.moved') })}>{t('hrms.hiring.move')}</Button>
          </Panel>
        )}

        {canEdit && !closed && (
          <Panel title={t('hrms.hiring.feedback')}>
            <div className="flex gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={String(n)} onClick={() => setEv((x) => ({ ...x, rating: n }))}><Star className={`h-6 w-6 ${n <= ev.rating ? 'fill-amber-400 text-amber-400' : 'text-ink-faint'}`} /></button>)}
            </div>
            <Textarea rows={2} value={ev.note} onChange={(e) => setEv((x) => ({ ...x, note: e.target.value }))} placeholder={t('hrms.hiring.feedbackHint')} />
            <Button size="sm" className="mt-2" disabled={!ev.rating} onClick={() => act.mutate({ fn: () => evaluateCandidate(id, ev), done: t('hrms.hiring.feedbackSaved') })}>{t('hrms.hiring.saveFeedback')}</Button>
          </Panel>
        )}

        {canEdit && !closed && c.stage !== 'OFFERED' && (
          <Panel title={t('hrms.hiring.offerTitle')}>
            <div className="grid sm:grid-cols-3 gap-3">
              <FormField label={t('hrms.hiring.joining')} required><Input type="date" value={offer.joiningDate} onChange={(e) => setOffer((o) => ({ ...o, joiningDate: e.target.value }))} /></FormField>
              <FormField label={t('hrms.hiring.offerSalary')}><Input type="number" min="0" value={offer.salary} onChange={(e) => setOffer((o) => ({ ...o, salary: e.target.value }))} /></FormField>
              <FormField label={t('hrms.employees.designation')}><Input value={offer.designation} onChange={(e) => setOffer((o) => ({ ...o, designation: e.target.value }))} placeholder={c.requisition?.title} /></FormField>
            </div>
            <Button size="sm" className="mt-2" disabled={!offer.joiningDate} onClick={() => act.mutate({ fn: () => offerCandidate(id, { joiningDate: offer.joiningDate, salary: offer.salary ? toPaise(offer.salary) : undefined, designation: offer.designation }), done: t('hrms.hiring.offered') })}>{t('hrms.hiring.makeOffer')}</Button>
          </Panel>
        )}

        {canEdit && c.stage === 'OFFERED' && hasPermission('hrms.employees.create') && (
          <Panel title={t('hrms.hiring.hireTitle')} subtitle={t('hrms.hiring.hireHint', { date: c.offer?.joiningDate ? date(c.offer.joiningDate) : '—' })}>
            <FormField label={t('hrms.employees.manager')}>
              <Select value={hire.reportingManagerId} onChange={(e) => setHire({ reportingManagerId: e.target.value })}>
                <option value="">{t('hrms.none')}</option>
                {(meta?.staff ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </FormField>
            <Button size="sm" icon={UserCheck} className="mt-2" loading={act.isPending} onClick={() => act.mutate({ fn: () => hireCandidate(id, { reportingManagerId: hire.reportingManagerId || null }), done: t('hrms.hiring.hired') })}>{t('hrms.hiring.hire')}</Button>
          </Panel>
        )}

        {(c.evaluations ?? []).length > 0 && (
          <Panel title={t('hrms.hiring.feedbackList')}>
            {c.evaluations.map((e) => (
              <div key={e.id ?? e.at} className="py-2 border-b border-border last:border-0">
                <p className="text-sm text-ink"><Star className="inline h-3.5 w-3.5 text-amber-500" /> {e.rating}/5 · {L.stage(e.stage)}</p>
                {e.note && <p className="text-sm text-ink-muted">{e.note}</p>}
                <p className="text-[11px] text-ink-faint">{e.by} · {dateTime(e.at)}</p>
              </div>
            ))}
          </Panel>
        )}
        <Panel title={t('hrms.hiring.files')}><Attachments entityType="candidate" entityId={c.id} canAdd={canEdit} compact /></Panel>
        <Panel title={t('hrms.hiring.history')}>
          <Timeline dense items={[...(c.history ?? [])].reverse().map((h, i) => ({ id: String(i), title: L.stage(h.stage), time: dateTime(h.at), meta: h.by, body: h.note }))} />
        </Panel>
      </div>
      {editing && <CandidateForm candidate={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done(t('hrms.hiring.saved'))() }} />}
    </Drawer>
  )
}

function VacancyDetail({ vacancy, onBack, onEdit }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [stage, setStage] = useState('OPEN')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['candidates', vacancy.id, stage], queryFn: () => fetchCandidates({ requisitionId: vacancy.id, stage: stage || undefined }) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['candidates'] }); qc.invalidateQueries({ queryKey: ['requisitions'] }) }
  const status = useMutation({ mutationFn: (s) => setRequisitionStatus(vacancy.id, { status: s }), onSuccess: () => { refresh(); showSuccess(t('hrms.hiring.statusSaved')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('hrms.hiring.edit')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('hrms.profile.back')} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{vacancy.title} <span className="text-xs font-mono-num text-ink-faint">{vacancy.requisitionNo}</span></p>
          <p className="text-xs text-ink-muted">{[L.category(vacancy.category), L.employment(vacancy.employmentType), t('hrms.hiring.filledOf', { filled: vacancy.filled ?? 0, count: vacancy.count }), vacancy.targetDate && t('hrms.hiring.by', { date: date(vacancy.targetDate) })].filter(Boolean).join(' · ')}</p>
        </div>
        <StatusPill tone={REQUISITION_STATUSES[vacancy.status]?.tone}>{L.reqStatus(vacancy.status)}</StatusPill>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>{t('hrms.edit')}</Button>}
          {canEdit && vacancy.status === 'OPEN' && <Button size="sm" variant="ghost" onClick={() => status.mutate('ON_HOLD')}>{t('hrms.hiring.hold')}</Button>}
          {canEdit && vacancy.status !== 'OPEN' && <Button size="sm" variant="ghost" onClick={() => status.mutate('OPEN')}>{t('hrms.hiring.reopen')}</Button>}
          {canEdit && !['CLOSED', 'FILLED'].includes(vacancy.status) && <Button size="sm" variant="ghost" onClick={() => status.mutate('CLOSED')}>{t('hrms.hiring.close')}</Button>}
          {hasPermission('hrms.hiring.create') && <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>{t('hrms.hiring.addCandidate')}</Button>}
        </div>
      </div>
      <SegmentedControl value={stage} onChange={setStage} options={[{ value: 'OPEN', label: t('hrms.hiring.inProcess') }, ...['HIRED', 'REJECTED', 'WITHDRAWN'].map((s) => ({ value: s, label: L.stage(s) })), { value: '', label: t('hrms.all') }]} />
      <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'name', header: t('hrms.hiring.candidate'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.mobile, r.qualifications].filter(Boolean).join(' · ')}</p></div> },
        { key: 'stage', header: t('hrms.hiring.stage'), render: (v, r) => <span><StatusPill tone={CANDIDATE_STAGES[v]?.tone}>{L.stage(v)}</StatusPill>{r.next?.date && <span className="block text-[11px] text-ink-faint mt-0.5">{date(r.next.date)} {r.next.time ?? ''}</span>}</span> },
        { key: 'rating', header: t('hrms.hiring.rating'), align: 'right', render: (v) => (v ? <span className="text-amber-700">★ {v}</span> : '—') },
        { key: 'source', header: t('hrms.hiring.source'), mobileHidden: true, render: (v) => t(`hrms.hiring.sources.${v}`, v) },
      ]} onRowClick={(r) => setOpenId(r.id)} emptyTitle={t('hrms.hiring.noCandidates')} />
      {vacancy.description && <Panel title={t('hrms.hiring.description')}><p className="text-sm text-ink-muted whitespace-pre-line">{vacancy.description}</p></Panel>}
      {adding && <CandidateForm requisitionId={vacancy.id} onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); refresh(); setOpenId(c.id); showSuccess(t('hrms.hiring.saved')) }} />}
      {openId && <CandidateDrawer id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  )
}

/** Staff & HR › Recruitment: vacancies and the people applying, through the demo class and interview to joining. */
export default function Hiring() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [status, setStatus] = useState('ACTIVE')
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['requisitions', status], queryFn: () => fetchRequisitions(status) })
  const open = rows.find((r) => r.id === openId)
  return (
    <PageContainer>
      <PageHeader icon={Briefcase} title={t('hrms.hiring.title')} subtitle={t('hrms.hiring.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="hrms.hiring.create" onClick={() => setEditing('new')}>{t('hrms.hiring.newVacancy')}</HeaderButton>} />
      {open ? <VacancyDetail vacancy={open} onBack={() => setOpenId(null)} onEdit={() => setEditing(open)} /> : (
        <>
          <SegmentedControl className="mb-3" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: t('hrms.hiring.active') }, { value: 'FILLED', label: L.reqStatus('FILLED') }, { value: 'CLOSED', label: L.reqStatus('CLOSED') }, { value: 'ALL', label: t('hrms.all') }]} />
          <DataTable rows={rows} loading={isLoading} columns={[
            { key: 'title', header: t('hrms.hiring.post'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.requisitionNo, L.category(r.category), r.department].filter(Boolean).join(' · ')}</p></div> },
            { key: 'count', header: t('hrms.hiring.posts'), align: 'right', render: (v, r) => t('hrms.hiring.filledOf', { filled: r.filled ?? 0, count: v }) },
            { key: 'inProcess', header: t('hrms.hiring.inProcess'), align: 'right', render: (v, r) => <span>{v}<span className="text-xs text-ink-faint"> / {r.candidates}</span></span> },
            { key: 'byStage', header: t('hrms.hiring.pipeline'), mobileHidden: true, render: (v) => <span className="text-xs text-ink-muted">{OPEN_CANDIDATE_STAGES.filter((s) => v?.[s]).map((s) => `${L.stage(s)} ${v[s]}`).join(' · ') || '—'}</span> },
            { key: 'targetDate', header: t('hrms.hiring.targetDate'), mobileHidden: true, render: (v) => (v ? date(v) : '—') },
            { key: 'status', header: t('hrms.employees.status'), render: (v) => <StatusPill tone={REQUISITION_STATUSES[v]?.tone}>{L.reqStatus(v)}</StatusPill> },
          ]} onRowClick={(r) => setOpenId(r.id)} emptyIcon={Briefcase} emptyTitle={t('hrms.hiring.noVacancies')} />
          <p className="text-xs text-ink-faint mt-3">{t('hrms.hiring.joinHint')} <button type="button" className="underline" onClick={() => navigate('/hrms/employees')}>{t('hrms.employees.title')}</button></p>
        </>
      )}
      {editing && <VacancyForm vacancy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(v) => { setEditing(null); qc.invalidateQueries({ queryKey: ['requisitions'] }); if (!openId) setOpenId(v.id); showSuccess(t('hrms.hiring.saved')) }} />}
    </PageContainer>
  )
}
