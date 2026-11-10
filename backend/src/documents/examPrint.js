// Small pieces the exam documents share (hall ticket, report card, year report card): the weekday of a paper's date,
// and the grade-only papers split the CBSE way into co-scholastic areas (Part 2) and discipline (Part 3).

const DAYS = [['SUN', 'Sunday'], ['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday']]

/** 'YYYY-MM-DD' → { day: 'MON', dayLabel: 'Monday' } (a calendar date, no time zone), or nulls. */
export function weekdayOf(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { day: null, dayLabel: null }
  const [code, label] = DAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]
  return { day: code, dayLabel: label }
}

/** A grade-only paper that grades the student's conduct rather than an activity. */
export const isDiscipline = (name) => /discipline|conduct|behaviou?r|values|attitude/i.test(String(name ?? ''))

/** Grade-only rows → { coScholastic, discipline } (both keep the rows as they are). */
export function splitActivities(rows = []) {
  return { coScholastic: rows.filter((r) => !isDiscipline(r.subject)), discipline: rows.filter((r) => isDiscipline(r.subject)) }
}

/** "Class 8" → "Class 9" style next class name for "Promoted to", from the class list ordered by `order`. */
export const nextClassName = (classes, cls) => {
  if (!cls) return null
  const later = classes.filter((c) => Number(c.order) > Number(cls.order)).sort((a, b) => Number(a.order) - Number(b.order))
  return later[0]?.name ?? null
}

/** A grade band's marks range as a report card prints it: "91–100", "81–90", "32 & below". */
export function bandRange(b) {
  const top = (v) => (Number(v) % 1 > 0.9 ? Math.floor(Number(v)) : Number(v))
  if (b?.min === undefined || b?.max === undefined) return ''
  return Number(b.min) === 0 ? `${top(b.max)} & below` : `${b.min}–${top(b.max)}`
}
