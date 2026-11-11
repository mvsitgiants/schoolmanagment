// Print templates (engine E8): the institution letterhead and per-document print layouts.
// The letterhead's name, address and numbers come from the institution profile; this keeps
// only how they are laid out.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const letterheadSchema = new Schema({
  key: { type: String, default: 'MAIN' }, // one letterhead per institution for now
  align: { type: String, default: 'CENTER' },
  showLogo: { type: Boolean, default: true },
  showContacts: { type: Boolean, default: true },
  ids: { type: [String], default: ['affiliationNo', 'schoolCode', 'udiseCode'] },
  tagline: String,
  accentColor: String,
  footerText: String,
  // the school seal and signatures printed on documents whose template says "print the signature and seal"
  // (images as data URLs, like the logo — they print without a sign-in); a campus can have its own (Branch.identity)
  sealUrl: String,
  signatures: { type: [new Schema({ role: String, name: String, title: String, imageUrl: String }, { _id: false })], default: [] },
  updatedBy: String,
}, { timestamps: true })
letterheadSchema.plugin(tenantPlugin)
letterheadSchema.index({ tenantId: 1, key: 1 }, { unique: true })

export const PrintLetterhead = model('PrintLetterhead', letterheadSchema, 'print_letterheads')

const templateSchema = new Schema({
  docType: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false },
  paper: { type: String, default: 'A4' },
  orientation: { type: String, default: 'portrait' },
  margins: { top: Number, right: Number, bottom: Number, left: Number },
  letterhead: { type: String, default: 'FULL' }, // FULL · PREPRINTED · NONE
  headerSpaceMm: Number, // PREPRINTED: blank space kept for the printed header
  footerSpaceMm: Number,
  footerText: String,
  showQr: { type: Boolean, default: true },
  showPrintedOn: { type: Boolean, default: true },
  fontScale: { type: Number, default: 100 },
  signMode: String, // SIGN_MODES; empty = the document's default (defaultSignMode)
  // a campus's own template (e.g. the UP Board TC of the inter college): its records print with it; null = the institution's
  branchId: { type: mongoose.Schema.Types.ObjectId, default: null },
  body: String, // Handlebars body of the document; empty = the built-in template
  active: { type: Boolean, default: true },
  updatedBy: String,
}, { timestamps: true })
templateSchema.plugin(tenantPlugin)
templateSchema.index({ tenantId: 1, docType: 1, name: 1 }, { unique: true })
// at most one default per document
templateSchema.index({ tenantId: 1, docType: 1 }, { unique: true, partialFilterExpression: { isDefault: true } })

export const PrintTemplate = model('PrintTemplate', templateSchema, 'print_templates')
