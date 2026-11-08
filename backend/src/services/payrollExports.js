import { EMPLOYER_LINES, PAY_COMPONENTS, PAY_EXTRA_LINES, lineAmount, lineLabel, payrollMonthLabel } from '@schoolgiant/shared'
import { Employee } from '../models/hrms.js'
import { PayrollRun, Payslip } from '../models/payroll.js'
import { audit } from '../platform/audit.js'
import { csvCell } from '../platform/csv.js'
import { decrypt } from '../platform/crypto.js'
import { isOid } from '../platform/db.js'
import { AppError, notFound } from '../platform/errors.js'
import { todayYmd } from './hrmsCommon.js'
import { getStatutory } from './payroll.js'

// Bank and statutory files of a payroll run (ported from the hospital): the salary transfer file (a
// generic CSV and the HDFC Bank bulk-upload layout), the EPFO ECR text file, the ESIC
// monthly contribution sheet, professional tax by state and the salary register. Every
// spreadsheet cell that starts with = + - @ is prefixed with ' so a name like
// "=HYPERLINK(…)" opens as text, never as a formula. Account numbers, UAN and ESI numbers
// are decrypted only here, for the file.

export const EXPORTS = {
  'bank-csv': { label: 'Bank transfer (CSV)', ext: 'csv', type: 'text/csv', released: true },
  'bank-hdfc': { label: 'HDFC Bank bulk upload', ext: 'csv', type: 'text/csv', released: true },
  'pf-ecr': { label: 'PF ECR (EPFO)', ext: 'txt', type: 'text/plain', released: true },
  'esi': { label: 'ESI monthly contribution', ext: 'csv', type: 'text/csv', released: true },
  'pt': { label: 'Professional tax by state', ext: 'csv', type: 'text/csv', released: true },
  'register': { label: 'Salary register', ext: 'csv', type: 'text/csv', released: false },
}

