import { useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock3, FastForward, MinusCircle, Users, XCircle } from 'lucide-react'
import { Timeline, usePrompt } from '../../system'
import Button from '../../ui/Button'
import { decideAsManager, decideLeave } from '../../../api/hrms'
import { useSnackbar } from '../../../context/SnackbarContext'
import { useFormat } from '../../../context/SettingsContext'
import { useDaysText } from './LeaveBits'

/*
 * A leave request's approval chain, as the API sends it on every request (`leave.chain`):
 *   { status, stepNumber, totalSteps, waitingOn, waitingOnPeople[], canAct, actingAsHr, cannotActReason,
 *     ruleName, requestedBy, rejectionReason, since, escalateAfterHours,
 *     steps[{ no, label, approverType, approverNames[], fallback, state, override, decidedBy, at, note }] }
 * state: APPROVED · REJECTED · CURRENT · UPCOMING · SKIPPED · ESCALATED · NOT_REACHED.
 * Shown next to every request so nobody has to guess who "waiting" waits for.
 */

const people = (names, max = 3) => {
  if (!names?.length) return ''
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max}` : shown
}

/** "Reporting manager — Rekha Rao" / "Principal / HR" */
export function useWaitingText() {
  const { t } = useTranslation('hrmsLeave')
  return (c) => {
    if (!c?.waitingOn) return t('hrmsLeave.chain.nextApprover')
    const who = people(c.waitingOnPeople)
    return who ? t('hrmsLeave.chain.waitingWho', { who: c.waitingOn, people: who }) : c.waitingOn
  }
}

/** Compact cell for a list row: who has it now (and what came before), or how it ended. */
export function LeaveChainInline({ chain: c, className }) {
  const { t } = useTranslation('hrmsLeave')
  if (!c) return <span className="text-xs text-ink-faint">—</span>
  const done = (c.steps ?? []).filter((s) => s.state === 'APPROVED')
  const last = done.at(-1)
  if (c.status === 'PENDING') {
    return (
      <div className={clsx('min-w-0 max-w-[260px]', className)}>
        <p className="text-xs text-ink flex items-center gap-1">
          <Clock3 className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-medium">{c.waitingOn}</span>
            {c.totalSteps > 1 && <span className="text-ink-muted"> · {t('hrmsLeave.chain.stepOf', { step: c.stepNumber, total: c.totalSteps })}</span>}
          </span>
        </p>
        {c.waitingOnPeople?.length > 0 && <p className="text-[11px] text-ink-muted ps-[18px] truncate">{people(c.waitingOnPeople)}</p>}
        {done.map((s) => <p key={s.no} className="text-[11px] text-ink-muted ps-[18px] truncate">{t('hrmsLeave.chain.approvedByShort', { name: s.decidedBy })}</p>)}
      </div>
    )
  }
  if (c.status === 'APPROVED') {
    return <p className={clsx('text-xs text-ink-muted truncate max-w-[260px]', className)}>{last?.decidedBy ? t('hrmsLeave.chain.approvedBy', { name: last.decidedBy }) : t('hrmsLeave.chain.approved')}</p>
  }
  if (c.status === 'REJECTED') {
    const r = (c.steps ?? []).find((s) => s.state === 'REJECTED')
    return (
      <div className={clsx('min-w-0 max-w-[260px]', className)}>
        <p className="text-xs text-ink-muted truncate">{r?.decidedBy ? t('hrmsLeave.chain.rejectedBy', { name: r.decidedBy }) : t('hrmsLeave.chain.rejected')}</p>
        {c.rejectionReason && <p className="text-[11px] text-ink-faint truncate">“{c.rejectionReason}”</p>}
      </div>
    )
  }
  return <p className={clsx('text-xs text-ink-faint truncate max-w-[260px]', className)}>{c.rejectionReason ? t('hrmsLeave.chain.cancelledReason', { reason: c.rejectionReason }) : t('hrmsLeave.chain.cancelled')}</p>
}

const STEP_MARK = {
  APPROVED: { icon: CheckCircle2, tone: 'brand' },
  REJECTED: { icon: XCircle, tone: 'neutral' },
  CURRENT: { icon: Clock3, tone: 'warning' },
  SKIPPED: { icon: MinusCircle, tone: 'neutral' },
  ESCALATED: { icon: FastForward, tone: 'neutral' },
}

/** The whole chain as a vertical stepper: who decided and when, who has it now, what is to come. */
export function LeaveChainSteps({ chain: c }) {
  const { t } = useTranslation('hrmsLeave')
  const { dateTime } = useFormat()
  if (!c) return null
  const lower = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`
  return (
    <Timeline dense items={(c.steps ?? []).map((s) => ({
      id: s.no, icon: STEP_MARK[s.state]?.icon, tone: STEP_MARK[s.state]?.tone, pending: !STEP_MARK[s.state],
      title: c.totalSteps > 1 ? t('hrmsLeave.chain.stepTitle', { no: s.no, label: s.label }) : s.label,
      body: (
        <div className="-mt-0.5 space-y-0.5">
          {s.state === 'APPROVED' && <p className="text-xs text-ink">{t(s.override ? 'hrmsLeave.chain.approvedByInstead' : 'hrmsLeave.chain.approvedBy', { name: s.decidedBy || t('hrmsLeave.chain.someone') })}{s.at ? ` · ${dateTime(s.at)}` : ''}</p>}
          {s.state === 'REJECTED' && <p className="text-xs text-ink">{t('hrmsLeave.chain.rejectedBy', { name: s.decidedBy || t('hrmsLeave.chain.someone') })}{s.at ? ` · ${dateTime(s.at)}` : ''}</p>}
          {s.state === 'CURRENT' && (
            <>
              <p className="text-xs text-ink flex items-start gap-1">
                <Users className="w-3.5 h-3.5 mt-px shrink-0 text-ink-muted" aria-hidden />
                <span className="min-w-0 break-words">{s.approverNames?.length ? t('hrmsLeave.chain.withNames', { names: s.approverNames.join(', ') }) : t('hrmsLeave.chain.withAnyone')}</span>
              </p>
              {c.since && <p className="text-[11px] text-ink-faint">{c.escalateAfterHours ? t('hrmsLeave.chain.sinceMovesOn', { time: dateTime(c.since), hours: c.escalateAfterHours }) : t('hrmsLeave.chain.since', { time: dateTime(c.since) })}</p>}
            </>
          )}
          {s.state === 'UPCOMING' && <p className="text-xs text-ink-faint">{s.approverNames?.length ? t('hrmsLeave.chain.nextPeople', { people: people(s.approverNames) }) : t('hrmsLeave.chain.next')}</p>}
          {s.state === 'SKIPPED' && <p className="text-xs text-ink-faint">{s.note ? t('hrmsLeave.chain.skippedNote', { note: lower(s.note) }) : t('hrmsLeave.chain.skipped')}</p>}
          {s.state === 'ESCALATED' && <p className="text-xs text-ink-muted">{t('hrmsLeave.chain.escalated')}{s.at ? ` · ${dateTime(s.at)}` : ''}</p>}
          {s.state === 'NOT_REACHED' && <p className="text-xs text-ink-faint">{t('hrmsLeave.chain.notReached')}</p>}
          {s.fallback && <p className="text-[11px] text-ink-faint">{t('hrmsLeave.chain.standsIn', { reason: lower(s.fallback) })}</p>}
          {s.note && s.state !== 'SKIPPED' && s.state !== 'ESCALATED' && <p className="text-xs text-ink-muted mt-0.5 break-words">“{s.note}”</p>}
        </div>
      ),
    }))} />
  )
}

