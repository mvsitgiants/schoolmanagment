// Print templates (engine E8): the institution letterhead and per-document print layouts.
// The letterhead's name, address and numbers come from the institution profile; this keeps
// only how they are laid out.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const letterheadSchema = new Schema({
  key: { type: String, default: 'MAIN' }, // one letterhead per institution for now
  align: { type: String, default: 'LEFT' },
  showLogo: { type: Boolean, default: true },
  showContacts: { type: Boolean, default: true },
  ids: { type: [String], default: ['registrationNo', 'nabhNo'] },
  tagline: String,
  accentColor: String,
  footerText: String,
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
  body: String, // Handlebars body of the document; empty = the built-in template
  active: { type: Boolean, default: true },
  updatedBy: String,
}, { timestamps: true })
templateSchema.plugin(tenantPlugin)
templateSchema.index({ tenantId: 1, docType: 1, name: 1 }, { unique: true })
// at most one default per document
templateSchema.index({ tenantId: 1, docType: 1 }, { unique: true, partialFilterExpression: { isDefault: true } })

export const PrintTemplate = model('PrintTemplate', templateSchema, 'print_templates')
