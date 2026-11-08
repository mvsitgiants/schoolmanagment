import { createHash } from 'node:crypto'
import { formatINR } from '@schoolgiant/shared'
import { Account, BankAccount, BankLine, Journal } from '../models/finance.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { listResponse } from '../platform/validate.js'
import { ensureChart, ledgerTotals } from './finance.js'

// Accounts › Bank (ported from the hospital): bank accounts (each with its own ledger), statement import (any Indian
// bank's CSV — the columns are found by their headings), and reconciliation: statement lines matched to the book
// entries on that bank's ledger, by hand or automatically (same amount within a few days, a reference that agrees).

const sum = (rows, f = (x) => x) => rows.reduce((s, r) => s + (f(r) || 0), 0)
const stamp = (auth) => ({ by: auth.user?.name, byId: isOid(auth.userId) ? auth.userId : undefined, at: new Date() })
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)

// ───────────────────────────────────────────────────────── bank

export async function listBankAccounts() {
  await ensureChart()
  const banks = await BankAccount.find().sort({ isDefault: -1, name: 1 }).lean()
  const totals = await ledgerTotals()
  const unrec = await BankLine.aggregate([{ $match: { status: 'UNRECONCILED' } }, { $group: { _id: '$bankAccountId', n: { $sum: 1 } } }])
  const accs = new Map((await Account.find({ _id: { $in: banks.map((b) => b.accountId) } }).lean()).map((a) => [String(a._id), a]))
  return banks.map((b) => {
    const t = totals.get(String(b.accountId)) ?? { debit: 0, credit: 0 }
    return { ...clean(b), ledger: accs.get(String(b.accountId)) && { code: accs.get(String(b.accountId)).code, name: accs.get(String(b.accountId)).name }, bookBalance: t.debit - t.credit, unreconciled: unrec.find((u) => String(u._id) === String(b._id))?.n ?? 0 }
  })
}

/** A new bank account gets its own ledger under Bank accounts. */
export async function saveBankAccount(id, input, auth, req) {
  await ensureChart()
  let bank
  if (id) {
    bank = await BankAccount.findById(id)
    if (!bank) throw notFound('Bank account')
    for (const k of ['name', 'bankName', 'accountNoLast4', 'ifsc', 'branch', 'active']) if (input[k] !== undefined) bank[k] = input[k]
    if (input.name) await Account.updateOne({ _id: bank.accountId }, { $set: { name: input.name } })
  } else {
    const group = await Account.findOne({ systemKey: 'G_BANK' }).lean()
    const siblings = await Account.find({ parentId: group._id }).select('code').lean()
    const next = String(Math.max(Number(group.code), ...siblings.map((s) => Number(s.code) || 0)) + 1)
    const ledger = await Account.create({ code: next, name: input.name, type: 'ASSET', parentId: group._id, cashBank: true, createdBy: auth.user?.name })
    bank = new BankAccount({ ...input, accountId: ledger._id })
  }
  if (input.isDefault) { await BankAccount.updateMany({ _id: { $ne: bank._id } }, { $set: { isDefault: false } }); bank.isDefault = true }
  await bank.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'finance', entityType: 'bank_account', entityId: String(bank._id), entityName: bank.name, summary: `${id ? 'Changed' : 'Added'} bank account ${bank.name}${bank.accountNoLast4 ? ` (…${bank.accountNoLast4})` : ''}` }, req)
  return clean(bank.toObject())
}

// CSV: a minimal RFC 4180 reader (quotes, commas and newlines inside quotes).
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function parseDate(s) {
  const t = String(s ?? '').trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/) // Indian banks: day first
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[\s/-]([A-Za-z]{3})[a-z]*[\s/-](\d{2}|\d{4})$/)
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}
const toPaise = (s) => {
  const t = String(s ?? '').replace(/[₹,\s]|INR|Rs\.?/gi, '')
  if (!t || t === '-') return 0
  const n = Number(t.replace(/^\((.*)\)$/, '-$1'))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

/** Columns found by their headings: date, narration, reference, withdrawal / deposit (or amount + Dr/Cr), balance. */
function columnsOf(head) {
  const h = head.map((x) => x.trim().toLowerCase())
  const find = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)))
  return {
    date: find(/date/, /value/) >= 0 ? find(/date/, /value/) : find(/date/),
    description: find(/narration|description|particular|details|remarks/),
    reference: find(/ref|chq|cheque|utr|instrument/),
    withdrawal: find(/withdraw|debit|^dr\b|paid out/),
    deposit: find(/deposit|credit|^cr\b|paid in/),
    amount: find(/^amount|amount \(/),
    drcr: find(/dr\s*\/\s*cr|^type$|cr\/dr/),
    balance: find(/balance/),
  }
}

