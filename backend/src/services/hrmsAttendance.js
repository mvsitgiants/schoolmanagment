import { MARKABLE, STAFF_ATTENDANCE, dayPay, monthTotals } from '@schoolgiant/shared'
import { Employee, StaffAttendance } from '../models/hrms.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { badRequest, forbidden } from '../platform/errors.js'
import { dayOffFor, employedOn, employeeScope, holidaysBetween, hrSettings, monthDays, myEmployee, todayYmd } from './hrmsCommon.js'

// Staff & HR › Staff attendance: one row a day per person. The office marks the day (or imports the biometric
// machine's file); approved leave is written in by the leave service and can't be marked over here. A day off
// (weekly off, Saturday off, holiday) needs no row — it shows as such and counts as paid.

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

function staffFilter(auth, q = {}) {
  const f = { ...employeeScope(auth) }
  if (q.departmentId) f.departmentId = q.departmentId
  if (q.branchId) f.branchId = q.branchId
  if (q.category) f.category = q.category
  return f
}

/** The people on the staff on a date (joined by then, not yet gone). */
async function staffOn(date, auth, q) {
  const rows = await Employee.find({ ...staffFilter(auth, q), joiningDate: { $lte: date }, $or: [{ status: { $ne: 'EXITED' } }, { 'exit.lastWorkingDate': { $gte: date } }] })
    .select('name employeeCode designation category departmentId branchId weeklyOffDays joiningDate exit userId').sort({ category: 1, name: 1 }).lean()
  return rows.filter((e) => employedOn(e, date))
}

const view = (e, a, off) => ({
  employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, category: e.category,
  status: a?.status ?? (off ? off.kind : null), marked: !!a, off: off ? { kind: off.kind, name: off.name ?? null } : null,
  inTime: a?.inTime ?? null, outTime: a?.outTime ?? null, late: !!a?.late, note: a?.note ?? null,
  leave: a?.leave?.leaveId ? { code: a.leave.code, portion: a.leave.portion, paid: a.leave.paid } : null, locked: a?.source === 'LEAVE',
  markedBy: a?.markedBy ?? null,
})

/** One day's register for the office: everyone on the staff, what is marked, who is off or on leave. */
export async function dayRegister(date, auth, q = {}) {
  const [staff, settings, holidays] = await Promise.all([staffOn(date, auth, q), hrSettings(), holidaysBetween(date, date)])
  const rows = await StaffAttendance.find({ date, employeeId: { $in: staff.map((e) => e._id) } }).lean()
  const by = new Map(rows.map((r) => [String(r.employeeId), r]))
  const list = staff.map((e) => view(e, by.get(String(e._id)), dayOffFor(e, date, { settings, holidays })))
  const counts = {}
  for (const r of list) counts[r.status ?? 'UNMARKED'] = (counts[r.status ?? 'UNMARKED'] ?? 0) + 1
  return { date, rows: list, counts, holiday: holidays.find((h) => !h.optional && !h.branchIds?.length)?.name ?? null, editable: await editable(date, auth) }
}

async function editable(date, auth) {
  const today = await todayYmd()
  if (date > today) return false
  if (auth?.fullAccess) return true
  const days = Number((await hrSettings()).attendanceEditDays ?? 7)
  return date >= addDays(today, -days)
}

const lateOf = (inTime, lateAfter) => !!(inTime && lateAfter && inTime > lateAfter)

/** Save the marks for a day. Leave days are left as they are. */
export async function saveDay(date, entries, auth, req) {
  if (!await editable(date, auth)) throw forbidden(date > await todayYmd() ? 'Attendance can’t be marked for a future day.' : 'This day is too far back to change. Ask an administrator.')
  const allowed = new Set((await staffOn(date, auth)).map((e) => String(e._id)))
  const { lateAfter } = await hrSettings()
  const locked = new Set((await StaffAttendance.find({ date, source: 'LEAVE' }).select('employeeId').lean()).map((r) => String(r.employeeId)))
  let saved = 0
  for (const x of entries) {
    if (!allowed.has(String(x.employeeId)) || locked.has(String(x.employeeId))) continue
    if (x.status === null) { await StaffAttendance.deleteOne({ employeeId: x.employeeId, date, source: { $ne: 'LEAVE' } }); continue }
    if (!MARKABLE.includes(x.status)) throw badRequest(`Can’t mark ${x.status} by hand.`)
    const timed = ['PRESENT', 'HALF_DAY', 'ON_DUTY'].includes(x.status)
    await StaffAttendance.updateOne({ employeeId: x.employeeId, date }, {
      $set: {
        status: x.status, ...dayPay(x.status), inTime: timed ? x.inTime || undefined : undefined, outTime: timed ? x.outTime || undefined : undefined,
        late: timed && lateOf(x.inTime, lateAfter), note: x.note || undefined, source: 'MANUAL', markedBy: auth.user?.name, markedAt: new Date(),
      },
      $unset: { leave: 1 },
    }, { upsert: true })
    saved++
  }
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'staff_attendance', entityName: date, summary: `Marked staff attendance for ${date} (${saved})` }, req)
  return dayRegister(date, auth)
}

