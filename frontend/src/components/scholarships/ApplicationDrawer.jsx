import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, Globe, History, IndianRupee, MessageSquareShare, PencilLine, Stamp, Undo2, X } from 'lucide-react'
import { SCHOLARSHIP_PORTAL_STATUS, formatINR, toPaise } from '@schoolgiant/shared'
import { Drawer, FactGrid, FormField, Input, Modal, Note, Skeleton, StatusPill, Textarea, Timeline, useConfirm, usePrompt } from '../system'
import Button from '../ui/Button'
import { ApplicationStatus, CheckDocument, DocumentLine, EligibilityList } from './ScholarshipKit'
import { PortalStatus, RecordMoney } from './PortalMoney'
import {
  checkDocument, decideApplications, documentFor, fetchApplication, markAllOriginalsSeen, markOriginalSeen, saveDocument, tellFamilies, updateApplication, withdrawApplication,
} from '../../api/scholarships'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const OPEN = ['IN_PROGRESS', 'NEEDS_FIX', 'READY']

/** Family income and marks typed by the office (when the system has no marks), and a note. */
function EditDetails({ app, onClose, onSaved }) {
  const { t } = useTranslation('scholarships')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    familyIncome: app.familyIncome != null ? String(app.familyIncome / 100) : '',
    marksPct: app.marksFrom === 'ENTERED' && app.marksPct != null ? String(app.marksPct) : '',
    note: app.note ?? '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => updateApplication(app.id, {
      familyIncome: form.familyIncome === '' ? null : toPaise(form.familyIncome), marksPct: form.marksPct === '' ? null : Number(form.marksPct), note: form.note,
    }),
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('scholarships.app.editTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('scholarships.common.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('scholarships.common.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('scholarships.new.income')} hint={t('scholarships.new.incomeHint')}><Input type="number" min="0" value={form.familyIncome} onChange={set('familyIncome')} /></FormField>
        <FormField label={t('scholarships.new.marks')} hint={t('scholarships.new.marksHint')}><Input type="number" min="0" max="100" step="0.1" value={form.marksPct} onChange={set('marksPct')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('scholarships.new.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
      </div>
    </Modal>
  )
}

/**
 * One application: the eligibility checks, every document on its checklist (files, check, original seen), what to
 * tell the family, and the decision. Everything is saved as it is done; the list behind refreshes.
 */
export default function ApplicationDrawer({ id, classes = [], onClose }) {
  const { t } = useTranslation('scholarships')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { dateTime, date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [checking, setChecking] = useState(null) // { item, mode }
  const [checkErrors, setCheckErrors] = useState({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(null) // `${key}:files` …
  const [portalOpen, setPortalOpen] = useState(false)
  const [moneyOpen, setMoneyOpen] = useState(false)
  const { data: app, isLoading } = useQuery({ queryKey: ['scholarship-app', id], queryFn: () => fetchApplication(id), enabled: !!id })
  const canWork = hasAnyPermission('scholarships.applications.create', 'scholarships.applications.edit', 'scholarships.applications.verify')
  const canVerify = hasPermission('scholarships.applications.verify')
  const canApprove = hasPermission('scholarships.applications.approve')
  const canEdit = hasAnyPermission('scholarships.applications.edit', 'scholarships.applications.approve')
  const canPortal = hasPermission('scholarships.applications.portal')
  const canMoney = hasPermission('scholarships.applications.money')
  const isOpen = app && OPEN.includes(app.status)

  const refresh = (next) => {
    if (next) qc.setQueryData(['scholarship-app', id], next)
    else qc.invalidateQueries({ queryKey: ['scholarship-app', id] })
    qc.invalidateQueries({ queryKey: ['scholarship-apps'] })
  }
  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (r, v) => { refresh(v.keepData ? undefined : r?.id ? r : undefined); if (v.done) showSuccess(typeof v.done === 'function' ? v.done(r) : v.done); setChecking(null); setCheckErrors({}) },
    onError: (e, v) => { if (v.form) setCheckErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
    onSettled: () => setBusy(null),
  })

  const decide = async (approve) => {
    if (approve) {
      if (await confirm({ title: t('scholarships.decide.approveTitle', { name: app.student?.name }), message: t(`scholarships.decide.approveBenefit.${app.scheme?.benefit ?? 'FEE_WAIVER'}`), confirmLabel: t('scholarships.decide.approve') })) {
        act.mutate({ fn: () => decideApplications([app.id], true), keepData: true, done: (r) => (r.done ? t('scholarships.decide.approved', { count: r.done }) : r.skipped?.[0]?.message) })
      }
      return
    }
    const note = await prompt({ title: t('scholarships.decide.rejectTitle', { name: app.student?.name }), label: t('scholarships.decide.rejectReason'), required: true })
    if (note) act.mutate({ fn: () => decideApplications([app.id], false, note), keepData: true, done: (r) => (r.done ? t('scholarships.decide.rejected', { count: r.done }) : r.skipped?.[0]?.message) })
  }
  const withdraw = async () => {
    const reason = await prompt({ title: t('scholarships.withdraw.title'), label: app.status === 'APPROVED' ? t('scholarships.withdraw.approvedLabel') : t('scholarships.withdraw.label'), required: true })
    if (reason) act.mutate({ fn: () => withdrawApplication(app.id, reason), done: t('scholarships.withdraw.done') })
  }
  const tell = () => act.mutate({ fn: () => tellFamilies([app.id]), keepData: true, done: (r) => (r.sent ? t('scholarships.tell.sent', { count: r.sent }) : r.skipped?.[0]?.message) })

  const required = app?.items.filter((i) => i.required) ?? []
  const correct = required.filter((i) => i.state === 'ACCEPTED').length
  const originalsDue = app?.items.filter((i) => i.state === 'ORIGINAL_DUE') ?? []
  const pendingFromFamily = app?.items.some((i) => ['MISSING', 'NOT_ACCEPTED', 'EXPIRED', 'ORIGINAL_DUE'].includes(i.state) && (i.required || i.state !== 'MISSING'))

  return (
    <Drawer open={!!id} onClose={onClose} size="lg" subtitle={app ? `${app.applicationNo} · ${app.yearName ?? ''}` : t('scholarships.app.subtitle')} title={app?.student?.name ?? '…'}
      footer={app && <div className="flex flex-wrap gap-2">
        {isOpen && canApprove && <Button icon={Check} disabled={app.status !== 'READY'} loading={act.isPending} onClick={() => decide(true)}>{t('scholarships.decide.approve')}</Button>}
        {isOpen && canWork && <Button variant="secondary" icon={MessageSquareShare} disabled={!pendingFromFamily} onClick={tell}>{t('scholarships.tell.button')}</Button>}
        {isOpen && canApprove && <Button variant="ghost" icon={X} onClick={() => decide(false)}>{t('scholarships.decide.reject')}</Button>}
        {((isOpen && canEdit) || (app.status === 'APPROVED' && canApprove)) && <Button variant="ghost" icon={Undo2} onClick={withdraw}>{t('scholarships.withdraw.button')}</Button>}
      </div>}>
      {isLoading || !app ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <ApplicationStatus status={app.status} />
            <span className="text-sm text-ink">{app.scheme?.name}</span>
            <span className="text-sm text-ink-muted">· {app.scheme?.valueText}</span>
          </div>

          {app.status === 'NEEDS_FIX' && <Note tone="warning">{t('scholarships.app.needsFixNote')}</Note>}
          {app.status === 'READY' && app.scheme?.approval === 'APPROVER' && <Note tone="success">{t('scholarships.app.readyNote')}</Note>}
          {app.status === 'IN_PROGRESS' && <Note>{t('scholarships.app.inProgressNote', { correct, total: required.length })}</Note>}
          {app.visit && isOpen && (
            <Note icon={CalendarClock} actions={canVerify && originalsDue.length > 0 && <Button size="sm" icon={Stamp} loading={act.isPending} onClick={() => act.mutate({ fn: () => markAllOriginalsSeen(app.id), done: t('scholarships.visit.allSeenDone') })}>{t('scholarships.visit.allSeen', { count: originalsDue.length })}</Button>}>
              {t('scholarships.visit.booked', { date: date(app.visit.date), time: app.visit.time, by: app.visit.bookedBy ?? '' })}{app.visit.attended ? ` · ${t('scholarships.visit.attended')}` : ''}
            </Note>
          )}
          {!app.visit && isOpen && canVerify && originalsDue.length > 1 && (
            <Note icon={Stamp} actions={<Button size="sm" icon={Stamp} loading={act.isPending} onClick={() => act.mutate({ fn: () => markAllOriginalsSeen(app.id), done: t('scholarships.visit.allSeenDone') })}>{t('scholarships.visit.allSeen', { count: originalsDue.length })}</Button>}>
              {t('scholarships.visit.originalsLeft', { list: originalsDue.map((i) => i.label).join(', ') })}
            </Note>
          )}
          {app.status === 'NOT_APPROVED' && app.decisionNote && <Note tone="danger">{t('scholarships.app.notApprovedNote', { reason: app.decisionNote })}</Note>}
          {app.status === 'APPROVED' && <Note tone="success">{t(`scholarships.app.approvedBenefit.${app.scheme?.benefit ?? 'FEE_WAIVER'}`, { by: app.decidedBy ?? '—' })}</Note>}

          <FactGrid cols={3} boxed items={[
            { label: t('scholarships.app.expected'), value: formatINR(app.expectedAmount ?? 0), hint: app.holdFees && isOpen ? t('scholarships.app.feesHeld') : undefined },
            { label: t('scholarships.app.income'), value: app.familyIncome != null ? formatINR(app.familyIncome) : null },
            { label: t('scholarships.app.marks'), value: app.marksPct != null ? `${app.marksPct}%` : null, hint: app.marksFrom ? t(`scholarships.app.marksFrom.${app.marksFrom}`) : undefined },
            { label: t('scholarships.app.attendance'), value: app.attendancePct != null ? `${app.attendancePct}%` : null },
            { label: t('scholarships.app.started'), value: `${date(String(app.createdAt).slice(0, 10))} · ${app.createdBy ?? ''}` },
            { label: t('scholarships.app.familyTold'), value: app.familyToldAt ? dateTime(app.familyToldAt) : null },
          ]} />
          {isOpen && canWork && <div><Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing(true)}>{t('scholarships.app.editDetails')}</Button></div>}

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">{t('scholarships.app.eligibility')}</h3>
            <EligibilityList checks={app.eligibility} classes={classes} />
          </section>

          {(app.portal || app.scheme?.provider === 'GOVERNMENT') && app.status !== 'WITHDRAWN' && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><Globe className="w-4 h-4 text-ink-muted" aria-hidden />{t('scholarships.portal.section', { portal: t(`scholarships.portalName.${app.scheme?.portal?.name ?? 'OTHER'}`) })}</h3>
                {canPortal && <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setPortalOpen(true)}>{t('scholarships.portal.update')}</Button>}
              </div>
              {app.portal ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={SCHOLARSHIP_PORTAL_STATUS[app.portal.status]?.tone}>{t(`scholarships.portalStatus.${app.portal.status}`, SCHOLARSHIP_PORTAL_STATUS[app.portal.status]?.label ?? '—')}</StatusPill>
                    {app.portal.applicationId && <span className="text-sm text-ink-muted">{t('scholarships.portal.idShort', { id: app.portal.applicationId })}</span>}
                    {app.portal.sanctionedAmount != null && <span className="text-sm text-ink-muted">· {t('scholarships.portal.sanctionedShort', { amount: formatINR(app.portal.sanctionedAmount) })}</span>}
                  </div>
                  {app.scheme?.portal?.verifyBy && app.portal.status === 'APPLIED' && <Note tone="warning">{t('scholarships.portal.verifyBy', { date: date(app.scheme.portal.verifyBy) })}</Note>}
                  {(app.portal.history ?? []).length > 0 && <Timeline dense items={app.portal.history.map((h, i) => ({ id: String(i), title: t(`scholarships.portalStatus.${h.status}`, h.status), time: dateTime(h.at), meta: h.by, body: h.note }))} />}
                </div>
              ) : <p className="text-sm text-ink-muted">{t('scholarships.portal.none')}{app.scheme?.portal?.url ? ` ${app.scheme.portal.url}` : ''}</p>}
            </section>
          )}

          {app.scheme?.benefit === 'PAID_TO_INSTITUTION' && app.status === 'APPROVED' && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><IndianRupee className="w-4 h-4 text-ink-muted" aria-hidden />{t('scholarships.money.section')}</h3>
                {canMoney && app.awaitingMoney && <Button size="sm" variant="secondary" icon={IndianRupee} onClick={() => setMoneyOpen(true)}>{t('scholarships.money.recordShort')}</Button>}
              </div>
              <p className="text-sm text-ink">{app.awaitingMoney
                ? t('scholarships.money.stillAwaited', { got: formatINR(app.receivedTotal ?? 0), left: formatINR(Math.max(0, (app.expectedAmount ?? 0) - (app.receivedTotal ?? 0))) })
                : t('scholarships.money.allIn', { got: formatINR(app.receivedTotal ?? 0) })}</p>
              {(app.received ?? []).length > 0 && (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
                  {app.received.map((r, i) => <li key={i} className="flex justify-between gap-2 px-3 py-1.5"><span className="text-ink">{date(r.date)} · {r.receiptNo}{r.reference ? ` · ${r.reference}` : ''}</span><span className="tabular-nums font-medium text-ink">{formatINR(r.amount)}</span></li>)}
                </ul>
              )}
            </section>
          )}

          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-ink">{t('scholarships.app.documents')}</h3>
              <span className="text-xs text-ink-muted">{t('scholarships.app.correctOf', { correct, total: required.length })}</span>
            </div>
            {app.items.length === 0 ? <p className="text-sm text-ink-muted">{t('scholarships.app.noDocuments')}</p> : (
              <div className="space-y-2">
                {app.items.map((item) => (
                  <DocumentLine key={item.key} item={item} open={isOpen} canWork={canWork} canVerify={canVerify}
                    busy={busy?.startsWith(`${item.key}:`) ? busy.split(':').pop() : null}
                    onAddFiles={async () => { setBusy(`${item.key}:files`); try { await documentFor(app.id, item.key); await qc.invalidateQueries({ queryKey: ['scholarship-app', id] }) } catch (e) { showError(e.message) } finally { setBusy(null) } }}
                    onFilesChanged={() => refresh()}
                    onPaperCopy={() => { setBusy(`${item.key}:paper`); act.mutate({ fn: () => saveDocument(app.id, item.key, { paperCopy: true }), done: t('scholarships.doc.paperSaved') }) }}
                    onCheck={(mode) => { setCheckErrors({}); setChecking({ item, mode }) }}
                    onOriginal={() => { setBusy(`${item.key}:original`); act.mutate({ fn: () => markOriginalSeen(app.id, item.key), done: t('scholarships.doc.originalSaved') }) }} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5"><History className="w-4 h-4 text-ink-muted" aria-hidden />{t('scholarships.app.history')}</h3>
            <Timeline dense items={app.log.map((l, i) => ({ id: String(i), title: l.text, time: dateTime(l.at), meta: l.by }))} />
          </section>
          {app.note && <FactGrid items={[{ label: t('scholarships.new.note'), value: app.note, text: true, span: 'full' }]} />}
        </div>
      )}
      {checking && <CheckDocument item={checking.item} mode={checking.mode} errors={checkErrors} saving={act.isPending} onClose={() => setChecking(null)}
        onSave={(body) => act.mutate({ fn: () => checkDocument(app.id, checking.item.key, body), form: true, done: body.result === 'ACCEPT' ? t('scholarships.doc.markedCorrect') : t('scholarships.doc.markedFix') })} />}
      {portalOpen && <PortalStatus ids={[app.id]} app={app} onClose={() => setPortalOpen(false)} onDone={() => { refresh(); setPortalOpen(false); showSuccess(t('scholarships.portal.saved', { count: 1 })) }} />}
      {moneyOpen && <RecordMoney rows={[{ ...app, received: app.receivedTotal }]} onClose={() => setMoneyOpen(false)}
        onDone={(r) => { refresh(); qc.invalidateQueries({ queryKey: ['fee-ledger'] }); setMoneyOpen(false); if (r.done) showSuccess(t('scholarships.money.done', { count: r.done })); else showError(r.skipped?.[0]?.message) }} />}
      {editing && <EditDetails app={app} onClose={() => setEditing(false)} onSaved={(r) => { refresh(r); setEditing(false); showSuccess(t('scholarships.app.detailsSaved')) }} />}
    </Drawer>
  )
}
