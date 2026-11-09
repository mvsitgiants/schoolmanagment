import { incomeKeyForHead } from '@schoolgiant/shared'
import { Account, Expense, FinanceConfig, Journal } from '../models/finance.js'
import { LibraryFine } from '../models/library.js'
import { StoreSale } from '../models/inventory.js'
import { CanteenOrder, WalletTxn } from '../models/canteen.js'
import { AlumniDonation } from '../models/alumni.js'
import { FeeHead, FeeInvoice, FeePayment, FeeRefund } from '../models/fees.js'
import { Payslip, PayrollRun } from '../models/payroll.js'
import { Student, studentName } from '../models/students.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest } from '../platform/errors.js'
import { on } from '../platform/events.js'
import { logger } from '../platform/logger.js'
import { getSettings } from '../platform/settings.js'
import { timeZoneOf, ymdIn } from '../platform/time.js'
import { loadChart, postEntry } from './finance.js'

// Auto-posting (ported from the hospital): business events → balanced vouchers, posted once each. Every rule reads the
// source document as saved and posts under the key `<SOURCE>:<id>:<event>`, so a listener firing twice, a rebuild
// over a period already posted, or both, all post exactly once. A module that is switched off posts nothing.
//
//   Source                Dr                                        Cr
//   Fee receipt           cash / bank (gateway when set)             each fee head's income ledger (caution deposit:
//                                                                    the deposit liability), late fees, fees in advance
//   Receipt cancelled     the receipt's voucher mirrored
//   Fee refund            caution deposits (up to what the receipt   cash / bank
//                         took), then fee refunds
//   Payroll paid          salaries + employer PF/ESI/LWF             bank (net), PF/ESI/PT/LWF/TDS payable,
//                                                                    staff loans, staff recoveries
//   Expense paid          the expense head                           cash / bank, TDS payable
//   Library fine paid     cash / bank                                late fees & fines
//   (payment cancelled)   the fine's voucher mirrored

const sum = (rows, f = (x) => x) => rows.reduce((s, r) => s + (f(r) || 0), 0)

// ───────────────────────────────────────────────────────── fee heads → ledgers

/** Which ledger each fee head posts to: the saved mapping, else by the head (tuition → Tuition fees …). */
export async function feeHeadLedgers(chart) {
  const [heads, config] = await Promise.all([FeeHead.find().lean(), FinanceConfig.findOne().lean()])
  const saved = config?.feeHeads ?? {}
  return new Map(heads.map((h) => {
    const id = saved[String(h._id)]
    const acc = (id && chart.byId.get(String(id))) || chart.byKey.get(incomeKeyForHead(h)) || chart.byKey.get('INC_OTHER_FEES')
    return [String(h._id), acc]
  }))
}

export async function feeHeadMapping() {
  const chart = await loadChart()
  const [heads, config] = await Promise.all([FeeHead.find().sort({ name: 1 }).lean(), FinanceConfig.findOne().lean()])
  const map = await feeHeadLedgers(chart)
  return heads.map((h) => ({ feeHeadId: String(h._id), name: h.name, code: h.code, refundable: !!h.refundable, accountId: String(map.get(String(h._id))?._id ?? ''), account: map.get(String(h._id))?.name ?? null, custom: !!config?.feeHeads?.[String(h._id)] }))
}

export async function saveFeeHeadMapping(rows, auth, req) {
  const chart = await loadChart()
  const feeHeads = {}
  for (const r of rows) {
    const acc = chart.byId.get(String(r.accountId))
    if (!acc || acc.isGroup || !['INCOME', 'LIABILITY'].includes(acc.type)) throw badRequest('Pick an income (or deposit) ledger for each fee head.')
    feeHeads[String(r.feeHeadId)] = String(acc._id)
  }
  await FinanceConfig.updateOne({}, { $set: { feeHeads, updatedBy: auth.user?.name } }, { upsert: true })
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'fee_head_mapping', entityName: 'Fee heads', summary: `Changed which ledger ${rows.length} fee head(s) post to` }, req)
  return feeHeadMapping()
}