/** A month: every person × every day, with their totals (what payroll counts). */
export async function monthRegister(month, auth, q = {}) {
  const days = monthDays(month)
  const [from, to] = [days[0], days.at(-1)]
  const today = await todayYmd()
  const [settings, holidays] = await Promise.all([hrSettings(), holidaysBetween(from, to)])
  const staff = await Employee.find({ ...staffFilter(auth, q), joiningDate: { $lte: to }, $or: [{ status: { $ne: 'EXITED' } }, { 'exit.lastWorkingDate': { $gte: from } }] })
    .select('name employeeCode designation category branchId weeklyOffDays joiningDate exit').sort({ category: 1, name: 1 }).lean()
  const rows = await StaffAttendance.find({ date: { $gte: from, $lte: to }, employeeId: { $in: staff.map((e) => e._id) } }).lean()
  const by = new Map(rows.map((r) => [`${r.employeeId}|${r.date}`, r]))
  return {
    month, days, holidays: holidays.filter((h) => !h.optional).map((h) => ({ date: h.date, name: h.name })),
    rows: staff.map((e) => {
      const cells = {}
      const counted = []
      let unmarked = 0
      for (const d of days) {
        if (!employedOn(e, d)) continue
        const a = by.get(`${e._id}|${d}`)
        const off = a ? null : dayOffFor(e, d, { settings, holidays })
        const status = a?.status ?? off?.kind ?? null
        if (status) {
          cells[d] = { s: STAFF_ATTENDANCE[status]?.code ?? status, status, late: !!a?.late, portion: a?.leave?.portion, paid: a?.leave?.paid }
          counted.push(a ?? { status, ...dayPay(status) })
        } else if (d <= today) unmarked++
      }
      return { employeeId: String(e._id), name: e.name, code: e.employeeCode, designation: e.designation ?? null, category: e.category, cells, totals: { ...monthTotals(counted), unmarked } }
    }),
  }
}

