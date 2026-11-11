import { Router } from 'express'
import { CANTEEN_CATEGORIES, CANTEEN_DAYS, CANTEEN_MARKS, CANTEEN_REFUND_MODES, CANTEEN_TAG_VALUES } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  adjustWallet, canteenSettings, counterSale, daySummary, deleteItem, deleteSpecial, findStudents, listMenu, listOrders, listSpecials, listWallets, menuFor, moveOrder,
  preorderBoard, refundWallet, saveItem, saveSpecial, setControls, setSoldOut, today, tokenBoard, topUpAtCounter, walletDetail,
} from '../services/canteen.js'
import { recheckTopup } from '../services/canteenFamily.js'

// canteen: /api/v1/canteen/*  — menu, counter (POS) and pre-orders, wallets
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('canteen'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const paise = z.coerce.number().int('Whole paise').min(0)
const values = (list) => list.map((x) => x.value)
const sid = (req) => objectId.parse(req.params.studentId)
// a page of a list: 50 rows by default, never more than 100 at a time
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 100)) }

// ───────────────────────────────────────────────────────── menu

const itemSchema = z.object({
  name: z.string().trim().min(2, 'Name the item').max(80),
  category: z.enum(values(CANTEEN_CATEGORIES)).default('SNACK'),
  price: paise.max(10_000_00, 'Too high'),
  mark: z.enum(values(CANTEEN_MARKS)).default('VEG'),
  tags: z.array(z.enum(CANTEEN_TAG_VALUES)).max(10).default([]),
  days: z.array(z.enum(CANTEEN_DAYS)).max(7).default([]),
  description: optionalText(300),
  active: z.boolean().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
})

const MENU_READ = ['canteen.menu.view', 'canteen.orders.view']
router.get('/menu', requirePermission(...MENU_READ), async (req, res) => { res.json({ data: await listMenu() }) })
router.post('/menu', requirePermission('canteen.menu.create'), async (req, res) => {
  res.status(201).json({ data: await saveItem(null, itemSchema.parse(req.body), req) })
})
router.patch('/menu/:id', requirePermission('canteen.menu.edit'), async (req, res) => {
  res.json({ data: await saveItem(objectId.parse(req.params.id), itemSchema.partial().parse(req.body), req) })
})
router.delete('/menu/:id', requirePermission('canteen.menu.delete'), async (req, res) => {
  res.json({ data: await deleteItem(objectId.parse(req.params.id), req) })
})
/** Sold out today — the counter can switch it too. */
router.post('/menu/:id/sold-out', requirePermission('canteen.menu.edit', 'canteen.orders.create'), async (req, res) => {
  const { soldOut } = z.object({ soldOut: z.boolean() }).parse(req.body)
  res.json({ data: await setSoldOut(objectId.parse(req.params.id), soldOut, req) })
})

router.get('/specials', requirePermission(...MENU_READ), async (req, res) => {
  res.json({ data: await listSpecials(z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)) })
})
router.post('/specials', requirePermission('canteen.menu.create', 'canteen.menu.edit'), async (req, res) => {
  const input = z.object({ date: ymd, itemId: objectId, price: paise.nullable().optional(), note: optionalText(120) }).parse(req.body)
  res.status(201).json({ data: await saveSpecial(input, req) })
})
router.delete('/specials/:id', requirePermission('canteen.menu.edit', 'canteen.menu.delete'), async (req, res) => {
  res.json({ data: await deleteSpecial(objectId.parse(req.params.id), req) })
})

// ───────────────────────────────────────────────────────── counter

/** The day's menu at the counter: what is on sale, specials priced, sold-out marked. */
router.get('/today', requirePermission('canteen.orders.view'), async (req, res) => {
  const { date } = z.object({ date: ymd.optional() }).parse(req.query)
  const d = date ?? (await today()).date
  const set = await canteenSettings()
  res.json({ data: { date: d, items: await menuFor(d), tokens: set.tokens, tokenPrint: set.tokens && set.tokenPrint } })
})
/** Find a student: card code (RFID / QR on the ID card), admission number or name. */
router.get('/find', requirePermission('canteen.orders.view', 'canteen.wallet.view'), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(80).default('') }).parse(req.query)
  res.json({ data: await findStudents(q) })
})

const linesSchema = z.array(z.object({ itemId: objectId, qty: z.coerce.number().int().min(1).max(50) })).min(1, 'Add at least one item').max(40)

