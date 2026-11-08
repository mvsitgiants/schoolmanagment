import { Router } from 'express'
import { ACCOUNT_TYPES, EXPENSE_PAY_MODES, EXPENSE_STATUSES, JOURNAL_STATUSES, POSTING_SOURCES, TDS_SECTIONS, VOUCHER_TYPES, fyOf } from '@schoolgiant/shared'
import { can } from '../platform/access.js'
import { forbidden } from '../platform/errors.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import {
  createJournal, deleteAccount, discardJournal, journalDetail, listAccounts, listJournals, postJournal, reverseJournal, saveAccount, updateJournal,
} from '../services/finance.js'
import { autoMatch, importStatement, listBankAccounts, matchLine, reconciliation, saveBankAccount, unmatchLine } from '../services/financeBank.js'
import { cancelExpense, createExpense, decideExpense, expenseHeads, getExpense, listExpenses, payExpense, updateExpense } from '../services/financeExpenses.js'
import { feeHeadMapping, rebuildPostings, saveFeeHeadMapping } from '../services/financePosting.js'
import { accountLedger, balanceSheet, dayBook, financeSummary, profitLoss, reportCsv, tallyExport, trialBalance } from '../services/financeReports.js'

// Accounts: /api/v1/finance. Vouchers are append-only: drafts change, posted vouchers only ever get reversed.
// Statuses, voucher numbers and totals are never taken from a request, and every amount is integer paise.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('finance'))

const paise = z.coerce.number().int().min(0).max(1e12)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const reason = z.string().trim().min(3, 'Say why').max(300)
const range = z.object({ from: ymd, to: ymd }).refine((r) => r.from <= r.to, { message: 'From is after to', path: ['from'] })
const id = (req) => objectId.parse(req.params.id)
const ANY = ['accounts', 'journals', 'expenses', 'bank', 'reports'].map((p) => `finance.${p}.view`)
const send = (res, name, body, type = 'text/csv') => {
  res.setHeader('Content-Type', `${type}; charset=utf-8`)
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(body)
}

router.get('/meta', requirePermission(...ANY), async (req, res) => {
  const { date: today } = await institutionNow()
  const fy = fyOf(today)
  const start = Number(fy.slice(0, 4))
  res.json({ data: {
    today, fy, fys: [0, 1, 2].map((n) => fyOf(`${start - n}-06-01`)),
    accountTypes: ACCOUNT_TYPES, voucherTypes: VOUCHER_TYPES, journalStatuses: JOURNAL_STATUSES, sources: POSTING_SOURCES, tdsSections: TDS_SECTIONS,
    settings: await getSettings('finance'),
    accounts: (await listAccounts({ includeInactive: false })).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isGroup: a.isGroup, cashBank: a.cashBank, systemKey: a.systemKey, depth: a.depth })),
    banks: (await listBankAccounts()).filter((b) => b.active).map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault, accountId: String(b.accountId) })),
  } })
})
router.get('/summary', requirePermission('finance.reports.view', 'finance.accounts.view'), async (req, res) => {
  res.json({ data: await financeSummary({ today: (await institutionNow()).date }) })
})

// ───────────────────────────────────────────────────────── chart of accounts

const accountBody = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z-]{2,12}$/, 'Letters, digits and - (2–12)'), name: z.string().trim().min(2, 'Enter a name').max(120),
  type: z.enum(ACCOUNT_TYPES.map((t) => t.value)).optional(), parentId: objectId.nullable().optional(), isGroup: z.boolean().default(false),
  cashBank: z.boolean().default(false), expenseHead: z.boolean().default(false), description: optionalText(300), active: z.boolean().default(true),
})
router.get('/accounts', requirePermission('finance.accounts.view', 'finance.reports.view'), async (req, res) => { res.json({ data: await listAccounts() }) })
router.post('/accounts', requirePermission('finance.accounts.create'), async (req, res) => { res.status(201).json({ data: await saveAccount(null, accountBody.parse(req.body), req.auth, req) }) })
router.patch('/accounts/:id', requirePermission('finance.accounts.edit'), async (req, res) => {
  const body = accountBody.partial().parse(req.body)
  for (const k of ['isGroup', 'cashBank', 'expenseHead', 'active']) if (req.body?.[k] === undefined) delete body[k]
  res.json({ data: await saveAccount(id(req), body, req.auth, req) })
})
router.delete('/accounts/:id', requirePermission('finance.accounts.delete'), async (req, res) => { res.json({ data: await deleteAccount(id(req), req) }) })
router.get('/fee-heads', requirePermission('finance.accounts.view'), async (req, res) => { res.json({ data: await feeHeadMapping() }) })
router.put('/fee-heads', requirePermission('finance.accounts.edit'), async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.object({ feeHeadId: objectId, accountId: objectId })).max(200) }).parse(req.body)
  res.json({ data: await saveFeeHeadMapping(rows, req.auth, req) })
})

// ───────────────────────────────────────────────────────── journals

