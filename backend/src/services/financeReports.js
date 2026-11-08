import { ACCOUNT_TYPE_LABEL, NORMAL_SIDE, VOUCHER_TYPE_BY, fyOf, fyRange } from '@schoolgiant/shared'
import { Account, Journal } from '../models/finance.js'
import { Tenant } from '../models/platform.js'
import { getContext } from '../platform/context.js'
import { clean, isOid, oid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { ensureChart, ledgerTotals, naturalBalance } from './finance.js'
import { toCsv } from './payrollExports.js'

// Accounts › Financial reports (ported from the hospital): trial balance, income & expenditure, balance sheet, day
// book and the ledger of one account (the cash book is the ledger of Cash in hand) — straight from posted vouchers,
// for a date range, each also as CSV — and the Tally export (ledgers and vouchers as Tally XML).

const addDaysYmd = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const sum = (rows, f = (x) => x) => rows.reduce((s, r) => s + (f(r) || 0), 0)
const ZERO = { debit: 0, credit: 0 }
const rupees = (p) => Math.round(p ?? 0) / 100
const dayBefore = (ymd) => addDaysYmd(ymd, -1)

async function chartWithParents() {
  await ensureChart()
  const accounts = await Account.find().sort({ code: 1 }).lean()
  const byId = new Map(accounts.map((a) => [String(a._id), a]))
  const groupOf = (a) => (a.parentId && byId.get(String(a.parentId))) || null
  return { accounts, byId, groupOf }
}

/** Opening (before `from`), movement within the range and closing, per ledger; Dr and Cr totals must agree. */
export async function trialBalance({ from, to }) {
  const { accounts, groupOf } = await chartWithParents()
  const opening = from ? await ledgerTotals({ to: dayBefore(from) }) : new Map()
  const period = await ledgerTotals({ from, to })
  const rows = accounts.filter((a) => !a.isGroup).map((a) => {
    const o = opening.get(String(a._id)) ?? ZERO
    const p = period.get(String(a._id)) ?? ZERO
    const open = o.debit - o.credit
    const close = open + p.debit - p.credit
    return {
      id: String(a._id), code: a.code, name: a.name, type: a.type, group: groupOf(a)?.name,
      openingDr: open > 0 ? open : 0, openingCr: open < 0 ? -open : 0, debit: p.debit, credit: p.credit,
      closingDr: close > 0 ? close : 0, closingCr: close < 0 ? -close : 0,
    }
  }).filter((r) => r.openingDr || r.openingCr || r.debit || r.credit)
  const totals = Object.fromEntries(['openingDr', 'openingCr', 'debit', 'credit', 'closingDr', 'closingCr'].map((k) => [k, sum(rows, (r) => r[k])]))
  return { from, to, rows, totals, balanced: totals.debit === totals.credit && totals.closingDr === totals.closingCr }
}

/** Income and expenses in the range, by group; the difference is the profit (or loss). */
export async function profitLoss({ from, to }) {
  const { accounts, groupOf } = await chartWithParents()
  const period = await ledgerTotals({ from, to })
  const section = (type) => {
    const rows = accounts.filter((a) => a.type === type && !a.isGroup).map((a) => ({ id: String(a._id), code: a.code, name: a.name, group: groupOf(a)?.name ?? ACCOUNT_TYPE_LABEL[type], amount: naturalBalance(type, period.get(String(a._id)) ?? ZERO) })).filter((r) => r.amount)
    const groups = []
    for (const r of rows) {
      let g = groups.find((x) => x.name === r.group)
      if (!g) { g = { name: r.group, rows: [], total: 0 }; groups.push(g) }
      g.rows.push(r)
      g.total += r.amount
    }
    return { groups, total: sum(rows, (r) => r.amount) }
  }
  const income = section('INCOME')
  const expenses = section('EXPENSE')
  return { from, to, income, expenses, profit: income.total - expenses.total }
}

/** Balances on a date: assets against liabilities, equity and the profit to date. */
export async function balanceSheet({ asOf }) {
  const { accounts, groupOf } = await chartWithParents()
  const totals = await ledgerTotals({ to: asOf })
  const section = (type) => {
    const rows = accounts.filter((a) => a.type === type && !a.isGroup).map((a) => ({ id: String(a._id), code: a.code, name: a.name, group: groupOf(a)?.name ?? ACCOUNT_TYPE_LABEL[type], amount: naturalBalance(type, totals.get(String(a._id)) ?? ZERO) })).filter((r) => r.amount)
    const groups = []
    for (const r of rows) {
      let g = groups.find((x) => x.name === r.group)
      if (!g) { g = { name: r.group, rows: [], total: 0 }; groups.push(g) }
      g.rows.push(r)
      g.total += r.amount
    }
    return { groups, total: sum(rows, (r) => r.amount) }
  }
  const pl = (type) => sum(accounts.filter((a) => a.type === type && !a.isGroup), (a) => naturalBalance(type, totals.get(String(a._id)) ?? ZERO))
  const profit = pl('INCOME') - pl('EXPENSE')
  const assets = section('ASSET')
  const liabilities = section('LIABILITY')
  const equity = section('EQUITY')
  equity.groups.push({ name: 'Income & expenditure to date', rows: [{ id: 'pl', code: '', name: 'Surplus / (deficit) to date', amount: profit }], total: profit })
  equity.total += profit
  return { asOf, assets, liabilities, equity, totals: { assets: assets.total, liabilitiesAndEquity: liabilities.total + equity.total }, balanced: assets.total === liabilities.total + equity.total }
}

/** Every posted voucher in the range, oldest first. */
export async function dayBook({ from, to, type }) {
  const f = { status: 'POSTED', date: { $gte: from, $lte: to } }
  if (type) f.type = type
  const rows = await Journal.find(f).sort({ date: 1, voucherNo: 1 }).limit(5000).lean()
  return { from, to, rows: clean(rows), totals: { vouchers: rows.length, amount: sum(rows, (r) => r.total) } }
}

/** One account (a group takes in its ledgers): opening, every entry with a running balance, closing. */
export async function accountLedger({ accountId, from, to }) {
  const { accounts, byId } = await chartWithParents()
  const acc = isOid(accountId) ? byId.get(String(accountId)) : null
  if (!acc) throw notFound('Account')
  const ids = new Set([String(acc._id)])
  let grew = true
  while (grew) { grew = false; for (const a of accounts) if (a.parentId && ids.has(String(a.parentId)) && !ids.has(String(a._id))) { ids.add(String(a._id)); grew = true } }
  const idList = [...ids].map(oid)
  const sign = NORMAL_SIDE[acc.type] === 'DR' ? 1 : -1
  const before = from ? await Journal.aggregate([
    { $match: { status: 'POSTED', date: { $lt: from }, 'lines.accountId': { $in: idList } } }, { $unwind: '$lines' }, { $match: { 'lines.accountId': { $in: idList } } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]) : []
  const opening = sign * ((before[0]?.debit ?? 0) - (before[0]?.credit ?? 0))
  const rows = await Journal.aggregate([
    { $match: { status: 'POSTED', date: { $gte: from, $lte: to }, 'lines.accountId': { $in: idList } } },
    { $sort: { date: 1, voucherNo: 1 } },
    { $limit: 5000 },
  ])
  let balance = opening
  const entries = []
  for (const j of rows) {
    for (const [i, l] of j.lines.entries()) {
      if (!ids.has(String(l.accountId))) continue
      balance += sign * (l.debit - l.credit)
      const other = j.lines.filter((x) => !ids.has(String(x.accountId)) && (l.debit ? x.credit : x.debit)).map((x) => x.accountName)
      entries.push({ journalId: String(j._id), line: i, date: j.date, voucherNo: j.voucherNo, type: j.type, narration: j.narration, account: ids.size > 1 ? l.accountName : undefined, against: [...new Set(other)].slice(0, 2).join(', '), party: l.party?.name, debit: l.debit, credit: l.credit, balance, source: j.source?.type })
    }
  }
  return {
    account: { id: String(acc._id), code: acc.code, name: acc.name, type: acc.type, isGroup: acc.isGroup, normal: NORMAL_SIDE[acc.type] },
    from, to, opening, entries, closing: balance, totals: { debit: sum(entries, (e) => e.debit), credit: sum(entries, (e) => e.credit) },
  }
}

export async function reportCsv(kind, q) {
  if (kind === 'trial-balance') {
    const r = await trialBalance(q)
    return { name: `trial-balance-${q.from}-to-${q.to}`, body: toCsv([
      ['Code', 'Account', 'Type', 'Group', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'],
      ...r.rows.map((x) => [x.code, x.name, ACCOUNT_TYPE_LABEL[x.type], x.group, rupees(x.openingDr), rupees(x.openingCr), rupees(x.debit), rupees(x.credit), rupees(x.closingDr), rupees(x.closingCr)]),
      ['', 'Total', '', '', rupees(r.totals.openingDr), rupees(r.totals.openingCr), rupees(r.totals.debit), rupees(r.totals.credit), rupees(r.totals.closingDr), rupees(r.totals.closingCr)],
    ]) }
  }
  if (kind === 'pnl') {
    const r = await profitLoss(q)
    const part = (title, s) => [[title, '', ''], ...s.groups.flatMap((g) => [...g.rows.map((x) => [x.code, x.name, rupees(x.amount)]), ['', `Total ${g.name}`, rupees(g.total)]]), ['', `Total ${title.toLowerCase()}`, rupees(s.total)]]
    return { name: `income-and-expenditure-${q.from}-to-${q.to}`, body: toCsv([['Code', 'Account', 'Amount'], ...part('Income', r.income), ...part('Expenditure', r.expenses), ['', r.profit >= 0 ? 'Surplus' : 'Deficit', rupees(r.profit)]]) }
  }
  if (kind === 'balance-sheet') {
    const r = await balanceSheet(q)
    const part = (title, s) => [[title, '', ''], ...s.groups.flatMap((g) => [...g.rows.map((x) => [x.code, x.name, rupees(x.amount)]), ['', `Total ${g.name}`, rupees(g.total)]]), ['', `Total ${title.toLowerCase()}`, rupees(s.total)]]
    return { name: `balance-sheet-${q.asOf}`, body: toCsv([['Code', 'Account', 'Amount'], ...part('Assets', r.assets), ...part('Liabilities', r.liabilities), ...part('Funds & reserves', r.equity)]) }
  }
  if (kind === 'day-book') {
    const r = await dayBook(q)
    return { name: `day-book-${q.from}-to-${q.to}`, body: toCsv([
      ['Date', 'Voucher', 'Type', 'Narration', 'Account', 'Party', 'Debit', 'Credit'],
      ...r.rows.flatMap((j) => j.lines.map((l) => [j.date, j.voucherNo, VOUCHER_TYPE_BY[j.type]?.label ?? j.type, j.narration, `${l.accountCode} ${l.accountName}`, l.party?.name, rupees(l.debit), rupees(l.credit)])),
    ]) }
  }
  if (kind === 'ledger') {
    const r = await accountLedger(q)
    return { name: `ledger-${r.account.code}-${q.from}-to-${q.to}`, body: toCsv([
      ['Date', 'Voucher', 'Narration', 'Against', 'Party', 'Debit', 'Credit', 'Balance'],
      [q.from, '', 'Opening balance', '', '', '', '', rupees(r.opening)],
      ...r.entries.map((e) => [e.date, e.voucherNo, e.narration, e.against, e.party, rupees(e.debit), rupees(e.credit), rupees(e.balance)]),
      [q.to, '', 'Closing balance', '', '', rupees(r.totals.debit), rupees(r.totals.credit), rupees(r.closing)],
    ]) }
  }
  throw notFound('Report')
}

// ───────────────────────────────────────────────────────── Tally export

const xml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const tallyAmount = (p) => (Math.round(p) / 100).toFixed(2)
/** Our sections → Tally's primary groups. */
const TALLY_GROUP = { ASSET: 'Current Assets', LIABILITY: 'Current Liabilities', EQUITY: 'Capital Account', INCOME: 'Indirect Incomes', EXPENSE: 'Indirect Expenses' }
const TALLY_VOUCHER = { JOURNAL: 'Journal', RECEIPT: 'Receipt', PAYMENT: 'Payment', CONTRA: 'Contra' }

/**
 * Ledgers and the posted vouchers of a period as a Tally XML import (Gateway of Tally › Import Data › Vouchers).
 * A debit goes in as a negative amount marked “deemed positive”, the way Tally writes it. Cash and bank ledgers go
 * under Cash-in-Hand / Bank Accounts, fixed assets under Fixed Assets; the rest by section.
 */
export async function tallyExport({ from, to }) {
  await ensureChart()
  const [accounts, rows, tenant] = await Promise.all([
    Account.find({ isGroup: false }).sort({ code: 1 }).lean(),
    Journal.find({ status: 'POSTED', date: { $gte: from, $lte: to } }).sort({ date: 1, voucherNo: 1 }).limit(20000).lean(),
    Tenant.findById(getContext()?.tenantId).select('name').lean(),
  ])
  const all = await Account.find().select('systemKey parentId').lean()
  const keyOf = new Map(all.map((a) => [String(a._id), a.systemKey]))
  const parentKey = (a) => keyOf.get(String(a.parentId))
  const groupOf = (a) => (a.systemKey === 'CASH' ? 'Cash-in-Hand' : a.cashBank ? 'Bank Accounts' : parentKey(a) === 'G_FIXED_ASSETS' ? 'Fixed Assets' : TALLY_GROUP[a.type])
  const ledgerName = (a) => `${a.name} (${a.code})`
  const byId = new Map(accounts.map((a) => [String(a._id), a]))
  const masters = accounts.map((a) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(ledgerName(a))}" ACTION="Create"><NAME.LIST><NAME>${xml(ledgerName(a))}</NAME></NAME.LIST><PARENT>${xml(groupOf(a))}</PARENT><ISBILLWISEON>No</ISBILLWISEON></LEDGER></TALLYMESSAGE>`)
  const vouchers = rows.map((j) => {
    const entries = j.lines.map((l) => {
      const a = byId.get(String(l.accountId))
      const name = a ? ledgerName(a) : `${l.accountName} (${l.accountCode})`
      const debit = l.debit > 0
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? '-' : ''}${tallyAmount(debit ? l.debit : l.credit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
    }).join('')
    const type = TALLY_VOUCHER[j.type] ?? 'Journal'
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${j.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(j.voucherNo)}</VOUCHERNUMBER><NARRATION>${xml(j.narration)}</NARRATION>${entries}</VOUCHER></TALLYMESSAGE>`
  })
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(tenant?.name)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n${[...masters, ...vouchers].join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`
  return { name: `tally-${from}-to-${to}.xml`, body, vouchers: rows.length, ledgers: accounts.length }
}

/** The Accounts landing view: money in hand and at the bank, this year's and month's income and expenditure. */
export async function financeSummary({ today }) {
  await ensureChart()
  const fy = fyRange(fyOf(today))
  const month = { from: `${today.slice(0, 7)}-01`, to: today }
  const [accounts, all, year, now] = await Promise.all([Account.find({ isGroup: false }).lean(), ledgerTotals(), ledgerTotals(fy), ledgerTotals(month)])
  const total = (map, type) => accounts.filter((a) => a.type === type).reduce((s, a) => s + naturalBalance(type, map.get(String(a._id)) ?? { debit: 0, credit: 0 }), 0)
  return {
    fy: fyOf(today),
    money: accounts.filter((a) => a.cashBank).map((a) => ({ id: String(a._id), code: a.code, name: a.name, balance: naturalBalance('ASSET', all.get(String(a._id)) ?? { debit: 0, credit: 0 }) })),
    year: { income: total(year, 'INCOME'), expenditure: total(year, 'EXPENSE') },
    month: { income: total(now, 'INCOME'), expenditure: total(now, 'EXPENSE') },
    drafts: await Journal.countDocuments({ status: 'DRAFT' }),
  }
}
