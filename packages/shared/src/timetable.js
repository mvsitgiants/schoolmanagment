// Timetable: bell schedules, the generator, and helpers shared by the API and the web app.
// A bell schedule is the day's periods and breaks; each class follows one (the default otherwise). The generator
// places every teacher allocation's periods per week (Academic setup › Teacher allocation) into the week so that no
// teacher, section or room is booked twice, keeping cells someone locked by hand.

export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

export const ROOM_KINDS = [
  { value: 'CLASSROOM', label: 'Classroom' },
  { value: 'LAB', label: 'Science lab' },
  { value: 'COMPUTER', label: 'Computer lab' },
  { value: 'HALL', label: 'Hall / auditorium' },
  { value: 'LIBRARY', label: 'Library' },
  { value: 'GROUND', label: 'Ground / sports' },
  { value: 'OTHER', label: 'Other' },
]
/** Rooms a practical subject may use. */
export const LAB_KINDS = ['LAB', 'COMPUTER']

export const SLOT_KINDS = { PERIOD: 'Period', BREAK: 'Break', ASSEMBLY: 'Assembly' }

export const TIMETABLE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  ARCHIVED: { label: 'Old version', tone: 'neutral' },
}

/** A typical school day: 8 periods of 40 minutes, a short break after the 3rd and lunch after the 5th. */
export const DEFAULT_BELL = [
  { no: 0, kind: 'ASSEMBLY', label: 'Assembly', start: '07:50', end: '08:10' },
  { no: 1, kind: 'PERIOD', start: '08:10', end: '08:50' },
  { no: 2, kind: 'PERIOD', start: '08:50', end: '09:30' },
  { no: 3, kind: 'PERIOD', start: '09:30', end: '10:10' },
  { no: 0, kind: 'BREAK', label: 'Short break', start: '10:10', end: '10:25' },
  { no: 4, kind: 'PERIOD', start: '10:25', end: '11:05' },
  { no: 5, kind: 'PERIOD', start: '11:05', end: '11:45' },
  { no: 0, kind: 'BREAK', label: 'Lunch', start: '11:45', end: '12:25' },
  { no: 6, kind: 'PERIOD', start: '12:25', end: '13:05' },
  { no: 7, kind: 'PERIOD', start: '13:05', end: '13:45' },
  { no: 8, kind: 'PERIOD', start: '13:45', end: '14:25' },
]

/** The teaching periods of a bell schedule, in order: [1, 2, …]. */
export const teachingPeriods = (slots = []) => slots.filter((s) => s.kind === 'PERIOD' && s.no > 0).map((s) => s.no).sort((a, b) => a - b)

/** Problems in a bell schedule: times in order, no overlaps, period numbers unique. */
export function checkBell(slots = []) {
  const errors = {}
  const nos = new Set()
  slots.forEach((s, i) => {
    if (!/^\d{2}:\d{2}$/.test(s.start ?? '') || !/^\d{2}:\d{2}$/.test(s.end ?? '')) errors[`slots.${i}.start`] = 'Use HH:MM'
    else if (s.end <= s.start) errors[`slots.${i}.end`] = 'After the start'
    if (i > 0 && slots[i - 1].end && s.start && s.start < slots[i - 1].end) errors[`slots.${i}.start`] = 'Overlaps the one before'
    if (s.kind === 'PERIOD') {
      if (!(s.no > 0)) errors[`slots.${i}.no`] = 'Number the period'
      else if (nos.has(s.no)) errors[`slots.${i}.no`] = 'Used twice'
      nos.add(s.no)
    }
  })
  if (!slots.some((s) => s.kind === 'PERIOD')) errors.slots = 'Add at least one period'
  return errors
}

// ───────────────────────────────────────────────────────── the generator

/** A small seeded random generator, so the same input always gives the same timetable. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Place the week's lessons.
 *
 *   days     ['MON', …]                          the working days
 *   periods  { [sectionId]: [1, 2, …] }           each section's teaching periods (from its bell schedule)
 *   lessons  [{ sectionId, subjectId, teacherId, count, lab }]   `count` periods a week; `lab` needs a lab room
 *   locked   [{ sectionId, day, period, subjectId, teacherId, roomId }]  kept as they are
 *   blocked  [{ teacherId, day, period }]         the teacher can't teach then
 *   labs     [roomId, …]                          rooms for practicals
 *   homeRoom { [sectionId]: roomId }              the room a section sits in otherwise
 *   rules    { maxSamePerDay = 2, teacherMaxPerDay = 7 }
 *
 * Returns { entries: [{ sectionId, day, period, subjectId, teacherId, roomId }], unplaced: [{ sectionId, subjectId,
 * teacherId, missing }], placed, wanted }. Never double-books a teacher, a section or a lab.
 */
