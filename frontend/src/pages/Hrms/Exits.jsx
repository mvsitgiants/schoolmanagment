import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, CircleSlash, DoorOpen, MessageSquareText, Plus, Printer, RotateCcw } from 'lucide-react'
import { CLEARANCE_OWNERS, formatINR } from '@schoolgiant/shared'
import { DataTable, Drawer, FormField, Input, Note, PageContainer, PageHeader, PersonCell, ProgressBar, SearchInput, SegmentedControl, Select, StatCardRow, StatusPill, Toolbar } from '../../components/system'
import Button from '../../components/ui/Button'
import { addClearanceItem, fetchExitClearance, fetchExitClearances, updateClearanceItem } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { useExperienceCertificate } from '../../components/hrms/ExperienceCertificateModal'
import { useExitInterview } from '../../components/hrms/ExitInterviewModal'

const TONE = { OPEN: 'warning', DONE: 'success', CANCELLED: 'neutral' }
const ITEM_TONE = { PENDING: 'warning', DONE: 'success', NA: 'neutral' }

/** One person's clearance: each item with who checks it, ticked off as cleared or not needed. */
function ClearanceDrawer({ id, onClose }) {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const { date, dateTime } = useFormat()
  const { showError } = useSnackbar()
  const certificate = useExperienceCertificate()
  const interview = useExitInterview()
  const canEdit = hasPermission('hrms.exits.edit')
  const [adding, setAdding] = useState(null)
  const { data: c } = useQuery({ queryKey: ['hrms', 'exits', id], queryFn: () => fetchExitClearance(id), enabled: !!id })
  const done = (next) => { qc.setQueryData(['hrms', 'exits', id], next); qc.invalidateQueries({ queryKey: ['hrms', 'exits', 'list'] }) }
  const tick = useMutation({ mutationFn: ({ itemId, status }) => updateClearanceItem(id, itemId, { status }), onSuccess: done, onError: (e) => showError(e.message) })
  const add = useMutation({ mutationFn: () => addClearanceItem(id, { title: adding.title.trim(), owner: adding.owner }), onSuccess: (next) => { done(next); setAdding(null) }, onError: (e) => showError(e.message) })
  const open = c?.status === 'OPEN'
  return (
    <Drawer open={!!id} onClose={onClose} size="lg" title={c ? `${c.employeeName} · ${c.employeeCode}` : '…'}
      subtitle={c ? [c.designation, c.exitType, c.lastWorkingDate && t('hrms.exits.lastDay', { date: date(c.lastWorkingDate) })].filter(Boolean).join(' · ') : ''}
      footer={c && (
        <div className="flex flex-wrap justify-end gap-2">
          {c.status !== 'CANCELLED' && <Button variant="secondary" icon={MessageSquareText} className="me-auto" onClick={() => interview.open(c.employeeId)}>{t('hrms.exits.exitInterview')}</Button>}
          <Button variant="secondary" icon={Printer} onClick={() => printDocument('HR_RELIEVING_LETTER', c.employeeId)}>{t('hrms.exits.relievingLetter')}</Button>
          <Button variant="secondary" icon={Printer} onClick={() => certificate.open(c.employeeId)}>{t('hrms.exits.experienceCertificate')}</Button>
          <Button variant="secondary" icon={Printer} onClick={() => printDocument('HR_NO_DUES', c.employeeId)}>{t('hrms.exits.noDues')}</Button>
          {c.employeeStatus === 'EXITED' && hasPermission('payroll.payslips.view') && <Button variant="secondary" icon={Printer} onClick={() => printDocument('HR_FNF_STATEMENT', c.employeeId)}>{t('hrms.exits.fnfStatement')}</Button>}
        </div>
      )}>
      {!c ? <div className="h-48 rounded-xl bg-black/5 animate-pulse" /> : (
        <div className="space-y-4">
          {c.status === 'CANCELLED' && <Note tone="info">{t('hrms.exits.cancelledNote')}</Note>}
          {c.status === 'DONE' && <Note tone="success">{t('hrms.exits.doneNote', { date: c.completed?.at ? date(c.completed.at) : '' })}</Note>}
          <div>
            <div className="flex items-center justify-between text-sm mb-1.5"><span className="text-ink-muted">{t('hrms.exits.progress', { done: c.progress.done, total: c.progress.total })}</span><StatusPill tone={TONE[c.status]}>{c.statusLabel}</StatusPill></div>
            <ProgressBar value={c.progress.done} max={c.progress.total || 1} />
          </div>
          {c.checks?.length > 0 && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hrms.exits.recordsCheck')}</p>
              {c.checks.map((k) => (
                <div key={k.key} className="flex items-start gap-2 text-sm">
                  <StatusPill tone={k.ok ? 'success' : 'danger'}>{k.ok ? t('hrms.exits.nothingDue') : t('hrms.exits.due')}</StatusPill>
                  <span className="min-w-0 text-ink">
                    {k.key === 'library' && (k.ok ? t('hrms.exits.libraryOk') : [k.booksOut.length ? t('hrms.exits.booksOut', { count: k.booksOut.length, titles: k.booksOut.map((b) => b.title).join(', ') }) : null, k.fineTotal ? t('hrms.exits.finesDue', { amount: formatINR(k.fineTotal) }) : null].filter(Boolean).join(' · '))}
                    {k.key === 'advances' && (k.ok ? t('hrms.exits.advancesOk') : t('hrms.exits.advancesDue', { amount: formatINR(k.total), count: k.loans.length }))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {c.items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink break-words">{it.title}</p>
                  <p className="text-xs text-ink-muted">{it.ownerLabel}{it.done?.by ? ` · ${it.done.by}, ${dateTime(it.done.at)}` : ''}</p>
                </div>
                <StatusPill tone={ITEM_TONE[it.status]}>{it.statusLabel}</StatusPill>
                {canEdit && c.status !== 'CANCELLED' && (it.status === 'PENDING' ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" icon={Check} loading={tick.isPending && tick.variables?.itemId === it.id && tick.variables?.status === 'DONE'} onClick={() => tick.mutate({ itemId: it.id, status: 'DONE' })}>{t('hrms.exits.clear')}</Button>
                    <Button size="sm" variant="ghost" icon={CircleSlash} onClick={() => tick.mutate({ itemId: it.id, status: 'NA' })}>{t('hrms.exits.notNeeded')}</Button>
                  </div>
                ) : <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => tick.mutate({ itemId: it.id, status: 'PENDING' })}>{t('hrms.exits.undo')}</Button>)}
              </li>
            ))}
          </ul>
          {canEdit && open && (adding ? (
            <div className="rounded-xl border border-border p-3 grid sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
              <FormField label={t('hrms.exits.itemTitle')}><Input value={adding.title} maxLength={160} onChange={(e) => setAdding({ ...adding, title: e.target.value })} /></FormField>
              <FormField label={t('hrms.exits.itemOwner')}><Select value={adding.owner} onChange={(e) => setAdding({ ...adding, owner: e.target.value })}>{CLEARANCE_OWNERS.map((o) => <option key={o.value} value={o.value}>{t(`hrms.exits.owners.${o.value}`)}</option>)}</Select></FormField>
              <Button loading={add.isPending} disabled={adding.title.trim().length < 3} onClick={() => add.mutate()}>{t('hrms.exits.add')}</Button>
            </div>
          ) : <Button variant="ghost" icon={Plus} onClick={() => setAdding({ title: '', owner: 'ADMIN' })}>{t('hrms.exits.addItem')}</Button>)}
        </div>
      )}
      {certificate.modal}
      {interview.modal}
    </Drawer>
  )
}

/** Staff & HR › Staff leaving: everyone with an exit clearance, the open ones first, soonest last day first. */
export default function Exits() {
  const { t } = useTranslation('hrms')
  const { date } = useFormat()
  const [status, setStatus] = useState('OPEN')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['hrms', 'exits', 'list', status, search, page], queryFn: () => fetchExitClearances({ status: status || undefined, search: search || undefined, page }) })
  const s = data?.summary ?? {}
  return (
    <PageContainer>
      <PageHeader icon={DoorOpen} title={t('hrms.exits.title')} subtitle={t('hrms.exits.subtitle')} />
      <StatCardRow items={[
        { icon: DoorOpen, label: t('hrms.exits.statOpen'), value: s.OPEN ?? 0, tone: s.OPEN ? 'warning' : 'neutral', onClick: () => setStatus('OPEN') },
        { icon: Check, label: t('hrms.exits.statDone'), value: s.DONE ?? 0, tone: 'success', onClick: () => setStatus('DONE') },
      ]} />
      <DataTable rows={data?.data ?? []} loading={isLoading} onRowClick={(r) => setOpenId(r.id)}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('hrms.exits.search')}
          right={<SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: 'OPEN', label: t('hrms.exits.tabOpen') }, { value: 'DONE', label: t('hrms.exits.tabDone') }, { value: '', label: t('hrms.exits.tabAll') }]} />} />}
        columns={[
          { key: 'employeeName', header: t('hrms.exits.colPerson'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={[r.employeeCode, r.designation, r.departmentName].filter(Boolean).join(' · ')} /> },
          { key: 'lastWorkingDate', header: t('hrms.exits.colLastDay'), nowrap: true, mobilePrimary: true, render: (v) => (v ? date(v) : '—') },
          { key: 'progress', header: t('hrms.exits.colProgress'), render: (p) => <div className="min-w-[120px]"><ProgressBar value={p.done} max={p.total || 1} /><p className="mt-1 text-xs text-ink-muted">{t('hrms.exits.progress', { done: p.done, total: p.total })}</p></div> },
          { key: 'status', header: t('hrms.exits.colStatus'), mobilePrimary: true, render: (v, r) => <StatusPill tone={TONE[v]}>{r.statusLabel}</StatusPill> },
        ]}
        pagination={data?.meta && { page: data.meta.page - 1, size: data.meta.pageSize, totalElements: data.meta.total, totalPages: data.meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={DoorOpen} emptyTitle={status === 'OPEN' ? t('hrms.exits.emptyOpen') : t('hrms.exits.empty')} emptyHint={t('hrms.exits.emptyHint')} />
      {openId && <ClearanceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </PageContainer>
  )
}
