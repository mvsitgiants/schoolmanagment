// Semester registration (module `registration`, higher education): lists and pure helpers shared by the API and the web app.
//
//   RegistrationWindow  a program-semester's registration period: dates, credit limits, the courses offered
//                       (core ones mandatory, electives in groups with a pick range and seat limits)
//   CourseRegistration  a student's course selection in a window; submitted, then approved by the advisor

export const REG_WINDOW_STATUS = {
  UPCOMING: { label: 'Not open yet', tone: 'neutral' },
  OPEN: { label: 'Open', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'warning' },
}

export const REG_STATUS = {
  SUBMITTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
}

/** A window's state on a day: closed by hand or past its last day, open between its dates. */
export function regWindowStatus(w, today) {
  if (!w) return null
  if (w.closed || (w.closesOn && today > w.closesOn)) return 'CLOSED'
  if (w.opensOn && today < w.opensOn) return 'UPCOMING'
  return 'OPEN'
}

/**
 * What is wrong with a selection (pure checks; prerequisites and seats need the database):
 *   window   { minCredits, maxCredits, offerings: [{ courseId, mandatory, group }], groups: [{ code, name, minPick, maxPick }] }
 *   courses  Map/obj courseId → { credits, code }
 *   picked   [courseId]
 * → { credits, errors: [{ code, message, courseId?, group? }] }
 */
export function checkRegistration(window, courses, picked = []) {
  const get = (id) => (courses instanceof Map ? courses.get(String(id)) : courses[String(id)])
  const ids = [...new Set(picked.map(String))]
  const errors = []
  const offered = new Map((window.offerings ?? []).map((o) => [String(o.courseId), o]))
  for (const id of ids) if (!offered.has(id)) errors.push({ code: 'NOT_OFFERED', courseId: id, message: `${get(id)?.code ?? 'A course'} is not offered in this window` })
  for (const o of window.offerings ?? []) {
    if (o.mandatory && !ids.includes(String(o.courseId))) errors.push({ code: 'MANDATORY', courseId: String(o.courseId), message: `${get(o.courseId)?.code ?? 'A core course'} is compulsory` })
  }
  for (const g of window.groups ?? []) {
    const n = ids.filter((id) => offered.get(id)?.group === g.code).length
    if (g.minPick && n < g.minPick) errors.push({ code: 'GROUP_MIN', group: g.code, message: `Pick at least ${g.minPick} from ${g.name || g.code}` })
    if (g.maxPick && n > g.maxPick) errors.push({ code: 'GROUP_MAX', group: g.code, message: `Pick at most ${g.maxPick} from ${g.name || g.code}` })
  }
  const credits = Math.round(ids.reduce((s, id) => s + (Number(get(id)?.credits) || 0), 0) * 10) / 10
  if (window.minCredits && credits < window.minCredits) errors.push({ code: 'MIN_CREDITS', message: `${credits} credits — at least ${window.minCredits} needed` })
  if (window.maxCredits && credits > window.maxCredits) errors.push({ code: 'MAX_CREDITS', message: `${credits} credits — at most ${window.maxCredits} allowed` })
  return { credits, errors }
}
