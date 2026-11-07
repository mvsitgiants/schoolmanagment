// Form builder (engine E6): form designs and their published, frozen versions.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed

/** A form being designed. `definition` is the working copy; publishing freezes it as a FormVersion. */
const formSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  use: { type: String, default: 'SURVEY' },
  specialities: [String], // tags: suggested first to staff of these subjects / departments
  definition: { type: Mixed, default: { sections: [] } },
  status: { type: String, default: 'DRAFT' }, // DRAFT · PUBLISHED · ARCHIVED
  version: { type: Number, default: 0 }, // latest published version, 0 = never published
  changedSincePublish: { type: Boolean, default: true },
  publishedAt: Date,
  publishedBy: String,
  updatedBy: String,
  starter: { type: Boolean, default: false },
}, { timestamps: true, minimize: false })
formSchema.plugin(tenantPlugin)
formSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const FormTemplate = model('FormTemplate', formSchema, 'form_templates')

const versionSchema = new Schema({
  formId: { type: ObjectId, required: true },
  version: { type: Number, required: true },
  code: String,
  name: String,
  use: String,
  definition: { type: Mixed, required: true },
  publishedAt: { type: Date, default: Date.now },
  publishedBy: String,
}, { timestamps: true, minimize: false })
versionSchema.plugin(tenantPlugin)
versionSchema.index({ tenantId: 1, formId: 1, version: 1 }, { unique: true })

export const FormVersion = model('FormVersion', versionSchema, 'form_versions')
