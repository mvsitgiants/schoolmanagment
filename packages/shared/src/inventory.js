// Store & assets (module `inventory`): constants and pure helpers shared by the API and the web app.
//
//   Items      what the store keeps: stationery, uniforms (in sizes), books, lab consumables, cleaning, sports, IT
//   Stock      per campus store and per size; every change is a line in the stock ledger
//   Purchase   vendors and purchase orders: draft → submitted → approved (within the approver's limit) → received
//   Sales      uniforms and books sold to a student over the counter, with a receipt
//   Assets     the register of furniture, computers, lab equipment … with straight-line book value

/** Item categories. `sellable`: sold to students at the counter by default (uniforms, books). */
export const STORE_CATEGORIES = [
  { value: 'STATIONERY', label: 'Stationery', sellable: false },
  { value: 'UNIFORM', label: 'Uniform', sellable: true },
  { value: 'BOOKS', label: 'Books', sellable: true },
  { value: 'LAB', label: 'Lab consumables', sellable: false },
  { value: 'CLEANING', label: 'Cleaning & housekeeping', sellable: false },
  { value: 'SPORTS', label: 'Sports', sellable: false },
  { value: 'IT', label: 'IT & electronics', sellable: false },
  { value: 'OTHER', label: 'Other', sellable: false },
]
export const STORE_CATEGORY_BY = Object.fromEntries(STORE_CATEGORIES.map((c) => [c.value, c]))

export const STORE_UNITS = ['PCS', 'BOX', 'PACK', 'SET', 'PAIR', 'DOZEN', 'REAM', 'KG', 'LITRE', 'METRE', 'BOTTLE', 'ROLL']

/**
 * Stock ledger entries. `sign`: +1 adds to stock, −1 takes away, 0 either way (an adjustment carries its own sign).
 *   RECEIPT      goods received against a purchase order
 *   OPENING      opening stock (import, or the first count)
 *   ISSUE        handed out to a department, a staff member or a classroom
 *   RETURN       brought back to the store
 *   ADJUSTMENT   corrected, with a reason (a physical count, damage, loss …)
 *   SALE         sold at the counter · SALE_CANCEL: a cancelled sale's stock back
 */
export const STORE_MOVE_TYPES = {
  RECEIPT: { label: 'Received', tone: 'success', sign: 1 },
  OPENING: { label: 'Opening stock', tone: 'info', sign: 1 },
  ISSUE: { label: 'Issued', tone: 'warning', sign: -1 },
  RETURN: { label: 'Returned', tone: 'teal', sign: 1 },
  ADJUSTMENT: { label: 'Adjusted', tone: 'violet', sign: 0 },
  SALE: { label: 'Sold', tone: 'brand', sign: -1 },
  SALE_CANCEL: { label: 'Sale cancelled', tone: 'neutral', sign: 1 },
}

/** Who stock is issued to (or returned from). */
export const STORE_ISSUE_TO = ['DEPARTMENT', 'STAFF', 'CLASSROOM', 'OTHER']

export const STORE_ADJUST_REASONS = [
  { value: 'COUNT', label: 'Physical count' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'LOST', label: 'Lost / missing' },
  { value: 'FOUND', label: 'Found' },
  { value: 'CORRECTION', label: 'Entry correction' },
]

export const PO_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  PARTIAL: { label: 'Partly received', tone: 'violet' },
  RECEIVED: { label: 'Received', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}
/** Orders still waiting for goods. */
export const PO_OPEN = ['APPROVED', 'PARTIAL']

export const STORE_SALE_MODES = ['CASH', 'UPI', 'CARD']
export const STORE_SALE_STATUS = {
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
}

