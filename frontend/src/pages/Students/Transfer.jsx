import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, CheckCircle2, ClipboardCheck, Hourglass, ListChecks, Pencil, Plus, Printer, RotateCcw, XCircle } from 'lucide-react'
import { CONDUCT_OPTIONS, LEAVING_REASONS, TC_FAILED, TC_STATUS, formatINR } from '@schoolgiant/shared'
import { DateInput, CodeBadge, ColorChip, ControlChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, PersonCell, Select, StackCell, StatCardRow, StatusPill, Textarea, Toolbar, presetRange, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { cancelTc, fetchStudent, fetchStudents, fetchTcChecks, fetchTcPrefill, fetchTcs, issueTc, requestTc, tcWindUpStep, updateTc } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import LeavingChecks from '../../components/students/LeavingChecks'

const PAGE = 50
// the leaving-date filter: every TC, or one financial year (1 Apr – 31 Mar, close to the school year)
const PERIODS = ['', 'thisFy', 'lastFy']

// the CBSE-format TC rows the form fills; whatever is left empty prints as a blank line to write in by hand
const DETAIL_KEYS = ['bookNo', 'applicationDate', 'lastExam', 'lastExamResult', 'failed', 'subjects', 'concession', 'workingDays', 'presentDays', 'nccScoutGuide', 'games']
const EDIT_KEYS = ['leavingDate', 'reason', 'reasonText', 'conduct', 'promotedTo', 'feesPaidUpTo', 'remarks', ...DETAIL_KEYS]
const blankForm = (studentId) => ({
  studentId: studentId ?? '', leavingDate: new Date().toISOString().slice(0, 10), reason: 'TRANSFER', reasonText: '', conduct: 'Good', promotedTo: '', feesPaidUpTo: '', remarks: '',
  bookNo: '', applicationDate: new Date().toISOString().slice(0, 10), lastExam: '', lastExamResult: '', failed: 'NO', subjects: '', concession: '', workingDays: '', presentDays: '', nccScoutGuide: '', games: '',
})
const fromTc = (tc) => ({ studentId: tc.studentId, ...Object.fromEntries(EDIT_KEYS.map((k) => [k, k === 'subjects' ? (tc.subjects ?? []).join(', ') : tc[k] ?? ''])) })
const toBody = (form) => ({ ...form, subjects: String(form.subjects ?? '').split(',').map((x) => x.trim()).filter(Boolean) })

const Heading = ({ children }) => <div className="sm:col-span-2 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted border-b border-border pb-1">{children}</div>

/** Ask for a TC (`tc` empty), or correct one still waiting for approval (`tc` given). */
function TcForm({ studentId: presetId, tc, onClose, onSaved }) {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const editing = !!tc
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data: found } = useQuery({ queryKey: ['students', 'tc-pick', q], queryFn: () => fetchStudents({ search: q, pageSize: 20 }), enabled: !!q && !editing })
  const { data: preset } = useQuery({ queryKey: ['student', presetId, false], queryFn: () => fetchStudent(presetId), enabled: !!presetId && !editing })
  const [form, setForm] = useState(() => (editing ? fromTc(tc) : blankForm(presetId)))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const options = [...(preset ? [preset] : []), ...(found?.data ?? []).filter((x) => x.id !== preset?.id)]
  const picked = options.find((s) => s.id === form.studentId)
  // what the school already knows (subjects, attendance, fees, last exam) fills the empty boxes once a student is picked
  const { data: known } = useQuery({ queryKey: ['tc-prefill', form.studentId], queryFn: () => fetchTcPrefill(form.studentId), enabled: !!form.studentId && !editing })
  useEffect(() => {
    if (!known) return
    setForm((f) => ({
      ...f,
      subjects: f.subjects || (known.subjects ?? []).join(', '),
      workingDays: f.workingDays === '' && known.workingDays != null ? known.workingDays : f.workingDays,
      presentDays: f.presentDays === '' && known.presentDays != null ? known.presentDays : f.presentDays,
      feesPaidUpTo: f.feesPaidUpTo || known.feesPaidUpTo || '',
      concession: f.concession || known.concession || '',
      lastExam: f.lastExam || known.lastExam || '',
      lastExamResult: f.lastExamResult || known.lastExamResult || '',
    }))
  }, [known])
  // what the records say is still open on the leaving date: shown while the TC is asked for, so the family can be told
  const leaving = useDebouncedValue(form.leavingDate, 400)
  const { data: checks } = useQuery({ queryKey: ['tc-checks', form.studentId, leaving], queryFn: () => fetchTcChecks(form.studentId, leaving), enabled: !!form.studentId && /^\d{4}-\d{2}-\d{2}$/.test(leaving ?? '') })
  const save = useMutation({
    mutationFn: () => (editing ? updateTc(tc.id, toBody(Object.fromEntries(EDIT_KEYS.map((k) => [k, form[k]])))) : requestTc(toBody(form))),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={editing ? t('students.transfer.editTitle', { name: tc.snapshot?.name }) : t('students.transfer.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.leavingDate} onClick={() => save.mutate()}>{editing ? t('actions.save') : t('students.transfer.request')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {!editing && <>
          <FormField label={t('students.transfer.findStudent')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('students.directory.search')} /></FormField>
          <FormField label={t('students.directory.student')} required error={errors.studentId}>
            <Select value={form.studentId} onChange={set('studentId')}>
              <option value="">{t('students.transfer.pickStudent')}</option>
              {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.classShort ?? '—'} · {s.admissionNo}</option>)}
            </Select>
          </FormField>
        </>}
        <Heading>{t('students.transfer.sections.leaving')}</Heading>
        <FormField label={t('students.transfer.leavingDate')} required error={errors.leavingDate}><DateInput value={form.leavingDate} onChange={set('leavingDate')} /></FormField>
        <FormField label={t('students.transfer.applicationDate')} error={errors.applicationDate}><DateInput value={form.applicationDate} onChange={set('applicationDate')} /></FormField>
        <FormField label={t('students.transfer.reason')} required>
          <Select value={form.reason} onChange={set('reason')}>{LEAVING_REASONS.map((r) => <option key={r.value} value={r.value}>{t(`students.transfer.reasons.${r.value}`, r.label)}</option>)}</Select>
        </FormField>
        <FormField label={t('students.transfer.conduct')}>
          <Select value={form.conduct} onChange={set('conduct')}>{CONDUCT_OPTIONS.map((c) => <option key={c} value={c}>{t(`students.transfer.conducts.${c.replace(/\s/g, '')}`, c)}</option>)}</Select>
        </FormField>
        {form.reason === 'OTHER' && <div className="sm:col-span-2"><FormField label={t('students.transfer.reasonText')}><Input value={form.reasonText} onChange={set('reasonText')} /></FormField></div>}
        {form.studentId && checks?.checks?.length > 0 && <div className="sm:col-span-2"><LeavingChecks data={checks} compact /></div>}

        <Heading>{t('students.transfer.sections.studies')}</Heading>
        <FormField label={t('students.transfer.lastExam')} hint={t('students.transfer.lastExamHint')} error={errors.lastExam}><Input value={form.lastExam} onChange={set('lastExam')} placeholder={t('students.transfer.lastExamPlaceholder')} /></FormField>
        <FormField label={t('students.transfer.lastExamResult')} error={errors.lastExamResult}><Input value={form.lastExamResult} onChange={set('lastExamResult')} placeholder={t('students.transfer.lastExamResultPlaceholder')} /></FormField>
        <FormField label={t('students.transfer.failed')}>
          <Select value={form.failed} onChange={set('failed')}>{TC_FAILED.map((x) => <option key={x.value} value={x.value}>{t(`students.transfer.faileds.${x.value}`, x.label)}</option>)}</Select>
        </FormField>
        <FormField label={t('students.transfer.promotedTo')} hint={t('students.transfer.promotedHint')}><Input value={form.promotedTo} onChange={set('promotedTo')} placeholder={picked?.classShort || editing ? t('students.transfer.promotedPlaceholder') : ''} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('students.transfer.subjects')} hint={t('students.transfer.subjectsHint')} error={errors.subjects}><Input value={form.subjects} onChange={set('subjects')} /></FormField></div>

        <Heading>{t('students.transfer.sections.attendance')}</Heading>
        <FormField label={t('students.transfer.workingDays')} error={errors.workingDays}><Input type="number" min={0} value={form.workingDays} onChange={set('workingDays')} /></FormField>
        <FormField label={t('students.transfer.presentDays')} error={errors.presentDays}><Input type="number" min={0} step="0.5" value={form.presentDays} onChange={set('presentDays')} /></FormField>
        <FormField label={t('students.transfer.feesPaidUpTo')}><Input value={form.feesPaidUpTo} onChange={set('feesPaidUpTo')} placeholder={t('students.transfer.feesPlaceholder')} /></FormField>
        <FormField label={t('students.transfer.concession')} hint={t('students.transfer.concessionHint')}><Input value={form.concession} onChange={set('concession')} /></FormField>

        <Heading>{t('students.transfer.sections.activities')}</Heading>
        <FormField label={t('students.transfer.nccScoutGuide')} hint={t('students.transfer.nccHint')}><Input value={form.nccScoutGuide} onChange={set('nccScoutGuide')} /></FormField>
        <FormField label={t('students.transfer.games')} hint={t('students.transfer.gamesHint')}><Input value={form.games} onChange={set('games')} /></FormField>

        <Heading>{t('students.transfer.sections.office')}</Heading>
        <FormField label={t('students.transfer.bookNo')} hint={t('students.transfer.bookNoHint')}><Input value={form.bookNo} onChange={set('bookNo')} /></FormField>
        <div />
        <div className="sm:col-span-2"><FormField label={t('students.transfer.remarks')}><Textarea rows={2} value={form.remarks} onChange={set('remarks')} /></FormField></div>
      </div>
    </Modal>
  )
}