const lineBody = z.object({
  accountId: objectId, debit: paise.default(0), credit: paise.default(0), note: optionalText(200),
  party: z.object({ type: z.enum(['STUDENT', 'SUPPLIER', 'EMPLOYEE', 'OTHER']).default('OTHER'), id: objectId.optional(), name: optionalText(120) }).optional(),
})
const journalBody = z.object({
  type: z.enum(VOUCHER_TYPES.filter((t) => t.manual).map((t) => t.value)), date: ymd, narration: optionalText(500), reference: optionalText(80),
  lines: z.array(lineBody).min(2, 'At least two lines').max(100),
})
router.get('/journals', requirePermission('finance.journals.view'), async (req, res) => {
  const q = z.object({
    from: ymd.optional(), to: ymd.optional(), status: z.enum(Object.keys(JOURNAL_STATUSES)).optional(), type: z.enum(VOUCHER_TYPES.map((t) => t.value)).optional(),
    fy: z.string().regex(/^\d{4}-\d{2}$/).optional(), source: z.enum(['AUTO', 'MANUAL', ...Object.keys(POSTING_SOURCES)]).optional(), accountId: objectId.optional(), search: optionalText(80),
  }).parse(req.query)
  res.json(await listJournals(q, pageParams(req.query)))
})
router.get('/journals/:id', requirePermission('finance.journals.view'), async (req, res) => { res.json({ data: await journalDetail(id(req)) }) })
router.post('/journals', requirePermission('finance.journals.create'), async (req, res) => {
  const body = journalBody.extend({ post: z.boolean().default(false) }).parse(req.body)
  if (body.post && !can(req.auth, 'finance.journals.post')) throw forbidden('Your role can draft vouchers; posting them is for someone else.')
  const draft = await createJournal(body, req.auth, req)
  res.status(201).json({ data: body.post ? await postJournal(draft.id, req.auth, req) : draft })
})
router.patch('/journals/:id', requirePermission('finance.journals.create'), async (req, res) => { res.json({ data: await updateJournal(id(req), journalBody.partial().parse(req.body), req.auth, req) }) })
router.delete('/journals/:id', requirePermission('finance.journals.create'), async (req, res) => { res.json({ data: await discardJournal(id(req), req) }) })
router.post('/journals/:id/post', requirePermission('finance.journals.post'), async (req, res) => { res.json({ data: await postJournal(id(req), req.auth, req) }) })
router.post('/journals/:id/reverse', requirePermission('finance.journals.reverse'), async (req, res) => {
  res.json({ data: await reverseJournal(id(req), z.object({ date: ymd.optional(), reason }).parse(req.body ?? {}), req.auth, req) })
})
/** Post whatever a period's fee receipts, refunds, payroll and expenses should have posted. Safe to re-run. */
router.post('/postings/rebuild', requirePermission('finance.journals.post'), async (req, res) => {
  const q = range.refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 864e5 <= 400, { message: 'At most about a year at a time', path: ['to'] }).parse(req.body ?? {})
  res.json({ data: await rebuildPostings(q, req) })
})

// ───────────────────────────────────────────────────────── expenses

const expenseBody = z.object({
  date: ymd, accountId: objectId,
  payee: z.object({ type: z.enum(['SUPPLIER', 'EMPLOYEE', 'OTHER']).default('SUPPLIER'), name: z.string().trim().min(2, 'Who is paid').max(120), employeeId: objectId.optional(), gstin: optionalText(15) }),
  description: z.string().trim().min(3, 'Say what it is for').max(500), billNo: optionalText(40),
  amount: paise.refine((n) => n > 0, 'Enter the amount'),
  tds: z.object({ section: z.enum(TDS_SECTIONS.map((t) => t.value)).optional(), pct: z.coerce.number().min(0).max(30).optional(), amount: paise.default(0) }).optional(),
})
router.get('/expenses/heads', requirePermission('finance.expenses.view', 'finance.expenses.create'), async (req, res) => { res.json({ data: await expenseHeads() }) })
router.get('/expenses', requirePermission('finance.expenses.view'), async (req, res) => {
  const q = z.object({ status: z.enum(Object.keys(EXPENSE_STATUSES)).optional(), accountId: objectId.optional(), from: ymd.optional(), to: ymd.optional(), search: optionalText(80) }).parse(req.query)
  res.json(await listExpenses(q, pageParams(req.query)))
})
router.get('/expenses/:id', requirePermission('finance.expenses.view'), async (req, res) => { res.json({ data: await getExpense(id(req)) }) })
router.post('/expenses', requirePermission('finance.expenses.create'), async (req, res) => { res.status(201).json({ data: await createExpense(expenseBody.parse(req.body), req.auth, req) }) })
router.patch('/expenses/:id', requirePermission('finance.expenses.create'), async (req, res) => { res.json({ data: await updateExpense(id(req), expenseBody.partial().parse(req.body), req.auth, req) }) })
router.post('/expenses/:id/decide', requirePermission('finance.expenses.approve'), async (req, res) => {
  res.json({ data: await decideExpense(id(req), z.object({ approve: z.boolean(), note: optionalText(300) }).parse(req.body), req.auth, req) })
})
router.post('/expenses/:id/pay', requirePermission('finance.expenses.pay'), async (req, res) => {
  const body = z.object({ date: ymd, mode: z.enum(EXPENSE_PAY_MODES.map((m) => m.value)), bankAccountId: objectId.optional(), reference: optionalText(60) }).parse(req.body)
  res.json({ data: await payExpense(id(req), body, req.auth, req) })
})
router.post('/expenses/:id/cancel', requirePermission('finance.expenses.create', 'finance.expenses.approve'), async (req, res) => {
  res.json({ data: await cancelExpense(id(req), z.object({ reason: optionalText(300) }).parse(req.body ?? {}), req.auth, req) })
})

