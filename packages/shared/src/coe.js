// Exam controller (module `coe`, higher education): lists and pure helpers shared by the API and the web app.
//
//   CoeSession     an examination session ("Nov 2026 end-semester", or a supplementary one) for some program-semesters
//   CoeMarkSheet   a course's internal marks (per assessment component) or external marks (by dummy number) in a session
//   CoeResult      a student's result in a course for one attempt: grade, grade points, pass / arrear
//   CoeSemesterResult  a student's semester in a session: SGPA, CGPA, credits, arrears — the grade card's record
//   CoeRevaluation a request to re-evaluate an external paper: REQUESTED → APPROVED → REVALUED (or REJECTED)

export const COE_SESSION_KINDS = {
  REGULAR: { label: 'Regular (end-semester)', tone: 'brand' },
  SUPPLEMENTARY: { label: 'Supplementary (arrears)', tone: 'orange' },
}

export const COE_SESSION_STATUS = {
  OPEN: { label: 'Marks being entered', tone: 'warning' },
  PUBLISHED: { label: 'Results published', tone: 'success' },
}

export const COE_SHEET_PARTS = {
  INTERNAL: { label: 'Internal assessment' },
  EXTERNAL: { label: 'End-semester (external)' },
}

export const COE_SHEET_STATUS = {
  OPEN: { label: 'Being entered', tone: 'warning' },
  LOCKED: { label: 'Locked', tone: 'success' },
}

export const COE_MODERATION_KINDS = {
  ADD: { label: 'Add marks (grace)' },
  SCALE: { label: 'Scale up by %' },
}
export const COE_MODERATION_STATUS = {
  PROPOSED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Applied', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

export const COE_REVAL_STATUS = {
  REQUESTED: { label: 'Requested', tone: 'warning' },
  APPROVED: { label: 'Approved — being re-evaluated', tone: 'info' },
  REVALUED: { label: 'Re-evaluated', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

export const COE_FAIL_REASONS = {
  ABSENT: 'Absent for the end-semester exam',
  INTERNAL: 'Below the internal minimum',
  EXTERNAL: 'Below the end-semester minimum',
  TOTAL: 'Below the pass mark',
  GRADE: 'Fail grade',
}

/** External marks after moderation, never above the paper's maximum. */
export function moderatedMarks(marks, moderation, max) {
  if (marks === null || marks === undefined) return marks
  if (!moderation || moderation.status !== 'APPROVED') return marks
  const v = Number(moderation.value) || 0
  const next = moderation.kind === 'SCALE' ? Number(marks) * (1 + v / 100) : Number(marks) + v
  return Math.min(Number(max) || Infinity, Math.round(next * 100) / 100)
}

/** A dummy (false) number for an answer script: a letter and six digits, e.g. D402917. */
export function makeDummyNo(random = Math.random) {
  return `D${String(Math.floor(random() * 900000) + 100000)}`
}
