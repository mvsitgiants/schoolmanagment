import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDaysYmd, canteenBlockReason, canteenSoldOn, canteenWalletCheck } from '@schoolgiant/shared'
import { CanteenTopup, CanteenWallet, WalletTxn } from '../src/models/canteen.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { institutionNow } from '../src/platform/time.js'
import { canteenRazorpayEvent, familyCancelPreorder, familyCanteen, familyControls, familyPreorder } from '../src/services/canteenFamily.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let student
let other
let today
let items = {}
const api = '/api/v1/canteen'
const asTenant = (fn) => runAsTenant(h.tenant._id, fn)
/** A family request (as routes/portal.js builds it) for the student's parent. */
const family = async (kind = 'PARENT') => ({
  tenant: h.tenant, slug: h.tenant.slug, features: ['CANTEEN'], session: { kind, mobile: '9845000801' },
  students: await asTenant(() => Student.find({ _id: student.id }).lean()),
})

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  const section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  student = (await admin.post('/api/v1/students').send({ firstName: 'Kabir', sectionId: section.id, guardians: [{ name: 'Parent Kabir', relation: 'FATHER', mobile: '9845000801', isPrimary: true }] })).body.data
  other = (await admin.post('/api/v1/students').send({ firstName: 'Myra', sectionId: section.id, guardians: [{ name: 'Parent Myra', relation: 'MOTHER', mobile: '9845000802', isPrimary: true }] })).body.data
  await asTenant(() => Student.updateOne({ _id: student.id }, { $set: { cardCode: 'CARD-KABIR-1' } }))
  today = (await asTenant(() => institutionNow())).date
})
afterAll(stopDb)

describe('helpers', () => {
  it('checks the wallet, the daily limit and what the family ruled out', () => {
    expect(canteenWalletCheck({ balance: 1000 }, 1500)).toEqual({ code: 'NO_BALANCE', short: 500 })
    expect(canteenWalletCheck({ balance: 5000, dailyLimit: 3000, spentToday: 2000 }, 1500)).toEqual({ code: 'OVER_LIMIT', left: 1000 })
    expect(canteenWalletCheck({ balance: 5000, dailyLimit: null, spentToday: 9000 }, 1500)).toBeNull()
    expect(canteenBlockReason({ id: 'a', tags: ['FRIED'] }, { blockedTags: ['FRIED'] })).toBe('BLOCKED_TAG')
    expect(canteenBlockReason({ id: 'a', tags: [] }, { blockedItemIds: ['a'] })).toBe('BLOCKED_ITEM')
    expect(canteenSoldOn({ days: ['MON'] }, 'TUE')).toBe(false)
    expect(canteenSoldOn({ days: [] }, 'TUE')).toBe(true)
  })
})

describe('the menu', () => {
  it('adds items, refuses the same name twice, and lists them', async () => {
    items.samosa = (await admin.post(`${api}/menu`).send({ name: 'Samosa', category: 'SNACK', price: 1500, mark: 'VEG', tags: ['FRIED'] }).expect(201)).body.data
    items.thali = (await admin.post(`${api}/menu`).send({ name: 'Veg thali', category: 'MEAL', price: 6000, mark: 'VEG' }).expect(201)).body.data
    items.coffee = (await admin.post(`${api}/menu`).send({ name: 'Cold coffee', category: 'BEVERAGE', price: 3000, mark: 'VEG', tags: ['CAFFEINE', 'SUGARY'] }).expect(201)).body.data
    await admin.post(`${api}/menu`).send({ name: 'samosa', price: 100 }).expect(400)
    const menu = (await admin.get(`${api}/menu`).expect(200)).body.data
    expect(menu.items.map((i) => i.name).sort()).toEqual(['Cold coffee', 'Samosa', 'Veg thali'])
  })

  it('a daily special changes the price that day; sold-out is for today only', async () => {
    await admin.post(`${api}/specials`).send({ date: today, itemId: items.coffee.id, price: 2500, note: 'Hot day' }).expect(201)
    let menu = (await admin.get(`${api}/today`).expect(200)).body.data.items
    expect(menu.find((i) => i.id === items.coffee.id)).toMatchObject({ special: true, price: 2500, menuPrice: 3000 })
    await admin.post(`${api}/menu/${items.thali.id}/sold-out`).send({ soldOut: true }).expect(200)
    menu = (await admin.get(`${api}/today`).expect(200)).body.data.items
    expect(menu.find((i) => i.id === items.thali.id).soldOut).toBe(true)
    await admin.post(`${api}/orders`).send({ payMode: 'CASH', lines: [{ itemId: items.thali.id, qty: 1 }] }).expect(400)
    await admin.post(`${api}/menu/${items.thali.id}/sold-out`).send({ soldOut: false }).expect(200)
  })
})