/** Import a statement CSV. Lines already imported (same date, amount, reference, narration) are skipped. */
export async function importStatement(bankId, { csv }, auth, req) {
  const bank = await BankAccount.findById(bankId)
  if (!bank) throw notFound('Bank account')
  const rows = parseCsv(String(csv ?? '').replace(/^﻿/, ''))
  const headAt = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /balance|amount|withdraw|deposit|debit|credit/i.test(c)))
  if (headAt < 0) throw badRequest('Could not find the heading row (Date, Narration, Withdrawal, Deposit, Balance).')
  const col = columnsOf(rows[headAt])
  if (col.date < 0 || (col.amount < 0 && (col.withdrawal < 0 || col.deposit < 0))) throw badRequest('The file needs a date column and either withdrawal and deposit columns or an amount column.')
  const importId = `${Date.now().toString(36)}`
  const errors = []
  const seen = new Map()
  const docs = []
  const { tenantId } = getContext()
  for (const [i, r] of rows.slice(headAt + 1).entries()) {
    if (docs.length >= 5000) break
    const date = parseDate(r[col.date])
    if (!date) { if (r[col.date]?.trim()) errors.push({ row: headAt + i + 2, message: `Unreadable date “${r[col.date]}”` }); continue }
    let deposit = 0
    let withdrawal = 0
    if (col.withdrawal >= 0 && col.deposit >= 0) { withdrawal = toPaise(r[col.withdrawal]); deposit = toPaise(r[col.deposit]) } else {
      const amt = toPaise(r[col.amount])
      const dr = col.drcr >= 0 ? /^d/i.test(String(r[col.drcr]).trim()) : amt < 0
      if (dr) withdrawal = Math.abs(amt); else deposit = Math.abs(amt)
    }
    if (!Number.isFinite(deposit) || !Number.isFinite(withdrawal) || deposit < 0 || withdrawal < 0) { errors.push({ row: headAt + i + 2, message: 'Unreadable amount' }); continue }
    if (!deposit && !withdrawal) continue
    const description = (col.description >= 0 ? r[col.description] : '').trim().slice(0, 300)
    const reference = (col.reference >= 0 ? r[col.reference] : '').trim().slice(0, 80)
    const balance = col.balance >= 0 ? toPaise(r[col.balance]) : undefined
    const base = `${date}|${deposit}|${withdrawal}|${reference}|${description}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    docs.push({ tenantId, bankAccountId: bank._id, importId, date, description, reference: reference || undefined, deposit, withdrawal, balance: Number.isFinite(balance) ? balance : undefined, fingerprint: createHash('sha1').update(`${base}#${n}`).digest('hex') })
  }
  if (!docs.length) throw badRequest(errors.length ? `Nothing could be read: ${errors[0].message} (row ${errors[0].row}).` : 'The file has no statement lines.')
  const known = new Set((await BankLine.find({ bankAccountId: bank._id, fingerprint: { $in: docs.map((d) => d.fingerprint) } }).select('fingerprint').lean()).map((x) => x.fingerprint))
  const fresh = docs.filter((d) => !known.has(d.fingerprint))
  if (fresh.length) await BankLine.insertMany(fresh, { ordered: false })
  const last = docs.filter((d) => d.balance !== undefined).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  if (last && (!bank.statementDate || last.date >= bank.statementDate)) { bank.statementBalance = last.balance; bank.statementDate = last.date; await bank.save() }
  const matched = fresh.length ? (await autoMatch(bank._id, auth)).matched : 0
  await audit({ action: 'IMPORT', module: 'finance', entityType: 'bank_statement', entityId: String(bank._id), entityName: bank.name, summary: `Imported ${fresh.length} statement line(s) into ${bank.name}${docs.length - fresh.length ? ` (${docs.length - fresh.length} already there)` : ''}; ${matched} matched automatically` }, req)
  return { imported: fresh.length, duplicates: docs.length - fresh.length, matched, errors: errors.slice(0, 20) }
}

