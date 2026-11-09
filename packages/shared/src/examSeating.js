// Exam seating: which students sit where in which room for one exam session (a date and start time), so that
// students of the same class never sit side by side or one behind the other; which rooms to use; and which teachers
// invigilate each room. Pure functions — the API generates and checks plans with them and the screen previews edits.
import { seatPlan, normSeating } from './seating.js'

export const SEAT_PLAN_STATUS = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  PUBLISHED: { label: 'Published', tone: 'success' },
}

/**
 * How classes are mixed:
 *   SEAT     every neighbour (left, right, front, back) is from another class — the usual board-exam rule
 *   COLUMN   each column of seats is one class, the next column another
 *   NONE     one class after another (a single class, or a small hall)
 */
export const SEAT_MIX = {
  SEAT: { label: 'Mix seat by seat' },
  COLUMN: { label: 'One class per column' },
  NONE: { label: 'Class after class' },
}

export const SEAT_FILL = {
  ROLL: { label: 'Roll number order' },
  NAME: { label: 'Alphabetical' },
}

export const SEAT_PLAN_DEFAULTS = { mix: 'SEAT', gap: false, spread: true, fill: 'ROLL', perInvigilator: 30, maxInvigilators: 3 }

/** The sessions of an exam: its papers grouped by date and start time. */
export function examSessions(papers = []) {
  const m = new Map()
  for (const p of papers) {
    if (!p.date || !p.startTime) continue
    const key = `${p.date}|${p.startTime}`
    if (!m.has(key)) m.set(key, { key, date: p.date, startTime: p.startTime, endTime: p.endTime ?? null, papers: [] })
    const s = m.get(key)
    if (p.endTime && (!s.endTime || p.endTime > s.endTime)) s.endTime = p.endTime
    s.papers.push(p)
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * A room's layout for an exam: its own seating layout when it has one, else benches of two sized to its capacity —
 * wider for a big room (a hall of 200 gets 7 columns), and never more seats than the capacity (`limit`).
 */
export function examRoomLayout(room = {}) {
  const own = room.layout ?? room.seating
  if (own) return { layout: normSeating(own), limit: null }
  const cap = Math.max(1, Number(room.capacity) || 30)
  const columns = Math.min(8, Math.max(3, Math.ceil(cap / 30)))
  return { layout: normSeating({ kind: 'BENCH', perBench: 2, columns, rows: Math.ceil(cap / (columns * 2)), numbering: 'ROW' }), limit: cap }
}

/** A room's seats for an exam in fill order. `gap` keeps every other seat on a bench empty (one student per bench of two). */
export function examRoomSeats(room, { gap = false } = {}) {
  const { layout, limit } = examRoomLayout(room)
  const plan = seatPlan(layout, limit != null ? { limit } : {})
  const seats = plan.rows.flat(2).map((s) => ({ ...s, across: s.col * plan.perBench + s.pos }))
  const usable = gap && plan.perBench > 1 ? seats.filter((s) => s.pos % 2 === 0) : seats
  return { plan, seats: usable.sort((a, b) => a.order - b.order) }
}

/** How many students a room takes for an exam. */
export const examRoomCapacity = (room, opts) => examRoomSeats(room, opts).seats.length

/**
 * Seat the students.
 *   rooms   [{ id, layout?, capacity? }]  in the order they are filled (see examRoomLayout)
 *   groups  [{ key, students: [{ id, … }] }]  one group per class, students already in fill order (roll / name)
 *   rules   { mix, gap, spread }  spread: share the students out over the rooms by size instead of filling one room after another
 *   locked  [{ roomId, seat, studentId }]  seats fixed by hand — kept as they are
 * Returns { seats: [{ roomId, seat, order, row, col, pos, across, studentId, group }], unseated: [studentId], clashes }.
 * Each class is used up in order, so every room gets an unbroken run of each class (the notice board can say
 * "Room 12: 8-A roll 1–15, 9-B roll 1–14"). When the only student left to seat would sit beside or behind one of the
 * same class, the seat is left empty instead — as long as there are seats to spare.
 */
export function planExamSeats({ rooms = [], groups = [], rules = {}, locked = [] }) {
  const { mix = 'SEAT', gap = false, spread = true } = { ...SEAT_PLAN_DEFAULTS, ...rules }
  const queues = groups.map((g) => ({ key: g.key, left: g.students.filter((s) => !locked.some((l) => l.studentId === s.id)) }))
  const lockedAt = new Map(locked.map((l) => [`${l.roomId}|${l.seat}`, l]))
  const groupOf = new Map(groups.flatMap((g) => g.students.map((s) => [s.id, g.key])))
  // every room's seats, and how many free (not locked) seats each has
  const plans = rooms.map((room) => {
    const { seats } = examRoomSeats(room, { gap })
    return { room, seats, free: seats.filter((x) => !lockedAt.has(`${room.id}|${x.label}`)).length }
  })
  const students = queues.reduce((n, q) => n + q.left.length, 0)
  const freeSeats = plans.reduce((n, p) => n + p.free, 0)
  // spread: each room takes its share by size (largest remainder), so no room is left nearly empty
  if (spread && freeSeats > 0) {
    const want = Math.min(students, freeSeats)
    const raw = plans.map((p) => (p.free / freeSeats) * want)
    plans.forEach((p, i) => { p.quota = Math.floor(raw[i]) })
    let rest = want - plans.reduce((n, p) => n + p.quota, 0)
    for (const i of raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (!rest) break; plans[i].quota++; rest-- }
  }
  let spare = Math.max(0, freeSeats - students) // seats that may stay empty (shared out over the rooms when spreading)
  // a fair share of `total` over sizes (largest remainder)
  const share = (sizes, total) => {
    const sum = sizes.reduce((n, x) => n + x, 0)
    if (!sum || total <= 0) return sizes.map(() => 0)
    const raw = sizes.map((x) => (x / sum) * Math.min(total, sum))
    const q = raw.map(Math.floor)
    let rest = Math.min(total, sum) - q.reduce((n, x) => n + x, 0)
    for (const i of raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (!rest) break; q[i]++; rest-- }
    return q
  }
  const out = []
  for (const p of plans) {
    const room = p.room
    let roomSpare = spread ? Math.max(0, p.free - (p.quota ?? p.free)) : null
    let placed = 0
    // this room's share of each class, so every room keeps the same mix to the end (and the pattern holds)
    const planned = spread ? (p.quota ?? 0) : Math.min(p.free, queues.reduce((n, q) => n + q.left.length, 0))
    const classShare = new Map(queues.map((q, i) => [q.key, share(queues.map((x) => x.left.length), planned)[i]]))
    const at = new Map() // `${row}|${across}` → group key, for the neighbour rule
    const columnGroup = new Map() // COLUMN mix: across → group key
    for (const seat of p.seats) {
      const fixed = lockedAt.get(`${room.id}|${seat.label}`)
      let pick = null
      if (fixed) pick = { key: groupOf.get(fixed.studentId) ?? null, id: fixed.studentId }
      else {
        if (spread && placed >= (p.quota ?? Infinity)) continue
        const anyLeft = queues.filter((q) => q.left.length)
        if (!anyLeft.length) break
        // classes with some of this room's share left (when every share is used, whoever is left)
        const inShare = anyLeft.filter((q) => (classShare.get(q.key) ?? 0) > 0)
        const live = inShare.length ? inShare : anyLeft
        const leftKey = at.get(`${seat.row}|${seat.across - 1}`) ?? at.get(`${seat.row}|${seat.across - 2}`)
        const frontKey = at.get(`${seat.row - 1}|${seat.across}`)
        let q
        if (mix === 'NONE') q = live[0]
        else if (mix === 'COLUMN') {
          if (!columnGroup.has(seat.across)) {
            const prev = columnGroup.get(seat.across - 1)
            const used = new Set(columnGroup.values())
            const choice = [...live].sort((a, b) => b.left.length - a.left.length)
            columnGroup.set(seat.across, (choice.find((x) => x.key !== prev && !used.has(x.key)) ?? choice.find((x) => x.key !== prev) ?? choice[0]).key)
          }
          q = live.find((x) => x.key === columnGroup.get(seat.across)) ?? [...live].sort((a, b) => b.left.length - a.left.length).find((x) => x.key !== leftKey) ?? live[0]
        } else {
          // the class with most students left that differs from the left and front neighbours
          const byLeft = [...live].sort((a, b) => (classShare.get(b.key) ?? 0) - (classShare.get(a.key) ?? 0) || b.left.length - a.left.length)
          q = byLeft.find((x) => x.key !== leftKey && x.key !== frontKey) ?? byLeft.find((x) => x.key !== leftKey) ?? byLeft[0]
        }
        // the only choice would sit beside (or, seat by seat, behind) its own class: leave the seat empty while seats are spare
        const clash = mix !== 'NONE' && (q.key === leftKey || (mix === 'SEAT' && q.key === frontKey))
        if (clash) {
          if (spread && roomSpare > 0) { roomSpare--; continue }
          if (!spread && spare > 0) { spare--; continue }
        }
        const s = q.left.shift()
        pick = { key: q.key, id: s.id }
        classShare.set(q.key, (classShare.get(q.key) ?? 0) - 1)
        placed++
      }
      at.set(`${seat.row}|${seat.across}`, pick.key)
      out.push({ roomId: room.id, seat: seat.label, order: seat.order, row: seat.row, col: seat.col, pos: seat.pos, across: seat.across, studentId: pick.id, group: pick.key })
    }
  }
  const unseated = queues.flatMap((q) => q.left.map((s) => s.id))
  return { seats: out, unseated, clashes: seatClashes(out, { mix }) }
}

/**
 * Neighbours from the same class: side by side on a row, or one behind the other. With one class per column
 * (`mix: 'COLUMN'`) the student behind is meant to be the same class, so only side by side counts.
 */
export function seatClashes(seats = [], { mix = 'SEAT' } = {}) {
  const groups = new Set(seats.map((s) => s.group).filter(Boolean))
  if (groups.size < 2) return []
  const at = new Map(seats.map((s) => [`${s.roomId}|${s.row}|${s.across}`, s]))
  const out = []
  for (const s of seats) {
    for (const [dr, da] of mix === 'COLUMN' ? [[0, 1]] : [[0, 1], [1, 0]]) {
      const n = at.get(`${s.roomId}|${s.row + dr}|${s.across + da}`)
      if (n && n.group && n.group === s.group) out.push({ roomId: s.roomId, a: s.seat, b: n.seat, group: s.group, side: dr ? 'BEHIND' : 'BESIDE' })
    }
  }
  return out
}

/** Kinds of room an exam is suggested into (a ground or "other" can still be picked by hand). Halls first. */
export const EXAM_ROOM_KINDS = ['HALL', 'CLASSROOM', 'LAB', 'COMPUTER', 'LIBRARY']

/**
 * Rooms for `needed` students: the fewest that fit, biggest first, keeping the order the school prefers
 * (`preferred` ids first). Returns { ids, seats, short }.
 */
export function suggestExamRooms(rooms = [], needed = 0, { gap = false, preferred = [] } = {}) {
  const cap = (r) => examRoomCapacity(r, { gap })
  const pref = new Set(preferred)
  const list = rooms.filter((r) => cap(r) > 0 && (!r.kind || EXAM_ROOM_KINDS.includes(r.kind))).sort((a, b) => (Number(pref.has(b.id)) - Number(pref.has(a.id))) || cap(b) - cap(a))
  const ids = []
  let seats = 0
  for (const r of list) { if (seats >= needed) break; ids.push(r.id); seats += cap(r) }
  // the last room picked may be far bigger than what is left over: swap it for the smallest that still fits
  if (ids.length > 1) {
    const before = seats - cap(list.find((r) => r.id === ids.at(-1)))
    const lack = needed - before
    const smaller = list.filter((r) => !ids.includes(r.id) && cap(r) >= lack).sort((a, b) => cap(a) - cap(b))[0]
    if (smaller && cap(smaller) < cap(list.find((r) => r.id === ids.at(-1)))) { seats = before + cap(smaller); ids[ids.length - 1] = smaller.id }
  }
  return { ids, seats, short: Math.max(0, needed - seats) }
}

/** How many invigilators a room needs for `students`. */
export const invigilatorsFor = (students, { perInvigilator = 30, maxInvigilators = 3 } = {}) =>
  students > 0 ? Math.min(maxInvigilators, Math.max(1, Math.ceil(students / Math.max(1, perInvigilator)))) : 0

/**
 * Invigilators for each room of a session.
 *   rooms     [{ id, students, avoid: [teacherId] }]  avoid = teachers of the subjects written in that room
 *   teachers  [{ id, duties }]  everyone who may invigilate, with their duties so far in this exam
 *   away      [teacherId]  on leave that day
 *   keep      { [roomId]: [teacherId] }  chosen by hand — kept
 * Fewest duties first; never a teacher who teaches a subject being written in the room; never two rooms at once.
 * Returns { rooms: { [roomId]: [teacherId] }, short: [{ roomId, missing }] }.
 */
export function assignInvigilators({ rooms = [], teachers = [], away = [], keep = {}, rules = {} }) {
  const r = { ...SEAT_PLAN_DEFAULTS, ...rules }
  const out = {}
  const busy = new Set([...away.map(String)])
  const duties = new Map(teachers.map((t) => [String(t.id), t.duties ?? 0]))
  for (const room of rooms) for (const id of keep[room.id] ?? []) busy.add(String(id))
  const short = []
  for (const room of [...rooms].sort((a, b) => b.students - a.students)) {
    const want = invigilatorsFor(room.students, r)
    const chosen = (keep[room.id] ?? []).map(String)
    const avoid = new Set((room.avoid ?? []).map(String))
    const pool = teachers.map((t) => String(t.id)).filter((id) => !busy.has(id) && !avoid.has(id))
      .sort((a, b) => duties.get(a) - duties.get(b) || a.localeCompare(b))
    while (chosen.length < want && pool.length) {
      const id = pool.shift()
      chosen.push(id); busy.add(id); duties.set(id, (duties.get(id) ?? 0) + 1)
    }
    if (chosen.length < want) short.push({ roomId: room.id, missing: want - chosen.length })
    out[room.id] = chosen
  }
  return { rooms: out, short }
}

/**
 * The notice-board list: per room, each class-section's run of roll numbers.
 *   seats    [{ roomId, studentId }]   students  Map(studentId → { section, rollNo, name })
 * Returns [{ roomId, count, runs: [{ section, from, to, count }] }].
 */
export function seatingRuns(seats = [], students = new Map()) {
  const byRoom = new Map()
  for (const s of seats) {
    const st = students.get(s.studentId)
    if (!st) continue
    if (!byRoom.has(s.roomId)) byRoom.set(s.roomId, new Map())
    const m = byRoom.get(s.roomId)
    if (!m.has(st.section)) m.set(st.section, [])
    m.get(st.section).push(st)
  }
  const num = (v) => (v == null || v === '' ? NaN : Number(v))
  return [...byRoom.entries()].map(([roomId, m]) => {
    const runs = [...m.entries()].map(([section, list]) => {
      const rolls = list.map((x) => num(x.rollNo)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
      return { section, from: rolls[0] ?? null, to: rolls.at(-1) ?? null, count: list.length }
    }).sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }))
    return { roomId, count: runs.reduce((n, x) => n + x.count, 0), runs }
  })
}