export async function exportMonth(month, auth, q) {
  const m = await monthRegister(month, auth, q)
  const head = ['Code', 'Name', 'Designation', ...m.days.map((d) => d.slice(8)), 'Present', 'Half days', 'Absent', 'Leave', 'Paid days', 'Loss of pay', 'Late', 'Not marked']
  const lines = m.rows.map((r) => [r.code, r.name, r.designation, ...m.days.map((d) => r.cells[d]?.s ?? ''), r.totals.PRESENT ?? 0, r.totals.HALF_DAY ?? 0, r.totals.ABSENT ?? 0, r.totals.LEAVE ?? 0, r.totals.payable, r.totals.lop, r.totals.late, r.totals.unmarked])
  return [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n')
}

/**
 * The biometric machine's (or a sheet's) rows: { employeeCode, date, inTime, outTime, status }. A row with an in time
 * and no status is a present day. Leave days and unknown codes are skipped and reported.
 */
export async function importAttendance(rows, auth, req) {
  const codes = [...new Set(rows.map((r) => String(r.employeeCode ?? '').trim().toUpperCase()).filter(Boolean))]
  const staff = new Map((await Employee.find({ employeeCode: { $in: codes }, ...employeeScope(auth) }).select('employeeCode joiningDate exit').lean()).map((e) => [e.employeeCode, e]))
  const { lateAfter } = await hrSettings()
  const today = await todayYmd()
  const out = { saved: 0, skipped: [] }
  for (const [i, r] of rows.entries()) {
    const e = staff.get(String(r.employeeCode ?? '').trim().toUpperCase())
    const skip = (why) => out.skipped.push({ row: i + 1, code: r.employeeCode, date: r.date, reason: why })
    if (!e) { skip('Unknown employee code'); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || r.date > today) { skip('Date must be YYYY-MM-DD, not in the future'); continue }
    if (!employedOn(e, r.date)) { skip('Not on the staff that day'); continue }
    const status = r.status ? String(r.status).toUpperCase() : r.inTime ? 'PRESENT' : 'ABSENT'
    const code = Object.entries(STAFF_ATTENDANCE).find(([k, v]) => k === status || v.code === status)?.[0]
    if (!code || !MARKABLE.includes(code)) { skip(`Unknown status ${r.status}`); continue }
    const res = await StaffAttendance.updateOne({ employeeId: e._id, date: r.date, source: { $ne: 'LEAVE' } }, {
      $set: { status: code, ...dayPay(code), inTime: r.inTime || undefined, outTime: r.outTime || undefined, late: lateOf(r.inTime, lateAfter), source: 'IMPORT', markedBy: auth.user?.name, markedAt: new Date() },
    }, { upsert: true }).catch((err) => (err.code === 11000 ? null : Promise.reject(err)))
    if (!res) skip('On approved leave that day')
    else out.saved++
  }
  await audit({ action: 'IMPORT', module: 'hrms', entityType: 'staff_attendance', entityName: `${out.saved} days`, summary: `Imported staff attendance: ${out.saved} day(s), ${out.skipped.length} skipped` }, req)
  return out
}

/** Self-service: my month. */
export async function myMonth(month, auth) {
  const emp = await myEmployee(auth)
  const days = monthDays(month)
  const [settings, holidays, rows] = await Promise.all([hrSettings(), holidaysBetween(days[0], days.at(-1)), StaffAttendance.find({ employeeId: emp._id, date: { $gte: days[0], $lte: days.at(-1) } }).lean()])
  const by = new Map(rows.map((r) => [r.date, r]))
  const list = days.filter((d) => employedOn(emp, d)).map((d) => {
    const a = by.get(d)
    const off = a ? null : dayOffFor(emp, d, { settings, holidays })
    return { date: d, status: a?.status ?? off?.kind ?? null, inTime: a?.inTime ?? null, outTime: a?.outTime ?? null, late: !!a?.late, holiday: off?.name ?? null, leave: a?.leave?.code ?? null }
  })
  return { month, days: list, totals: monthTotals(list.filter((d) => d.status).map((d) => by.get(d.date) ?? { status: d.status, ...dayPay(d.status) })) }
}

/**
 * For payroll: each person's paid days and loss-of-pay days in a month. A working day nobody marked counts as paid
 * (`unmarked` says how many) — the payroll run shows them so they can be fixed before paying.
 */
export async function payDays(month, employeeIds) {
  const days = monthDays(month)
  const [settings, holidays] = await Promise.all([hrSettings(), holidaysBetween(days[0], days.at(-1))])
  const staff = await Employee.find({ _id: { $in: employeeIds } }).select('branchId weeklyOffDays joiningDate exit').lean()
  const rows = await StaffAttendance.find({ employeeId: { $in: employeeIds }, date: { $gte: days[0], $lte: days.at(-1) } }).lean()
  const by = new Map(rows.map((r) => [`${r.employeeId}|${r.date}`, r]))
  const out = {}
  for (const e of staff) {
    let employed = 0; let payable = 0; let lop = 0; let unmarked = 0
    for (const d of days) {
      if (!employedOn(e, d)) continue
      employed++
      const a = by.get(`${e._id}|${d}`)
      if (a) { payable += a.payable ?? 0; lop += a.lop ?? 0 } else if (dayOffFor(e, d, { settings, holidays })) payable++
      else { payable++; unmarked++ }
    }
    out[String(e._id)] = { monthDays: days.length, employed, payable, lop, unmarked }
  }
  return out
}


/**
 * For a payroll run: each person's month in numbers — days not on the books, loss of pay (half days count half,
 * unpaid leave counts its portion), and what the payslip shows (present, half days, absent, leave, late, unmarked).
 * A working day nobody marked is paid (and counted in `unmarked`, so the run can flag it).
 */
export async function payrollAttendance(employees, month) {
  const days = monthDays(month)
  const [settings, holidays] = await Promise.all([hrSettings(), holidaysBetween(days[0], days.at(-1))])
  const rows = await StaffAttendance.find({ employeeId: { $in: employees.map((e) => e._id) }, date: { $gte: days[0], $lte: days.at(-1) } }).lean()
  const by = new Map(rows.map((r) => [`${r.employeeId}|${r.date}`, r]))
  const out = new Map()
  for (const e of employees) {
    const t = { daysInMonth: days.length, notEmployedDays: 0, lop: 0, unmarked: 0, present: 0, halfDays: 0, absent: 0, leave: 0, late: 0 }
    for (const d of days) {
      if (!employedOn(e, d)) { t.notEmployedDays++; continue }
      const a = by.get(`${e._id}|${d}`)
      if (!a) { if (!dayOffFor(e, d, { settings, holidays })) t.unmarked++; continue }
      t.lop += a.lop ?? 0
      if (a.status === 'PRESENT' || a.status === 'ON_DUTY') t.present++
      if (a.status === 'HALF_DAY') t.halfDays++
      if (a.status === 'ABSENT') t.absent++
      if (a.status === 'LEAVE') t.leave += a.leave?.portion ?? 1
      if (a.late) t.late++
    }
    t.lop = Math.round(t.lop * 2) / 2
    out.set(String(e._id), t)
  }
  return out
}