/** Posted entries on a bank's ledger, one per voucher line, with whether a statement line matches them. */
async function bookEntries(bank, { from, to, unmatchedOnly } = {}) {
  const match = { status: 'POSTED', 'lines.accountId': bank.accountId }
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const rows = await Journal.aggregate([
    { $match: match },
    { $unwind: { path: '$lines', includeArrayIndex: 'line' } },
    { $match: { 'lines.accountId': bank.accountId } },
    { $project: { voucherNo: 1, date: 1, narration: 1, reference: 1, type: 1, line: 1, debit: '$lines.debit', credit: '$lines.credit', source: 1 } },
    { $sort: { date: 1, voucherNo: 1 } },
  ])
  const matched = new Set((await BankLine.find({ bankAccountId: bank._id, 'match.journalId': { $ne: null } }).select('match').lean()).map((l) => `${l.match.journalId}:${l.match.line}`))
  const out = rows.map((r) => ({ journalId: String(r._id), line: r.line, voucherNo: r.voucherNo, date: r.date, narration: r.narration, reference: r.reference, type: r.type, debit: r.debit, credit: r.credit, source: r.source?.type, matched: matched.has(`${r._id}:${r.line}`) }))
  return unmatchedOnly ? out.filter((r) => !r.matched) : out
}

async function findBank(id) {
  const bank = isOid(id) ? await BankAccount.findById(id).lean() : null
  if (!bank) throw notFound('Bank account')
  return bank
}

/**
 * The reconciliation screen: statement lines, unmatched book entries and suggested pairs. With `paging`
 * the statement lines are one page of the whole filtered statement (plus `linesMeta` and the filter's
 * withdrawal / deposit totals); without it, the first 2,000 lines.
 */
export async function reconciliation(bankId, { status, from, to } = {}, paging) {
  const bank = await findBank(bankId)
  const { matchWindowDays } = await getSettings('finance')
  const f = { bankAccountId: bank._id }
  if (status) f.status = status
  if (from || to) f.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const [lines, lineCount, lineSums] = await Promise.all([
    BankLine.find(f).sort({ date: 1, createdAt: 1, _id: 1 }).skip(paging?.skip ?? 0).limit(paging?.pageSize ?? 2000).lean(),
    paging ? BankLine.countDocuments(f) : null,
    paging ? BankLine.aggregate([{ $match: f }, { $group: { _id: null, withdrawal: { $sum: '$withdrawal' }, deposit: { $sum: '$deposit' } } }]) : null,
  ])
  const book = await bookEntries(bank, { unmatchedOnly: true })
  const suggest = (l) => book.filter((b) => (l.deposit ? b.debit === l.deposit : b.credit === l.withdrawal) && daysBetween(b.date < l.date ? b.date : l.date, b.date < l.date ? l.date : b.date) <= matchWindowDays)
    .slice(0, 3).map((b) => ({ journalId: b.journalId, line: b.line, voucherNo: b.voucherNo, date: b.date, narration: b.narration }))
  const totals = await ledgerTotals()
  const t = totals.get(String(bank.accountId)) ?? { debit: 0, credit: 0 }
  const unrec = await BankLine.find({ bankAccountId: bank._id, status: 'UNRECONCILED' }).select('deposit withdrawal').lean()
  return {
    bank: clean(bank),
    summary: {
      bookBalance: t.debit - t.credit, statementBalance: bank.statementBalance ?? null, statementDate: bank.statementDate ?? null,
      statementUnreconciled: { count: unrec.length, deposits: sum(unrec, (x) => x.deposit), withdrawals: sum(unrec, (x) => x.withdrawal) },
      bookUnreconciled: { count: book.length, debits: sum(book, (x) => x.debit), credits: sum(book, (x) => x.credit) },
    },
    lines: clean(lines).map((l) => ({ ...l, suggestions: l.status === 'UNRECONCILED' ? suggest(l) : [] })),
    book,
    ...(paging && {
      linesMeta: listResponse([], lineCount, paging).meta,
      lineTotals: { withdrawal: lineSums[0]?.withdrawal ?? 0, deposit: lineSums[0]?.deposit ?? 0 },
    }),
  }
}

