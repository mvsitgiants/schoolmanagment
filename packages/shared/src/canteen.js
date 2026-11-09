// Canteen & wallet (module `canteen`): the menu, the counter (POS), pre-orders from the family app and a cashless
// wallet per student that parents top up. Money in paise; dates 'YYYY-MM-DD' in the institution's timezone.

export const CANTEEN_CATEGORIES = [
  { value: 'SNACK', label: 'Snack', tone: 'orange' },
  { value: 'MEAL', label: 'Meal', tone: 'brand' },
  { value: 'BEVERAGE', label: 'Beverage', tone: 'sky' },
]
export const CANTEEN_CATEGORY_BY = Object.fromEntries(CANTEEN_CATEGORIES.map((c) => [c.value, c]))

/** The food mark printed on Indian menus: green square (veg), brown/red (non-veg), yellow (egg). */
export const CANTEEN_MARKS = [
  { value: 'VEG', label: 'Veg', tone: 'success' },
  { value: 'NON_VEG', label: 'Non-veg', tone: 'danger' },
  { value: 'EGG', label: 'Contains egg', tone: 'warning' },
]
export const CANTEEN_MARK_BY = Object.fromEntries(CANTEEN_MARKS.map((m) => [m.value, m]))

/** What a parent can rule out in one tap ("no fried food"); an item carries any of these. */
export const CANTEEN_TAGS = [
  { value: 'FRIED', label: 'Fried' },
  { value: 'SUGARY', label: 'Sugary' },
  { value: 'CAFFEINE', label: 'Caffeine' },
  { value: 'SPICY', label: 'Spicy' },
  { value: 'PACKAGED', label: 'Packaged' },
]
export const CANTEEN_TAG_VALUES = CANTEEN_TAGS.map((t) => t.value)

/** Days a menu item is sold on (none ticked = every day). */
export const CANTEEN_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** The wallet ledger is append-only: a row is never changed; a mistake is put right by an ADJUSTMENT. */
export const CANTEEN_TXN_TYPES = {
  TOP_UP: { label: 'Top-up', tone: 'success', sign: 1 },
  PURCHASE: { label: 'Purchase', tone: 'info', sign: -1 },
  REFUND: { label: 'Refund to family', tone: 'warning', sign: -1 },
  ADJUSTMENT: { label: 'Adjustment', tone: 'violet', sign: 0 }, // either way
}

export const CANTEEN_TOPUP_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'ONLINE', label: 'Online (app)' },
]
export const CANTEEN_REFUND_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank transfer' },
]

export const CANTEEN_ORDER_SOURCES = { COUNTER: { label: 'Counter', tone: 'neutral' }, PREORDER: { label: 'Pre-order', tone: 'violet' } }
export const CANTEEN_PAY_MODES = { WALLET: { label: 'Wallet', tone: 'brand' }, CASH: { label: 'Cash', tone: 'warning' } }

/** Counter sales are SERVED at once; a pre-order goes PLACED → READY → COLLECTED (or CANCELLED while still PLACED). */
export const CANTEEN_ORDER_STATUS = {
  PLACED: { label: 'Placed', tone: 'info' },
  READY: { label: 'Ready', tone: 'warning' },
  COLLECTED: { label: 'Collected', tone: 'success' },
  SERVED: { label: 'Served', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}

/** An online top-up through the school's own Razorpay account (the one fees use). */
export const CANTEEN_TOPUP_STATUS = {
  CREATED: { label: 'Waiting for payment', tone: 'info' },
  APPLIED: { label: 'Added to wallet', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'warning' },
}

/** Code defaults; Settings › Canteen (when wired) overrides them. */
export const CANTEEN_DEFAULTS = {
  lowBalance: 10000, // ₹100: the family is told once the wallet falls below this
  minTopUp: 5000, // ₹50
  maxTopUp: 500000, // ₹5,000 at a time
  maxBalance: 1000000, // ₹10,000 held at most
  preorderDays: 7, // how far ahead families can pre-order
  preorderCutoff: '09:00', // same-day pre-orders close at this time
}
export const CANTEEN_TOPUP_PRESETS = [20000, 50000, 100000] // ₹200 / ₹500 / ₹1,000

/** A daily-spend limit is either null (no limit) or a whole number of paise. */
export const hasSpendLimit = (limit) => Number.isInteger(limit) && limit > 0

/** Is the item on sale on this day? (active, not sold out, and either no days set or this weekday ticked). */
export function canteenSoldOn(item, weekday) {
  if (!item || item.active === false) return false
  return !item.days?.length || item.days.includes(weekday)
}

/** Why a student may not buy this item: 'BLOCKED_ITEM' · 'BLOCKED_TAG' · null. */
export function canteenBlockReason(item, controls = {}) {
  const id = String(item.id ?? item._id ?? item.itemId ?? '')
  if ((controls.blockedItemIds ?? []).map(String).includes(id)) return 'BLOCKED_ITEM'
  if ((item.tags ?? []).some((t) => (controls.blockedTags ?? []).includes(t))) return 'BLOCKED_TAG'
  return null
}

/** Total of order lines ({ price, qty }). */
export const canteenTotal = (lines = []) => lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0)

/**
 * Can this wallet pay `amount` today? → null when it can, else { code, ... }:
 * NO_BALANCE (short by `short`) or OVER_LIMIT (`left` of the day's limit remains).
 */
export function canteenWalletCheck({ balance = 0, dailyLimit = null, spentToday = 0 }, amount) {
  if (amount > balance) return { code: 'NO_BALANCE', short: amount - balance }
  if (hasSpendLimit(dailyLimit) && spentToday + amount > dailyLimit) return { code: 'OVER_LIMIT', left: Math.max(0, dailyLimit - spentToday) }
  return null
}
