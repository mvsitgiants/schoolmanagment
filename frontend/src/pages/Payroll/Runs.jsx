import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Banknote, Calculator, CalendarClock, ChevronLeft, Plus, RotateCcw, ShieldAlert, Wallet } from 'lucide-react'
import { ELECTRONIC_PAY_MODES, PAYROLL_PAY_MODES, PAYROLL_RUN_STATUSES } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, SegmentedControl, Select, StatCardRow, localIso, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { approveRun, calculateRun, createRun, fetchRun, fetchRuns, payRun, reopenRun } from '../../api/payroll'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { PayslipDrawer, RunStatusPill, useMonthLabel, usePayrollMeta } from '../../components/payroll/PayrollKit'

function NewRunModal({ meta, onClose, onDone }) {
  const { t } = useTranslation('payroll')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ month: meta?.month ?? '', branchId: '' })
  const save = useMutation({ mutationFn: () => createRun({ month: f.month, branchId: f.branchId || null }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('payroll.runs.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!/^\d{4}-\d{2}$/.test(f.month)} onClick={() => save.mutate()}>{t('payroll.runs.start')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('payroll.month')} required><Input type="month" value={f.month} max={meta?.month} onChange={(e) => setF((x) => ({ ...x, month: e.target.value }))} /></FormField>
          {(meta?.branches ?? []).length > 1 && (
            <FormField label={t('payroll.runs.for')} hint={t('payroll.runs.forHint')}>
              <Select value={f.branchId} onChange={(e) => setF((x) => ({ ...x, branchId: e.target.value }))}>
                <option value="">{t('payroll.runs.whole')}</option>
                {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <p className="text-sm text-ink-muted">{t('payroll.runs.draftHint')}</p>
      </div>
    </Modal>
  )
}

function PayModal({ run, onClose, onDone }) {
  const { t } = useTranslation('payroll')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ date: localIso(new Date()), mode: 'NEFT', reference: '', note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => payRun(run.id, f), onSuccess: onDone, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  const needsRef = ELECTRONIC_PAY_MODES.includes(f.mode)
  return (
    <Modal open onClose={onClose} title={t('payroll.runs.payTitle', { runNo: run.runNo })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!f.date || (needsRef && !f.reference.trim())} onClick={() => save.mutate()}>{t('payroll.runs.recordPay')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('payroll.runs.paidOn')} required error={errors.date}><Input type="date" value={f.date} max={localIso(new Date())} onChange={set('date')} /></FormField>
        <FormField label={t('payroll.runs.mode')}><Select value={f.mode} onChange={set('mode')}>{PAYROLL_PAY_MODES.map((m) => <option key={m.value} value={m.value}>{t(`payroll.payModes.${m.value}`)}</option>)}</Select></FormField>
        <div className="sm:col-span-2"><FormField label={t('payroll.runs.reference')} required={needsRef} error={errors.reference}><Input value={f.reference} onChange={set('reference')} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('payroll.runs.note')}><Input value={f.note} onChange={set('note')} /></FormField></div>
        <p className="sm:col-span-2 text-xs text-ink-faint">{t('payroll.runs.payHint')}</p>
      </div>
    </Modal>
  )
}

function RunDetail({ id, onBack }) {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const monthLabel = useMonthLabel()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [slip, setSlip] = useState(null)
  const [paying, setPaying] = useState(false)
  const { data: run, isLoading } = useQuery({ queryKey: ['payroll-run', id], queryFn: () => fetchRun(id) })
  const { data: meta } = usePayrollMeta()
  const sod = meta?.statutory?.separateDuties !== false
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll-run', id] }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  if (isLoading || !run) return <p className="text-sm text-ink-faint">{t('payroll.loading')}</p>
  const tot = run.totals ?? {}
  const flagged = run.payslips.filter((p) => p.warnings.length).length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('payroll.back')} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{monthLabel(run.month)} <span className="text-xs font-mono-num text-ink-faint">{run.runNo}</span></p>
          <p className="text-xs text-ink-muted">{run.branchName ?? t('payroll.runs.whole')}{run.calculated?.at ? ` · ${t('payroll.runs.calculatedBy', { by: run.calculated.by })}` : ''}{run.approved?.at ? ` · ${t('payroll.runs.approvedBy', { by: run.approved.by })}` : ''}{run.paid?.date ? ` · ${t('payroll.runs.paidLine', { date: date(run.paid.date), mode: t(`payroll.payModes.${run.paid.mode}`), ref: run.paid.reference ?? '' })}` : ''}</p>
        </div>
        <RunStatusPill status={run.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {['DRAFT', 'CALCULATED'].includes(run.status) && hasPermission('payroll.runs.calculate') && <Button icon={Calculator} variant={run.status === 'DRAFT' ? 'primary' : 'secondary'} loading={act.isPending}
            onClick={() => act.mutate({ fn: () => calculateRun(run.id), done: t('payroll.runs.calculated') })}>{run.status === 'DRAFT' ? t('payroll.runs.calculate') : t('payroll.runs.recalculate')}</Button>}
          {run.status === 'CALCULATED' && hasPermission('payroll.runs.calculate') && <Button variant="ghost" icon={RotateCcw}
            onClick={async () => { const reason = await prompt({ title: t('payroll.runs.reopenTitle'), label: t('payroll.runs.why'), required: true, confirmLabel: t('payroll.runs.reopen') }); if (reason) act.mutate({ fn: () => reopenRun(run.id, reason), done: t('payroll.runs.reopened') }) }}>{t('payroll.runs.reopen')}</Button>}
          {run.status === 'CALCULATED' && hasPermission('payroll.runs.approve') && <Button icon={BadgeCheck} disabled={run.preparedByMe && sod}
            onClick={async () => { if (await confirm({ title: t('payroll.runs.approveTitle', { month: monthLabel(run.month) }), message: t('payroll.runs.approveHint', { count: tot.employees, net: Math.round((tot.net ?? 0) / 100) }), confirmLabel: t('payroll.runs.approve') })) act.mutate({ fn: () => approveRun(run.id), done: t('payroll.runs.approved') }) }}>{t('payroll.runs.approve')}</Button>}
          {run.status === 'APPROVED' && hasPermission('payroll.runs.pay') && <Button icon={Banknote} onClick={() => setPaying(true)}>{t('payroll.runs.recordPay')}</Button>}
        </div>
      </div>
      {run.status === 'CALCULATED' && run.preparedByMe && sod && <Note>{t('payroll.runs.sodHint')}</Note>}
      {run.status === 'DRAFT' && <Note>{t('payroll.runs.draftNote')}</Note>}
      {run.version > 0 && (
        <StatCardRow items={[
          { label: t('payroll.runs.staff'), value: tot.employees ?? 0 },
          { label: t('payroll.runs.gross'), value: <Money value={tot.gross} paise /> },
          { label: t('payroll.runs.deductions'), value: <Money value={tot.deductions} paise /> },
          { label: t('payroll.runs.net'), value: <Money value={tot.net} paise />, tone: 'success' },
          { label: t('payroll.runs.cost'), value: <Money value={tot.employerCost} paise /> },
        ]} />
      )}
      {(run.exceptions ?? []).length > 0 && (
        <Note tone="warning">
          <p className="font-medium mb-1">{t('payroll.runs.exceptions', { count: run.exceptions.length })}</p>
          {run.exceptions.slice(0, 12).map((x) => <p key={String(x.employeeId)} className="text-sm">{x.employeeName} ({x.employeeCode}): {x.reason}</p>)}
        </Note>
      )}
      {flagged > 0 && <Note tone="warning">{t('payroll.runs.flagged', { count: flagged })}</Note>}
      <DataTable rows={run.payslips} columns={[
        { key: 'name', header: t('payroll.staff.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}{r.fnf && <span className="ml-1 text-[11px] text-amber-700">{t('payroll.runs.fnf')}</span>}</p><p className="text-xs text-ink-faint">{[r.code, r.designation].filter(Boolean).join(' · ')}</p></div> },
        { key: 'payDays', header: t('payroll.att.payDays'), align: 'right', render: (v, r) => <span>{v}/{r.baseDays}{r.lop > 0 && <span className={`block text-[11px] ${r.lopEdited ? 'text-brand-600' : 'text-danger-600'}`}>{t('payroll.runs.lopShort', { n: r.lop })}</span>}</span> },
        { key: 'gross', header: t('payroll.runs.gross'), align: 'right', render: (v) => <Money value={v} paise /> },
        { key: 'deductions', header: t('payroll.runs.deductions'), align: 'right', mobileHidden: true, render: (v) => <Money value={v} paise /> },
        { key: 'net', header: t('payroll.runs.net'), align: 'right', render: (v) => <Money value={v} paise className="font-semibold" /> },
        { key: 'warnings', header: '', width: 30, render: (w) => w.length > 0 && <ShieldAlert className="h-4 w-4 text-amber-500" aria-label={w.join(' ')} /> },
      ]} onRowClick={(r) => setSlip(r.id)} emptyIcon={Wallet} emptyTitle={run.version ? t('payroll.runs.noPayslips') : t('payroll.runs.notCalculated')} />
      {slip && <PayslipDrawer id={slip} onClose={() => setSlip(null)} onChanged={refresh} />}
      {paying && <PayModal run={run} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh(); showSuccess(t('payroll.runs.paid')) }} />}
    </div>
  )
}

/** Payroll › Payroll runs: calculate a month from staff attendance, check, approve, record the payment. */
export default function Runs() {
  const { t } = useTranslation('payroll')
  const qc = useQueryClient()
  const monthLabel = useMonthLabel()
  const { showSuccess } = useSnackbar()
  const { data: meta } = usePayrollMeta()
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)
  const query = { status: status || undefined, page, pageSize: 25 }
  const { data, isLoading } = useQuery({ queryKey: ['payroll-runs', query], queryFn: () => fetchRuns(query), placeholderData: keepPreviousData })
  const pm = data?.meta
  const s = data?.summary ?? {}
  return (
    <PageContainer>
      <PageHeader icon={Wallet} title={t('payroll.runs.title')} subtitle={t('payroll.runs.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="payroll.runs.create" onClick={() => setCreating(true)}>{t('payroll.runs.new')}</HeaderButton>} />
      {meta && !meta.statutory?.verified && <Note tone="warning" className="mb-4">{t('payroll.runs.verifyWarning')}</Note>}
      {open ? <RunDetail id={open} onBack={() => setOpen(null)} /> : (
        <div className="space-y-4">
          <StatCardRow items={[
            { icon: CalendarClock, label: t('payroll.runs.lastPaid'), value: s.lastPaid ? monthLabel(s.lastPaid.month) : '—', tone: 'success' },
            { icon: Calculator, label: t('payroll.runs.waiting'), value: s.waiting ?? 0, tone: s.waiting ? 'warning' : 'neutral', onClick: () => setStatus('CALCULATED') },
            { icon: BadgeCheck, label: t('payroll.runs.toPay'), value: s.toPay ?? 0, tone: s.toPay ? 'info' : 'neutral', onClick: () => setStatus('APPROVED') },
          ]} />
          <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: t('payroll.all') }, ...Object.keys(PAYROLL_RUN_STATUSES).map((k) => ({ value: k, label: t(`payroll.runStatus.${k}`) }))]} />
          <DataTable rows={data?.data ?? []} loading={isLoading} columns={[
            { key: 'month', header: t('payroll.month'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{monthLabel(v)}</p><p className="text-xs text-ink-faint font-mono-num">{r.runNo}</p></div> },
            { key: 'branchName', header: t('payroll.runs.for'), mobileHidden: true, render: (v) => v ?? t('payroll.runs.whole') },
            { key: 'status', header: t('payroll.status'), render: (v) => <RunStatusPill status={v} /> },
            { key: 'staff', header: t('payroll.runs.staff'), align: 'right', render: (_, r) => r.totals?.employees ?? '—' },
            { key: 'net', header: t('payroll.runs.net'), align: 'right', render: (_, r) => (r.version ? <Money value={r.totals?.net} paise className="font-semibold" /> : '—') },
            { key: 'cost', header: t('payroll.runs.cost'), align: 'right', mobileHidden: true, render: (_, r) => (r.version ? <Money value={r.totals?.employerCost} paise /> : '—') },
          ]} onRowClick={(r) => setOpen(r.id)}
            pagination={pm && pm.totalPages > 1 && { page: pm.page - 1, size: pm.pageSize, totalElements: pm.total, totalPages: pm.totalPages, onPageChange: (p) => setPage(p + 1) }}
            emptyIcon={Wallet} emptyTitle={status ? t('payroll.runs.noneHere') : t('payroll.runs.empty')} emptyHint={status ? undefined : t('payroll.runs.emptyHint')} />
        </div>
      )}
      {creating && <NewRunModal meta={meta} onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); setOpen(r.id); showSuccess(t('payroll.runs.started', { runNo: r.runNo })) }} />}
    </PageContainer>
  )
}