// ───────────────────────────────────────────────────────── bank

const bankBody = z.object({ name: z.string().trim().min(2).max(80), bankName: optionalText(80), accountNoLast4: z.string().regex(/^\d{4}$/, 'Last four digits').optional().or(z.literal('').transform(() => undefined)), ifsc: optionalText(11), branch: optionalText(80), isDefault: z.boolean().optional(), active: z.boolean().optional() })
router.get('/bank/accounts', requirePermission('finance.bank.view'), async (req, res) => { res.json({ data: await listBankAccounts() }) })
router.post('/bank/accounts', requirePermission('finance.accounts.create'), async (req, res) => { res.status(201).json({ data: await saveBankAccount(null, bankBody.parse(req.body), req.auth, req) }) })
router.patch('/bank/accounts/:id', requirePermission('finance.accounts.edit'), async (req, res) => { res.json({ data: await saveBankAccount(id(req), bankBody.partial().parse(req.body), req.auth, req) }) })
router.get('/bank/accounts/:id/reconciliation', requirePermission('finance.bank.view'), async (req, res) => {
  const q = z.object({ status: z.enum(['UNRECONCILED', 'RECONCILED']).optional(), from: ymd.optional(), to: ymd.optional() }).parse(req.query)
  res.json({ data: await reconciliation(id(req), q, req.query.page ? pageParams(req.query) : undefined) })
})
router.post('/bank/accounts/:id/import', requirePermission('finance.bank.reconcile'), async (req, res) => {
  res.status(201).json({ data: await importStatement(id(req), z.object({ csv: z.string().min(10, 'The file is empty').max(900_000, 'The file is too large') }).parse(req.body), req.auth, req) })
})
router.post('/bank/accounts/:id/auto-match', requirePermission('finance.bank.reconcile'), async (req, res) => { res.json({ data: await autoMatch(id(req), req.auth, req) }) })
router.post('/bank/lines/:id/match', requirePermission('finance.bank.reconcile'), async (req, res) => {
  res.json({ data: await matchLine(id(req), z.object({ journalId: objectId, line: z.coerce.number().int().min(0).max(200) }).parse(req.body), req.auth, req) })
})
router.post('/bank/lines/:id/unmatch', requirePermission('finance.bank.reconcile'), async (req, res) => { res.json({ data: await unmatchLine(id(req), req.auth, req) }) })

// ───────────────────────────────────────────────────────── reports

router.get('/reports/trial-balance', requirePermission('finance.reports.view'), async (req, res) => { res.json({ data: await trialBalance(range.parse(req.query)) }) })
router.get('/reports/income-expenditure', requirePermission('finance.reports.view'), async (req, res) => { res.json({ data: await profitLoss(range.parse(req.query)) }) })
router.get('/reports/balance-sheet', requirePermission('finance.reports.view'), async (req, res) => { res.json({ data: await balanceSheet(z.object({ asOf: ymd }).parse(req.query)) }) })
router.get('/reports/day-book', requirePermission('finance.reports.view'), async (req, res) => {
  res.json({ data: await dayBook(range.and(z.object({ type: z.enum(VOUCHER_TYPES.map((t) => t.value)).optional() })).parse(req.query)) })
})
router.get('/reports/ledger', requirePermission('finance.reports.view'), async (req, res) => { res.json({ data: await accountLedger(range.and(z.object({ accountId: objectId })).parse(req.query)) }) })
router.get('/reports/:kind/export', requirePermission('finance.reports.export'), async (req, res) => {
  const kind = z.enum(['trial-balance', 'pnl', 'balance-sheet', 'day-book', 'ledger', 'tally']).parse(req.params.kind)
  if (kind === 'tally') {
    const r = await tallyExport(range.parse(req.query))
    return send(res, r.name, r.body, 'application/xml')
  }
  const q = kind === 'balance-sheet' ? z.object({ asOf: ymd }).parse(req.query) : range.and(z.object({ accountId: objectId.optional(), type: z.string().optional() })).parse(req.query)
  const r = await reportCsv(kind, q)
  send(res, `${r.name}.csv`, r.body)
})

export default router