/**
 * Approve / reject the step a request waits on: an optional note to approve, a reason (the person sees it) to say no.
 * `asManager`: decide through My workspace (a named approver without Staff & HR rights). `onDone(updatedLeave)`.
 */
export function useLeaveDecision(onDone, { asManager = false } = {}) {
  const { t } = useTranslation('hrmsLeave')
  const prompt = usePrompt()
  const days = useDaysText()
  const waiting = useWaitingText()
  const { showSuccess, showError } = useSnackbar()
  const [busy, setBusy] = useState(null)
  const decide = async (l, approve) => {
    const c = l.chain
    const instead = !!c?.actingAsHr
    const next = (c?.steps ?? []).find((s) => s.state === 'UPCOMING')
    const what = { days: days(l.days), type: l.leaveName, name: l.employeeName }
    const message = approve
      ? instead ? t('hrmsLeave.decide.approveInstead', { who: waiting(c) }) : next ? t('hrmsLeave.decide.approveNext', { next: next.label }) : t('hrmsLeave.decide.approveFinal')
      : instead ? t('hrmsLeave.decide.rejectInstead', { who: waiting(c) }) : t('hrmsLeave.decide.rejectMsg')
    const note = await prompt(approve
      ? { title: t('hrmsLeave.decide.approveTitle', what), message, label: t('hrmsLeave.decide.noteOptional'), confirmLabel: t('hrmsLeave.decide.approve') }
      : { title: t('hrmsLeave.decide.rejectTitle', what), message, label: t('hrmsLeave.decide.reason'), required: true, confirmLabel: t('hrmsLeave.decide.reject'), tone: 'danger' })
    if (note === null || note === undefined) return null
    setBusy(l.id)
    try {
      const body = { approve, note: note.trim() || undefined }
      const x = await (asManager ? decideAsManager(l.id, body) : decideLeave(l.id, body))
      const after = x?.chain
      showSuccess(!approve ? t('hrmsLeave.decide.rejected')
        : after?.status === 'APPROVED' ? t('hrmsLeave.decide.approvedDone')
          : t('hrmsLeave.decide.approvedStep', { who: waiting(after) }))
      onDone?.(x)
      return x
    } catch (e) { showError(e.message); return null } finally { setBusy(null) }
  }
  return { decide, busy }
}

/** Approve / Not approve buttons for a row, or who it waits on when it isn't the caller's step. */
export function LeaveDecisionButtons({ leave: l, decide, busy }) {
  const { t } = useTranslation('hrmsLeave')
  const c = l.chain
  if (l.status !== 'PENDING') return null
  if (!c?.canAct) return <span className="block text-[11px] font-sans text-ink-faint max-w-[140px] ms-auto text-end" title={c?.cannotActReason || ''}>{t('hrmsLeave.chain.notYours')}</span>
  return (
    <div className="flex gap-1.5 justify-end font-sans" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="secondary" disabled={busy === l.id} onClick={() => decide(l, false)}>{t('hrmsLeave.decide.reject')}</Button>
      <Button size="sm" loading={busy === l.id} onClick={() => decide(l, true)}>{t('hrmsLeave.decide.approve')}</Button>
    </div>
  )
}
