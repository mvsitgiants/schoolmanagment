import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, CalendarClock, CheckCircle2, Presentation, Send, XCircle } from 'lucide-react'
import { Drawer, FactGrid, Note, SkeletonRows, Timeline, localIso, usePrompt } from '../../system'
import Button from '../../ui/Button'
import { cancelLeave, cancelMyLeave, fetchLeave, fetchMyApproval } from '../../../api/hrms'
import { hasPermission } from '../../../api/auth'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useFormat } from '../../../context/SettingsContext'
import { BalanceBar, LeaveStatusPill, LeaveTypeName, invalidateLeave, useBalanceText, useDaysText, useDow, useLeaveDates } from './LeaveBits'
import { LeaveChainSteps, useLeaveDecision, useWaitingText } from './LeaveChain'

/**
 * One leave request: who, when, why; where it is in its approval chain; the person's balance of that leave; and for
 * a teacher, the lessons on those days with a link to arrange cover. Approve / not approve when it is the caller's
 * step; cancel for HR (or the person themselves, before it starts).
 *   mode: 'hr' (Staff & HR › Leave) · 'approver' (My workspace › Team leave) · 'self' (My workspace › Leave, `leave` passed in)
 */
export default function LeaveDrawer({ id, leave: given, mode = 'hr', onClose }) {
  const { t } = useTranslation('hrmsLeave')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const days = useDaysText()
  const dates = useLeaveDates()
  const dow = useDow()
  const waiting = useWaitingText()
  const balanceText = useBalanceText()
  const { showSuccess, showError } = useSnackbar()
  const q = useQuery({ queryKey: ['leave', id, mode], queryFn: () => (mode === 'approver' ? fetchMyApproval(id) : fetchLeave(id)), enabled: !!id && mode !== 'self' })
  const l = mode === 'self' ? given : q.data
  const { decide, busy } = useLeaveDecision(() => invalidateLeave(qc), { asManager: mode === 'approver' })
  const today = localIso(new Date())
  const canCancel = l && ['PENDING', 'APPROVED'].includes(l.status) && (mode === 'self' ? l.status === 'PENDING' || l.from > today : mode === 'hr' && hasPermission('hrms.leave.cancel'))
  const cancel = async () => {
    const reason = await prompt({ title: mode === 'self' ? t('hrmsLeave.drawer.cancelMine') : t('hrmsLeave.drawer.cancelTitle', { name: l.employeeName }), message: l.status === 'APPROVED' ? t('hrmsLeave.drawer.cancelApprovedMsg', { days: days(l.days) }) : t('hrmsLeave.drawer.cancelPendingMsg'), label: t('hrmsLeave.drawer.cancelWhy'), confirmLabel: t('hrmsLeave.drawer.cancel'), tone: 'danger' })
    if (reason === null || reason === undefined) return
    try {
      await (mode === 'self' ? cancelMyLeave(l.id, reason.trim() || undefined) : cancelLeave(l.id, reason.trim() || undefined))
      showSuccess(t('hrmsLeave.drawer.cancelled'))
      invalidateLeave(qc)
      onClose()
    } catch (e) { showError(e.message) }
  }
  const c = l?.chain
  const canAct = l?.status === 'PENDING' && c?.canAct && mode !== 'self'
  const lessons = l?.lessons
  const open = lessons ? lessons.days.filter((d) => d.covered < d.lessons) : []
  return (
    <Drawer open onClose={onClose} size="lg" subtitle={t('hrmsLeave.drawer.subtitle')} title={l ? (mode === 'self' ? l.leaveName : `${l.employeeName} · ${l.leaveName}`) : t('hrmsLeave.drawer.loading')}
      footer={l && (canAct || canCancel) && (
        <div className="flex flex-wrap justify-end gap-2">
          {canCancel && <Button variant="ghost" icon={Ban} onClick={cancel}>{mode === 'self' && l.status === 'PENDING' ? t('hrmsLeave.drawer.withdraw') : t('hrmsLeave.drawer.cancel')}</Button>}
          {canAct && <Button variant="secondary" icon={XCircle} disabled={!!busy} onClick={async () => { if (await decide(l, false)) onClose() }}>{t('hrmsLeave.decide.reject')}</Button>}
          {canAct && <Button icon={CheckCircle2} loading={busy === l.id} onClick={async () => { if (await decide(l, true)) q.refetch() }}>{c.actingAsHr ? t('hrmsLeave.decide.approveForThem') : t('hrmsLeave.decide.approve')}</Button>}
        </div>
      )}>
      {!l ? <SkeletonRows rows={5} className="!px-0" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <LeaveStatusPill status={l.status} />
            <span className="text-sm text-ink">{t('hrmsLeave.drawer.headline', { days: days(l.days), dates: dates(l) })}</span>
          </div>
          {l.warnings?.length > 0 && l.status === 'PENDING' && <Note tone="warning">{l.warnings.map((w) => <p key={w}>{w}</p>)}</Note>}
          {canAct && c.actingAsHr && <Note>{t('hrmsLeave.drawer.instead', { who: waiting(c) })}</Note>}
          <FactGrid cols={2} items={[
            mode !== 'self' && { label: t('hrmsLeave.drawer.person'), value: [l.employeeName, l.designation, l.department].filter(Boolean).join(' · '), span: 'full' },
            { label: t('hrmsLeave.drawer.type'), value: <LeaveTypeName name={l.leaveName} paid={l.paid} /> },
            { label: t('hrmsLeave.drawer.days'), value: days(l.days) },
            { label: t('hrmsLeave.drawer.reason'), value: l.reason, text: true, span: 'full' },
            l.arrangement && { label: t('hrmsLeave.drawer.arrangement'), value: l.arrangement, text: true, span: 'full' },
          ].filter(Boolean)} />
          {l.balance && !l.balance.unlimited && l.status === 'PENDING' && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1.5">{t('hrmsLeave.drawer.balance', { type: l.leaveName })}</h4>
              <p className="text-sm text-ink">{balanceText(l.balance)}{l.balance.pending ? <span className="text-ink-muted"> · {t('hrmsLeave.drawer.held', { days: days(l.balance.pending) })}</span> : null}</p>
              <BalanceBar left={l.balance.available} of={l.balance.ofTotal} className="mt-1.5 max-w-xs" />
            </section>
          )}
          {lessons?.total > 0 && (
            <section className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-ink"><Presentation className="w-4 h-4 text-ink-muted" aria-hidden />
                {t('hrmsLeave.drawer.lessons', { count: lessons.total })}
                {lessons.covered > 0 && <span className="font-normal text-ink-muted">{t('hrmsLeave.drawer.covered', { count: lessons.covered })}</span>}
              </p>
              {l.status === 'APPROVED' && open.length > 0 && hasPermission('timetable.substitutions.view') && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {open.slice(0, 8).map((d) => (
                    <li key={d.date}>
                      <Link to={`/timetable/substitutions?date=${d.date}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 h-8 text-xs text-ink hover:bg-bg">
                        <CalendarClock className="w-3.5 h-3.5 text-brand-600" aria-hidden />{t('hrmsLeave.drawer.arrangeCover', { day: `${dow(d.date)} ${date(d.date)}`, count: d.lessons - d.covered })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {l.status === 'PENDING' && <p className="mt-1 text-xs text-ink-muted">{t('hrmsLeave.drawer.lessonsPending')}</p>}
              {l.status === 'APPROVED' && !open.length && <p className="mt-1 text-xs text-ink-muted">{t('hrmsLeave.drawer.allCovered')}</p>}
            </section>
          )}
          {c && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('hrmsLeave.drawer.approval')}</h4>
              <LeaveChainSteps chain={c} />
              {l.status === 'PENDING' && mode !== 'self' && !c.canAct && <p className="mt-2 text-[11px] text-ink-faint">{c.cannotActReason || t('hrmsLeave.chain.waitingFor', { who: waiting(c) })}</p>}
            </section>
          )}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('hrmsLeave.drawer.history')}</h4>
            <Timeline dense items={[
              { id: 'applied', icon: Send, tone: 'neutral', title: l.applied?.onBehalf ? t('hrmsLeave.drawer.enteredBy', { name: l.applied?.by }) : t('hrmsLeave.drawer.askedBy', { name: l.applied?.by }), time: dateTime(l.applied?.at) },
              l.decided?.at && { id: 'decided', icon: l.status === 'REJECTED' ? XCircle : CheckCircle2, tone: l.status === 'REJECTED' ? 'neutral' : 'brand', title: l.status === 'REJECTED' ? t('hrmsLeave.drawer.rejectedBy', { name: l.decided.by }) : t('hrmsLeave.drawer.approvedBy', { name: l.decided.by }), time: dateTime(l.decided.at), meta: l.decided.note },
              l.cancelled?.at && { id: 'cancelled', icon: Ban, tone: 'neutral', title: t('hrmsLeave.drawer.cancelledBy', { name: l.cancelled.by }), time: dateTime(l.cancelled.at), meta: [l.cancelled.reason, l.cancelled.afterApproval && t('hrmsLeave.drawer.daysBack')].filter(Boolean).join(' · ') },
            ].filter(Boolean)} />
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">{t('hrmsLeave.drawer.daysThatCount')}</h4>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(l.dates ?? []).map((d) => (
                <li key={d.date} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-ink"><span className="text-ink-faint text-xs w-9 inline-block">{dow(d.date)}</span>{date(d.date)}</span>
                  <span className="text-xs text-ink-muted">{d.portion === 0.5 ? t('hrmsLeave.bits.halfADay') : t('hrmsLeave.bits.wholeDay')}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-ink-faint">{t('hrmsLeave.drawer.daysNote')}</p>
          </section>
        </div>
      )}
    </Drawer>
  )
}