describe('the counter and the wallet', () => {
  it('finds a student by card, admission number or name', async () => {
    const byCard = (await admin.get(`${api}/find`).query({ q: 'CARD-KABIR-1' }).expect(200)).body.data
    expect(byCard).toHaveLength(1)
    expect(byCard[0]).toMatchObject({ id: student.id, balance: 0 })
    const byNo = (await admin.get(`${api}/find`).query({ q: student.admissionNo }).expect(200)).body.data
    expect(byNo[0].id).toBe(student.id)
    const byName = (await admin.get(`${api}/find`).query({ q: 'kab' }).expect(200)).body.data
    expect(byName.map((s) => s.id)).toContain(student.id)
  })

  it('refuses a wallet sale without money, then sells after a top-up — the ledger adds up', async () => {
    const no = await admin.post(`${api}/orders`).send({ studentId: student.id, payMode: 'WALLET', lines: [{ itemId: items.samosa.id, qty: 2 }] })
    expect(no.status).toBe(409)
    expect(no.body.details?.code).toBe('NO_BALANCE')
    const top = (await admin.post(`${api}/wallets/${student.id}/topup`).send({ amount: 20000, mode: 'CASH' }).expect(201)).body.data
    expect(top.balance).toBe(20000)
    const sale = (await admin.post(`${api}/orders`).send({ studentId: student.id, payMode: 'WALLET', lines: [{ itemId: items.samosa.id, qty: 2 }, { itemId: items.coffee.id, qty: 1 }] }).expect(201)).body.data
    // tokens are on by default: the sale gets the day's token and is made first (PLACED = preparing)
    expect(sale).toMatchObject({ total: 1500 * 2 + 2500, status: 'PLACED', payMode: 'WALLET', source: 'COUNTER' })
    expect(sale.token).toBeGreaterThan(0)
    const w = (await admin.get(`${api}/wallets/${student.id}`).expect(200)).body.data
    expect(w.student.balance).toBe(20000 - 5500)
    expect(w.student.spentToday).toBe(5500)
    expect(w.ledger.map((x) => [x.type, x.amount, x.balanceAfter])).toEqual([['PURCHASE', -5500, 14500], ['TOP_UP', 20000, 20000]])
  })

  it('sells to a walk-in for cash, without a student', async () => {
    const o = (await admin.post(`${api}/orders`).send({ payMode: 'CASH', lines: [{ itemId: items.samosa.id, qty: 1 }] }).expect(201)).body.data
    expect(o).toMatchObject({ studentId: null, payMode: 'CASH', total: 1500 })
    await admin.post(`${api}/orders`).send({ payMode: 'WALLET', lines: [{ itemId: items.samosa.id, qty: 1 }] }).expect(400)
  })

  it('follows the family controls: blocked kinds of food and the daily limit', async () => {
    await admin.put(`${api}/wallets/${student.id}/controls`).send({ dailyLimit: 8000, blockedTags: ['FRIED'] }).expect(200)
    const fried = await admin.post(`${api}/orders`).send({ studentId: student.id, payMode: 'WALLET', lines: [{ itemId: items.samosa.id, qty: 1 }] })
    expect(fried.status).toBe(400)
    expect(fried.body.message).toMatch(/blocked/)
    // 5,500 spent of 8,000: a 6,000 thali is over the limit
    const over = await admin.post(`${api}/orders`).send({ studentId: student.id, payMode: 'WALLET', lines: [{ itemId: items.thali.id, qty: 1 }] })
    expect(over.status).toBe(409)
    expect(over.body.details?.code).toBe('OVER_LIMIT')
    await admin.put(`${api}/wallets/${student.id}/controls`).send({ dailyLimit: null, blockedTags: [] }).expect(200)
  })

  it('tells the family once when the balance runs low', async () => {
    await admin.post(`${api}/orders`).send({ studentId: student.id, payMode: 'WALLET', lines: [{ itemId: items.thali.id, qty: 1 }] }).expect(201) // 14,500 → 8,500 < 10,000
    expect((await asTenant(() => CanteenWallet.findOne({ studentId: student.id }).lean())).lowAlertSent).toBe(true)
    await admin.post(`${api}/wallets/${student.id}/topup`).send({ amount: 5000, mode: 'UPI', reference: 'UPI123' }).expect(201)
    expect((await asTenant(() => CanteenWallet.findOne({ studentId: student.id }).lean())).lowAlertSent).toBe(false)
  })

  it('refunds and adjusts with a reason; never below zero; the ledger cannot be edited', async () => {
    const w = (await admin.get(`${api}/wallets/${student.id}`).expect(200)).body.data.student
    await admin.post(`${api}/wallets/${student.id}/refund`).send({ amount: w.balance + 100, reason: 'Too much' }).expect(400)
    await admin.post(`${api}/wallets/${student.id}/refund`).send({ amount: 1000, reason: 'Family asked' }).expect(201)
    await admin.post(`${api}/wallets/${student.id}/adjust`).send({ amount: -(w.balance), reason: 'Take it all' }).expect(409)
    const adj = (await admin.post(`${api}/wallets/${student.id}/adjust`).send({ amount: 500, reason: 'Wrong change given' }).expect(201)).body.data
    expect(adj.balance).toBe(w.balance - 1000 + 500)
    await expect(asTenant(() => WalletTxn.updateOne({ studentId: student.id }, { $set: { amount: 1 } }))).rejects.toThrow(/cannot be changed/)
    await expect(asTenant(() => WalletTxn.deleteMany({ studentId: student.id }))).rejects.toThrow(/cannot be changed/)
    const rows = await asTenant(() => WalletTxn.find({ studentId: student.id }).sort({ createdAt: 1, _id: 1 }).lean())
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(adj.balance)
  })

  it('lists wallets with the low ones flagged', async () => {
    await admin.post(`${api}/wallets/${other.id}/topup`).send({ amount: 5000 }).expect(201)
    const list = (await admin.get(`${api}/wallets`).query({ filter: 'LOW' }).expect(200)).body.data
    expect(list.rows.map((r) => r.id)).toContain(other.id)
    expect(list.stats.wallets).toBe(2)
  })
})

