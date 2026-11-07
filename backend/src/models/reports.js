// Reports (module `reports`). Tenant-scoped.
//
//   SavedReport  a library report with its inputs and chosen columns, saved under a name (Report
//                builder); shared with roles and, optionally, sent on a schedule to users / emails.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const savedReportSchema = new Schema({
  name: { type: String, required: true, trim: true },
  reportId: { type: String, required: true }, // REPORTS[].id
  params: { type: Schema.Types.Mixed, default: {} }, // date ranges stay as presets (thisMonth …) so a schedule moves on
  columns: { type: [String], default: [] }, // empty = every column
  ownerId: { type: ObjectId, ref: 'User', required: true },
  owner: String,
  sharedRoleIds: { type: [{ type: ObjectId, ref: 'Role' }], default: [] },
  schedule: {
    active: { type: Boolean, default: false },
    frequency: String, // REPORT_FREQUENCIES
    hour: { type: Number, default: 7 }, // institution time
    userIds: { type: [{ type: ObjectId, ref: 'User' }], default: [] }, // a bell notification each
    emails: { type: [String], default: [] }, // a summary by email each
  },
  nextRunAt: Date,
  lastRunAt: Date,
  lastRows: Number,
  lastError: String,
}, { timestamps: true, minimize: false })
savedReportSchema.plugin(tenantPlugin)
savedReportSchema.index({ tenantId: 1, ownerId: 1 })
savedReportSchema.index({ 'schedule.active': 1, nextRunAt: 1 })
export const SavedReport = model('SavedReport', savedReportSchema, 'saved_reports')
