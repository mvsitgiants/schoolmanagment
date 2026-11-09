// Accreditation (module `accreditation`). Tenant-scoped.
//
//   AccrAssessment  one framework's return for one assessment year (NAAC SSR 2025-26, NIRF 2026 …): per metric its
//                   status, a manual value (when SchoolGiant can't compute it, or the computed one is overridden),
//                   a note and, for qualitative metrics, the narrative. Computed values are read live, never stored.
//   AccrEvidence    a piece of evidence (sanction letter, geo-tagged photos, minutes …) for one or more metrics: its files
//                   are attachments (files engine, record type `accreditation_evidence`); DVV marks it verified.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const metricStateSchema = new Schema({
  code: { type: String, required: true },
  status: { type: String, default: 'NOT_STARTED' }, // ACCR_METRIC_STATUS
  manualValue: Number, // used when set (overrides the computed value)
  note: String, // where the value comes from, what it counts
  narrative: String, // qualitative metrics (simple markdown: **bold**, "- " bullets, "## " headings)
  updatedBy: String,
  updatedAt: Date,
}, { _id: false })

const assessmentSchema = new Schema({
  framework: { type: String, required: true }, // ACCR_FRAMEWORKS
  year: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // assessment (academic) year, "2025-26"
  metrics: { type: [metricStateSchema], default: [] },
  createdBy: String,
}, { timestamps: true })
assessmentSchema.plugin(tenantPlugin)
assessmentSchema.index({ tenantId: 1, framework: 1, year: 1 }, { unique: true })
export const AccrAssessment = model('AccrAssessment', assessmentSchema, 'accr_assessments')

const evidenceSchema = new Schema({
  framework: { type: String, required: true },
  metricCodes: { type: [String], default: [] },
  /** Which DVV checklist line it answers ("3.1.1#0" → the metric's first required document). */
  checklist: { type: [String], default: [] },
  year: { type: String, match: /^\d{4}-\d{2}$/ },
  title: { type: String, required: true, trim: true },
  description: String,
  link: { type: String, trim: true }, // a page on the institution's website, when the evidence lives there
  dvv: {
    status: { type: String, default: 'PENDING' }, // ACCR_DVV_STATUS
    note: String, by: String, at: Date,
  },
  uploadedById: ObjectId,
  uploadedBy: String,
}, { timestamps: true })
evidenceSchema.plugin(tenantPlugin)
evidenceSchema.index({ tenantId: 1, framework: 1, metricCodes: 1 })
export const AccrEvidence = model('AccrEvidence', evidenceSchema, 'accr_evidence')
