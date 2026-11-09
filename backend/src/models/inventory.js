// Store & assets (module `inventory`). Tenant-scoped. Money in paise, business dates YYYY-MM-DD.
//
//   StoreItem           what the store keeps (stationery, uniforms in sizes, books …), its rate, sale price, reorder level
//   StoreStock          how many of an item (in one size) a campus store holds now
//   StoreMove           the stock ledger: every receipt, issue, return, adjustment and sale — append only
//   StoreVendor         a supplier
//   StorePurchaseOrder  an order to a vendor: draft → submitted → approved → (partly) received, or cancelled
//   StoreSale           uniforms and books sold to a student at the counter
//   StoreCount          a physical stock count; posting it adjusts the stock to what was counted
//   StoreAsset          the asset register: tag, place, who has it, cost, warranty, depreciation, upkeep, disposal
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const stamp = () => ({ by: String, byId: ObjectId, at: Date })

const sizeSchema = new Schema({ size: { type: String, required: true }, salePrice: Number }, { _id: false })

const itemSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true }, // STORE_CATEGORIES
  unit: { type: String, default: 'PCS' }, // STORE_UNITS
  rate: { type: Number, default: 0 }, // purchase rate per unit (the last one received)
  sellable: { type: Boolean, default: false }, // sold to students at the counter
  salePrice: Number, // per unit, for sellable items
  sizes: { type: [sizeSchema], default: [] }, // uniforms: 28, 30, 32 … — stock is kept per size
  reorderLevel: { type: Number, default: 0 },
  location: { type: String, trim: true }, // rack / shelf in the store
  hasExpiry: { type: Boolean, default: false }, // lab chemicals and the like: receipts note the expiry
  description: String,
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true })
itemSchema.plugin(tenantPlugin)
itemSchema.index({ tenantId: 1, code: 1 }, { unique: true })
itemSchema.index({ tenantId: 1, category: 1, name: 1 })
export const StoreItem = model('StoreItem', itemSchema, 'store_items')

const stockSchema = new Schema({
  itemId: { type: ObjectId, required: true },
  branchId: { type: ObjectId, default: null },
  size: { type: String, default: '' },
  qty: { type: Number, default: 0, min: 0 },
  expiry: String, // the nearest expiry noted on a receipt (optional)
  lastMovedAt: Date,
}, { timestamps: true })
stockSchema.plugin(tenantPlugin)
stockSchema.index({ tenantId: 1, itemId: 1, branchId: 1, size: 1 }, { unique: true })
stockSchema.index({ tenantId: 1, branchId: 1 })
export const StoreStock = model('StoreStock', stockSchema, 'store_stock')

const partySchema = new Schema({ kind: String, id: ObjectId, name: String }, { _id: false }) // STORE_ISSUE_TO

const moveSchema = new Schema({
  itemId: { type: ObjectId, required: true },
  itemName: String, category: String, unit: String,
  branchId: { type: ObjectId, default: null },
  size: { type: String, default: '' },
  type: { type: String, required: true }, // STORE_MOVE_TYPES
  qty: { type: Number, required: true }, // + in, − out
  balance: Number, // stock after this entry
  rate: Number, value: Number, // paise: the item's rate then, and |qty| × rate
  party: partySchema, // issued to / returned by
  reason: String, // STORE_ADJUST_REASONS (adjustments)
  refType: String, refId: ObjectId, refNo: String, // PO receipt, sale, count
  note: String,
  date: { type: String, required: true },
  by: String, byId: ObjectId,
  at: { type: Date, default: Date.now },
})
moveSchema.plugin(tenantPlugin)
moveSchema.index({ tenantId: 1, branchId: 1, at: -1 })
moveSchema.index({ tenantId: 1, itemId: 1, at: -1 })
moveSchema.index({ tenantId: 1, type: 1, date: -1 })
export const StoreMove = model('StoreMove', moveSchema, 'store_moves')

const vendorSchema = new Schema({
  name: { type: String, required: true, trim: true },
  contactPerson: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  gstin: { type: String, trim: true, uppercase: true },
  address: String,
  categories: { type: [String], default: [] }, // what they supply (STORE_CATEGORIES)
  note: String,
  active: { type: Boolean, default: true },
}, { timestamps: true })
vendorSchema.plugin(tenantPlugin)
vendorSchema.index({ tenantId: 1, name: 1 })
export const StoreVendor = model('StoreVendor', vendorSchema, 'store_vendors')

const poLineSchema = new Schema({
  itemId: { type: ObjectId, required: true },
  name: String, unit: String,
  size: { type: String, default: '' },
  qty: { type: Number, required: true },
  rate: { type: Number, required: true }, // paise per unit
  amount: Number,
  receivedQty: { type: Number, default: 0 },
})