describe('pre-orders from the family app', () => {
  const tomorrow = () => addDaysYmd(today, 1)

  it('a parent sees the wallet, sets controls, pre-orders for tomorrow and can cancel', async () => {
    const f = await family()
    const view = await asTenant(() => familyCanteen(f, student.id))
    expect(view.wallet.balance).toBeGreaterThan(0)
    expect(view.days.length).toBeGreaterThan(1)
    expect(view.canControl).toBe(true)
    await asTenant(() => familyControls(f, student.id, { blockedItemIds: [items.coffee.id] }, null))
    await expect(asTenant(() => familyPreorder(f, student.id, { date: tomorrow(), lines: [{ itemId: items.coffee.id, qty: 1 }] }, null))).rejects.toThrow(/blocked/)
    const before = (await asTenant(() => CanteenWallet.findOne({ studentId: student.id }).lean())).balance
    const o = await asTenant(() => familyPreorder(f, student.id, { date: tomorrow(), lines: [{ itemId: items.samosa.id, qty: 2 }] }, null))
    expect(o).toMatchObject({ status: 'PLACED', source: 'PREORDER', date: tomorrow(), total: 3000 })
    expect((await asTenant(() => CanteenWallet.findOne({ studentId: student.id }).lean())).balance).toBe(before - 3000)
    const second = await asTenant(() => familyPreorder(f, student.id, { date: tomorrow(), lines: [{ itemId: items.thali.id, qty: 1 }] }, null))
    await asTenant(() => familyCancelPreorder(f, student.id, second.id, null))
    expect((await asTenant(() => CanteenWallet.findOne({ studentId: student.id }).lean())).balance).toBe(before - 3000)
    const last = await asTenant(() => WalletTxn.findOne({ studentId: student.id }).sort({ createdAt: -1, _id: -1 }).lean())
    expect(last).toMatchObject({ type: 'ADJUSTMENT', amount: 6000 })
  })

  it('a student signed in to the app cannot change the controls', async () => {
    const f = await family('STUDENT')
    await expect(asTenant(() => familyControls(f, student.id, { dailyLimit: 100 }, null))).rejects.toThrow(/parent/)
  })

  it('the counter makes a pre-order ready, then collected', async () => {
    const list = (await admin.get(`${api}/orders`).query({ date: tomorrow(), source: 'PREORDER' }).expect(200)).body.data.rows
    const placed = list.find((o) => o.status === 'PLACED')
    await admin.post(`${api}/orders/${placed.id}/collect`).expect(200)
    await admin.post(`${api}/orders/${placed.id}/ready`).expect(409)
    const cancelled = list.find((o) => o.status === 'CANCELLED')
    await admin.post(`${api}/orders/${cancelled.id}/ready`).expect(409)
  })
})