// ───────────────────────────────────────────────────────── fees

/** The ledger a payment mode's money lands in. ONLINE goes to the gateway account when the setting says so. */
async function moneyFor(chart, mode) {
  if (mode === 'CASH') return chart.byKey.get('CASH')
  if (mode === 'ONLINE' && (await getSettings('finance')).onlineToGateway) return chart.byKey.get('GATEWAY')
  const bank = chart.defaultBank
  return (bank && chart.byId.get(String(bank.accountId))) ?? chart.byKey.get('BANK')
}

/** A receipt's money, split by the fee heads of the invoices it paid (proportionally within each invoice). */
async function receiptLines(p, chart) {
  const ledgers = await feeHeadLedgers(chart)
  const invoices = new Map((await FeeInvoice.find({ _id: { $in: p.allocations.map((a) => a.invoiceId) } }).lean()).map((i) => [String(i._id), i]))
  const credit = new Map()
  const add = (acc, amount) => { if (acc && amount) credit.set(String(acc._id), (credit.get(String(acc._id)) ?? 0) + amount) }
  let allocated = 0
  for (const a of p.allocations) {
    allocated += a.amount
    const inv = invoices.get(String(a.invoiceId))
    if (!inv) { add(chart.byKey.get('INC_OTHER_FEES'), a.amount); continue }
    const lines = inv.lines.map((l) => ({ ...l, net: Math.max(0, (l.amount ?? 0) - (l.concession ?? 0)) }))
    const base = sum(lines, (l) => l.net) + (inv.lateFee ?? 0)
    let given = 0
    for (const l of lines) {
      const share = base ? Math.floor((a.amount * l.net) / base) : 0
      given += share
      add(ledgers.get(String(l.feeHeadId)) ?? chart.byKey.get('INC_OTHER_FEES'), share)
    }
    add(chart.byKey.get('INC_LATE_FEE'), a.amount - given) // the late fee and rounding
  }
  add(chart.byKey.get('FEE_ADVANCES'), p.amount - allocated) // paid ahead of any invoice
  return [...credit.entries()].map(([account, amount]) => ({ account, amount: -amount }))
}

const studentParty = (s) => s && { type: 'STUDENT', id: s._id, name: `${studentName(s)} (${s.admissionNo})` }

export async function postFeeReceipt(p, chart) {
  if (!p.amount) return null
  const s = await Student.findById(p.studentId).select('firstName lastName admissionNo').lean()
  const money = await moneyFor(chart, p.mode)
  const credits = await receiptLines(p, chart)
  return postEntry({
    key: `FEE_RECEIPT:${p._id}:RECEIVED`, type: 'RECEIPT', date: p.date, branchId: p.branchId, reference: p.reference,
    narration: `Fee receipt ${p.receiptNo} — ${s ? studentName(s) : ''}`,
    lines: [{ account: money._id, amount: p.amount, party: studentParty(s) }, ...credits],
    source: { type: 'FEE_RECEIPT', id: p._id, no: p.receiptNo, event: 'RECEIVED', module: 'fees' },
  }, chart)
}

/** A cancelled receipt: its voucher mirrored on the day it was cancelled. */
export async function postReceiptCancel(p, chart) {
  if (p.status !== 'CANCELLED') return null
  const received = await Journal.findOne({ postingKey: `FEE_RECEIPT:${p._id}:RECEIVED` }).lean()
  if (!received) return null
  const day = ymdIn(p.cancelledAt ?? p.updatedAt ?? new Date(), await timeZoneOf())
  return postEntry({
    key: `FEE_RECEIPT:${p._id}:CANCELLED`, type: 'RECEIPT', date: day < p.date ? p.date : day, branchId: p.branchId,
    narration: `Fee receipt ${p.receiptNo} cancelled${p.cancelReason ? ` — ${p.cancelReason}` : ''}`,
    lines: received.lines.map((l) => ({ account: l.accountId, amount: l.credit - l.debit, party: l.party, note: l.note })),
    source: { type: 'FEE_RECEIPT', id: p._id, no: p.receiptNo, event: 'CANCELLED', module: 'fees' },
  }, chart)
}

