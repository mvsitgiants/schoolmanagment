import {
  ACCOUNT_TYPES, CASH_MODES, NORMAL_SIDE, POSTING_SOURCES, STARTER_ACCOUNTS, VOUCHER_TYPE_BY, fyOf, formatINR,
} from '@schoolgiant/shared'
import { Account, BankAccount, BankLine, Journal } from '../models/finance.js'
import { audit } from '../platform/audit.js'
import { clean, isOid, oid, withTransaction } from '../platform/db.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'
import { nextNumber } from '../platform/numbering.js'
import { institutionNow } from '../platform/time.js'
import { escapeRegex, listResponse } from '../platform/validate.js'

// Accounts — the ledger engine (ported from the hospital). Every voucher, typed by hand or posted by a
// business event, goes through postEntry()/postJournal(): the lines must balance (Σ debit =
// Σ credit, both > 0), only ledger accounts (not groups) take entries, and a posted voucher
// is never edited or deleted — it is undone by a reversal that mirrors its lines.

const sum = (rows, f = (x) => x) => rows.reduce((s, r) => s + (f(r) || 0), 0)
const stamp = (auth) => ({ by: auth?.user?.name ?? 'System', byId: auth?.userId && isOid(auth.userId) ? auth.userId : undefined, at: new Date() })
export const AUTO_BY = 'Auto-posting'

// ───────────────────────────────────────────────────────── chart of accounts

/** The starter chart (and the main bank account) for an institution that has none yet. Safe to call often. */
export async function ensureChart() {
  if (await Account.exists({ systemKey: 'INC_TUITION' }) && await BankAccount.exists({})) return
  const byCode = new Map((await Account.find().lean()).map((a) => [a.code, a]))
  const keys = new Set([...byCode.values()].map((a) => a.systemKey).filter(Boolean))
  for (const s of STARTER_ACCOUNTS) {
    if (byCode.has(s.code) || (s.key && keys.has(s.key))) continue
    const parent = s.parent ? byCode.get(s.parent) : null
    try {
      const [doc] = await Account.create([{ code: s.code, name: s.name, type: s.type, parentId: parent?._id, isGroup: !!s.group, systemKey: s.key, cashBank: !!s.cashBank, expenseHead: !!s.expense, description: s.hint, createdBy: 'Starter chart' }])
      byCode.set(s.code, doc.toObject())
    } catch (err) {
      if (err?.code !== 11000) throw err // another request made it meanwhile
      byCode.set(s.code, await Account.findOne({ code: s.code }).lean())
    }
  }
  if (!await BankAccount.exists({})) {
    const bank = await Account.findOne({ systemKey: 'BANK' }).lean()
    if (bank) await BankAccount.create([{ name: bank.name, accountId: bank._id, isDefault: true }]).catch((err) => { if (err?.code !== 11000) throw err })
  }
}

/** Accounts by system key and id, read once per batch of postings. */
export async function loadChart() {
  await ensureChart()
  const accounts = await Account.find().lean()
  const banks = await BankAccount.find({ active: true }).lean()
  const byKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey, a]))
  const byId = new Map(accounts.map((a) => [String(a._id), a]))
  const defaultBank = banks.find((b) => b.isDefault) ?? banks[0]
  return { byKey, byId, banks, defaultBank, seen: null }
}

/** The ledger money in a payment mode lands in: cash in hand, a chosen bank account, or the default bank. */
export function moneyLedger(chart, mode, bankAccountId) {
  if (CASH_MODES.includes(mode)) return chart.byKey.get('CASH')
  const bank = bankAccountId ? chart.banks.find((b) => String(b._id) === String(bankAccountId)) : chart.defaultBank
  return (bank && chart.byId.get(String(bank.accountId))) ?? chart.byKey.get('BANK')
}

function rollUp(accounts, own) {
  const kids = new Map()
  for (const a of accounts) if (a.parentId) kids.set(String(a.parentId), [...(kids.get(String(a.parentId)) ?? []), a])
  const memo = new Map()
  const total = (a) => {
    const id = String(a._id)
    if (memo.has(id)) return memo.get(id)
    const o = own.get(id) ?? { debit: 0, credit: 0 }
    const t = { debit: o.debit, credit: o.credit }
    for (const k of kids.get(id) ?? []) { const c = total(k); t.debit += c.debit; t.credit += c.credit }
    memo.set(id, t)
    return t
  }
  return { total, kids }
}

