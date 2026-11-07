import clsx from 'clsx'
import { CheckCircle2, CircleDot, Circle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../context/SettingsContext'

const ICON = { APPROVED: CheckCircle2, REJECTED: XCircle }

/** The steps of one approval request, with who decided each and who it waits for now. */
export default function ApprovalSteps({ request, approvers = [] }) {
  const { t } = useTranslation('ui')
  const { dateTime } = useFormat()
  const steps = request?.steps ?? []
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const current = request.status === 'PENDING' && i === request.currentStep
        const Icon = ICON[s.status] ?? (current ? CircleDot : Circle)
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', s.status === 'APPROVED' ? 'text-success-600' : s.status === 'REJECTED' ? 'text-danger-600' : current ? 'text-amber-600' : 'text-ink-faint')} />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink">
                {s.label || t('ui.approvalSteps.step', { n: i + 1 })}
                {s.roleNames?.length > 0 && <span className="font-normal text-ink-muted"> · {s.roleNames.join(t('ui.approvalSteps.orSeparator'))}</span>}
              </p>
              {s.decidedBy ? (
                <p className="text-xs text-ink-muted">{t(s.status === 'REJECTED' ? 'ui.approvalSteps.rejectedBy' : 'ui.approvalSteps.approvedBy', { name: s.decidedBy })} · {dateTime(s.decidedAt)}{s.note ? ` — “${s.note}”` : ''}</p>
              ) : current ? (
                <p className="text-xs text-amber-700">{approvers.length ? t('ui.approvalSteps.waitingFor', { names: approvers.map((a) => a.name).join(', ') }) : t('ui.approvalSteps.nobody')}</p>
              ) : <p className="text-xs text-ink-faint">{request.status === 'PENDING' ? t('ui.approvalSteps.next') : t('ui.approvalSteps.notReached')}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