router.get('/orders', requirePermission('canteen.orders.view'), async (req, res) => {
  const q = z.object({ date: ymd.optional(), source: z.enum(['COUNTER', 'PREORDER']).optional(), status: z.enum(['PLACED', 'READY', 'COLLECTED', 'SERVED', 'CANCELLED']).optional(), sort: z.enum(['token']).optional(), ...paging }).parse(req.query)
  res.json({ data: await listOrders(q) })
})
/** The pre-order board for a day: every pre-order, not paged. */
router.get('/preorders', requirePermission('canteen.orders.view'), async (req, res) => {
  const { date } = z.object({ date: ymd.optional() }).parse(req.query)
  res.json({ data: await preorderBoard(date) })
})
/** The token board (a TV at the counter): what is being made, what is ready, what was just collected — for one campus. */
router.get('/tokens', requirePermission('canteen.orders.view'), async (req, res) => {
  const q = z.object({ branchId: objectId.optional(), date: ymd.optional() }).parse(req.query)
  res.json({ data: await tokenBoard(q, req.auth) })
})
router.post('/orders', requirePermission('canteen.orders.create'), async (req, res) => {
  const input = z.object({ studentId: objectId.optional().nullable(), lines: linesSchema, payMode: z.enum(['WALLET', 'CASH']) }).parse(req.body)
  res.status(201).json({ data: await counterSale(input, req) })
})
router.post('/orders/:id/ready', requirePermission('canteen.orders.create'), async (req, res) => {
  res.json({ data: await moveOrder(objectId.parse(req.params.id), 'READY', req) })
})
router.post('/orders/:id/collect', requirePermission('canteen.orders.create'), async (req, res) => {
  res.json({ data: await moveOrder(objectId.parse(req.params.id), 'COLLECTED', req) })
})
router.get('/summary', requirePermission('canteen.orders.view'), async (req, res) => {
  const { date } = z.object({ date: ymd.optional() }).parse(req.query)
  res.json({ data: await daySummary(date) })
})

// ───────────────────────────────────────────────────────── wallets

router.get('/wallets', requirePermission('canteen.wallet.view'), async (req, res) => {
  const q = z.object({ search: z.string().trim().max(80).optional(), filter: z.enum(['ALL', 'LOW', 'LIMITED']).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query)
  res.json({ data: await listWallets(q) })
})
router.get('/wallets/:studentId', requirePermission('canteen.wallet.view', 'canteen.orders.view'), async (req, res) => {
  res.json({ data: await walletDetail(sid(req)) })
})
/** Cash / UPI at the counter: the cashier who sells also tops up. */
router.post('/wallets/:studentId/topup', requirePermission('canteen.orders.create'), async (req, res) => {
  const input = z.object({ amount: paise.min(1, 'Enter an amount'), mode: z.enum(['CASH', 'UPI']).default('CASH'), reference: optionalText(60) }).parse(req.body)
  res.status(201).json({ data: await topUpAtCounter(sid(req), input, req) })
})
router.post('/wallets/:studentId/refund', requirePermission('canteen.wallet.refund'), async (req, res) => {
  const input = z.object({ amount: paise.min(1).optional(), mode: z.enum(values(CANTEEN_REFUND_MODES)).default('CASH'), reference: optionalText(60), reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.status(201).json({ data: await refundWallet(sid(req), input, req) })
})
router.post('/wallets/:studentId/adjust', requirePermission('canteen.wallet.refund'), async (req, res) => {
  const input = z.object({ amount: z.coerce.number().int().refine((n) => n !== 0, 'Enter an amount').refine((n) => Math.abs(n) <= 1_000_000, 'Too large'), reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.status(201).json({ data: await adjustWallet(sid(req), input, req) })
})
router.put('/wallets/:studentId/controls', requirePermission('canteen.wallet.refund'), async (req, res) => {
  const input = z.object({ dailyLimit: paise.nullable().optional(), blockedItemIds: z.array(objectId).max(200).optional(), blockedTags: z.array(z.enum(CANTEEN_TAG_VALUES)).max(10).optional() }).parse(req.body)
  res.json({ data: await setControls(sid(req), input, req.auth?.user?.name ?? 'Staff', req) })
})
router.post('/topups/:id/recheck', requirePermission('canteen.wallet.refund'), async (req, res) => {
  res.json({ data: await recheckTopup(objectId.parse(req.params.id), req) })
})

export default router