/** Fees given back: out of the caution deposit the receipt took (refunded so far counted), the rest as fee refunds. */
export async function postFeeRefund(r, chart) {
  const p = await FeePayment.findById(r.paymentId).lean()
  if (!p) return null
  const received = await Journal.findOne({ postingKey: `FEE_RECEIPT:${p._id}:RECEIVED` }).lean()
  const deposits = chart.byKey.get('CAUTION_DEPOSITS')
  const depositTaken = received ? sum(received.lines.filter((l) => String(l.accountId) === String(deposits?._id)), (l) => l.credit) : 0
  const earlierIds = (await FeeRefund.find({ paymentId: p._id, _id: { $ne: r._id } }).select('_id').lean()).map((x) => x._id)
  const earlier = earlierIds.length ? await Journal.find({ 'source.type': 'FEE_REFUND', 'source.id': { $in: earlierIds } }).select('lines').lean() : []
  const depositBack = sum(earlier, (j) => sum(j.lines.filter((l) => String(l.accountId) === String(deposits?._id)), (l) => l.debit))
  const fromDeposit = Math.max(0, Math.min(r.amount, depositTaken - depositBack))
  const s = await Student.findById(r.studentId).select('firstName lastName admissionNo').lean()
  const money = await moneyFor(chart, r.mode === 'CASH' ? 'CASH' : 'BANK')
  return postEntry({
    key: `FEE_REFUND:${r._id}:PAID`, type: 'PAYMENT', date: r.date, branchId: p.branchId, reference: r.reference,
    narration: `Fee refund ${r.refundNo} on ${p.receiptNo} — ${s ? studentName(s) : ''}: ${r.reason}`,
    lines: [
      { account: 'CAUTION_DEPOSITS', amount: fromDeposit, party: studentParty(s) },
      { account: 'FEE_REFUNDS', amount: r.amount - fromDeposit, party: studentParty(s) },
      { account: money._id, amount: -r.amount },
    ],
    source: { type: 'FEE_REFUND', id: r._id, no: r.refundNo, event: 'PAID', module: 'fees' },
  }, chart)
}

// ───────────────────────────────────────────────────────── payroll

const PF_EMPLOYER = new Set(['EPF_ER', 'EPS_ER', 'EDLI', 'PF_ADMIN'])
const lineSum = (ps, key, test) => sum(ps, (p) => sum((p[key] ?? []).filter((l) => test(l.code)), (l) => l.amount))

export async function postPayrollRun(run, chart) {
  if (run.status !== 'PAID' || !run.paid?.date) return null
  const ps = await Payslip.find({ runId: run._id }).select('gross net totalDeductions employerContribution deductions employer').lean()
  const gross = sum(ps, (p) => p.gross)
  const net = sum(ps, (p) => p.net)
  const employer = sum(ps, (p) => p.employerContribution)
  const ded = (code) => lineSum(ps, 'deductions', (c) => c === code)
  const known = ['PF', 'ESI', 'PT', 'LWF', 'TDS', 'LOAN']
  const otherDed = sum(ps, (p) => p.totalDeductions) - sum(known, ded)
  const erPf = lineSum(ps, 'employer', (c) => PF_EMPLOYER.has(c))
  const erEsi = lineSum(ps, 'employer', (c) => c === 'ESI_ER')
  const erLwf = lineSum(ps, 'employer', (c) => c === 'LWF_ER')
  const erOther = employer - erPf - erEsi - erLwf
  const credits = net + sum(known, ded) + otherDed + employer
  const money = await moneyFor(chart, run.paid.mode === 'CASH' ? 'CASH' : 'BANK')
  return postEntry({
    key: `PAYROLL_RUN:${run._id}:PAID`, type: 'JOURNAL', date: run.paid.date, reference: run.paid.reference, branchId: run.branchId,
    narration: `Payroll ${run.runNo} for ${run.month}${run.branchName ? ` (${run.branchName})` : ''} paid — ${ps.length} staff`,
    lines: [
      { account: 'SALARIES', amount: gross }, { account: 'EMPLOYER_CONTRIB', amount: employer },
      { account: money._id, amount: -net, note: 'Net pay' },
      { account: 'PF_PAYABLE', amount: -(ded('PF') + erPf + erOther) }, { account: 'ESI_PAYABLE', amount: -(ded('ESI') + erEsi) },
      { account: 'PT_PAYABLE', amount: -ded('PT') }, { account: 'LWF_PAYABLE', amount: -(ded('LWF') + erLwf) }, { account: 'TDS_PAYABLE', amount: -ded('TDS'), note: 'Salary TDS (192)' },
      { account: 'STAFF_ADVANCES', amount: -ded('LOAN'), note: 'Loan recovery' }, { account: 'STAFF_RECOVERIES', amount: -otherDed },
      { account: 'ROUND_OFF', amount: credits - gross - employer }, // payslips always balance; this only catches stray paise
    ],
    source: { type: 'PAYROLL_RUN', id: run._id, no: run.runNo, event: 'PAID', module: 'payroll' },
  }, chart)
}

