// Date helpers on plain YYYY-MM-DD strings and HH:MM times. Dates are kept as strings in the
// institution's own timezone (a school day is a calendar day there, not a UTC instant).

export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return h * 60 + (m || 0)
}
export const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
export const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))

/** "09:30" → "9:30 AM" */
export function formatTime12(hhmm) {
  const n = toMinutes(hhmm)
  const h = Math.floor(n / 60)
  const m = n % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD string. */
export const weekdayOf = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

/** Add days to a YYYY-MM-DD string. */
export function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Today as YYYY-MM-DD in a timezone, and the current minute of the day there. */
export function nowIn(timeZone = 'Asia/Kolkata', date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(date).map((x) => [x.type, x.value]))
  const hour = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, minutes: Number(hour) * 60 + Number(p.minute) }
}

/** Age in whole years on a date (YYYY-MM-DD), e.g. for admission eligibility. */
export function ageOn(dob, onYmd) {
  if (!dob || !onYmd) return null
  const [by, bm, bd] = dob.split('-').map(Number)
  const [y, m, d] = onYmd.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}
