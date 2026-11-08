import { incomeKeyForHead } from '@schoolgiant/shared'
import { Expense, FinanceConfig, Journal } from '../models/finance.js'
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
  'payroll.paid': ['payroll', (p) => p.entity?.id, byId(PayrollRun, postPayrollRun)],
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
  await run('EXPENSE', await Expense.find({ status: 'PAID', 'paid.date': range }).lean(), (x) => postExpense(x, chart))
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'ledger', entityName: `${from} – ${to}`, summary: `Rebuilt postings for ${from} to ${to}: ${counts.posted} posted, ${counts.existing} already there${counts.failed ? `, ${counts.failed} failed` : ''}` }, req)
  return counts
}

