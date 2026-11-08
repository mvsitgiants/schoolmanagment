import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, ChevronLeft, Pencil, Play, Plus, Square, X } from 'lucide-react'
import { APPRAISAL_CYCLE_STATUS, APPRAISAL_STATUS, EMPLOYEE_CATEGORIES, TEACHER_CRITERIA } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Select, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { closeCycle, createCycle, fetchCycleReviews, fetchCycles, launchCycle, rateAsHr, setReviewer, updateCycle } from '../../api/hrms'
import { fetchUsers } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels } from '../../components/hrms/HrKit'
import ReviewForm from '../../components/hrms/ReviewForm'

function CycleForm({ cycle, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const draft = !cycle || cycle.status === 'DRAFT'
  const [form, setForm] = useState({ name: cycle?.name ?? '', from: cycle?.from ?? '', to: cycle?.to ?? '', dueDate: cycle?.dueDate ?? '', selfReview: cycle?.selfReview ?? true, categories: cycle?.categories ?? ['TEACHING'] })
  const [criteria, setCriteria] = useState(() => (cycle?.criteria ?? TEACHER_CRITERIA).map((c) => ({ ...c, weight: String(c.weight ?? 1) })))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setC = (i, k, v) => setCriteria((x) => x.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  const total = criteria.reduce((n, c) => n + (Number(c.weight) || 0), 0)
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, ...(draft && { criteria: criteria.filter((c) => c.label.trim()).map((c) => ({ key: c.key, label: c.label, weight: Number(c.weight) || 1 })) }) }
      return cycle ? updateCycle(cycle.id, body) : createCycle(body)
    },
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="lg" title={cycle ? t('hrms.performance.editCycle') : t('hrms.performance.newCycle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>{t('hrms.performance.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><FormField label={t('hrms.performance.name')} required><Input value={form.name} onChange={set('name')} placeholder={t('hrms.performance.namePlaceholder')} /></FormField></div>
          <FormField label={t('hrms.performance.from')}><Input type="date" value={form.from} onChange={set('from')} /></FormField>
          <FormField label={t('hrms.performance.to')}><Input type="date" value={form.to} onChange={set('to')} /></FormField>
          <FormField label={t('hrms.performance.due')}><Input type="date" value={form.dueDate} onChange={set('dueDate')} /></FormField>
          <label className="inline-flex items-center gap-2 text-sm text-ink sm:mt-6"><input type="checkbox" checked={form.selfReview} onChange={set('selfReview')} className="rounded border-border text-brand-500" />{t('hrms.performance.selfReview')}</label>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-muted mb-1.5">{t('hrms.performance.covers')}</p>
          <div className="flex flex-wrap gap-2">
            {EMPLOYEE_CATEGORIES.map((c) => (
              <label key={c.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs">
                <input type="checkbox" checked={form.categories.includes(c.value)} onChange={() => setForm((f) => ({ ...f, categories: f.categories.includes(c.value) ? f.categories.filter((x) => x !== c.value) : [...f.categories, c.value] }))} className="rounded border-border text-brand-500" />{L.category(c.value)}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1">{t('hrms.performance.coversHint')}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-ink mb-2">{t('hrms.performance.criteria')} <span className="text-xs text-ink-faint">{t('hrms.performance.weightTotal', { n: total })}</span></p>
          {!draft && <Note className="mb-2">{t('hrms.performance.criteriaLocked')}</Note>}
          <div className="space-y-2">
            {criteria.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_auto] gap-2">
                <Input value={c.label} disabled={!draft} onChange={(e) => setC(i, 'label', e.target.value)} aria-label={t('hrms.performance.criterion')} />
                <Input type="number" min="0" disabled={!draft} value={c.weight} onChange={(e) => setC(i, 'weight', e.target.value)} aria-label={t('hrms.performance.weight')} />
                {draft ? <Button size="sm" variant="ghost" icon={X} aria-label={t('hrms.performance.remove')} onClick={() => setCriteria((x) => x.filter((_, j) => j !== i))} /> : <span />}
              </div>
            ))}
          </div>
          {draft && <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setCriteria((x) => [...x, { label: '', weight: '10' }])}>{t('hrms.performance.addCriterion')}</Button>}
        </div>
      </div>
    </Modal>
  )
}

function CycleDetail({ cycleId, onBack, onEdit }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [rating, setRating] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['cycle-reviews', cycleId], queryFn: () => fetchCycleReviews(cycleId) })
  const canEdit = hasPermission('hrms.performance.edit')
  const { data: users } = useQuery({ queryKey: ['users-all'], queryFn: () => fetchUsers({ pageSize: 500 }), enabled: canEdit })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cycle-reviews', cycleId] }); qc.invalidateQueries({ queryKey: ['appraisal-cycles'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(typeof v.done === 'function' ? v.done(r) : v.done) }, onError: (e) => showError(e.message) })
  if (isLoading || !data) return <p className="text-sm text-ink-faint">{t('hrms.loading')}</p>
  const c = data.cycle
  const open = c.status === 'OPEN'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('hrms.profile.back')} />
        <p className="font-semibold text-ink">{c.name}</p>
        <StatusPill tone={APPRAISAL_CYCLE_STATUS[c.status]?.tone}>{L.cycle(c.status)}</StatusPill>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && c.status !== 'CLOSED' && <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>{t('hrms.edit')}</Button>}
          {canEdit && c.status !== 'CLOSED' && <Button size="sm" icon={Play} onClick={async () => { if (await confirm({ title: t('hrms.performance.launchTitle'), message: t('hrms.performance.launchHint'), confirmLabel: t('hrms.performance.launch') })) act.mutate({ fn: () => launchCycle(c.id), done: (r) => t('hrms.performance.launched', { count: r.made }) }) }}>{c.status === 'DRAFT' ? t('hrms.performance.launch') : t('hrms.performance.addNew')}</Button>}
          {canEdit && open && <Button size="sm" variant="ghost" icon={Square} onClick={async () => { if (await confirm({ title: t('hrms.performance.closeTitle'), message: t('hrms.performance.closeHint'), confirmLabel: t('hrms.performance.close') })) act.mutate({ fn: () => closeCycle(c.id), done: t('hrms.performance.closed') }) }}>{t('hrms.performance.close')}</Button>}
        </div>
      </div>
      {c.status === 'DRAFT' && <Note>{t('hrms.performance.draftHint')}</Note>}
      <DataTable rows={data.rows} columns={[
        { key: 'employeeName', header: t('hrms.performance.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</p></div> },
        { key: 'reviewerName', header: t('hrms.performance.reviewer'), render: (v, r) => (canEdit && open && r.status !== 'DONE' ? (
          <div className="w-48" onClick={(e) => e.stopPropagation()}>
            <Select value={r.reviewerUserId ?? ''} onChange={(e) => act.mutate({ fn: () => setReviewer(r.id, e.target.value || null), done: t('hrms.performance.reviewerSet') })} aria-label={t('hrms.performance.reviewer')}>
              <option value="">{t('hrms.performance.hr')}</option>
              {(users?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        ) : (v ?? t('hrms.performance.hr'))) },
        { key: 'status', header: t('hrms.performance.status'), render: (v) => <StatusPill tone={APPRAISAL_STATUS[v]?.tone}>{L.review(v)}</StatusPill> },
        { key: 'self', header: t('hrms.performance.selfScore'), align: 'right', render: (v) => (v?.score != null ? v.score : '—') },
        { key: 'finalScore', header: t('hrms.performance.final'), align: 'right', render: (v) => (v != null ? <span className="font-semibold">{v}</span> : '—') },
        { key: 'id', header: '', align: 'right', width: 110, render: (_, r) => canEdit && open && r.status !== 'DONE' && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRating(r) }}>{t('hrms.performance.rateHr')}</Button> },
      ]} emptyIcon={Award} emptyTitle={t('hrms.performance.noReviews')} />
      {rating && <ReviewForm review={{ ...rating, cycle: c }} mode="manager" submit={(body) => rateAsHr(rating.id, body)} onClose={() => setRating(null)} onSaved={() => { setRating(null); refresh(); showSuccess(t('hrms.performance.rated')) }} />}
    </div>
  )
}