/** Debit and credit totals of posted lines per account, optionally within dates. */
export async function ledgerTotals({ from, to } = {}) {
  const match = { status: 'POSTED' }
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const rows = await Journal.aggregate([
    { $match: match }, { $unwind: '$lines' },
    { $group: { _id: '$lines.accountId', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' }, n: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [String(r._id), { debit: r.debit, credit: r.credit, n: r.n }]))
}

/** Signed balance in the account's natural direction (assets/expenses: Dr − Cr). */
export const naturalBalance = (type, t) => (NORMAL_SIDE[type] === 'DR' ? t.debit - t.credit : t.credit - t.debit)

/** The chart as a flat, ordered tree with each account's balance (groups roll up their children). */
export async function listAccounts({ includeInactive = true } = {}) {
  await ensureChart()
  const accounts = await Account.find(includeInactive ? {} : { active: true }).sort({ code: 1 }).lean()
  const own = await ledgerTotals()
  const { total, kids } = rollUp(accounts, own)
  const out = []
  const walk = (a, depth) => {
    const t = total(a)
    out.push({ ...clean(a), depth, debit: t.debit, credit: t.credit, balance: naturalBalance(a.type, t), entries: own.get(String(a._id))?.n ?? 0, children: (kids.get(String(a._id)) ?? []).length })
    for (const k of (kids.get(String(a._id)) ?? []).sort((x, y) => x.code.localeCompare(y.code))) walk(k, depth + 1)
  }
  for (const root of accounts.filter((a) => !a.parentId || !accounts.some((p) => String(p._id) === String(a.parentId)))) walk(root, 0)
  return out
}

async function descendants(id) {
  const all = await Account.find().select('parentId').lean()
  const out = new Set()
  const add = (pid) => { for (const a of all.filter((x) => String(x.parentId) === String(pid))) { out.add(String(a._id)); add(a._id) } }
  add(id)
  return out
}

export async function saveAccount(id, input, auth, req) {
  await ensureChart()
  const doc = id ? await Account.findById(id) : new Account()
  if (!doc) throw notFound('Account')
  const fields = {}
  if (input.code !== undefined && input.code !== doc.code && await Account.exists({ code: input.code, _id: { $ne: doc._id } })) fields.code = 'Another account has this code'
  let parent = null
  if (input.parentId !== undefined) {
    parent = input.parentId ? await Account.findById(input.parentId).lean() : null
    if (input.parentId && !parent) fields.parentId = 'Unknown group'
    else if (parent && !parent.isGroup) fields.parentId = 'Pick a group, not a ledger'
    else if (parent && id && (String(parent._id) === String(doc._id) || (await descendants(doc._id)).has(String(parent._id)))) fields.parentId = 'An account cannot sit under itself'
  } else if (!id) fields.parentId = 'Pick the group it belongs to'
  const type = parent?.type ?? input.type ?? doc.type
  if (!ACCOUNT_TYPES.some((t) => t.value === type)) fields.type = 'Pick a type'
  if (id && doc.systemKey && type !== doc.type) fields.parentId = 'A system account stays in its own section'
  if (input.isGroup !== undefined && id && input.isGroup !== doc.isGroup) {
    if (input.isGroup && await Journal.exists({ 'lines.accountId': doc._id })) fields.isGroup = 'It has entries; it stays a ledger'
    if (!input.isGroup && await Account.exists({ parentId: doc._id })) fields.isGroup = 'It holds other accounts'
    if (doc.systemKey) fields.isGroup = 'A system account keeps its kind'
  }
  if (input.cashBank && (input.isGroup ?? doc.isGroup)) fields.cashBank = 'Only a ledger can be cash or bank'
  if (Object.keys(fields).length) throw badRequest('Check the highlighted fields.', { fields })
  const before = id ? doc.toObject() : null
  for (const k of ['code', 'name', 'description', 'active', 'isGroup', 'cashBank', 'expenseHead']) if (input[k] !== undefined) doc[k] = input[k]
  if (input.parentId !== undefined) doc.parentId = parent?._id ?? null
  doc.type = type
  if (!id) doc.createdBy = auth.user?.name
  if (doc.systemKey && doc.active === false) throw badRequest('Auto-posting uses this account; it can’t be switched off.')
  await doc.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'finance', entityType: 'account', entityId: String(doc._id), entityName: `${doc.code} ${doc.name}`, summary: `${id ? 'Changed' : 'Added'} account ${doc.code} · ${doc.name}${before && before.name !== doc.name ? ` (was ${before.name})` : ''}` }, req)
  return clean(doc.toObject())
}

export async function deleteAccount(id, req) {
  const doc = await Account.findById(id)
  if (!doc) throw notFound('Account')
  if (doc.systemKey) throw conflict('This is a system account that auto-posting uses. Rename it if you like, but it stays.')
  if (await Account.exists({ parentId: doc._id })) throw conflict('Move or delete the accounts under this group first.')
  if (await Journal.exists({ 'lines.accountId': doc._id })) throw conflict('This account has entries. Switch it off instead.')
  if (await BankAccount.exists({ accountId: doc._id })) throw conflict('A bank account uses this ledger.')
  await doc.deleteOne()
  await audit({ action: 'DELETE', module: 'finance', entityType: 'account', entityId: String(doc._id), entityName: `${doc.code} ${doc.name}`, summary: `Deleted account ${doc.code} · ${doc.name}` }, req)
  return { id }
}

// ───────────────────────────────────────────────────────── the posting engine

/**
 * Lines in → checked lines out. Each input line is `{ account, amount }` with amount > 0 a
 * debit and < 0 a credit, or `{ account, debit, credit }`. Zero lines drop out.
 */
export function balanceLines(input, chart) {
  const lines = []
  for (const [i, l] of input.entries()) {
    const acc = typeof l.account === 'string' && !isOid(l.account) ? chart.byKey.get(l.account) : chart.byId.get(String(l.account ?? l.accountId))
    let debit = l.debit ?? 0
    let credit = l.credit ?? 0
    if (l.amount !== undefined) { debit = l.amount > 0 ? l.amount : 0; credit = l.amount < 0 ? -l.amount : 0 }
    if (![debit, credit].every((v) => Number.isInteger(v) && v >= 0)) throw badRequest('Amounts are whole paise and not negative.', { fields: { [`lines.${i}`]: 'Bad amount' } })
    if (debit && credit) throw badRequest('A line is either a debit or a credit.', { fields: { [`lines.${i}`]: 'Both sides' } })
    if (!debit && !credit) continue
    if (!acc) throw badRequest(`Unknown account on line ${i + 1}.`, { fields: { [`lines.${i}.accountId`]: 'Unknown account' } })
    if (acc.isGroup) throw badRequest(`${acc.name} is a group; post to one of its ledgers.`, { fields: { [`lines.${i}.accountId`]: 'A group' } })
    if (acc.active === false) throw badRequest(`${acc.name} is switched off.`, { fields: { [`lines.${i}.accountId`]: 'Switched off' } })
    lines.push({ accountId: acc._id, accountCode: acc.code, accountName: acc.name, debit, credit, party: l.party?.name || l.party?.id ? l.party : undefined, note: l.note || undefined })
  }
  const debit = sum(lines, (l) => l.debit)
  const credit = sum(lines, (l) => l.credit)
  if (lines.length < 2) throw badRequest('A voucher needs at least one debit and one credit.')
  if (debit !== credit) throw badRequest(`Debits (${formatINR(debit, { decimals: 2 })}) and credits (${formatINR(credit, { decimals: 2 })}) must be equal.`, { fields: { lines: 'Not balanced' } })
  return { lines, total: debit }
}

const noon = (ymd) => new Date(`${ymd}T06:30:00Z`)

/**
 * Post one auto voucher for a business event, once. `key` = `<source>:<id>:<event>`; a key
 * already in the ledger returns that voucher untouched. Returns null when there is nothing to post.
 */
export async function postEntry({ key, type, date, narration, lines, source, reference, branchId }, chart) {
  if (key) {
    if (chart.seen?.has(key)) return { existed: true }
    const ex = await Journal.findOne({ postingKey: key }).select('voucherNo').lean()
    if (ex) return { existed: true, journal: ex }
  }
  const kept = lines.map((l) => ({ ...l, amount: Math.round(l.amount || 0) })).filter((l) => l.amount !== 0)
  if (!kept.length) return null
  const { lines: checked, total } = balanceLines(kept, chart)
  const voucherNo = await nextNumber(VOUCHER_TYPE_BY[type].docType, { date: noon(date) })
  try {
    const [j] = await Journal.create([{
      voucherNo, type, date, fy: fyOf(date), narration, status: 'POSTED', lines: checked, total,
      source: { ...source, module: source.module ?? POSTING_SOURCES[source.type]?.module }, postingKey: key, auto: true, reference, branchId,
      created: { by: AUTO_BY, at: new Date() }, posted: { by: AUTO_BY, at: new Date() },
    }])
    chart.seen?.add(key)
    return { journal: j }
  } catch (err) {
    if (err?.code === 11000 && key) return { existed: true }
    throw err
  }
}

// ───────────────────────────────────────────────────────── vouchers by hand

/** Receipt / payment / contra need cash or bank on the right side. */
function checkVoucherShape(type, lines, chart) {
  const isMoney = (l) => chart.byId.get(String(l.accountId))?.cashBank
  if (type === 'CONTRA' && !lines.every(isMoney)) throw badRequest('A contra voucher moves money between cash and bank accounts only.', { fields: { type: 'Only cash and bank' } })
  if (type === 'RECEIPT' && !lines.some((l) => isMoney(l) && l.debit)) throw badRequest('A receipt debits a cash or bank account.', { fields: { type: 'No cash or bank debit' } })
  if (type === 'PAYMENT' && !lines.some((l) => isMoney(l) && l.credit)) throw badRequest('A payment credits a cash or bank account.', { fields: { type: 'No cash or bank credit' } })
}

function partyOf(l) {
  return l.party?.name?.trim() ? { type: l.party.type || 'OTHER', id: l.party.id && isOid(l.party.id) ? l.party.id : undefined, name: l.party.name.trim() } : undefined
}

async function checkedVoucher(input, chart) {
  const type = input.type
  if (!VOUCHER_TYPE_BY[type]?.manual) throw badRequest('Pick the voucher type.', { fields: { type: 'Unknown' } })
  const { lines, total } = balanceLines(input.lines.map((l) => ({ account: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, party: partyOf(l), note: l.note?.trim() })), chart)
  checkVoucherShape(type, lines, chart)
  return { type, lines, total }
}

export async function createJournal(input, auth, req) {
  const chart = await loadChart()
  const { type, lines, total } = await checkedVoucher(input, chart)
  const [j] = await Journal.create([{
    type, date: input.date, fy: fyOf(input.date), narration: input.narration?.trim(), reference: input.reference?.trim() || undefined,
    status: 'DRAFT', lines, total, source: { type: 'MANUAL', module: 'finance' }, branchId: auth.user?.branchId, created: stamp(auth),
  }])
  await audit({ action: 'CREATE', module: 'finance', entityType: 'journal', entityId: String(j._id), entityName: `Draft ${VOUCHER_TYPE_BY[type].label}`, summary: `Drafted a ${VOUCHER_TYPE_BY[type].label.toLowerCase()} voucher of ${formatINR(total, { decimals: 2 })} dated ${input.date}${input.narration ? `: ${input.narration.trim()}` : ''}` }, req)
  return journalDetail(j._id)
}

async function draft(id) {
  const j = isOid(id) ? await Journal.findById(id) : null
  if (!j) throw notFound('Voucher')
  if (j.status !== 'DRAFT') throw conflict('This voucher is posted. A posted voucher is never changed — reverse it instead.')
  return j
}

export async function updateJournal(id, input, auth, req) {
  const j = await draft(id)
  const chart = await loadChart()
  const { type, lines, total } = await checkedVoucher({ type: input.type ?? j.type, lines: input.lines ?? j.lines.map((l) => ({ ...l.toObject(), accountId: String(l.accountId) })) }, chart)
  Object.assign(j, { type, lines, total })
  if (input.date) Object.assign(j, { date: input.date, fy: fyOf(input.date) })
  if (input.narration !== undefined) j.narration = input.narration?.trim()
  if (input.reference !== undefined) j.reference = input.reference?.trim() || undefined
  await j.save()
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'journal', entityId: String(j._id), entityName: 'Draft voucher', summary: `Changed a draft ${VOUCHER_TYPE_BY[type].label.toLowerCase()} voucher (${formatINR(total, { decimals: 2 })})` }, req)
  return journalDetail(j._id)
}

