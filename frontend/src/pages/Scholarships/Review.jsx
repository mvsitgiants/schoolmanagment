import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  ArrowLeft, CalendarClock, Check, ChevronLeft, ChevronRight, CircleAlert, Clock, Eye, FilePlus2, Globe, History, IndianRupee, MessageSquareShare,
  PencilLine, RefreshCw, Stamp, Undo2, X,
} from 'lucide-react'
import { SCHOLARSHIP_DOC_FILE_CATEGORY, SCHOLARSHIP_DOC_TYPE_BY, SCHOLARSHIP_PORTAL_STATUS, formatINR, toPaise } from '@schoolgiant/shared'
import { ColorChip, FormField, Input, Modal, Note, PageContainer, Panel, Skeleton, StatusPill, Textarea, Timeline, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import DocPreview from '../../components/scholarships/DocPreview'
import { ApplicationStatus, CheckDocument, DocState, EligibilityChips, docName, valueTextOf } from '../../components/scholarships/ScholarshipKit'
import { PortalStatus, RecordMoney } from '../../components/scholarships/PortalMoney'
import {
  checkDocument, decideApplications, documentFor, fetchApplication, fetchApplications, fetchScholarshipMeta, markAllOriginalsSeen, markOriginalSeen, saveDocument,
  tellFamilies, updateApplication, withdrawApplication,
} from '../../api/scholarships'
import { hasAnyPermission, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const OPEN = ['IN_PROGRESS', 'NEEDS_FIX', 'READY']
const STATE_ICON = { ACCEPTED: Check, ORIGINAL_DUE: Stamp, SUBMITTED: Eye, NOT_ACCEPTED: X, EXPIRED: CircleAlert, MISSING: Clock }
const STATE_CLS = {
  ACCEPTED: 'bg-success-500 text-white', ORIGINAL_DUE: 'bg-success-50 text-success-700', SUBMITTED: 'bg-brand-500 text-white',
  NOT_ACCEPTED: 'bg-danger-500 text-white', EXPIRED: 'bg-danger-50 text-danger-600', MISSING: 'bg-black/[0.06] text-ink-faint',
}

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
    mutationFn: () => updateApplication(app.id, { familyIncome: form.familyIncome === '' ? null : toPaise(form.familyIncome), marksPct: form.marksPct === '' ? null : Number(form.marksPct), note: form.note }),
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

/** A short fact: label over value. */
const Fact = ({ label, value, hint }) => (
  <div className="min-w-0">
    <p className="text-xs text-ink-muted">{label}</p>
    <p className="text-sm font-semibold text-ink tabular-nums">{value ?? '—'}</p>
    {hint && <p className="text-xs text-ink-faint">{hint}</p>}
  </div>
)

/**
 * One application on a full page. Left: who the student is and whether they can apply, the fees held, the government
 * portal and the money. Right: every document — pick one to see its photo large, then mark it correct or send it back.
 * The bar at the bottom tells the family, decides, and moves to the previous / next application of the list.
 */
export default function Review() {
  const { t } = useTranslation('scholarships')
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { dateTime, date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const tab = params.get('tab') ?? ''
  const schemeParam = params.get('scheme') ?? ''
  const listUrl = `/scholarships/applications?${new URLSearchParams({ ...(tab && { tab }), ...(schemeParam && { scheme: schemeParam }) })}`

  const [selKey, setSelKey] = useState(null)
  const [checking, setChecking] = useState(null)
  const [checkErrors, setCheckErrors] = useState({})
  const [editing, setEditing] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)
  const [moneyOpen, setMoneyOpen] = useState(false)
  const [allHistory, setAllHistory] = useState(false)
  // the list it was opened from, in order — kept as it was, so moving on works even as applications change tab
  const [order, setOrder] = useState(null)
  const { data: list } = useQuery({ queryKey: ['scholarship-apps', 'order', tab, schemeParam], queryFn: () => fetchApplications({ tab: tab || undefined, schemeId: schemeParam || undefined, pageSize: 1 }), enabled: !order })
  useEffect(() => { if (list?.ids && !order) setOrder(list.ids) }, [list, order])

  const { data: meta } = useQuery({ queryKey: ['scholarship-meta'], queryFn: fetchScholarshipMeta })
  const { data: app, isLoading, error } = useQuery({ queryKey: ['scholarship-app', id], queryFn: () => fetchApplication(id) })
  const canWork = hasAnyPermission('scholarships.applications.create', 'scholarships.applications.edit', 'scholarships.applications.verify')
  const canVerify = hasPermission('scholarships.applications.verify')
  const canApprove = hasPermission('scholarships.applications.approve')
  const canEdit = hasAnyPermission('scholarships.applications.edit', 'scholarships.applications.approve')
  const canPortal = hasPermission('scholarships.applications.portal')
  const canMoney = hasPermission('scholarships.applications.money')
  const isOpen = app && OPEN.includes(app.status)

  // pick the document that needs looking at first: one waiting to be checked, else one to fix, else the first
  useEffect(() => {
    if (!app) return
    if (selKey && app.items.some((i) => i.key === selKey)) return
    const first = app.items.find((i) => i.state === 'SUBMITTED') ?? app.items.find((i) => ['NOT_ACCEPTED', 'EXPIRED'].includes(i.state)) ?? app.items[0]
    setSelKey(first?.key ?? null)
  }, [app, selKey])
  useEffect(() => { setSelKey(null) }, [id])

  const pos = order ? order.indexOf(id) : -1
  const prevId = pos > 0 ? order[pos - 1] : null
  const nextId = order && pos >= 0 && pos < order.length - 1 ? order[pos + 1] : order && pos === -1 ? order[0] : null
  const go = (to) => navigate(`/scholarships/applications/${to}?${params}`)

  const refresh = (next) => {
    if (next?.id) qc.setQueryData(['scholarship-app', id], next)
    else qc.invalidateQueries({ queryKey: ['scholarship-app', id] })
    qc.invalidateQueries({ queryKey: ['scholarship-apps'] })
  }
  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (r, v) => {
      refresh(v.keepData ? undefined : r)
      const msg = typeof v.done === 'function' ? v.done(r) : v.done
      if (msg) showSuccess(msg)
      setChecking(null); setCheckErrors({})
      if (v.then === 'next') { if (nextId) go(nextId); else navigate(listUrl) }
      if (v.then === 'nextDoc' && r?.items) {
        const after = r.items.find((i) => i.state === 'SUBMITTED')
        if (after) setSelKey(after.key)
      }
    },
    onError: (e, v) => { if (v.form) setCheckErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  if (error) return <PageContainer><Note tone="danger">{error.message}</Note></PageContainer>
  if (isLoading || !app) return <PageContainer><Skeleton className="h-[70vh] rounded-xl" /></PageContainer>

  const required = app.items.filter((i) => i.required)
  const correct = required.filter((i) => i.state === 'ACCEPTED').length
  const originalsDue = app.items.filter((i) => i.state === 'ORIGINAL_DUE')
  const pendingFromFamily = app.items.some((i) => ['MISSING', 'NOT_ACCEPTED', 'EXPIRED', 'ORIGINAL_DUE'].includes(i.state) && (i.required || i.state !== 'MISSING'))
  const sel = app.items.find((i) => i.key === selKey)

  const markCorrect = (item) => {
    const stale = item.doc?.validTill && item.doc.validTill < app.today // the date on file is last year's paper
    const needsDate = SCHOLARSHIP_DOC_TYPE_BY[item.type]?.validMonths && (!item.doc?.issuedOn || stale)
    if (needsDate || item.originalNeeded) {
      setCheckErrors({})
      setChecking({ item: stale ? { ...item, doc: { ...item.doc, issuedOn: null, number: null } } : item, mode: 'ACCEPT' })
      return
    }
    act.mutate({ fn: () => checkDocument(app.id, item.key, { result: 'ACCEPT' }), done: t('scholarships.doc.markedCorrect'), then: 'nextDoc' })
  }
  const decide = async (approve) => {
    if (approve) {
      if (await confirm({ title: t('scholarships.decide.approveTitle', { name: app.student?.name }), message: t(`scholarships.decide.approveBenefit.${app.scheme?.benefit ?? 'FEE_WAIVER'}`), confirmLabel: t('scholarships.decide.approve') })) {
        act.mutate({ fn: () => decideApplications([app.id], true), keepData: true, then: 'next', done: (r) => (r.done ? t('scholarships.decide.approved', { count: r.done }) : r.skipped?.[0]?.message) })
      }
      return
    }
    const note = await prompt({ title: t('scholarships.decide.rejectTitle', { name: app.student?.name }), label: t('scholarships.decide.rejectReason'), required: true })
    if (note) act.mutate({ fn: () => decideApplications([app.id], false, note), keepData: true, then: 'next', done: (r) => (r.done ? t('scholarships.decide.rejected', { count: r.done }) : r.skipped?.[0]?.message) })
  }
  const withdraw = async () => {
    const reason = await prompt({ title: t('scholarships.withdraw.title'), label: app.status === 'APPROVED' ? t('scholarships.withdraw.approvedLabel') : t('scholarships.withdraw.label'), required: true })
    if (reason) act.mutate({ fn: () => withdrawApplication(app.id, reason), done: t('scholarships.withdraw.done') })
  }
  const tell = () => act.mutate({ fn: () => tellFamilies([app.id]), keepData: true, done: (r) => (r.sent ? t('scholarships.tell.sent', { count: r.sent }) : r.skipped?.[0]?.message) })
  const history = allHistory ? app.log : app.log.slice(0, 5)
  const p = app.portal

  return (
    <PageContainer>
      {/* where you are in the list */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate(listUrl)}>{t(tab ? `scholarships.review.back.${tab}` : 'scholarships.review.backAll')}</Button>
        <div className="flex items-center gap-2">
          {order && pos >= 0 && <span className="text-sm text-ink-muted tabular-nums">{t('scholarships.review.position', { n: pos + 1, total: order.length })}</span>}
          <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={!prevId} onClick={() => go(prevId)}>{t('scholarships.review.previous')}</Button>
          <Button size="sm" variant="secondary" disabled={!nextId} onClick={() => go(nextId)}>{t('scholarships.review.next')}<ChevronRight className="ms-1 h-4 w-4" aria-hidden /></Button>
        </div>
      </div>

      {/* who and what, and whether they can apply */}
      <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">{app.student?.name}</h1>
              {app.student?.classShort && <ColorChip label={app.student.classShort} seed={app.student.classId ?? app.student.classShort} />}
              <ApplicationStatus status={app.status} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">{[app.student?.admissionNo, app.applicationNo, app.yearName].filter(Boolean).join(' · ')}</p>
            {app.renewedFrom && (
              <button type="button" onClick={() => navigate(`/scholarships/applications/${app.renewedFrom.id}`)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />{t('scholarships.renewal.of', { no: app.renewedFrom.applicationNo, year: app.renewedFrom.yearName ?? '' })}
              </button>
            )}
          </div>
          <div className="sm:text-end">
            <p className="text-sm font-medium text-ink">{app.scheme?.name}</p>
            <p className="text-sm text-ink-muted">{valueTextOf(t, app.scheme)} · {t('scholarships.review.worth', { amount: formatINR(app.expectedAmount ?? 0) })}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label={t('scholarships.app.income')} value={app.familyIncome != null ? formatINR(app.familyIncome) : null} />
          <Fact label={t('scholarships.app.marks')} value={app.marksPct != null ? `${app.marksPct}%` : null} hint={app.marksFrom ? t(`scholarships.app.marksFrom.${app.marksFrom}`) : null} />
          <Fact label={t('scholarships.app.attendance')} value={app.attendancePct != null ? `${app.attendancePct}%` : null} />
          <Fact label={t('scholarships.review.feesHeldFact')} value={isOpen && app.holdFees ? formatINR(app.expectedAmount ?? 0) : null} hint={isOpen && app.holdFees ? t('scholarships.review.feesHeldHint') : null} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-ink-muted">{t('scholarships.review.canApply')}</span>
          <EligibilityChips checks={app.eligibility} classes={meta?.classes ?? []} />
          {isOpen && canWork && <Button size="sm" variant="ghost" icon={PencilLine} className="ms-auto" onClick={() => setEditing(true)}>{t('scholarships.app.editDetails')}</Button>}
        </div>
      </div>

      {app.status === 'NOT_APPROVED' && app.decisionNote && <Note tone="danger">{t('scholarships.app.notApprovedNote', { reason: app.decisionNote })}</Note>}
      {app.status === 'APPROVED' && <Note tone="success">{t(`scholarships.app.approvedBenefit.${app.scheme?.benefit ?? 'FEE_WAIVER'}`, { by: app.decidedBy ?? '—' })}</Note>}
      {app.visit && isOpen && (
        <Note icon={CalendarClock}>{t('scholarships.visit.booked', { date: date(app.visit.date), time: app.visit.time, by: app.visit.bookedBy ?? '' })}{app.visit.attended ? ` · ${t('scholarships.visit.attended')}` : ''}</Note>
      )}

      {/* the documents, and the picked one large beside them */}
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-5">
          <Panel title={t('scholarships.app.documents')} actions={<span className="text-sm text-ink-muted">{t('scholarships.app.correctOf', { correct, total: required.length })}</span>} flush>
            {!app.items.length ? <p className="p-4 text-sm text-ink-muted">{t('scholarships.app.noDocuments')}</p> : (
              <ul className="divide-y divide-border">
                {app.items.map((item) => {
                  const Icon = STATE_ICON[item.state] ?? Clock
                  const active = item.key === selKey
                  const d = item.doc
                  return (
                    <li key={item.key} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 cursor-pointer border-s-2', active ? 'border-brand-500 bg-brand-50/60' : 'border-transparent hover:bg-black/[0.02]')} onClick={() => setSelKey(item.key)}>
                      <span className={clsx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', STATE_CLS[item.state])}><Icon className="h-4 w-4" strokeWidth={2.5} aria-hidden /></span>
                      <div className="min-w-[10rem] flex-1">
                        <p className="text-sm font-medium text-ink">{docName(t, item)}
                          {!item.required && <span className="font-normal text-ink-faint"> · {t('scholarships.doc.optional')}</span>}
                          {item.originalNeeded && <Stamp className="ms-1.5 inline h-3.5 w-3.5 text-brand-600" aria-label={t('scholarships.doc.originalNeeded')} />}
                        </p>
                        <p className={clsx('text-xs', ['NOT_ACCEPTED', 'EXPIRED'].includes(item.state) ? 'text-danger-600' : 'text-ink-muted')}>
                          {item.state === 'NOT_ACCEPTED' && d?.reason ? `${t(`scholarships.reason.${d.reason}`)}${d.reasonNote ? ` — ${d.reasonNote}` : ''}` : t(`scholarships.docState.${item.state}`)}
                          {d?.validTill && item.state === 'ACCEPTED' ? ` · ${t('scholarships.doc.validTill', { date: date(d.validTill) })}` : ''}
                          {d?.files ? ` · ${t('scholarships.review.files', { count: d.files })}` : d?.paperCopy ? ` · ${t('scholarships.review.paper')}` : ''}
                        </p>
                      </div>
                      {isOpen && (
                        <div className="ms-auto flex shrink-0 flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {canVerify && !['ACCEPTED', 'ORIGINAL_DUE', 'MISSING', 'EXPIRED'].includes(item.state) && <Button size="sm" icon={Check} onClick={() => markCorrect(item)}>{t('scholarships.doc.correct')}</Button>}
                          {canVerify && item.state === 'SUBMITTED' && <Button size="sm" variant="secondary" icon={X} onClick={() => { setCheckErrors({}); setChecking({ item, mode: 'NOT_ACCEPT' }) }}>{t('scholarships.review.fix')}</Button>}
                          {canVerify && item.state === 'ORIGINAL_DUE' && <Button size="sm" variant="secondary" icon={Stamp} onClick={() => act.mutate({ fn: () => markOriginalSeen(app.id, item.key), done: t('scholarships.doc.originalSaved') })}>{t('scholarships.doc.markOriginal')}</Button>}
                          {canWork && ['MISSING', 'NOT_ACCEPTED', 'EXPIRED'].includes(item.state) && <Button size="sm" variant="ghost" icon={FilePlus2} title={t('scholarships.doc.paperReceived')} onClick={() => act.mutate({ fn: () => saveDocument(app.id, item.key, { paperCopy: true }), done: t('scholarships.doc.paperSaved') })}>{t('scholarships.review.paperShort')}</Button>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
          {originalsDue.length > 1 && isOpen && canVerify && (
            <Note icon={Stamp} actions={<Button size="sm" icon={Stamp} onClick={() => act.mutate({ fn: () => markAllOriginalsSeen(app.id), done: t('scholarships.visit.allSeenDone') })}>{t('scholarships.visit.allSeen', { count: originalsDue.length })}</Button>}>
              {t('scholarships.visit.originalsLeft', { list: originalsDue.map((i) => docName(t, i)).join(', ') })}
            </Note>
          )}
        </div>
        {sel && (
          <div className="min-w-0 lg:sticky lg:top-4 lg:col-span-7">
            <Panel title={docName(t, sel)} actions={<DocState state={sel.state} />}>
              <DocPreview key={sel.key} docId={sel.doc?.id} label={docName(t, sel)} fileCategory={SCHOLARSHIP_DOC_FILE_CATEGORY[sel.type]} paperCopy={!!sel.doc?.paperCopy} canAdd={isOpen && canWork}
                ensureDoc={async () => (await documentFor(app.id, sel.key)).id} onChanged={() => refresh()} />
              {sel.doc && (sel.doc.number || sel.doc.issuedOn || sel.doc.checkedAt) && (
                <p className="mt-3 text-xs text-ink-muted">{[
                  sel.doc.number && t('scholarships.doc.no', { no: sel.doc.number }), sel.doc.issuedOn && t('scholarships.doc.issued', { date: date(sel.doc.issuedOn) }),
                  sel.doc.checkedAt && t('scholarships.doc.checkedBy', { name: sel.doc.checkedBy ?? '—', date: date(String(sel.doc.checkedAt).slice(0, 10)) }),
                  sel.doc.originalSeen && t('scholarships.doc.originalSeenShort'),
                ].filter(Boolean).join(' · ')}</p>
              )}
              {sel.note && <p className="mt-1 text-xs text-ink-faint">{sel.note}</p>}
            </Panel>
          </div>
        )}
      </div>

      {/* the rest: the government portal, the money, what has happened */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(p || app.scheme?.provider === 'GOVERNMENT') && app.status !== 'WITHDRAWN' && (
          <Panel title={t('scholarships.portal.panel')} subtitle={t(`scholarships.portalName.${app.scheme?.portal?.name ?? 'OTHER'}`)} icon={Globe}
            actions={canPortal && <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setPortalOpen(true)}>{t('scholarships.portal.update')}</Button>}>
            {p ? (
              <div className="space-y-2">
                <StatusPill tone={SCHOLARSHIP_PORTAL_STATUS[p.status]?.tone}>{t(`scholarships.portalStatus.${p.status}`, SCHOLARSHIP_PORTAL_STATUS[p.status]?.label ?? '—')}</StatusPill>
                <p className="text-sm text-ink-muted">{[p.applicationId && t('scholarships.portal.idShort', { id: p.applicationId }), p.sanctionedAmount != null && t('scholarships.portal.sanctionedShort', { amount: formatINR(p.sanctionedAmount) })].filter(Boolean).join(' · ')}</p>
                {p.previousId && <Note icon={RefreshCw}>{t('scholarships.renewal.portalPrevious', { id: p.previousId })}</Note>}
                {app.scheme?.portal?.verifyBy && p.status === 'APPLIED' && <Note tone="warning">{t('scholarships.portal.verifyBy', { date: date(app.scheme.portal.verifyBy) })}</Note>}
              </div>
            ) : <p className="text-sm text-ink-muted">{t('scholarships.portal.none')}</p>}
          </Panel>
        )}
        {app.scheme?.benefit === 'PAID_TO_INSTITUTION' && app.status === 'APPROVED' && (
          <Panel title={t('scholarships.money.section')} icon={IndianRupee}
            actions={canMoney && app.awaitingMoney && <Button size="sm" variant="secondary" onClick={() => setMoneyOpen(true)}>{t('scholarships.money.recordShort')}</Button>}>
            <p className="text-sm text-ink">{app.awaitingMoney
              ? t('scholarships.money.stillAwaited', { got: formatINR(app.receivedTotal ?? 0), left: formatINR(Math.max(0, (app.expectedAmount ?? 0) - (app.receivedTotal ?? 0))) })
              : t('scholarships.money.allIn', { got: formatINR(app.receivedTotal ?? 0) })}</p>
            {(app.received ?? []).length > 0 && (
              <ul className="mt-2 divide-y divide-border text-sm">
                {app.received.map((r, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="text-ink">{date(r.date)} · {r.receiptNo}</span><span className="tabular-nums font-medium text-ink">{formatINR(r.amount)}</span></li>)}
              </ul>
            )}
          </Panel>
        )}
        <Panel title={t('scholarships.app.history')} icon={History}>
          <Timeline dense items={history.map((l, i) => ({ id: String(i), title: l.text, time: dateTime(l.at), meta: l.by }))} />
          {app.log.length > 5 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAllHistory((v) => !v)}>{allHistory ? t('scholarships.review.lessHistory') : t('scholarships.review.allHistory', { count: app.log.length })}</Button>}
        </Panel>
      </div>

      {/* the decision bar */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:py-3 sm:pe-20">
        <p className="hidden min-w-0 flex-1 basis-60 text-sm text-ink-muted sm:block">{t(`scholarships.review.bar.${isOpen ? app.status : 'DONE'}`, { correct, total: required.length })}</p>
        <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-wrap">
        {((isOpen && canEdit) || (app.status === 'APPROVED' && canApprove)) && <Button variant="ghost" icon={Undo2} title={t('scholarships.withdraw.button')} aria-label={t('scholarships.withdraw.button')} onClick={withdraw}><span className="hidden sm:inline">{t('scholarships.withdraw.button')}</span></Button>}
        {isOpen && canWork && <Button variant="secondary" icon={MessageSquareShare} title={t('scholarships.tell.button')} aria-label={t('scholarships.tell.button')} disabled={!pendingFromFamily} onClick={tell}><span className="hidden sm:inline">{t('scholarships.tell.button')}</span></Button>}
        {isOpen && canApprove && <Button variant="secondary" icon={X} className="flex-1 sm:flex-none" onClick={() => decide(false)}>{t('scholarships.decide.reject')}</Button>}
        {isOpen && canApprove && <Button icon={Check} className="flex-1 sm:flex-none" disabled={app.status !== 'READY'} loading={act.isPending} onClick={() => decide(true)}>{t('scholarships.review.approveNext')}</Button>}
        {!isOpen && nextId && <Button icon={ChevronRight} className="flex-1 sm:flex-none" onClick={() => go(nextId)}>{t('scholarships.review.next')}</Button>}
        </div>
      </div>

      {checking && <CheckDocument item={checking.item} mode={checking.mode} errors={checkErrors} saving={act.isPending} onClose={() => setChecking(null)}
        onSave={(body) => act.mutate({ fn: () => checkDocument(app.id, checking.item.key, body), form: true, then: 'nextDoc', done: body.result === 'ACCEPT' ? t('scholarships.doc.markedCorrect') : t('scholarships.doc.markedFix') })} />}
      {editing && <EditDetails app={app} onClose={() => setEditing(false)} onSaved={(r) => { refresh(r); setEditing(false); showSuccess(t('scholarships.app.detailsSaved')) }} />}
      {portalOpen && <PortalStatus ids={[app.id]} app={app} onClose={() => setPortalOpen(false)} onDone={() => { refresh(); setPortalOpen(false); showSuccess(t('scholarships.portal.saved', { count: 1 })) }} />}
      {moneyOpen && <RecordMoney rows={[{ ...app, received: app.receivedTotal }]} onClose={() => setMoneyOpen(false)}
        onDone={(r) => { refresh(); qc.invalidateQueries({ queryKey: ['fee-ledger'] }); setMoneyOpen(false); if (r.done) showSuccess(t('scholarships.money.done', { count: r.done })); else showError(r.skipped?.[0]?.message) }} />}
    </PageContainer>
  )
}
