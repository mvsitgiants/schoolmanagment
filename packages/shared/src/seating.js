// Classroom seating: how a section's room is laid out — benches (several students to a bench) or single desks,
// how many across a row, how many rows — and how the seats are numbered. The seating sheet on the class board
// draws it; students fill the seats in roll-number order.

export const SEATING_KINDS = {
  BENCH: { label: 'Benches' },
  DESK: { label: 'Single desks' },
}

export const SEAT_NUMBERING = {
  ROW: { label: 'Row by row (1, 2, 3 … across, then the next row)' },
  COLUMN: { label: 'Column by column (front to back, then the next column)' },
  CODE: { label: 'Row letter and seat (A1, A2 … B1, B2 …)' },
}

export const SEATING_LIMITS = { perBench: [1, 4], columns: [1, 8], rows: [1, 15] }

/** A sensible room to start from: three columns of two-seat benches, enough rows for `capacity`. */
export function defaultSeating(capacity = 30) {
  return { kind: 'BENCH', perBench: 2, columns: 3, rows: Math.max(1, Math.ceil((Number(capacity) || 30) / 6)), numbering: 'ROW' }
}

const clampInt = (v, [lo, hi], d) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || d))

/** The layout with every number in range. */
export function normSeating(s = {}) {
  const kind = s.kind === 'DESK' ? 'DESK' : 'BENCH'
  return {
    kind,
    perBench: kind === 'DESK' ? 1 : clampInt(s.perBench, SEATING_LIMITS.perBench, 2),
    columns: clampInt(s.columns, SEATING_LIMITS.columns, 3),
    rows: clampInt(s.rows, SEATING_LIMITS.rows, 6),
    numbering: SEAT_NUMBERING[s.numbering] ? s.numbering : 'ROW',
  }
}

/** How many students the layout seats. */
export const seatCapacity = (s) => { const n = normSeating(s); return n.rows * n.columns * n.perBench }

/**
 * Every seat of the layout, front row first: rows[r][c] = a bench (or desk) = [seat, …], each seat
 * { row, col, pos, no, label, order }; `rowCount` is the number of rows (`rows` is the drawing). `no` is the seat number in the chosen numbering, `label` what is
 * printed on it ("7" or "B3"), `order` the order students fill the seats in (seat number order).
 * `limit` drops the seats past it (a room without a set layout, sized to the section's capacity).
 */
export function seatPlan(seating, { limit } = {}) {
  const s = normSeating(seating)
  const perRow = s.columns * s.perBench
  const letter = (r) => (r < 26 ? String.fromCharCode(65 + r) : `R${r + 1}`)
  const rows = []
  const seats = []
  for (let r = 0; r < s.rows; r++) {
    const row = []
    for (let c = 0; c < s.columns; c++) {
      const bench = []
      for (let p = 0; p < s.perBench; p++) {
        const across = c * s.perBench + p // 0-based position across the row
        const no = s.numbering === 'COLUMN' ? across * s.rows + r + 1 : r * perRow + across + 1
        const label = s.numbering === 'CODE' ? `${letter(r)}${across + 1}` : String(no)
        const seat = { row: r, col: c, pos: p, no, label }
        bench.push(seat)
        seats.push(seat)
      }
      row.push(bench)
    }
    rows.push(row)
  }
  seats.sort((a, b) => a.no - b.no).forEach((x, i) => { x.order = i })
  if (limit != null) {
    for (const row of rows) for (const bench of row) for (let i = bench.length - 1; i >= 0; i--) if (bench[i].order >= limit) bench.splice(i, 1)
  }
  return { ...s, rowCount: s.rows, rows, total: limit != null ? Math.min(limit, seats.length) : seats.length }
}

/**
 * Who sits where in a classroom: students placed by hand keep their seat (when it still exists and they are still in
 * the class); everyone else fills the free seats in seat order, in the order given (roll numbers).
 *   plan         seatPlan(…)        students  [{ id, … }]  in fill order
 *   assignments  [{ seat, studentId }]
 * Returns { at: Map(seatLabel → student), placed: Set(studentId placed by hand), standing: [student] }.
 */
export function placeStudents(plan, students = [], assignments = []) {
  const seats = plan.rows.flat(2).sort((a, b) => a.order - b.order)
  const labels = new Set(seats.map((s) => s.label))
  const byId = new Map(students.map((s) => [String(s.id), s]))
  const at = new Map()
  const placed = new Set()
  for (const a of assignments) {
    const st = byId.get(String(a.studentId))
    if (!st || !labels.has(a.seat) || at.has(a.seat) || placed.has(String(st.id))) continue
    at.set(a.seat, st)
    placed.add(String(st.id))
  }
  const rest = students.filter((s) => !placed.has(String(s.id)))
  let i = 0
  for (const seat of seats) {
    if (at.has(seat.label)) continue
    if (i >= rest.length) break
    at.set(seat.label, rest[i++])
  }
  return { at, placed, standing: rest.slice(i) }
}