// ───────────────────────────────────────────────────────── expenses

/** An expense paid: Dr the expense head (the whole bill), Cr the money that left and the TDS held back. */
export async function postExpense(x, chart) {
  if (x.status !== 'PAID' || !x.paid?.date) return null
  const money = x.paid.mode === 'CASH' ? chart.byKey.get('CASH')
    : (x.paid.bankAccountId && chart.byId.get(String(chart.banks.find((b) => String(b._id) === String(x.paid.bankAccountId))?.accountId))) || (await moneyFor(chart, 'BANK'))
  const party = { type: x.payee?.employeeId ? 'EMPLOYEE' : 'SUPPLIER', id: x.payee?.employeeId, name: x.payee?.name }
  return postEntry({
    key: `EXPENSE:${x._id}:PAID`, type: 'PAYMENT', date: x.paid.date, reference: x.paid.reference, branchId: x.branchId,
    narration: `Expense ${x.expenseNo} — ${x.payee?.name}: ${x.description}`,
    lines: [
      { account: x.accountId, amount: x.amount, party },
      { account: money._id, amount: -(x.amount - (x.tds?.amount ?? 0)) },
      { account: 'TDS_PAYABLE', amount: -(x.tds?.amount ?? 0), note: x.tds?.section ? `TDS ${x.tds.section}` : undefined },
    ],
    source: { type: 'EXPENSE', id: x._id, no: x.expenseNo, event: 'PAID', module: 'finance' },
  }, chart)
}

// ───────────────────────────────────────────────────────── library fines

const borrowerParty = (b) => b && { type: b.kind === 'STAFF' ? 'EMPLOYEE' : 'STUDENT', id: b.id, name: `${b.name}${b.code ? ` (${b.code})` : ''}` }

/** A library fine collected: Dr the money, Cr late fees & fines. Keyed by the receipt, so paid again after a cancel posts again. */
export async function postLibraryFine(f, chart) {
  if (f.status !== 'PAID' || !f.paid?.receiptNo || !f.amount) return null
  const money = await moneyFor(chart, f.paid.mode)
  return postEntry({
    key: `LIBRARY_FINE:${f._id}:PAID:${f.paid.receiptNo}`, type: 'RECEIPT', date: f.paid.date, branchId: f.branchId, reference: f.paid.reference,
    narration: `Library fine ${f.paid.receiptNo} — ${f.borrower?.name ?? ''}${f.title ? `: ${f.title}` : ''}`,
    lines: [{ account: money._id, amount: f.amount, party: borrowerParty(f.borrower) }, { account: 'INC_LATE_FEE', amount: -f.amount }],
    source: { type: 'LIBRARY_FINE', id: f._id, no: f.paid.receiptNo, event: 'PAID', module: 'library' },
  }, chart)
}

