import { EXPENSE_STATUSES, formatINR } from '@schoolgiant/shared'
import { Account, BankAccount, Expense } from '../models/finance.js'
import { can } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'
import { ensureChart, loadChart } from './finance.js'
import { postExpense } from './financePosting.js'
import { usersWith } from './hrmsCommon.js'
import { notifyUsers } from './notify.js'

// Accounts › Expenses: a bill to pay — electricity, fuel, repairs, an annual-day stage. Recorded (with the bill
// attached), approved by someone whose role allows that amount (Administration › Roles › limits: “Max expense to
// approve”), then paid; paying posts it to the books (Dr the expense head; Cr cash / bank and TDS held back).

const fieldsError = (fields, message = 'Check the highlighted fields.') => badRequest(message, { fields })
const stamp = (auth) => ({ by: auth.user?.name ?? 'System', byId: isOid(auth.userId) ? auth.userId : undefined, at: new Date() })
const today = async () => (await institutionNow()).date
const label = (s) => EXPENSE_STATUSES[s]?.label ?? s
const out = (x) => ({ ...clean(x), accountId: String(x.accountId), statusLabel: label(x.status) })

/** The ledgers an expense can go to: expense heads first, then every other expenditure ledger. */
export async function expenseHeads() {
  await ensureChart()
  const rows = await Account.find({ type: 'EXPENSE', isGroup: false, active: true, systemKey: { $nin: ['SALARIES', 'EMPLOYER_CONTRIB'] } }).sort({ code: 1 }).lean()
  return rows.map((a) => ({ id: String(a._id), code: a.code, name: a.name, head: !!a.expenseHead }))
}

export async function listExpenses(q, paging) {
  const f = {}
  if (q.status) f.status = q.status
  if (isOid(q.accountId)) f.accountId = q.accountId
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  if (q.search) { const re = new RegExp(escapeRegex(q.search), 'i'); f.$or = [{ expenseNo: re }, { 'payee.name': re }, { description: re }, { billNo: re }] }
  const [rows, total, counts] = await Promise.all([
    Expense.find(f).sort({ date: -1, createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
    Expense.countDocuments(f),
    Expense.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ])
  return { ...listResponse(rows.map(out), total, paging), summary: Object.fromEntries(counts.map((c) => [c._id, { count: c.n, amount: c.amount }])) }
}

export async function getExpense(id) {
  const x = isOid(id) ? await Expense.findById(id).lean() : null
  if (!x) throw notFound('Expense')
  return out(x)
}

async function checked(input) {
  const acc = isOid(input.accountId) ? await Account.findById(input.accountId).lean() : null
  const fields = {}
  if (!acc || acc.type !== 'EXPENSE' || acc.isGroup || !acc.active) fields.accountId = 'Pick an expense head'
  if (!(input.amount > 0)) fields.amount = 'Enter the amount'
  const tds = input.tds?.amount ?? 0
  if (tds < 0 || tds >= input.amount) fields['tds.amount'] = 'Less than the bill'
  if (input.date > await today()) fields.date = 'In the future'
  if (Object.keys(fields).length) throw fieldsError(fields)
  return { acc, tds }
}

/** Auto-approve small expenses (Settings › Accounts), else tell whoever may approve. */
async function route(x, auth) {
  const upTo = Number((await getSettings('finance')).expenseAutoApproveUpTo ?? 0) * 100
  if (upTo > 0 && x.amount <= upTo) {
    x.status = 'APPROVED'
    x.approved = { by: 'Auto (small expense)', at: new Date(), note: `Up to ${formatINR(upTo)} needs no approval` }
    return
  }
  const to = (await usersWith('finance.expenses.approve')).filter((u) => u !== String(auth.userId))
  await notifyUsers(to, { event: 'finance.expense', title: `Expense to approve: ${formatINR(x.amount)}`, message: `${x.payee.name} — ${x.description}`, link: '/finance/expenses', tone: 'info', entityType: 'expense', entityId: String(x._id) })
}

export async function createExpense(input, auth, req) {
  const { acc, tds } = await checked(input)
  const x = new Expense({
    expenseNo: await nextNumber('EXPENSE', { date: new Date(`${input.date}T06:30:00Z`) }), date: input.date,
    accountId: acc._id, accountCode: acc.code, accountName: acc.name, payee: input.payee, description: input.description, billNo: input.billNo || undefined,
    amount: input.amount, tds: { section: tds ? input.tds?.section : undefined, pct: tds ? input.tds?.pct : undefined, amount: tds }, payable: input.amount - tds,
    status: 'SUBMITTED', branchId: auth.user?.branchId, submitted: stamp(auth),
  })
  await x.save()
  await route(x, auth)
  await x.save()
  await audit({ action: 'CREATE', module: 'finance', entityType: 'expense', entityId: String(x._id), entityName: x.expenseNo, summary: `Recorded expense ${x.expenseNo}: ${formatINR(x.amount)} to ${x.payee.name} (${acc.name})${x.status === 'APPROVED' ? ' — approved on its own' : ''}` }, req)
  return out(x.toObject())
}

/** Change an expense still waiting for approval (whoever recorded it, or someone who may approve). */
export async function updateExpense(id, input, auth, req) {
  const x = isOid(id) ? await Expense.findById(id) : null
  if (!x) throw notFound('Expense')
  if (x.status !== 'SUBMITTED') throw conflict(`This expense is ${label(x.status).toLowerCase()}; it can’t change now.`)
  if (String(x.submitted?.byId) !== String(auth.userId) && !can(auth, 'finance.expenses.approve')) throw forbidden('Only whoever recorded it can change it.')
  const { acc, tds } = await checked({ ...x.toObject(), ...input, accountId: input.accountId ?? String(x.accountId) })
  Object.assign(x, {
    date: input.date ?? x.date, accountId: acc._id, accountCode: acc.code, accountName: acc.name, payee: input.payee ?? x.payee, description: input.description ?? x.description,
    billNo: input.billNo ?? x.billNo, amount: input.amount ?? x.amount, tds: input.tds ? { section: tds ? input.tds.section : undefined, pct: tds ? input.tds.pct : undefined, amount: tds } : x.tds,
  })
  x.payable = x.amount - (x.tds?.amount ?? 0)
  await x.save()
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'expense', entityId: String(x._id), entityName: x.expenseNo, summary: `Changed expense ${x.expenseNo} (${formatINR(x.amount)})` }, req)
  return out(x.toObject())
}