export function generateTimetable({ days, periods, lessons, locked = [], blocked = [], labs = [], homeRoom = {}, rules = {}, seed = 1 }) {
  const maxSame = rules.maxSamePerDay ?? 2
  const tMax = rules.teacherMaxPerDay ?? 7
  const rand = mulberry32(seed)
  const key = (...a) => a.join('|')
  const sec = new Set() // section|day|period
  const tch = new Set() // teacher|day|period
  const room = new Set() // room|day|period
  const block = new Set(blocked.map((b) => key(b.teacherId, b.day, b.period)))
  const tDay = new Map() // teacher|day → count
  const sDay = new Map() // section|subject|day → count
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
  const entries = []
  const book = (e) => {
    sec.add(key(e.sectionId, e.day, e.period))
    if (e.teacherId) { tch.add(key(e.teacherId, e.day, e.period)); bump(tDay, key(e.teacherId, e.day)) }
    if (e.roomId && labs.includes(e.roomId)) room.add(key(e.roomId, e.day, e.period))
    bump(sDay, key(e.sectionId, e.subjectId, e.day))
    entries.push(e)
  }
  const unbook = (e) => {
    sec.delete(key(e.sectionId, e.day, e.period))
    if (e.teacherId) { tch.delete(key(e.teacherId, e.day, e.period)); bump(tDay, key(e.teacherId, e.day), -1) }
    if (e.roomId && labs.includes(e.roomId)) room.delete(key(e.roomId, e.day, e.period))
    bump(sDay, key(e.sectionId, e.subjectId, e.day), -1)
    entries.splice(entries.indexOf(e), 1)
  }
  for (const l of locked) book({ ...l, locked: true })

  // what is already locked counts towards each lesson
  const lockedCount = new Map()
  for (const l of locked) bump(lockedCount, key(l.sectionId, l.subjectId, l.teacherId))
  const units = []
  const load = new Map()
  for (const l of lessons) bump(load, l.teacherId, l.count)
  for (const l of lessons) {
    const left = Math.max(0, l.count - (lockedCount.get(key(l.sectionId, l.subjectId, l.teacherId)) ?? 0))
    for (let i = 0; i < left; i++) units.push({ ...l, tie: rand() })
  }
  // hardest first: busy teachers, then labs, then big counts
  units.sort((a, b) => (load.get(b.teacherId) - load.get(a.teacherId)) || (Number(b.lab) - Number(a.lab)) || (b.count - a.count) || (a.tie - b.tie))

  const freeLab = (day, period) => labs.find((r) => !room.has(key(r, day, period)))
  const fits = (u, day, period) => {
    if (!(periods[u.sectionId] ?? []).includes(period)) return false
    if (sec.has(key(u.sectionId, day, period))) return false
    if (u.teacherId && (tch.has(key(u.teacherId, day, period)) || block.has(key(u.teacherId, day, period)) || (tDay.get(key(u.teacherId, day)) ?? 0) >= tMax)) return false
    if ((sDay.get(key(u.sectionId, u.subjectId, day)) ?? 0) >= maxSame) return false
    if (u.lab && labs.length && !freeLab(day, period)) return false
    return true
  }
  const score = (u, day, period) => {
    const same = sDay.get(key(u.sectionId, u.subjectId, day)) ?? 0
    const busy = u.teacherId ? (tDay.get(key(u.teacherId, day)) ?? 0) : 0
    return same * 10 + busy + (u.lab ? 0 : period * 0.05) + rand() * 0.5
  }
  const place = (u, day, period) => book({ sectionId: u.sectionId, day, period, subjectId: u.subjectId, teacherId: u.teacherId, roomId: u.lab && labs.length ? freeLab(day, period) : homeRoom[u.sectionId] })
  const best = (u) => {
    let pick = null
    for (const day of days) for (const period of periods[u.sectionId] ?? []) {
      if (!fits(u, day, period)) continue
      const s = score(u, day, period)
      if (!pick || s < pick.s) pick = { day, period, s }
    }
    return pick
  }

  const unplaced = new Map()
  for (const u of units) {
    let pick = best(u)
    if (!pick) {
      // one step of repair: free a slot of this section by moving the lesson there (or the teacher's clash) elsewhere
      outer: for (const day of days) for (const period of periods[u.sectionId] ?? []) {
        const blockers = entries.filter((e) => !e.locked && e.day === day && e.period === period && (e.sectionId === u.sectionId || (u.teacherId && e.teacherId === u.teacherId)))
        if (!blockers.length || blockers.length > 1 || (u.teacherId && block.has(key(u.teacherId, day, period)))) continue
        const [other] = blockers
        unbook(other)
        if (fits(u, day, period)) {
          const ou = { ...other, lab: !!other.roomId && labs.includes(other.roomId) }
          // take the slot first, then find the moved lesson a home — otherwise its "free" slot can be this very one
          place(u, day, period)
          const mine = entries[entries.length - 1]
          const alt = best(ou)
          if (alt) { place(ou, alt.day, alt.period); pick = { done: true }; break outer }
          unbook(mine)
        }
        book(other)
      }
    } else place(u, pick.day, pick.period)
    if (!pick) bump(unplaced, key(u.sectionId, u.subjectId, u.teacherId))
  }
  return {
    entries: entries.map(({ locked: lk, ...e }) => ({ ...e, locked: !!lk })),
    unplaced: [...unplaced].map(([k, missing]) => { const [sectionId, subjectId, teacherId] = k.split('|'); return { sectionId, subjectId, teacherId: teacherId || null, missing } }),
    placed: entries.length, wanted: units.length + locked.length,
  }
}

/** Clashes in a set of entries: a teacher or a room in two places at once. */
export function findClashes(entries, { labs = [] } = {}) {
  const seen = new Map()
  const out = []
  for (const e of entries) {
    for (const [what, id] of [['teacher', e.teacherId], ['room', labs.includes(e.roomId) ? e.roomId : null]]) {
      if (!id) continue
      const k = `${what}|${id}|${e.day}|${e.period}`
      if (seen.has(k)) out.push({ what, id, day: e.day, period: e.period, sections: [seen.get(k).sectionId, e.sectionId] })
      else seen.set(k, e)
    }
  }
  return out
}