export async function discardJournal(id, req) {
  const j = await draft(id)
  await j.deleteOne()
  await audit({ action: 'DELETE', module: 'finance', entityType: 'journal', entityId: String(j._id), entityName: 'Draft voucher', summary: `Discarded a draft ${VOUCHER_TYPE_BY[j.type]?.label.toLowerCase() ?? ''} voucher of ${formatINR(j.total, { decimals: 2 })}` }, req)
  return { id }
}

/** Draft → posted: checked again, numbered from the voucher type's series. */
export async function postJournal(id, auth, req) {
  const j = await draft(id)
  const chart = await loadChart()
  await checkedVoucher({ type: j.type, lines: j.lines.map((l) => ({ accountId: String(l.accountId), debit: l.debit, credit: l.credit, party: l.party, note: l.note })) }, chart)
  const voucherNo = await nextNumber(VOUCHER_TYPE_BY[j.type].docType, { date: noon(j.date) })
  const done = await Journal.findOneAndUpdate({ _id: j._id, status: 'DRAFT' }, { $set: { status: 'POSTED', voucherNo, posted: stamp(auth) } }, { new: true }).lean()
  if (!done) throw conflict('This voucher was just posted by someone else.')
  await audit({ action: 'UPDATE', module: 'finance', entityType: 'journal', entityId: String(j._id), entityName: voucherNo, summary: `Posted ${voucherNo} (${VOUCHER_TYPE_BY[j.type].label}, ${formatINR(j.total, { decimals: 2 })}, dated ${j.date})` }, req)
  return journalDetail(j._id)
}