export async function decideExpense(id, { approve, note }, auth, req) {
  const x = isOid(id) ? await Expense.findById(id) : null
  if (!x) throw notFound('Expense')
  if (x.status !== 'SUBMITTED') throw conflict(`This expense is already ${label(x.status).toLowerCase()}.`)
  if (!auth.fullAccess && String(x.submitted?.byId) === String(auth.userId)) throw forbidden('Someone else approves an expense you recorded.')
  const limit = auth.limits?.['finance.expenseApproveMax']
  if (approve && !auth.fullAccess && limit != null && limit !== '' && x.amount > Number(limit) * 100) throw forbidden(`Your role approves expenses up to ${formatINR(Number(limit) * 100)}.`)
  if (approve) { x.status = 'APPROVED'; x.approved = { ...stamp(auth), note } } else { x.status = 'REJECTED'; x.rejected = { ...stamp(auth), reason: note } }
  await x.save()
  await audit({ action: approve ? 'APPROVE' : 'REJECT', module: 'finance', entityType: 'expense', entityId: String(x._id), entityName: x.expenseNo, summary: `${approve ? 'Approved' : 'Rejected'} expense ${x.expenseNo} (${formatINR(x.amount)})${note ? `: ${note}` : ''}` }, req)
  if (x.submitted?.byId) await notifyUsers([x.submitted.byId], { event: 'finance.expense', title: `Expense ${x.expenseNo} ${approve ? 'approved' : 'rejected'}`, message: note || x.description, link: '/finance/expenses', tone: approve ? 'success' : 'warning' })
  return out(x.toObject())
}

/** Pay an approved expense: it posts to the books then. */
export async function payExpense(id, input, auth, req) {
  const x = isOid(id) ? await Expense.findById(id) : null
  if (!x) throw notFound('Expense')
  if (x.status !== 'APPROVED') throw conflict(x.status === 'SUBMITTED' ? 'Approve it first.' : `This expense is ${label(x.status).toLowerCase()}.`)
  const fields = {}
  if (input.date > await today()) fields.date = 'In the future'
  if (input.date < x.date) fields.date = 'Before the bill'
  if (input.mode !== 'CASH' && !input.reference?.trim()) fields.reference = 'Enter the UTR / cheque number'
  if (input.mode !== 'CASH' && input.bankAccountId && !await BankAccount.exists({ _id: input.bankAccountId, active: true })) fields.bankAccountId = 'Unknown bank account'
  if (Object.keys(fields).length) throw fieldsError(fields)
  x.status = 'PAID'
  x.paid = { ...stamp(auth), date: input.date, mode: input.mode, bankAccountId: input.mode === 'CASH' ? undefined : input.bankAccountId || undefined, reference: input.reference?.trim() || undefined }
  const posted = await postExpense(x.toObject(), await loadChart())
  x.paid.journalId = posted?.journal?._id
  x.paid.voucherNo = posted?.journal?.voucherNo
  await x.save()
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'expense', entityId: String(x._id), entityName: x.expenseNo, summary: `Paid expense ${x.expenseNo}: ${formatINR(x.payable)} to ${x.payee.name} by ${input.mode}${x.tds?.amount ? ` (TDS ${formatINR(x.tds.amount)} held)` : ''} — ${x.paid.voucherNo ?? ''}` }, req)
  return out(x.toObject())
}

export async function cancelExpense(id, { reason }, auth, req) {
  const x = isOid(id) ? await Expense.findById(id) : null
  if (!x) throw notFound('Expense')
  if (!['SUBMITTED', 'APPROVED'].includes(x.status)) throw conflict(`This expense is ${label(x.status).toLowerCase()}; a paid one is undone by reversing its voucher.`)
  if (String(x.submitted?.byId) !== String(auth.userId) && !can(auth, 'finance.expenses.approve')) throw forbidden()
  x.status = 'CANCELLED'
  x.cancelled = { ...stamp(auth), reason }
  await x.save()
  await audit({ action: 'CANCEL', module: 'finance', entityType: 'expense', entityId: String(x._id), entityName: x.expenseNo, summary: `Cancelled expense ${x.expenseNo}${reason ? `: ${reason}` : ''}` }, req)
  return out(x.toObject())
}

/** For the files engine: an expense's bills and quotations. */
export async function expenseRecord(id) {
  const x = isOid(id) ? await Expense.findById(id).select('expenseNo payee status').lean() : null
  return x && { name: `${x.expenseNo} · ${x.payee?.name ?? ''}`, locked: x.status === 'CANCELLED' }
}