/** Each cancelled payment of a fine: its voucher mirrored on the day it was cancelled. */
export async function postLibraryFineCancels(f, chart) {
  let last = null
  for (const c of f.cancelled ?? []) {
    const received = await Journal.findOne({ postingKey: `LIBRARY_FINE:${f._id}:PAID:${c.receiptNo}` }).lean()
    if (!received) continue
    last = await postEntry({
      key: `LIBRARY_FINE:${f._id}:CANCELLED:${c.receiptNo}`, type: 'RECEIPT', date: c.on && c.on > c.date ? c.on : c.date, branchId: f.branchId,
      narration: `Library fine ${c.receiptNo} cancelled${c.reason ? ` — ${c.reason}` : ''}`,
      lines: received.lines.map((l) => ({ account: l.accountId, amount: l.credit - l.debit, party: l.party, note: l.note })),
      source: { type: 'LIBRARY_FINE', id: f._id, no: c.receiptNo, event: 'CANCELLED', module: 'library' },
    }, chart)
  }
  return last
}

// ───────────────────────────────────────────────────────── store sales (inventory)

/** "Uniform & book sales": its system key when the chart has one, else the starter account 4230, else other fees. */
const storeIncome = (chart) => chart.byKey.get('INC_STORE_SALES')
  ?? [...chart.byId.values()].find((a) => a.code === '4230' && !a.isGroup)
  ?? chart.byKey.get('INC_OTHER_FEES')

/** A uniform / book sale at the store counter: Dr the money (cash, or bank for UPI / card), Cr store sales. */
export async function postStoreSale(s, chart) {
  if (!s.total) return null
  const money = await moneyFor(chart, s.mode)
  const party = s.studentId && { type: 'STUDENT', id: s.studentId, name: `${s.student?.name ?? ''}${s.student?.admissionNo ? ` (${s.student.admissionNo})` : ''}` }
  return postEntry({
    key: `STORE_SALE:${s._id}:SOLD`, type: 'RECEIPT', date: s.date, branchId: s.branchId, reference: s.reference,
    narration: `Store sale ${s.saleNo} — ${s.student?.name ?? ''}`,
    lines: [{ account: money._id, amount: s.total, party }, { account: storeIncome(chart)._id, amount: -s.total }],
    source: { type: 'STORE_SALE', id: s._id, no: s.saleNo, event: 'SOLD', module: 'inventory' },
  }, chart)
}

/** A cancelled store sale: its voucher mirrored on the day it was cancelled. */
export async function postStoreSaleCancel(s, chart) {
  if (s.status !== 'CANCELLED') return null
  const sold = await Journal.findOne({ postingKey: `STORE_SALE:${s._id}:SOLD` }).lean()
  if (!sold) return null
  const day = s.cancelled?.on ?? s.date
  return postEntry({
    key: `STORE_SALE:${s._id}:CANCELLED`, type: 'RECEIPT', date: day < s.date ? s.date : day, branchId: s.branchId,
    narration: `Store sale ${s.saleNo} cancelled${s.cancelled?.reason ? ` — ${s.cancelled.reason}` : ''}`,
    lines: sold.lines.map((l) => ({ account: l.accountId, amount: l.credit - l.debit, party: l.party, note: l.note })),
    source: { type: 'STORE_SALE', id: s._id, no: s.saleNo, event: 'CANCELLED', module: 'inventory' },
  }, chart)
}

// ───────────────────────────────────────────────────────── alumni donations

/** A donation received: Dr the money, Cr donations & grants. */
export async function postDonation(d, chart) {
  if (d.status !== 'RECEIVED' || !d.amount) return null
  const money = await moneyFor(chart, d.mode)
  return postEntry({
    key: `DONATION:${d._id}:RECEIVED`, type: 'RECEIPT', date: d.date, branchId: d.branchId, reference: d.reference,
    narration: `Donation ${d.receiptNo} — ${d.donor?.name ?? ''}${d.fund ? ` (${d.fund})` : ''}`,
    lines: [{ account: money._id, amount: d.amount, party: { type: 'OTHER', id: d.donor?.alumnusId, name: d.donor?.name } }, { account: 'INC_DONATIONS', amount: -d.amount }],
    source: { type: 'DONATION', id: d._id, no: d.receiptNo, event: 'RECEIVED', module: 'alumni' },
  }, chart)
}
// ───────────────────────────────────────────────────────── canteen wallet