const receiptSchema = new Schema({
  grnNo: String, // <PO no>-R1, -R2 …
  date: String,
  invoiceNo: String,
  lines: [{ lineId: ObjectId, itemId: ObjectId, name: String, size: String, qty: Number, expiry: String, _id: false }],
  value: Number,
  note: String,
  by: String, byId: ObjectId, at: Date,
}, { _id: true })

const poSchema = new Schema({
  poNo: { type: String, required: true },
  branchId: { type: ObjectId, default: null },
  vendorId: { type: ObjectId, required: true },
  vendorName: String,
  date: { type: String, required: true },
  expectedOn: String,
  status: { type: String, default: 'DRAFT' }, // PO_STATUS
  lines: [poLineSchema],
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  terms: String,
  note: String,
  created: stamp(),
  submitted: stamp(),
  approved: { ...stamp(), note: String },
  cancelled: { ...stamp(), reason: String },
  receipts: { type: [receiptSchema], default: [] },
}, { timestamps: true })
poSchema.plugin(tenantPlugin)
poSchema.index({ tenantId: 1, poNo: 1 }, { unique: true })
poSchema.index({ tenantId: 1, status: 1, date: -1 })
poSchema.index({ tenantId: 1, vendorId: 1, date: -1 })
export const StorePurchaseOrder = model('StorePurchaseOrder', poSchema, 'store_purchase_orders')

const saleSchema = new Schema({
  saleNo: { type: String, required: true },
  branchId: { type: ObjectId, default: null },
  date: { type: String, required: true },
  studentId: { type: ObjectId, required: true },
  student: { name: String, admissionNo: String, class: String },
  lines: [{ itemId: ObjectId, name: String, category: String, size: String, qty: Number, rate: Number, amount: Number, _id: false }],
  total: { type: Number, required: true },
  mode: { type: String, required: true }, // STORE_SALE_MODES
  reference: String,
  status: { type: String, default: 'PAID' }, // STORE_SALE_STATUS
  by: String, byId: ObjectId,
  at: { type: Date, default: Date.now },
  cancelled: { ...stamp(), reason: String, on: String },
}, { timestamps: true })
saleSchema.plugin(tenantPlugin)
saleSchema.index({ tenantId: 1, saleNo: 1 }, { unique: true })
saleSchema.index({ tenantId: 1, branchId: 1, date: -1 })
saleSchema.index({ tenantId: 1, studentId: 1, date: -1 })
export const StoreSale = model('StoreSale', saleSchema, 'store_sales')

const countSchema = new Schema({
  branchId: { type: ObjectId, default: null },
  category: String, // only this category (none: every item)
  date: { type: String, required: true },
  status: { type: String, default: 'OPEN' }, // STORE_COUNT_STATUS
  lines: [{ itemId: ObjectId, name: String, category: String, unit: String, size: String, systemQty: Number, countedQty: Number, _id: false }],
  note: String,
  created: stamp(),
  posted: { ...stamp(), adjusted: Number, value: Number },
  cancelled: stamp(),
}, { timestamps: true })
countSchema.plugin(tenantPlugin)
countSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 })
export const StoreCount = model('StoreCount', countSchema, 'store_counts')

const maintenanceSchema = new Schema({
  date: { type: String, required: true },
  kind: { type: String, default: 'REPAIR' }, // ASSET_MAINTENANCE_KINDS
  description: { type: String, required: true },
  cost: { type: Number, default: 0 },
  vendor: String,
  nextDue: String,
  by: String, byId: ObjectId, at: Date,
})

const assetSchema = new Schema({
  assetTag: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true }, // ASSET_CATEGORIES
  make: String, model: String, serialNo: String,
  branchId: { type: ObjectId, default: null },
  roomId: ObjectId, roomName: String, // Timetable › Rooms
  location: String, // anything else: "Principal's office", "Store room 2"
  assignedTo: { userId: ObjectId, name: String },
  vendorId: ObjectId, vendorName: String,
  purchase: { date: String, cost: Number, invoiceNo: String, poNo: String },
  warrantyEnd: String,
  depreciation: { lifeYears: Number, salvagePct: { type: Number, default: 0 } },
  condition: { type: String, default: 'GOOD' }, // ASSET_CONDITIONS
  status: { type: String, default: 'IN_USE' }, // ASSET_STATUS
  maintenance: { type: [maintenanceSchema], default: [] },
  disposal: { date: String, method: String, amount: Number, reason: String, by: String, byId: ObjectId, at: Date },
  lastVerified: { at: Date, by: String }, // physically seen in an audit — its tag scanned (Scan › Verify)
  note: String,
  createdBy: String,
}, { timestamps: true })
assetSchema.plugin(tenantPlugin)
assetSchema.index({ tenantId: 1, assetTag: 1 }, { unique: true })
assetSchema.index({ tenantId: 1, branchId: 1, category: 1 })
assetSchema.index({ tenantId: 1, roomId: 1 })
export const StoreAsset = model('StoreAsset', assetSchema, 'store_assets')
