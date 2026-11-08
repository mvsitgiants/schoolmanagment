// Events & calendar: the school calendar (events for everyone, some classes or staff only — alongside the holidays from
// Staff & HR and the exam dates from Exams), replies families give in the app (going / not going, or consent for a trip),
// parent–teacher meetings (a session with teachers and time slots families book), and photo albums for families.
import { addDaysYmd, fromMinutes, toMinutes } from './dates.js'

export const EVENT_KINDS = [
  { value: 'EVENT', label: 'Event', tone: 'brand' },
  { value: 'CELEBRATION', label: 'Celebration / festival', tone: 'success' },
  { value: 'CULTURAL', label: 'Cultural programme', tone: 'success' },
  { value: 'SPORTS', label: 'Sports', tone: 'info' },
  { value: 'TRIP', label: 'Trip / excursion', tone: 'info' },
  { value: 'EXAM', label: 'Exam / test', tone: 'warning' },
  { value: 'DEADLINE', label: 'Last date', tone: 'danger' },
  { value: 'MEETING', label: 'Meeting', tone: 'neutral' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]
export const EVENT_KIND_BY = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k]))

/** What else shows on the calendar, from other modules (read-only there). */
export const CALENDAR_SOURCES = {
  EVENT: { label: 'Event' },
  HOLIDAY: { label: 'Holiday', tone: 'danger' },
  EXAM: { label: 'Exam', tone: 'warning' },
  PTM: { label: 'Parent–teacher meeting', tone: 'info' },
}

export const AUDIENCES = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'CLASSES', label: 'Some classes' },
  { value: 'SECTIONS', label: 'Some sections' },
  { value: 'STAFF', label: 'Staff only' },
]

export const REPLY_KINDS = [
  { value: 'NONE', label: 'No reply needed' },
  { value: 'RSVP', label: 'Going / not going' },
  { value: 'CONSENT', label: 'Permission (consent slip)' },
]
export const REPLY_ANSWERS = { YES: { label: 'Yes', tone: 'success' }, NO: { label: 'No', tone: 'danger' } }

export const PTM_STATUS = {
  DRAFT: { label: 'Being set up', tone: 'neutral' },
  OPEN: { label: 'Booking open', tone: 'success' },
  CLOSED: { label: 'Booking closed', tone: 'info' },
  DONE: { label: 'Held', tone: 'neutral' },
}
export const PTM_MODES = [
  { value: 'IN_PERSON', label: 'At school' },
  { value: 'ONLINE', label: 'Video call' },
]
export const BOOKING_STATUS = {
  BOOKED: { label: 'Booked', tone: 'info' },
  ATTENDED: { label: 'Met', tone: 'success' },
  NO_SHOW: { label: 'Didn’t come', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}
export const ACTIVE_BOOKING = ['BOOKED', 'ATTENDED', 'NO_SHOW']

/** The slot start times of a meeting: from `start` to `end` (HH:MM), `minutes` each with `gap` between. */
export function ptmSlots(start, end, minutes = 10, gap = 0) {
  const out = []
  const s = toMinutes(start)
  const e = toMinutes(end)
  const step = Math.max(1, Number(minutes) || 10) + Math.max(0, Number(gap) || 0)
  if (!(s >= 0) || !(e > s)) return out
  for (let m = s; m + (Number(minutes) || 10) <= e && out.length < 200; m += step) out.push(fromMinutes(m))
  return out
}

/** Does an event (startDate–endDate) touch the range from–to (all YYYY-MM-DD)? */
export const touchesRange = (ev, from, to) => ev.startDate <= to && (ev.endDate || ev.startDate) >= from

/** The weeks of a month for a calendar grid: arrays of 7 dates (YYYY-MM-DD), Monday first unless `sundayFirst`. */
export function monthGrid(year, month, { sundayFirst = false } = {}) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay()
  const back = sundayFirst ? dow : (dow + 6) % 7
  let d = addDaysYmd(first, -back)
  const weeks = []
  do {
    const w = []
    for (let i = 0; i < 7; i++) { w.push(d); d = addDaysYmd(d, 1) }
    weeks.push(w)
  } while (d.slice(0, 7) === first.slice(0, 7) && weeks.length < 6)
  return weeks
}

// ───────────────────────────────────────────────────────── iCalendar (.ics)

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDate = (ymd) => ymd.replace(/-/g, '')
const icsDateTime = (ymd, hhmm) => `${icsDate(ymd)}T${hhmm.replace(':', '')}00`
/** Lines over 75 octets are folded (RFC 5545). */
const fold = (line) => {
  const out = []
  let s = line
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}` }
  out.push(s)
  return out.join('\r\n')
}

/**
 * A calendar file for phones and Outlook / Google Calendar. `items`: { uid, title, description, venue, startDate,
 * endDate, startTime, endTime } — all-day unless both times are given (local times in `timeZone`).
 */
export function buildIcs(items, { name = 'School calendar', timeZone = 'Asia/Kolkata', stamp = new Date() } = {}) {
  const now = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SchoolGiant//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(name)}`, `X-WR-TIMEZONE:${timeZone}`]
  for (const e of items) {
    const end = e.endDate || e.startDate
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`)
    if (e.startTime && e.endTime && end === e.startDate) {
      lines.push(`DTSTART;TZID=${timeZone}:${icsDateTime(e.startDate, e.startTime)}`, `DTEND;TZID=${timeZone}:${icsDateTime(end, e.endTime)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.startDate)}`, `DTEND;VALUE=DATE:${icsDate(addDaysYmd(end, 1))}`)
    }
    lines.push(`SUMMARY:${icsText(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`)
    if (e.venue) lines.push(`LOCATION:${icsText(e.venue)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