/**
 * Issue a TC: first what the records show on the leaving date. All clear — issue. Dues open (fees, library) — they
 * are listed and the TC is only issued "anyway" with a reason, which stays on the TC's record.
 */
function IssueTc({ tc, onClose, onIssued }) {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const [reason, setReason] = useState('')
  const [skip, setSkip] = useState([]) // wind-up steps the approver unticked
  const { data: checks, error } = useQuery({ queryKey: ['tc-checks', tc.studentId, tc.leavingDate], queryFn: () => fetchTcChecks(tc.studentId, tc.leavingDate) })
  const dues = checks?.dues ?? 0
  // what issuing can wind up on the leaving date (the canteen balance is paid back by hand, afterwards)
  const windable = (checks?.checks ?? []).filter((c) => c.kind === 'TIDY' && !c.ok && c.key !== 'canteen')
  const wallet = (checks?.checks ?? []).find((c) => c.key === 'canteen' && !c.ok)
  const issue = useMutation({
    mutationFn: () => issueTc(tc.id, dues ? { reason: reason.trim() } : undefined, windable.map((c) => c.key).filter((k) => !skip.includes(k))),
    onSuccess: onIssued,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} size="md" title={t('students.transfer.issueConfirm.title', { name: tc.snapshot?.name })} subtitle={t('students.transfer.issueConfirm.message')}
      footer={<>
        <Button variant="ghost" icon={ClipboardCheck} className="me-auto" onClick={() => printDocument('STUDENT_NO_DUES', tc.studentId)}>{t('students.leaving.printSlip')}</Button>
        <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button variant={dues ? 'danger' : 'primary'} icon={CheckCircle2} loading={issue.isPending} disabled={!checks || (dues > 0 && reason.trim().length < 5)} onClick={() => issue.mutate()}>
          {dues ? t('students.leaving.issueAnyway') : t('students.transfer.issue')}
        </Button>
      </>}>
      <div className="space-y-4">
        {error ? <p className="text-sm text-danger-600">{error.message}</p> : <LeavingChecks data={checks} />}
        {checks && !checks.checks.length && <p className="text-sm text-ink-muted">{t('students.leaving.noModules')}</p>}
        {dues > 0 && (
          <FormField label={t('students.leaving.anywayReason')} hint={t('students.leaving.anywayHint')} required>
            <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        )}
        {windable.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">{t('students.leaving.windUpTitle')}</p>
            {windable.map((c) => (
              <label key={c.key} className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="mt-0.5 rounded border-border text-brand-600" checked={!skip.includes(c.key)} onChange={(e) => setSkip((x) => (e.target.checked ? x.filter((k) => k !== c.key) : [...x, c.key]))} />
                <span>{t(`students.leaving.windUp.${c.key}`, { count: c.bills?.length ?? 0, amount: formatINR(c.total ?? 0), route: c.route ?? '', place: [c.block, c.room].filter(Boolean).join(' ') })}</span>
              </label>
            ))}
            <p className="text-xs text-ink-muted">{t('students.leaving.windUpHint')}</p>
          </div>
        )}
        {wallet && <p className="text-xs text-ink-muted">{t('students.leaving.walletAfter', { amount: formatINR(wallet.balance) })}</p>}
      </div>
    </Modal>
  )
}