export async function matchLine(lineId, { journalId, line }, auth, req) {
  const l = isOid(lineId) ? await BankLine.findById(lineId) : null
  if (!l) throw notFound('Statement line')
  if (l.status === 'RECONCILED') throw conflict('This statement line is already matched. Unmatch it first.')
  const bank = await findBank(l.bankAccountId)
  const j = isOid(journalId) ? await Journal.findById(journalId).lean() : null
  const jl = j?.lines?.[line]
  if (!j || j.status !== 'POSTED' || !jl) throw notFound('Book entry')
  if (String(jl.accountId) !== String(bank.accountId)) throw badRequest('That entry is not on this bank account’s ledger.')
  if (l.deposit ? jl.debit !== l.deposit : jl.credit !== l.withdrawal) throw badRequest('The amounts differ: a deposit matches a debit to the bank of the same amount, a withdrawal a credit.')
  l.status = 'RECONCILED'
  l.match = { journalId: j._id, line, voucherNo: j.voucherNo, date: j.date, ...stamp(auth) }
  try { await l.save() } catch (err) { if (err?.code === 11000) throw conflict('That book entry is already matched to another statement line.'); throw err }
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'bank_line', entityId: String(l._id), entityName: bank.name, summary: `Matched the ${l.date} statement line (${formatINR(l.deposit || l.withdrawal, { decimals: 2 })}) with ${j.voucherNo}` }, req)
  return clean(l.toObject())
}

export async function unmatchLine(lineId, auth, req) {
  const l = isOid(lineId) ? await BankLine.findById(lineId) : null
  if (!l) throw notFound('Statement line')
  if (l.status !== 'RECONCILED') throw conflict('This line is not matched.')
  const was = l.match?.voucherNo
  l.status = 'UNRECONCILED'
  l.match = undefined
  await l.save()
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'bank_line', entityId: String(l._id), entityName: was, summary: `Unmatched the ${l.date} statement line from ${was}` }, req)
  return clean(l.toObject())
}

/** Match every statement line that has exactly one book entry of the same amount within the window. */
export async function autoMatch(bankId, auth, req) {
  const bank = await findBank(bankId)
  const { matchWindowDays } = await getSettings('finance')
  const lines = await BankLine.find({ bankAccountId: bank._id, status: 'UNRECONCILED' }).sort({ date: 1 })
  const book = await bookEntries(bank, { unmatchedOnly: true })
  const taken = new Set()
  let matched = 0
  for (const l of lines) {
    const near = book.filter((b) => !taken.has(`${b.journalId}:${b.line}`) && (l.deposit ? b.debit === l.deposit : b.credit === l.withdrawal) && daysBetween(b.date < l.date ? b.date : l.date, b.date < l.date ? l.date : b.date) <= matchWindowDays)
    const exact = near.filter((b) => b.reference && l.reference && (l.reference.includes(b.reference) || b.reference.includes(l.reference)))
    const pick = exact.length === 1 ? exact[0] : near.length === 1 ? near[0] : null
    if (!pick) continue
    taken.add(`${pick.journalId}:${pick.line}`)
    l.status = 'RECONCILED'
    l.match = { journalId: pick.journalId, line: pick.line, voucherNo: pick.voucherNo, date: pick.date, ...stamp(auth), by: `${auth.user?.name ?? 'System'} (auto)` }
    try { await l.save(); matched++ } catch (err) { if (err?.code !== 11000) throw err }
  }
  if (req) await audit({ action: 'UPDATE', module: 'finance', entityType: 'bank_statement', entityId: String(bank._id), entityName: bank.name, summary: `Auto-matched ${matched} statement line(s) in ${bank.name}` }, req)
  return { matched }
}