export const STORE_COUNT_STATUS = {
  OPEN: { label: 'Counting', tone: 'warning' },
  POSTED: { label: 'Posted', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

// ───────────────────────────────────────────────────────── assets

/** Asset categories, each with a typical useful life (years) for straight-line depreciation and a tag prefix. */
export const ASSET_CATEGORIES = [
  { value: 'FURNITURE', label: 'Furniture & fixtures', lifeYears: 10, prefix: 'FUR' },
  { value: 'IT', label: 'Computers & IT', lifeYears: 4, prefix: 'IT' },
  { value: 'AV', label: 'Smart class & audio-visual', lifeYears: 5, prefix: 'AV' },
  { value: 'LAB', label: 'Laboratory equipment', lifeYears: 8, prefix: 'LAB' },
  { value: 'SPORTS', label: 'Sports equipment', lifeYears: 5, prefix: 'SPT' },
  { value: 'ELECTRICAL', label: 'Electrical & appliances', lifeYears: 8, prefix: 'ELE' },
  { value: 'MUSIC', label: 'Musical instruments', lifeYears: 8, prefix: 'MUS' },
  { value: 'KITCHEN', label: 'Kitchen & canteen', lifeYears: 8, prefix: 'KIT' },
  { value: 'OTHER', label: 'Other', lifeYears: 5, prefix: 'AST' },
]
export const ASSET_CATEGORY_BY = Object.fromEntries(ASSET_CATEGORIES.map((c) => [c.value, c]))

export const ASSET_STATUS = {
  IN_USE: { label: 'In use', tone: 'success' },
  IN_STORE: { label: 'In store', tone: 'info' },
  UNDER_REPAIR: { label: 'Under repair', tone: 'warning' },
  DISPOSED: { label: 'Disposed', tone: 'neutral' },
}
export const ASSET_CONDITIONS = {
  NEW: { label: 'New', tone: 'success' },
  GOOD: { label: 'Good', tone: 'success' },
  FAIR: { label: 'Fair', tone: 'warning' },
  POOR: { label: 'Poor', tone: 'danger' },
  DAMAGED: { label: 'Damaged', tone: 'danger' },
}
export const ASSET_MAINTENANCE_KINDS = ['REPAIR', 'SERVICE', 'INSPECTION', 'UPGRADE']
export const ASSET_DISPOSAL_METHODS = ['SOLD', 'SCRAPPED', 'DONATED', 'LOST', 'WRITTEN_OFF']

// ───────────────────────────────────────────────────────── helpers

/** Stock against its reorder level: OUT (none), LOW (at or under the level), OK. */
export function stockLevel(qty, reorderLevel = 0) {
  const q = Number(qty) || 0
  if (q <= 0) return 'OUT'
  if (reorderLevel > 0 && q <= reorderLevel) return 'LOW'
  return 'OK'
}
export const STOCK_LEVEL = {
  OUT: { label: 'Out of stock', tone: 'danger' },
  LOW: { label: 'Low', tone: 'warning' },
  OK: { label: 'In stock', tone: 'success' },
}

/** A size label as stored: trimmed, upper case ("m" → "M", " 32 " → "32"). Items with no sizes use ''. */
export const normSize = (s) => String(s ?? '').trim().toUpperCase().slice(0, 12)

/** The price an item sells at in a size: the size's own price when it has one, else the item's. */
export function salePriceOf(item, size) {
  const own = (item?.sizes ?? []).find((s) => normSize(s.size) === normSize(size))
  return own?.salePrice != null ? own.salePrice : item?.salePrice ?? null
}

/** Purchase order money: each line qty × rate, the subtotal, tax and total (paise). */
export function poTotals(lines = [], taxAmount = 0) {
  const out = lines.map((l) => ({ ...l, amount: Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0)) }))
  const subtotal = out.reduce((s, l) => s + l.amount, 0)
  const tax = Math.max(0, Math.round(Number(taxAmount) || 0))
  return { lines: out, subtotal, tax, total: subtotal + tax }
}

const ymdMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`)

/**
 * Straight-line depreciation: (cost − salvage) spread evenly over the useful life from the purchase date.
 * Returns { depreciation, bookValue, pctWritten } on `asOf` (YYYY-MM-DD), in paise.
 */
export function bookValue({ cost, purchaseDate, lifeYears, salvagePct = 0 } = {}, asOf) {
  const c = Math.max(0, Math.round(Number(cost) || 0))
  if (!c || !purchaseDate || !(lifeYears > 0) || !asOf) return { depreciation: 0, bookValue: c, pctWritten: 0 }
  const salvage = Math.round((c * Math.min(100, Math.max(0, Number(salvagePct) || 0))) / 100)
  const years = Math.max(0, (ymdMs(asOf) - ymdMs(purchaseDate)) / (365.25 * 864e5))
  const depreciation = Math.min(c - salvage, Math.round(((c - salvage) * years) / lifeYears))
  return { depreciation, bookValue: c - depreciation, pctWritten: c ? Math.round((depreciation / c) * 100) : 0 }
}

/** Is a warranty still running, ending soon (within `soonDays`), or over? */
export function warrantyState(warrantyEnd, today, soonDays = 30) {
  if (!warrantyEnd || !today) return null
  if (warrantyEnd < today) return 'OVER'
  const days = Math.round((ymdMs(warrantyEnd) - ymdMs(today)) / 864e5)
  return days <= soonDays ? 'SOON' : 'ON'
}