describe('online top-up (the school’s Razorpay)', () => {
  it('a captured payment is added to the wallet exactly once', async () => {
    const before = (await asTenant(() => CanteenWallet.findOne({ studentId: other.id }).lean())).balance
    await asTenant(() => CanteenTopup.create({ studentId: other.id, studentName: 'Myra', admissionNo: other.admissionNo, amount: 30000, providerOrderId: 'order_TEST123' }))
    const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST123', order_id: 'order_TEST123', status: 'captured', amount: 30000, currency: 'INR', method: 'upi' } } } }
    const first = await asTenant(() => canteenRazorpayEvent({}, body))
    expect(first.note).toBe('canteen APPLIED')
    await asTenant(() => canteenRazorpayEvent({}, body))
    expect((await asTenant(() => CanteenWallet.findOne({ studentId: other.id }).lean())).balance).toBe(before + 30000)
    expect(await asTenant(() => WalletTxn.countDocuments({ gatewayPaymentId: 'pay_TEST123' }))).toBe(1)
    expect(await asTenant(() => canteenRazorpayEvent({}, { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_NOT_OURS', status: 'captured', amount: 100 } } } }))).toBeNull()
  })

  it('a payment for the wrong amount waits for review', async () => {
    await asTenant(() => CanteenTopup.create({ studentId: other.id, amount: 20000, providerOrderId: 'order_TEST456' }))
    const r = await asTenant(() => canteenRazorpayEvent({}, { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST456', order_id: 'order_TEST456', status: 'captured', amount: 10000, currency: 'INR' } } } }))
    expect(r.note).toBe('canteen NEEDS_REVIEW')
  })
})

describe('the day', () => {
  it('sums sales by item and pay mode, top-ups and cash in hand', async () => {
    const d = (await admin.get(`${api}/summary`).expect(200)).body.data
    expect(d.sales.count).toBeGreaterThanOrEqual(3)
    expect(d.sales.cash).toBe(1500)
    expect(d.items[0].amount).toBeGreaterThan(0)
    expect(d.topUps.byMode.CASH).toBeGreaterThan(0)
    expect(d.cashInHand).toBe(1500 + d.topUps.byMode.CASH - 1000)
  })
})
