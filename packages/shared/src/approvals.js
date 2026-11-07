// Approval engine (E8). Some actions go beyond what a role may do on its own: a fee
// concession above the role's limit, cancelling a receipt that isn't yours. Instead of
// "ask the principal" on paper, the user sends a request; people who may approve it get
// it in their inbox; the decision is recorded.
//
// Two kinds:
//   PERMIT  – approval is a one-time pass the requester uses (the accountant then saves
//             the receipt with the approved concession). Expires if not used.
//   EXECUTE – the system does the action the moment it is approved (the receipt is
//             cancelled), as the approver.
//
// Who may approve: anyone holding `approver` whose role limit (`limitKey`) covers the
// request, never the requester. An institution can narrow each step to certain roles and
// add steps that only apply above a value (Administration › Workflows & approvals).
// Each module adds its approval types here (the type's module must be switched on).

export const APPROVAL_TYPES = [
  {
    type: 'fees.concession', module: 'fees', label: 'Fee concession above the limit', mode: 'PERMIT',
    approver: 'fees.concessions.approve', limitKey: 'fees.discountMaxPct', measure: 'PCT', expiryHours: 24,
    help: 'The accountant asks before collecting fees with a bigger concession than their role allows. Once approved, they can collect that student’s fee with up to the approved concession, once.',
  },
  {
    type: 'fees.cancel', module: 'fees', label: 'Cancel a fee receipt', mode: 'EXECUTE',
    approver: 'fees.invoices.cancel', limitKey: 'fees.refundMax', measure: 'AMOUNT', expiryHours: 24,
    help: 'For a receipt the accountant can’t cancel alone: someone else’s, from an earlier day, or above their limit. Approving cancels the receipt.',
  },
]

export const APPROVAL_TYPE_BY = Object.fromEntries(APPROVAL_TYPES.map((t) => [t.type, t]))

export const APPROVAL_STATUSES = {
  PENDING: { label: 'Waiting', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  USED: { label: 'Done', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  FAILED: { label: 'Could not complete', tone: 'danger' },
}

export const APPROVAL_STEP_STATUSES = {
  PENDING: { label: 'Waiting', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SKIPPED: { label: 'Not needed', tone: 'neutral' },
}

/** A request's value as people read it: "12%" or "₹1,200". Amounts are in paise. */
export function approvalValueText(measure, value) {
  if (value === null || value === undefined) return '—'
  if (measure === 'PCT') return `${Math.round(value * 100) / 100}%`
  return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** Value in the unit a rule is written in (% or ₹), from the stored value (% or paise). */
export const approvalValueInRuleUnits = (measure, value) => (measure === 'AMOUNT' ? value / 100 : value)

/** Does a role limit cover the request? Limits are in % or ₹; no limit set means no cap. */
export function limitCovers(limit, measure, value) {
  if (limit === null || limit === undefined || limit === '') return true
  return measure === 'AMOUNT' ? Number(limit) * 100 >= value : Number(limit) >= value
}

/** The default rule: one step, anyone who may approve. */
export const defaultApprovalRule = (type) => ({
  type, enabled: true, expiryHours: APPROVAL_TYPE_BY[type]?.expiryHours ?? 24,
  steps: [{ label: 'Approval', roleIds: [], minValue: null }],
})

/** Steps that apply to a request: a step with `minValue` applies only above it. */
export function stepsFor(rule, measure, value) {
  const v = approvalValueInRuleUnits(measure, value)
  return (rule.steps ?? []).filter((s) => s.minValue === null || s.minValue === undefined || s.minValue === '' || v > Number(s.minValue))
}