/** Undo a posted voucher with a mirrored one. The original stays exactly as it was. */
export async function reverseJournal(id, { date, reason }, auth, req) {
  const j = isOid(id) ? await Journal.findById(id).lean() : null
  if (!j) throw notFound('Voucher')
  if (j.status !== 'POSTED') throw conflict('Only a posted voucher is reversed; discard a draft instead.')
  if (j.reversedBy?.id) throw conflict(`Already reversed by ${j.reversedBy.voucherNo}.`)
  if (j.reversalOf?.id) throw conflict('This voucher is itself a reversal. Post a fresh voucher if needed.')
  const { date: today } = await institutionNow()
  const on = date || today
  if (on < j.date) throw badRequest('The reversal can’t be dated before the voucher it reverses.', { fields: { date: 'Before the voucher' } })
  const rev = await withTransaction(async () => {
    const voucherNo = await nextNumber(VOUCHER_TYPE_BY[j.type].docType, { date: noon(on) })
    const [r] = await Journal.create([{
      voucherNo, type: j.type, date: on, fy: fyOf(on), narration: `Reversal of ${j.voucherNo}: ${reason}`, status: 'POSTED',
      lines: j.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })), total: j.total,
      source: j.source, reversalOf: { id: j._id, voucherNo: j.voucherNo }, branchId: j.branchId, created: stamp(auth), posted: stamp(auth),
    }])
    const res = await Journal.updateOne({ _id: j._id, 'reversedBy.id': null }, { $set: { reversedBy: { id: r._id, voucherNo, reason, ...stamp(auth) } } })
    if (!res.modifiedCount) throw conflict('This voucher was just reversed by someone else.')
    return r
  })
  await audit({ action: 'REVERSE', module: 'finance', entityType: 'journal', entityId: String(j._id), entityName: j.voucherNo, summary: `Reversed ${j.voucherNo} (${formatINR(j.total, { decimals: 2 })}) with ${rev.voucherNo} on ${on}: ${reason}` }, req)
  return journalDetail(rev._id)
}

