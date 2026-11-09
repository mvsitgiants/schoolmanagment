// AI assistant (module `ai`). Tenant-scoped.
//
//   AiUsage   one call to the model: what for, which model, tokens in and out, who asked.
//             The assistant page shows this month's total; a monthly cap (AI_MONTHLY_TOKEN_CAP) reads it.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const aiUsageSchema = new Schema({
  feature: { type: String, required: true }, // AI_FEATURES
  model: { type: String, required: true },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  cacheReadTokens: { type: Number, default: 0 },
  cacheWriteTokens: { type: Number, default: 0 },
  ok: { type: Boolean, default: true },
  stopReason: String,
  month: { type: String, required: true }, // YYYY-MM in the institution's timezone
  userId: ObjectId,
  userName: String,
  at: { type: Date, default: Date.now },
})
aiUsageSchema.plugin(tenantPlugin)
aiUsageSchema.index({ tenantId: 1, month: 1, feature: 1 })
aiUsageSchema.index({ tenantId: 1, at: -1 })

export const AiUsage = model('AiUsage', aiUsageSchema, 'ai_usage')