const CANTEEN_LEDGERS = {
  CANTEEN_WALLETS: { code: '2125', name: 'Canteen wallet balances', type: 'LIABILITY', parent: '2100' },
  INC_CANTEEN: { code: '4250', name: 'Canteen sales', type: 'INCOME', parent: '4200' },
}
/** The canteen ledger by key; an institution whose chart predates it gets it now (and the chart in hand learns it). */
async function canteenLedger(chart, key) {
  let acc = chart.byKey.get(key)
  if (acc) return acc
  const def = CANTEEN_LEDGERS[key]
  acc = await Account.findOne({ systemKey: key }).lean()
  if (!acc) {
    const parent = await Account.findOne({ code: def.parent }).select('_id').lean()
    const code = (await Account.exists({ code: def.code })) ? `${def.code}-C` : def.code
    try {
      acc = (await Account.create([{ code, name: def.name, type: def.type, parentId: parent?._id, systemKey: key, createdBy: 'Auto-posting' }]))[0].toObject()
    } catch (err) {
      if (err?.code !== 11000) throw err
      acc = await Account.findOne({ systemKey: key }).lean()
    }
  }
  chart.byKey.set(key, acc)
  chart.byId.set(String(acc._id), acc)
  return acc
}
const walletParty = (t) => ({ type: 'STUDENT', id: t.studentId })
const canteenStudentParty = async (id) => studentParty(id ? await Student.findById(id).select('firstName lastName admissionNo').lean() : null)

/** A wallet top-up: Dr the money (cash at the counter, UPI → bank, online → gateway/bank), Cr canteen wallet balances. */
export async function postCanteenTopUp(t, chart) {
  if (t.type !== 'TOP_UP' || !(t.amount > 0)) return null
  const money = await moneyFor(chart, t.mode === 'CASH' ? 'CASH' : t.mode === 'ONLINE' ? 'ONLINE' : 'BANK')
  const wallets = await canteenLedger(chart, 'CANTEEN_WALLETS')
  const party = (await canteenStudentParty(t.studentId)) ?? walletParty(t)
  return postEntry({
    key: `CANTEEN_TXN:${t._id}:TOP_UP`, type: 'RECEIPT', date: t.date, branchId: t.branchId, reference: t.reference,
    narration: `Canteen wallet top-up — ${party.name ?? ''}${t.mode ? ` (${t.mode})` : ''}`,
    lines: [{ account: money._id, amount: t.amount, party }, { account: wallets._id, amount: -t.amount, party }],
    source: { type: 'CANTEEN', id: t._id, event: 'TOP_UP', module: 'canteen' },
  }, chart)
}

/** Wallet money given back to the family: Dr canteen wallet balances, Cr cash / bank. */
export async function postCanteenRefund(t, chart) {
  if (t.type !== 'REFUND' || !(t.amount < 0)) return null
  const money = await moneyFor(chart, t.mode === 'CASH' ? 'CASH' : 'BANK')
  const wallets = await canteenLedger(chart, 'CANTEEN_WALLETS')
  const party = (await canteenStudentParty(t.studentId)) ?? walletParty(t)
  return postEntry({
    key: `CANTEEN_TXN:${t._id}:REFUND`, type: 'PAYMENT', date: t.date, branchId: t.branchId, reference: t.reference,
    narration: `Canteen wallet refund — ${party.name ?? ''}${t.note ? `: ${t.note}` : ''}`,
    lines: [{ account: wallets._id, amount: -t.amount, party }, { account: money._id, amount: t.amount, party }],
    source: { type: 'CANTEEN', id: t._id, event: 'REFUND', module: 'canteen' },
  }, chart)
}

