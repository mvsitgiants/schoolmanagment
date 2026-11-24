// Documents (module `documents`).
//   DocumentFolder  a folder in the document library for the school's own files — circulars, forms and formats,
//                   policies, a day's scans to file later. Its files are Attachments (entityType 'doc_folder',
//                   entityId = the folder) and can be used again on any record through "Choose from existing".
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const folderSchema = new Schema({
  name: { type: String, required: true, trim: true },
  note: String,
  createdById: ObjectId,
  createdBy: String,
  removedAt: Date, // an empty folder removed (kept, so a removed file put back still has its folder)
  removedBy: String,
}, { timestamps: true })
folderSchema.plugin(tenantPlugin)
folderSchema.index({ tenantId: 1, name: 1 })

export const DocumentFolder = model('DocumentFolder', folderSchema, 'document_folders')