function journalFilter(q) {
  const f = {}
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  if (q.status) f.status = q.status
  if (q.type) f.type = q.type
  if (q.fy) f.fy = q.fy
  if (q.source === 'AUTO') f.auto = true
  else if (q.source === 'MANUAL') f.auto = { $ne: true }
  else if (q.source) f['source.type'] = q.source
  if (q.accountId && isOid(q.accountId)) f['lines.accountId'] = oid(q.accountId)
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i')
    f.$or = [{ voucherNo: re }, { narration: re }, { reference: re }, { 'source.no': re }, { 'lines.party.name': re }, { 'lines.accountName': re }]
  }
  return f
}

export async function listJournals(q, paging) {
  const filter = journalFilter(q)
  const rows = await Journal.find(filter).sort({ date: -1, createdAt: -1 }).skip(paging.skip).limit(paging.pageSize).lean()
  const total = await Journal.countDocuments(filter)
  const drafts = await Journal.countDocuments({ status: 'DRAFT' })
  const out = clean(rows).map(({ lines, ...j }) => ({ ...j, lines: lines.length, accounts: [...new Set(lines.map((l) => l.accountName))].slice(0, 4), parties: [...new Set(lines.map((l) => l.party?.name).filter(Boolean))].slice(0, 2) }))
  return { ...listResponse(out, total, paging), summary: { drafts } }
}

export async function journalDetail(id) {
  const j = isOid(id) ? await Journal.findById(id).lean() : null
  if (!j) throw notFound('Voucher')
  const reconciled = j.status === 'POSTED' ? await BankLine.find({ 'match.journalId': j._id }).select('match.line date').lean() : []
  return { ...clean(j), reconciledLines: reconciled.map((r) => r.match.line) }
}