const STEP_TONE = { DONE: 'success', PENDING: 'warning', UNDONE: 'neutral' }

/** An issued TC's wind-up: each step with what it did — undo a done one, do one left to do, record the wallet paid back. */
function WindUp({ tc, onClose, onChanged }) {
  const { t } = useTranslation('students')
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const [pay, setPay] = useState({ mode: 'CASH', reference: '' })
  const [items, setItems] = useState(tc.windUp ?? [])
  const step = useMutation({
    mutationFn: ({ key, action }) => tcWindUpStep(tc.id, key, { action, ...(key === 'canteen' && action === 'do' ? { mode: pay.mode, reference: pay.reference.trim() || undefined } : {}) }),
    onSuccess: (next) => { setItems(next.windUp ?? []); onChanged() },
    onError: (e) => showError(e.message),
  })
  const busy = (key, action) => step.isPending && step.variables?.key === key && step.variables?.action === action
  return (
    <Modal open onClose={onClose} size="md" title={t('students.leaving.windUpOf', { name: tc.snapshot?.name, no: tc.tcNo })} footer={<Button variant="secondary" onClick={onClose}>{t('actions.close')}</Button>}>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {items.map((it) => (
          <li key={it.key} className="px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{t(`students.leaving.steps.${it.key}`)}</span>
                <span className="block text-xs text-ink-muted break-words">{[it.key === 'canteen' && it.amount ? formatINR(it.amount) : null, it.note, it.status === 'UNDONE' ? t('students.leaving.undoneBy', { name: it.undoneBy, at: dateTime(it.undoneAt) }) : it.by && `${it.by}, ${dateTime(it.at)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusPill tone={STEP_TONE[it.status]}>{t(`students.leaving.stepStatus.${it.status}`)}</StatusPill>
              {it.status === 'DONE' && it.key !== 'canteen' && it.refs?.length > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} loading={busy(it.key, 'undo')} onClick={() => step.mutate({ key: it.key, action: 'undo' })}>{t('students.leaving.undo')}</Button>}
              {it.status !== 'DONE' && it.key !== 'canteen' && <Button size="sm" icon={CheckCircle2} loading={busy(it.key, 'do')} onClick={() => step.mutate({ key: it.key, action: 'do' })}>{t('students.leaving.doNow')}</Button>}
            </div>
            {it.key === 'canteen' && it.status === 'PENDING' && (
              <div className="grid sm:grid-cols-[140px_1fr_auto] gap-2 items-end">
                <FormField label={t('students.leaving.paidBy')}><Select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}><option value="CASH">{t('students.leaving.cash')}</option><option value="BANK">{t('students.leaving.bank')}</option></Select></FormField>
                <FormField label={t('students.leaving.reference')}><Input value={pay.reference} maxLength={60} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></FormField>
                <Button loading={busy('canteen', 'do')} onClick={() => step.mutate({ key: 'canteen', action: 'do' })}>{t('students.leaving.paidBack')}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export default function Transfer() {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showSuccess, showError } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('')
  const [page, setPage] = useState(1)
  const [asking, setAsking] = useState(null)
  const [editing, setEditing] = useState(null)
  const [issuing, setIssuing] = useState(null)
  const [winding, setWinding] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const range = period ? presetRange(period) : null
  const query = { status: status || undefined, search: q || undefined, from: range?.from, to: range?.to, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tcs', query], queryFn: () => fetchTcs(query), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  // the tiles count each status over the same search and dates, whichever status is picked (counted on the server)
  const tally = data?.counts ?? {}
  const pickStatus = (s) => { setStatus(s); setPage(1) }
  const periodLabel = (p) => (p ? t(`ui:ui.dateRange.${p}`) : t('students.all'))
  useEffect(() => { const sid = params.get('student'); if (sid) { setAsking(sid); setParams({}, { replace: true }) } }, [params, setParams])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tcs'] }); qc.invalidateQueries({ queryKey: ['students'] }); qc.invalidateQueries({ queryKey: ['student'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const statusLabel = (s) => (s ? t(`students.transfer.status.${s}`, TC_STATUS[s]?.label) : t('students.all'))
  const STATUSES = ['', 'REQUESTED', 'ISSUED', 'CANCELLED']
  const STATUS_LOOK = { REQUESTED: { icon: Hourglass, tone: 'warning' }, ISSUED: { icon: CheckCircle2, tone: 'success' }, CANCELLED: { icon: XCircle, tone: 'neutral' } }

  return (
    <PageContainer>
      <PageHeader icon={ArrowLeftRight} title={t('students.transfer.title')} subtitle={t('students.transfer.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setAsking('new')}>{t('students.transfer.new')}</HeaderButton>} />
      {Object.values(tally).some(Boolean) && (
        <StatCardRow className="mb-4" items={STATUSES.filter(Boolean).map((k) => ({
          label: statusLabel(k), value: tally[k] ?? 0, ...STATUS_LOOK[k],
          onClick: () => pickStatus(status === k ? '' : k),
          className: status === k ? 'ring-2 ring-brand-400' : status ? 'opacity-60 hover:opacity-100' : undefined,
        }))} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('students.transfer.search')} right={<div className="flex flex-wrap gap-2">
          <ControlChip label={t('students.transfer.leavingDate')} value={periodLabel(period)} active={!!period} options={PERIODS.map(periodLabel)} onChange={(v) => { setPeriod(PERIODS.find((p) => periodLabel(p) === v) ?? ''); setPage(1) }} />
          <ControlChip label={t('students.status.title')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => pickStatus(STATUSES.find((s) => statusLabel(s) === v) ?? '')} />
        </div>} />}
        columns={[
          { key: 'tcNo', header: t('students.transfer.tcNo'), render: (v) => (v ? <CodeBadge tone="success">{v}</CodeBadge> : <span className="text-xs text-ink-faint">{t('students.transfer.draft')}</span>) },
          { key: 'studentId', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => (
            <Link to={`/students/profile/${v}`} onClick={(e) => e.stopPropagation()} className="block max-w-full hover:[&_span.font-medium]:text-brand-700">
              <PersonCell name={r.snapshot?.name} sub={[r.lastClassLabel, r.snapshot?.admissionNo].filter(Boolean).join(' · ')} size={34} />
            </Link>
          ) },
          { key: 'leavingDate', header: t('students.transfer.leavingDate'), nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'reasonLabel', header: t('students.transfer.reason'), mobileHidden: true, render: (v, r) => <ColorChip dot seed={r.reason} label={r.reason === 'OTHER' && r.reasonText ? r.reasonText : r.reason ? t(`students.transfer.reasons.${r.reason}`, v ?? r.reason) : v} /> },
          { key: 'requestedBy', header: t('students.transfer.requestedBy'), mobileHidden: true, render: (v, r) => <StackCell title={v ?? '—'} sub={r.issuedBy ? `→ ${r.issuedBy}` : undefined} /> },
          { key: 'status', header: t('students.status.title'), render: (v, r) => (
            <div className="flex flex-col items-start gap-1">
              <StatusPill tone={TC_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill>
              {r.windUp?.some((i) => i.status === 'PENDING') && <span className="text-xs text-ink-muted">{t('students.leaving.toWindUp', { count: r.windUp.filter((i) => i.status === 'PENDING').length })}</span>}
              {r.duesOverride?.reason && <span className="text-xs text-ink-muted" title={[...(r.duesOverride.open ?? []), r.duesOverride.reason].join(' — ')}>{t('students.leaving.issuedWithDues')}</span>}
            </div>
          ) },
          { key: 'id', header: '', align: 'right', width: 200, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'REQUESTED' && (hasPermission('students.transfer.create') || hasPermission('students.transfer.approve')) && <Button size="sm" variant="ghost" icon={Pencil} title={t('students.transfer.edit')} aria-label={t('students.transfer.edit')} onClick={() => setEditing(r)} />}
              {r.status === 'REQUESTED' && hasPermission('students.transfer.approve') && <Button size="sm" variant="ghost" icon={CheckCircle2} title={t('students.transfer.issue')} aria-label={t('students.transfer.issue')} onClick={() => setIssuing(r)} />}
              {r.status === 'ISSUED' && r.windUp?.length > 0 && hasPermission('students.transfer.approve') && <Button size="sm" variant="ghost" icon={ListChecks} title={t('students.leaving.windUpButton')} aria-label={t('students.leaving.windUpButton')} onClick={() => setWinding(r)} />}
              {r.status === 'REQUESTED' && <Button size="sm" variant="ghost" icon={ClipboardCheck} title={t('students.leaving.printSlip')} aria-label={t('students.leaving.printSlip')} onClick={() => printDocument('STUDENT_NO_DUES', r.studentId)} />}
              {hasPermission('students.transfer.print') && r.status !== 'CANCELLED' && <Button size="sm" variant="ghost" icon={Printer} title={t('students.transfer.print')} aria-label={t('students.transfer.print')} onClick={() => printDocument('TRANSFER_CERTIFICATE', id)} />}
              {r.status !== 'CANCELLED' && (r.status === 'REQUESTED' || hasPermission('students.transfer.approve')) && <Button size="sm" variant="ghost" icon={XCircle} title={t('students.transfer.cancel')} aria-label={t('students.transfer.cancel')}
                onClick={async () => {
                  const reason = await prompt({ title: t('students.transfer.cancelConfirm.title'), message: r.status === 'ISSUED' ? t('students.transfer.cancelConfirm.issued') : t('students.transfer.cancelConfirm.requested'), label: t('students.transfer.cancelReason'), required: true })
                  if (reason) act.mutate({ fn: () => cancelTc(id, reason), done: t('students.transfer.cancelled') })
                }} />}
            </div>
          ) },
        ]}
        emptyIcon={ArrowLeftRight} emptyTitle={q || period || status ? t('students.directory.noMatch') : t('students.transfer.empty')} emptyHint={q || period || status ? undefined : t('students.transfer.emptyHint')}
        pagination={total > PAGE ? { page: page - 1, size: PAGE, totalElements: total, totalPages: Math.ceil(total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
      />
      {asking && <TcForm studentId={asking === 'new' ? null : asking} onClose={() => setAsking(null)} onSaved={() => { refresh(); showSuccess(t('students.transfer.requested')); setAsking(null) }} />}
      {issuing && <IssueTc tc={issuing} onClose={() => setIssuing(null)} onIssued={(done) => { refresh(); qc.invalidateQueries({ queryKey: ['tc-checks'] }); showSuccess(t('students.transfer.issued')); setIssuing(null); if (done?.windUp?.some((i) => i.status === 'PENDING')) setWinding(done) }} />}
      {winding && <WindUp tc={winding} onClose={() => setWinding(null)} onChanged={refresh} />}
      {editing && <TcForm tc={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); showSuccess(t('students.transfer.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
