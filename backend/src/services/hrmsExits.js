// Staff leaving (hrms.exits): the exit clearance — what someone leaving hands back or settles, item by item,
// and who cleared it. Started on its own when an exit is recorded (services/hrms.js exitEmployee), cancelled
// when the exit is taken back. Also the experience certificate's wording (saved with the exit), and the
// automatic checks — library books still out, unpaid library fines, unrecovered salary advances — shown
// beside the clearance and on the no-dues certificate (HR_NO_DUES).
import { CLEARANCE_ITEM_STATUSES, CLEARANCE_OWNERS, CLEARANCE_STATUSES, DEFAULT_EXIT_CLEARANCE, EXIT_INTERVIEW_ASPECTS, EXIT_REASONS, EXIT_TYPES, LOGGED_LETTERS, REHIRE_OPTIONS, REJOIN_OPTIONS } from '@schoolgiant/shared'
import { Employee, ExitClearance } from '../models/hrms.js'
import { LibraryFine, LibraryLoan } from '../models/library.js'
import { PayrollLoan } from '../models/payroll.js'
import { Department } from '../models/tenant.js'
import { moduleEnabled } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { conflict, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { findEmployee, scopedEmployeeIds, stamp, todayYmd } from './hrmsCommon.js'
import { loanBalance } from './payroll.js'

const label = (list, v) => (Array.isArray(list) ? list.find((x) => x.value === v)?.label : list[v]?.label) ?? v

function out(c) {
  const items = (c.items ?? []).map((i) => ({ ...clean(i), ownerLabel: label(CLEARANCE_OWNERS, i.owner), statusLabel: label(CLEARANCE_ITEM_STATUSES, i.status) }))
  const open = items.filter((i) => i.status === 'PENDING').length
  return { ...clean(c), items, statusLabel: label(CLEARANCE_STATUSES, c.status), progress: { total: items.length, open, done: items.length - open } }
}

/** Recording an exit starts the clearance (one at a time); never lets a clearance problem undo the exit. */
export async function startClearance(e, auth) {
  try {
    if (await ExitClearance.exists({ employeeId: e._id, status: 'OPEN' })) return null
    return await ExitClearance.create({
      employeeId: e._id, employeeName: e.name, employeeCode: e.employeeCode, designation: e.designation, departmentId: e.departmentId, branchId: e.branchId,
      lastWorkingDate: e.exit?.lastWorkingDate, items: DEFAULT_EXIT_CLEARANCE.map((x) => ({ ...x })), started: stamp(auth),
    })
  } catch (err) {
    logger.warn({ err, employeeId: String(e._id) }, 'could not start the exit clearance')
    return null
  }
}

/** The exit was taken back: the clearance stops. */
export async function cancelClearance(employeeId, auth) {
  await ExitClearance.updateMany({ employeeId, status: 'OPEN' }, { $set: { status: 'CANCELLED', cancelled: stamp(auth) } })
}

/** A changed last working day moves with the clearance. */
export async function moveClearance(employeeId, lastWorkingDate) {
  await ExitClearance.updateMany({ employeeId, status: 'OPEN' }, { $set: { lastWorkingDate } })
}

async function findClearance(id, auth) {
  const c = isOid(id) ? await ExitClearance.findById(id) : null
  if (!c) throw notFound('Exit clearance')
  const ids = await scopedEmployeeIds(auth)
  if (ids && !ids.some((x) => String(x) === String(c.employeeId))) throw notFound('Exit clearance')
  return c
}

export async function listClearances({ status, search } = {}, auth, paging) {
  const filter = {}
  if (status) filter.status = status
  const ids = await scopedEmployeeIds(auth)
  if (ids) filter.employeeId = { $in: ids }
  if (search) filter.$or = [{ employeeName: { $regex: escapeRegex(search), $options: 'i' } }, { employeeCode: { $regex: escapeRegex(search), $options: 'i' } }]
  // open ones first, soonest last day first
  const q = ExitClearance.find(filter).sort({ status: -1, lastWorkingDate: 1 })
  const [rows, total, counts, deps] = await Promise.all([
    paging ? q.skip(paging.skip).limit(paging.pageSize).lean() : q.limit(500).lean(),
    ExitClearance.countDocuments(filter),
    ExitClearance.aggregate([{ $match: { ...(ids ? { employeeId: { $in: ids } } : {}) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Department.find().select('name').lean(),
  ])
  const dep = new Map(deps.map((d) => [String(d._id), d.name]))
  const data = rows.map((c) => ({ ...out(c), departmentName: dep.get(String(c.departmentId)) ?? null }))
  const summary = Object.fromEntries(counts.map((x) => [x._id, x.n]))
  return paging ? { ...listResponse(data, total, paging), summary } : { rows: data, summary }
}

/**
 * What the records say is still due, checked live: books out and unpaid fines (Library, when it is on) and
 * advances or loans not yet recovered (Payroll, when it is on). `ok` when nothing is due; `owner` ties each
 * check to the clearance item it belongs to.
 */
export async function autoChecks(employeeId, auth) {
  const checks = []
  if (moduleEnabled(auth, 'library')) {
    const who = { 'borrower.kind': 'STAFF', 'borrower.id': employeeId }
    const [loans, fines] = await Promise.all([
      LibraryLoan.find({ ...who, status: 'ISSUED' }).select('title accessionNo dueOn').sort({ dueOn: 1 }).lean(),
      LibraryFine.find({ ...who, status: 'OPEN' }).select('amount').lean(),
    ])
    const fineTotal = fines.reduce((n, f) => n + (f.amount ?? 0), 0)
    checks.push({
      key: 'library', owner: 'LIBRARY', ok: !loans.length && !fineTotal,
      booksOut: loans.map((l) => ({ title: l.title, accessionNo: l.accessionNo, dueOn: l.dueOn })), fines: fines.length, fineTotal,
    })
  }
  if (moduleEnabled(auth, 'payroll')) {
    const loans = await PayrollLoan.find({ employeeId, status: 'ACTIVE' }).select('loanNo type amount recoveries').lean()
    const owing = loans.map((l) => ({ loanNo: l.loanNo, type: l.type, balance: loanBalance(l) })).filter((l) => l.balance > 0)
    checks.push({ key: 'advances', owner: 'ACCOUNTS', ok: !owing.length, loans: owing, total: owing.reduce((n, l) => n + l.balance, 0) })
  }
  return checks
}

export async function getClearance(id, auth) {
  const c = await findClearance(id, auth)
  const e = await Employee.findById(c.employeeId).select('exit status').lean()
  return { ...out(c.toObject()), exitType: label(EXIT_TYPES, e?.exit?.type), employeeStatus: e?.status, checks: c.status === 'CANCELLED' ? [] : await autoChecks(c.employeeId, auth) }
}

/**
 * The no-dues certificate (HR_NO_DUES, `id`: a staff record): the latest clearance item by item, and the automatic
 * checks. While an item is still to do or something is still due it prints as a draft that says so.
 */
export async function noDuesData(employeeId, auth) {
  const e = await findEmployee(employeeId, auth, { lean: true })
  if (!e.exit?.lastWorkingDate) throw conflict(`${e.name} has no exit recorded. Record the exit first (Staff › the person › Exit).`)
  const c = await ExitClearance.findOne({ employeeId: e._id, status: { $ne: 'CANCELLED' } }).sort({ createdAt: -1 }).lean()
  if (!c) throw conflict(`${e.name} has no exit clearance. It starts when the exit is recorded.`)
  const items = out(c).items.map((i) => ({ ...i, cleared: i.status === 'DONE', notNeeded: i.status === 'NA', pending: i.status === 'PENDING', on: i.done?.at ? new Date(i.done.at).toISOString().slice(0, 10) : null }))
  const checks = await autoChecks(e._id, auth)
  const library = checks.find((x) => x.key === 'library') ?? null
  const advances = checks.find((x) => x.key === 'advances') ?? null
  const pending = items.filter((i) => i.pending).length
  const dues = checks.filter((x) => !x.ok).length
  const dep = e.departmentId ? await Department.findById(e.departmentId).select('name').lean() : null
  return {
    date: await todayYmd(), refNo: `HR/NOD/${e.employeeCode}`,
    staff: { name: e.name, code: e.employeeCode, salutation: e.gender === 'FEMALE' ? 'Ms.' : e.gender === 'MALE' ? 'Mr.' : '', designation: e.designation, department: dep?.name ?? null, joiningDate: e.joiningDate, lastWorkingDate: e.exit.lastWorkingDate, exitType: label(EXIT_TYPES, e.exit.type) },
    clearance: { items, pending, dues, complete: !pending && !dues, completedOn: c.completed?.at ? new Date(c.completed.at).toISOString().slice(0, 10) : null },
    library, advances,
  }
}

/** Mark one item cleared, not needed, or back to do — with a note. All cleared → the clearance is done. */
export async function updateItem(id, itemId, { status, note }, auth, req) {
  const c = await findClearance(id, auth)
  if (c.status === 'CANCELLED') throw conflict('This clearance was cancelled — the exit was taken back.')
  const item = c.items.id(isOid(itemId) ? itemId : null)
  if (!item) throw notFound('Item')
  if (status) {
    item.status = status
    item.done = status === 'PENDING' ? undefined : stamp(auth)
  }
  if (note !== undefined) item.note = note || undefined
  const open = c.items.some((i) => i.status === 'PENDING')
  if (!open && c.status === 'OPEN') { c.status = 'DONE'; c.completed = stamp(auth) }
  if (open && c.status === 'DONE') { c.status = 'OPEN'; c.completed = undefined }
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'exit_clearance', entityId: String(c._id), entityName: c.employeeName, summary: `${item.title}: ${label(CLEARANCE_ITEM_STATUSES, item.status)} — ${c.employeeName}` }, req)
  return getClearance(c._id, auth)
}

export async function addItem(id, { title, owner }, auth, req) {
  const c = await findClearance(id, auth)
  if (c.status === 'CANCELLED') throw conflict('This clearance was cancelled — the exit was taken back.')
  c.items.push({ title, owner })
  if (c.status === 'DONE') { c.status = 'OPEN'; c.completed = undefined }
  await c.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'exit_clearance', entityId: String(c._id), entityName: c.employeeName, summary: `Added “${title}” to the exit clearance of ${c.employeeName}` }, req)
  return getClearance(c._id, auth)
}

/** The experience certificate's wording for someone with an exit recorded. */
export async function saveCertificate(employeeId, input, auth, req) {
  const e = await findEmployee(employeeId, auth)
  if (!e.exit?.lastWorkingDate) throw conflict(`${e.name} has no exit recorded. Record the exit first.`)
  e.exit.certificate = { ...(e.exit.certificate?.toObject?.() ?? e.exit.certificate ?? {}), ...input }
  e.markModified('exit')
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Set the experience certificate wording for ${e.name}` }, req)
  return { certificate: e.exit.certificate }
}

/** The exit interview: why they are leaving, six ratings, what to keep and change, and the school's rehire call. Ticks "Exit interview" on the clearance. */
export async function saveInterview(employeeId, input, auth, req) {
  const e = await findEmployee(employeeId, auth)
  if (!e.exit?.lastWorkingDate) throw conflict(`${e.name} has no exit recorded. Record the exit first.`)
  e.exit.interview = { ...input, ...stamp(auth) }
  e.markModified('exit')
  await e.save()
  await audit({ action: 'UPDATE', module: 'hrms', entityType: 'employee', entityId: String(e._id), entityName: e.name, summary: `Recorded the exit interview of ${e.name}` }, req)
  await tickInterview(e._id, auth)
  return { interview: e.exit.interview }
}

async function tickInterview(employeeId, auth) {
  try {
    const c = await ExitClearance.findOne({ employeeId, status: 'OPEN' })
    const item = c?.items.find((i) => i.status === 'PENDING' && /exit interview/i.test(i.title))
    if (!item) return
    item.status = 'DONE'; item.done = stamp(auth)
    if (!c.items.some((i) => i.status === 'PENDING')) { c.status = 'DONE'; c.completed = stamp(auth) }
    await c.save()
  } catch (err) {
    logger.warn({ err, employeeId: String(employeeId) }, 'could not tick the exit interview on the clearance')
  }
}

/**
 * The exit interview form (HR_EXIT_INTERVIEW, `id`: a staff record with an exit): filled in once recorded,
 * otherwise blank boxes to fill by hand and sign.
 */
export async function exitInterviewData(employeeId, auth) {
  const e = await findEmployee(employeeId, auth, { lean: true })
  if (!e.exit?.lastWorkingDate) throw conflict(`${e.name} has no exit recorded. Record the exit first (Staff › the person › Exit).`)
  const i = e.exit.interview ?? {}
  const dep = e.departmentId ? await Department.findById(e.departmentId).select('name').lean() : null
  const on = i.at ? new Date(i.at).toISOString().slice(0, 10) : null
  return {
    date: on ?? await todayYmd(), refNo: `HR/EXI/${e.employeeCode}`,
    staff: { name: e.name, code: e.employeeCode, salutation: e.gender === 'FEMALE' ? 'Ms.' : e.gender === 'MALE' ? 'Mr.' : '', designation: e.designation, department: dep?.name ?? null, joiningDate: e.joiningDate, lastWorkingDate: e.exit.lastWorkingDate, exitType: label(EXIT_TYPES, e.exit.type) },
    interview: {
      recorded: !!i.reason, by: i.by ?? null, on,
      reasons: EXIT_REASONS.map((r) => ({ label: r.label, chosen: i.reason === r.value })),
      reasonLabel: label(EXIT_REASONS, i.reason) ?? null, otherReason: i.otherReason ?? null,
      ratings: EXIT_INTERVIEW_ASPECTS.map((a) => ({ aspect: a.label, score: i.ratings?.[a.value] ?? null, boxes: [1, 2, 3, 4, 5].map((n) => ({ n, on: i.ratings?.[a.value] === n })) })),
      liked: i.liked ?? null, improve: i.improve ?? null,
      rejoinOptions: REJOIN_OPTIONS.map((o) => ({ label: o.label, on: i.wouldRejoin === o.value })),
      rehireOptions: REHIRE_OPTIONS.map((o) => ({ label: o.label, on: i.rehire === o.value })), rehireNote: i.rehireNote ?? null,
    },
  }
}

/**
 * Note on the staff record that an HR paper was printed (Staff › the person › Letters). The same paper printed
 * again by the same person within ten minutes is one entry. Never fails the print.
 */
export async function logLetter(doc, employeeId, ref, auth) {
  if (!LOGGED_LETTERS.includes(doc) || !isOid(employeeId)) return
  try {
    const e = await Employee.findById(employeeId).select('letters').lean()
    if (!e) return
    const last = e.letters?.at(-1)
    const byId = auth?.userId && isOid(auth.userId) ? auth.userId : undefined
    if (last && last.doc === doc && String(last.byId) === String(byId) && Date.now() - new Date(last.at).getTime() < 10 * 60 * 1000) {
      await Employee.updateOne({ _id: employeeId }, { $set: { [`letters.${e.letters.length - 1}.at`]: new Date(), [`letters.${e.letters.length - 1}.ref`]: ref || undefined } })
      return
    }
    await Employee.updateOne({ _id: employeeId }, { $push: { letters: { $each: [{ doc, ref: ref || undefined, by: auth?.user?.name ?? 'System', byId, at: new Date() }], $slice: -200 } } })
  } catch (err) {
    logger.warn({ err, doc, employeeId: String(employeeId) }, 'could not log the printed letter')
  }
}