export const toCsv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`

const rs = (p) => (Math.round(p ?? 0) / 100).toFixed(2) // paise → "1234.50"
const whole = (p) => Math.round((p ?? 0) / 100) // paise → whole rupees
const dmy = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '')
const plain = (s, max = 85) => String(s ?? '').replace(/[^A-Za-z0-9 .&'-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max)
const secret = (s) => { try { return s?.enc ? decrypt(s.enc) : '' } catch { return '' } }

async function loadRun(id, kind) {
  const run = await PayrollRun.findById(isOid(id) ? id : null).lean()
  if (!run) throw notFound('Payroll run')
  const ok = EXPORTS[kind].released ? ['APPROVED', 'PAID'] : ['CALCULATED', 'APPROVED', 'PAID']
  if (!ok.includes(run.status)) {
    throw new AppError(409, EXPORTS[kind].released ? 'Approve the run first: bank and statutory files are made from an approved payroll.' : 'Calculate the run first.', { code: 'INVALID_TRANSITION' })
  }
  const payslips = await Payslip.find({ runId: run._id }).sort({ 'employee.name': 1 }).lean()
  return { run, payslips }
}

async function privateOf(payslips) {
  const rows = await Employee.find({ _id: { $in: payslips.map((p) => p.employeeId) } }).select('+bank +statutory').lean()
  return new Map(rows.map((e) => [String(e._id), e]))
}

const narration = (run) => `SALARY ${payrollMonthLabel(run.month).toUpperCase()}`

function bankRows(run, payslips, priv) {
  const out = []
  const skipped = []
  for (const p of payslips) {
    if (p.employee?.paymentMode && p.employee.paymentMode !== 'BANK') continue
    if (!(p.net > 0)) continue
    const e = priv.get(String(p.employeeId))
    const account = secret(e?.bank?.account)
    if (!account || !e?.bank?.ifsc) { skipped.push(p.employee?.name); continue }
    out.push({ p, e, account })
  }
  return { out, skipped }
}

async function bankCsv(run, payslips) {
  const priv = await privateOf(payslips)
  const { out, skipped } = bankRows(run, payslips, priv)
  const rows = [['Sl no', 'Employee code', 'Beneficiary name', 'Bank', 'IFSC', 'Account number', 'Amount', 'Narration', 'Payslip no']]
  out.forEach(({ p, e, account }, i) => rows.push([i + 1, p.employee.code, e.bank.accountName || p.employee.name, e.bank.bankName, e.bank.ifsc, account, rs(p.net), narration(run), p.payslipNo]))
  return { body: toCsv(rows), count: out.length, skipped }
}

/**
 * HDFC Bank ENet bulk upload (no header row): transaction type (I = within HDFC, N = NEFT),
 * beneficiary code, account, amount, name, 7 blank location/address columns, references,
 * 7 payment-detail columns, cheque no., date (DD/MM/YYYY), MICR, IFSC, bank, branch, e-mail.
 * Check the column layout with your bank's current format before uploading.
 */
async function bankHdfc(run, payslips) {
  const priv = await privateOf(payslips)
  const { out, skipped } = bankRows(run, payslips, priv)
  const date = dmy(run.paid?.date ?? await todayYmd())
  const rows = out.map(({ p, e, account }) => [
    /^HDFC/i.test(e.bank.ifsc) ? 'I' : 'N', p.employee.code, account, rs(p.net), plain(e.bank.accountName || p.employee.name, 40),
    '', '', '', '', '', '', '', '', p.payslipNo, narration(run), '', '', '', '', '', '', '', date, '', e.bank.ifsc, e.bank.bankName, '', '',
  ])
  return { body: toCsv(rows), count: out.length, skipped }
}

/** EPFO ECR 2.0: one line a member, fields separated by #~#, amounts in whole rupees. */
async function pfEcr(run, payslips) {
  const stat = await getStatutory()
  const priv = await privateOf(payslips)
  const lines = []
  const skipped = []
  for (const p of payslips) {
    const ee = lineAmount(p.deductions, 'PF')
    if (!ee) continue
    const uan = secret(priv.get(String(p.employeeId))?.statutory?.uan)
    if (!uan) { skipped.push(p.employee?.name); continue }
    const ceiling = Math.min(p.pfWages ?? 0, stat.pf.wageCeiling)
    const epfWages = stat.pf.restrictToCeiling ? ceiling : p.pfWages
    const ncp = Math.round((p.attendance?.lop ?? 0) + (p.attendance?.notEmployedDays ?? 0))
    lines.push([uan, plain(p.employee.name), whole(p.gross), whole(epfWages), whole(ceiling), whole(ceiling), whole(ee), whole(lineAmount(p.employer, 'EPS_ER')), whole(lineAmount(p.employer, 'EPF_ER')), ncp, 0].join('#~#'))
  }
  return { body: lines.length ? `${lines.join('\n')}\n` : '', count: lines.length, skipped }
}

/** ESIC monthly contribution upload: IP number, name, days paid, wages, reason for zero days, last working day. */
async function esiSheet(run, payslips) {
  const priv = await privateOf(payslips)
  const rows = [['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days', 'Last Working Day']]
  const skipped = []
  let count = 0
  for (const p of payslips) {
    if (!lineAmount(p.deductions, 'ESI')) continue
    const ip = secret(priv.get(String(p.employeeId))?.statutory?.esi)
    if (!ip) { skipped.push(p.employee?.name); continue }
    const days = Math.floor(p.attendance?.payDays ?? 0)
    const left = p.employee?.lastWorkingDate && p.employee.lastWorkingDate.slice(0, 7) === run.month
    rows.push([ip, p.employee.name, days, whole(p.esiWages), days === 0 ? (left ? 2 : 1) : left ? 2 : 0, left ? dmy(p.employee.lastWorkingDate) : ''])
    count++
  }
  return { body: toCsv(rows), count, skipped }
}

/** Professional tax: a summary by state and slab, then each employee. */
async function ptSummary(run, payslips) {
  const stat = await getStatutory()
  const name = (code) => stat.pt.states.find((s) => s.code === code)?.name ?? code ?? '—'
  const groups = new Map()
  for (const p of payslips) {
    const pt = lineAmount(p.deductions, 'PT')
    const k = `${p.state}|${pt}`
    const g = groups.get(k) ?? { state: p.state, pt, employees: 0, wages: 0, total: 0 }
    g.employees++
    g.wages += p.gross - lineAmount(p.earnings, 'GRATUITY') - lineAmount(p.earnings, 'LEAVE_ENCASHMENT')
    g.total += pt
    groups.set(k, g)
  }
  const rows = [[`Professional tax — ${payrollMonthLabel(run.month)} — ${run.runNo}`], [], ['State', 'Tax a month (₹)', 'Employees', 'Gross wages (₹)', 'Professional tax (₹)']]
  for (const g of [...groups.values()].sort((a, b) => String(a.state).localeCompare(String(b.state)) || a.pt - b.pt)) rows.push([name(g.state), rs(g.pt), g.employees, rs(g.wages), rs(g.total)])
  rows.push(['Total', '', payslips.length, rs([...groups.values()].reduce((s, g) => s + g.wages, 0)), rs([...groups.values()].reduce((s, g) => s + g.total, 0))])
  rows.push([], ['Employee code', 'Name', 'State', 'Gross (₹)', 'Professional tax (₹)'])
  for (const p of payslips) rows.push([p.employee.code, p.employee.name, name(p.state), rs(p.gross), rs(lineAmount(p.deductions, 'PT'))])
  return { body: toCsv(rows), count: payslips.length, skipped: [] }
}

/** Every payslip on one line: attendance, each earning and deduction, employer contributions. */
async function register(run, payslips) {
  const order = [...PAY_COMPONENTS.map((c) => c.code), ...Object.keys(PAY_EXTRA_LINES)]
  const present = (key) => order.filter((c) => payslips.some((p) => (p[key] ?? []).some((l) => l.code === c)))
  const earn = present('earnings')
  const ded = present('deductions')
  const emp = Object.keys(EMPLOYER_LINES).filter((c) => payslips.some((p) => (p.employer ?? []).some((l) => l.code === c)))
  const rows = [[
    'Payslip no', 'Employee code', 'Name', 'Designation', 'Department', 'Campus', 'Structure', 'Days in month', 'Pay days basis', 'LOP', 'Paid days',
    ...earn.map((c) => lineLabel(c)), 'Gross', ...ded.map((c) => lineLabel(c)), 'Total deductions', 'Net pay', ...emp.map((c) => EMPLOYER_LINES[c]), 'Employer cost',
    'Payment mode', 'Bank', 'IFSC', 'Account (last 4)', 'Status',
  ]]
  for (const p of payslips) {
    rows.push([
      p.payslipNo, p.employee.code, p.employee.name, p.employee.designation, p.employee.departmentName, p.employee.branchName, p.structureName,
      p.attendance?.daysInMonth, p.attendance?.baseDays, p.attendance?.lop, p.attendance?.payDays,
      ...earn.map((c) => rs(lineAmount(p.earnings, c))), rs(p.gross), ...ded.map((c) => rs(lineAmount(p.deductions, c))), rs(p.totalDeductions), rs(p.net),
      ...emp.map((c) => rs(lineAmount(p.employer, c))), rs(p.employerCost),
      p.employee.paymentMode, p.employee.bankName, p.employee.ifsc, p.employee.accountLast4, p.status,
    ])
  }
  rows.push(['Total', '', `${payslips.length} staff`, '', '', '', '', '', '', payslips.reduce((s, p) => s + (p.attendance?.lop ?? 0), 0), '',
    ...earn.map((c) => rs(payslips.reduce((s, p) => s + lineAmount(p.earnings, c), 0))), rs(payslips.reduce((s, p) => s + p.gross, 0)),
    ...ded.map((c) => rs(payslips.reduce((s, p) => s + lineAmount(p.deductions, c), 0))), rs(payslips.reduce((s, p) => s + p.totalDeductions, 0)), rs(payslips.reduce((s, p) => s + p.net, 0)),
    ...emp.map((c) => rs(payslips.reduce((s, p) => s + lineAmount(p.employer, c), 0))), rs(payslips.reduce((s, p) => s + p.employerCost, 0))])
  return { body: toCsv(rows), count: payslips.length, skipped: [] }
}

const MAKERS = { 'bank-csv': bankCsv, 'bank-hdfc': bankHdfc, 'pf-ecr': pfEcr, esi: esiSheet, pt: ptSummary, register }

/** → { filename, contentType, body, count, skipped[] } */
export async function exportFile(runId, kind, req) {
  const def = EXPORTS[kind]
  if (!def) throw notFound('Export')
  const { run, payslips } = await loadRun(runId, kind)
  const r = await MAKERS[kind](run, payslips)
  await audit({ action: 'EXPORT', module: 'payroll', entityType: 'payroll-run', entityId: String(run._id), entityName: run.runNo, summary: `Downloaded the ${def.label.toLowerCase()} of ${run.runNo} (${payrollMonthLabel(run.month)}): ${r.count} row(s)${r.skipped.length ? `, ${r.skipped.length} left out for missing bank / statutory numbers` : ''}` }, req)
  return { ...r, filename: `${kind}-${run.month}-${run.runNo}.${def.ext}`, contentType: `${def.type}; charset=utf-8` }
}

/** What can be downloaded for a run, and how many rows each would have. */
export async function exportOptions(runId) {
  const run = await PayrollRun.findById(isOid(runId) ? runId : null).lean()
  if (!run) throw notFound('Payroll run')
  const payslips = await Payslip.find({ runId: run._id }).select('deductions net employee.paymentMode').lean()
  const counts = {
    'bank-csv': payslips.filter((p) => (p.employee?.paymentMode ?? 'BANK') === 'BANK' && p.net > 0).length,
    'pf-ecr': payslips.filter((p) => lineAmount(p.deductions, 'PF') > 0).length,
    esi: payslips.filter((p) => lineAmount(p.deductions, 'ESI') > 0).length,
    pt: payslips.filter((p) => lineAmount(p.deductions, 'PT') > 0).length,
    register: payslips.length,
  }
  counts['bank-hdfc'] = counts['bank-csv']
  return Object.entries(EXPORTS).map(([kind, d]) => ({ kind, ...d, rows: counts[kind], ready: (d.released ? ['APPROVED', 'PAID'] : ['CALCULATED', 'APPROVED', 'PAID']).includes(run.status) }))
}