/** A sale: Dr canteen wallet balances (wallet) or cash (cash), Cr canteen sales. */
export async function postCanteenSale(o, chart) {
  if (!o.total) return null
  const income = await canteenLedger(chart, 'INC_CANTEEN')
  const from = o.payMode === 'WALLET' ? await canteenLedger(chart, 'CANTEEN_WALLETS') : await moneyFor(chart, 'CASH')
  const party = o.studentId ? await canteenStudentParty(o.studentId) : undefined
  return postEntry({
    key: `CANTEEN_ORDER:${o._id}:SOLD`, type: o.payMode === 'WALLET' ? 'JOURNAL' : 'RECEIPT', date: o.date, branchId: o.branchId,
    narration: `Canteen ${o.source === 'PREORDER' ? 'pre-order' : 'sale'} ${o.orderNo}${o.studentName ? ` — ${o.studentName}` : ''}`,
    lines: [{ account: from._id, amount: o.total, party }, { account: income._id, amount: -o.total }],
    source: { type: 'CANTEEN', id: o._id, no: o.orderNo, event: 'SOLD', module: 'canteen' },
  }, chart)
}

/** A cancelled pre-order: its sale voucher mirrored. */
export async function postCanteenSaleCancel(o, chart) {
  if (o.status !== 'CANCELLED') return null
  const sold = await Journal.findOne({ postingKey: `CANTEEN_ORDER:${o._id}:SOLD` }).lean()
  if (!sold) return null
  return postEntry({
    key: `CANTEEN_ORDER:${o._id}:CANCELLED`, type: sold.type, date: o.cancelledAt ? ymdIn(o.cancelledAt, await timeZoneOf()) : o.date, branchId: o.branchId,
    narration: `Canteen pre-order ${o.orderNo} cancelled`,
    lines: sold.lines.map((l) => ({ account: l.accountId, amount: l.credit - l.debit, party: l.party, note: l.note })),
    source: { type: 'CANTEEN', id: o._id, no: o.orderNo, event: 'CANCELLED', module: 'canteen' },
  }, chart)
}
// ───────────────────────────────────────────────────────── listeners and rebuild

const byId = (Model, fn) => async (id, chart) => {
  if (!isOid(id)) return null
  const doc = await Model.findById(id).lean()
  return doc ? fn(doc, chart) : null
}

const HANDLERS = {
  'fees.receipt': ['fees', (p) => p.entity?.id, byId(FeePayment, postFeeReceipt)],
  'fees.receipt_cancelled': ['fees', (p) => p.entity?.id, byId(FeePayment, postReceiptCancel)],
  'fees.refund': ['fees', (p) => p.entity?.id, byId(FeeRefund, postFeeRefund)],
  'alumni.donation': ['alumni', (p) => p.entity?.id, byId(AlumniDonation, postDonation)],
  'canteen.topup': ['canteen', (p) => p.entity?.id, byId(WalletTxn, postCanteenTopUp)],
  'canteen.refund': ['canteen', (p) => p.entity?.id, byId(WalletTxn, postCanteenRefund)],
  'canteen.sale': ['canteen', (p) => p.entity?.id, byId(CanteenOrder, postCanteenSale)],
  'canteen.sale_cancelled': ['canteen', (p) => p.entity?.id, byId(CanteenOrder, postCanteenSaleCancel)],
  'inventory.sale': ['inventory', (p) => p.entity?.id, byId(StoreSale, postStoreSale)],
  'inventory.sale_cancelled': ['inventory', (p) => p.entity?.id, byId(StoreSale, postStoreSaleCancel)],
  'payroll.paid': ['payroll', (p) => p.entity?.id, byId(PayrollRun, postPayrollRun)],
  'library.fine_paid': ['library', (p) => p.entity?.id, byId(LibraryFine, postLibraryFine)],
  'library.fine_cancelled': ['library', (p) => p.entity?.id, byId(LibraryFine, postLibraryFineCancels)],
}

let registered = false
/** Listen for the business events that post (once per process). */
export function registerFinanceListeners() {
  if (registered) return
  registered = true
  for (const [event, [moduleId, idOf, fn]] of Object.entries(HANDLERS)) {
    on(event, async (payload) => {
      const tenantId = getContext()?.tenantId
      if (!tenantId) return
      const enabled = await enabledModuleIds(tenantId)
      if (!enabled.includes('finance') || !enabled.includes(moduleId)) return
      if ((await getSettings('finance')).autoPost === false) return
      const id = idOf(payload ?? {})
      if (!id) return
      await fn(String(id), await loadChart())
    })
  }
}

