// Leave approval chains (Staff & HR): who approves a leave request, step by step (ported from the hospital).
// A chain is picked by leave type, department, staff category and length; nothing matching means the default —
// the person's reporting manager, else the principal / HR. Shared so the API and the setup screen read the same
// vocabulary and the same matching.

export const LEAVE_APPROVER_TYPES = [
  { value: 'REPORTING_MANAGER', label: 'The person they report to', short: 'Reporting manager' },
  { value: 'DEPARTMENT_HEAD', label: 'Head of their department', short: 'Head of department' },
  { value: 'HR', label: 'Principal / HR (anyone who approves leave)', short: 'Principal / HR' },
  { value: 'SPECIFIC_USERS', label: 'Named people', short: 'Named people' },
  { value: 'ROLE', label: 'Anyone with a role', short: 'Role' },
]
export const LEAVE_APPROVER_LABEL = Object.fromEntries(LEAVE_APPROVER_TYPES.map((t) => [t.value, t.label]))
export const LEAVE_APPROVER_SHORT = Object.fromEntries(LEAVE_APPROVER_TYPES.map((t) => [t.value, t.short]))

/** What happened at a step. OVERRIDDEN = the principal / HR decided it in place of the step's approver. */
export const LEAVE_STEP_DECISIONS = {
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  SKIPPED: 'Skipped',
  ESCALATED: 'Moved on — no decision in time',
  OVERRIDDEN: 'Approved by the principal / HR',
}

export const LEAVE_CHAIN_MAX_STEPS = 5

/** Used when no active chain matches: the reporting manager (the service falls back to the principal / HR). */
export const DEFAULT_LEAVE_CHAIN = {
  name: 'Usual — reporting manager, else principal / HR',
  steps: [{ label: 'Reporting manager', approverType: 'REPORTING_MANAGER', userIds: [], roleIds: [] }],
  skipSelfOrRepeat: true,
  escalateAfterHours: null,
}

const has = (list, v) => !list?.length || (v !== null && v !== undefined && list.map(String).includes(String(v)))

/** Does `rule` cover this request? Empty scope lists mean "any". */
export function leaveRuleMatches(rule, { leaveTypeId, departmentId, category, days }) {
  const s = rule?.scope ?? {}
  if (rule?.active === false) return false
  if (!has(s.leaveTypeIds, leaveTypeId) || !has(s.departmentIds, departmentId) || !has(s.categories, category)) return false
  return s.minDays === null || s.minDays === undefined || Number(days) >= Number(s.minDays)
}

/** The active matching rule with the highest priority (ties: the most recently changed), or null. */
export function pickLeaveRule(rules, ctx) {
  const hit = (rules ?? []).filter((r) => leaveRuleMatches(r, ctx))
  hit.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  return hit[0] ?? null
}

/** "Reporting manager → Principal / HR" */
export const leaveChainSummary = (steps) => (steps ?? []).map((s) => s.label || LEAVE_APPROVER_SHORT[s.approverType] || s.approverType).join(' → ')