/** Staff & HR › Appraisal: review rounds, who reviews whom, and the scores. */
export default function Performance() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null)
  const { data: cycles = [], isLoading } = useQuery({ queryKey: ['appraisal-cycles'], queryFn: fetchCycles })
  return (
    <PageContainer>
      <PageHeader icon={Award} title={t('hrms.performance.title')} subtitle={t('hrms.performance.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="hrms.performance.create" onClick={() => setEditing('new')}>{t('hrms.performance.newCycle')}</HeaderButton>} />
      {openId ? <CycleDetail cycleId={openId} onBack={() => setOpenId(null)} onEdit={() => setEditing(cycles.find((c) => c.id === openId))} /> : (
        <DataTable rows={cycles} loading={isLoading} columns={[
          { key: 'name', header: t('hrms.performance.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{[r.from && r.to && `${date(r.from)} – ${date(r.to)}`, r.categories?.length ? r.categories.map(L.category).join(', ') : t('hrms.performance.everyone')].filter(Boolean).join(' · ')}</p></div> },
          { key: 'dueDate', header: t('hrms.performance.due'), render: (v) => (v ? date(v) : '—') },
          { key: 'total', header: t('hrms.performance.progress'), render: (v, r) => (v ? t('hrms.performance.doneOf', { done: r.byStatus?.DONE ?? 0, total: v }) : '—') },
          { key: 'status', header: t('hrms.performance.status'), render: (v) => <StatusPill tone={APPRAISAL_CYCLE_STATUS[v]?.tone}>{L.cycle(v)}</StatusPill> },
        ]} onRowClick={(r) => setOpenId(r.id)} emptyIcon={Award} emptyTitle={t('hrms.performance.noCycles')} emptyHint={t('hrms.performance.noCyclesHint')} />
      )}
      {editing && <CycleForm cycle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(c) => { setEditing(null); qc.invalidateQueries({ queryKey: ['appraisal-cycles'] }); qc.invalidateQueries({ queryKey: ['cycle-reviews'] }); setOpenId(c.id); showSuccess(t('hrms.performance.saved')) }} />}
    </PageContainer>
  )
}
