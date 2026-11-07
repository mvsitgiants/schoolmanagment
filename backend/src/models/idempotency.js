// A money request's Idempotency-Key and the answer it got (platform/idempotency.js).
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const idempotencyKeySchema = new Schema({
  key: { type: String, required: true },
  userId: String,
  route: String, // "POST /api/v1/billing/bills" — a key is good for one route only
  state: { type: String, enum: ['PENDING', 'DONE'], default: 'PENDING' },
  status: Number,
  body: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false })
idempotencyKeySchema.plugin(tenantPlugin)
idempotencyKeySchema.index({ tenantId: 1, key: 1 }, { unique: true })
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 }) // a retry comes within minutes; a day is generous

export const IdempotencyKey = model('IdempotencyKey', idempotencyKeySchema, 'idempotency_keys')