/**
 * Post everything a period's documents should have posted and haven't (Accounts switched on later, auto-posting off
 * for a while). Safe to run again and again: what is already in the ledger is left alone.
 */
export async function rebuildPostings({ from, to }, req) {
  const enabled = new Set(await enabledModuleIds(getContext().tenantId))
  const chart = await loadChart()
  chart.seen = new Set((await Journal.find({ postingKey: { $type: 'string' } }).select('postingKey').lean()).map((j) => j.postingKey))
  const range = { $gte: from, $lte: to }
  const counts = { posted: 0, existing: 0, failed: 0, bySource: {} }
  const run = async (source, docs, fn) => {
    for (const d of docs) {
      try {
        const r = await fn(d)
        if (!r) continue
        if (r.existed) counts.existing++
        else { counts.posted++; counts.bySource[source] = (counts.bySource[source] ?? 0) + 1 }
      } catch (err) { counts.failed++; logger.warn({ err, source, id: String(d._id) }, 'posting failed during rebuild') }
    }
  }
  if (enabled.has('fees')) {
    const receipts = await FeePayment.find({ date: range }).lean()
    await run('FEE_RECEIPT', receipts, (p) => postFeeReceipt(p, chart))
    await run('FEE_RECEIPT', receipts.filter((p) => p.status === 'CANCELLED'), (p) => postReceiptCancel(p, chart))
    await run('FEE_REFUND', await FeeRefund.find({ date: range }).lean(), (r) => postFeeRefund(r, chart))
  }
  if (enabled.has('payroll')) await run('PAYROLL_RUN', await PayrollRun.find({ status: 'PAID', 'paid.date': range }).lean(), (r) => postPayrollRun(r, chart))
  if (enabled.has('library')) {
    await run('LIBRARY_FINE', await LibraryFine.find({ status: 'PAID', 'paid.date': range }).lean(), (f) => postLibraryFine(f, chart))
    await run('LIBRARY_FINE', await LibraryFine.find({ 'cancelled.date': range }).lean(), (f) => postLibraryFineCancels(f, chart))
  }
  if (enabled.has('alumni')) await run('DONATION', await AlumniDonation.find({ status: 'RECEIVED', date: range }).lean(), (d) => postDonation(d, chart))
  if (enabled.has('canteen')) {
    const txns = await WalletTxn.find({ date: range, type: { $in: ['TOP_UP', 'REFUND'] } }).lean()
    await run('CANTEEN', txns.filter((t) => t.type === 'TOP_UP'), (t) => postCanteenTopUp(t, chart))
    await run('CANTEEN', txns.filter((t) => t.type === 'REFUND'), (t) => postCanteenRefund(t, chart))
    const orders = await CanteenOrder.find({ date: range }).lean()
    await run('CANTEEN', orders, (o) => postCanteenSale(o, chart))
    await run('CANTEEN', orders.filter((o) => o.status === 'CANCELLED'), (o) => postCanteenSaleCancel(o, chart))
  }
  if (enabled.has('inventory')) {
    const sales = await StoreSale.find({ date: range }).lean()
    await run('STORE_SALE', sales, (s) => postStoreSale(s, chart))
    await run('STORE_SALE', await StoreSale.find({ status: 'CANCELLED', 'cancelled.on': range }).lean(), (s) => postStoreSaleCancel(s, chart))
  }
  await run('EXPENSE', await Expense.find({ status: 'PAID', 'paid.date': range }).lean(), (x) => postExpense(x, chart))
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'ledger', entityName: `${from} – ${to}`, summary: `Rebuilt postings for ${from} to ${to}: ${counts.posted} posted, ${counts.existing} already there${counts.failed ? `, ${counts.failed} failed` : ''}` }, req)
  return counts
}

