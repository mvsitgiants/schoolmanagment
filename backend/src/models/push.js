// Web push subscriptions (services/push.js): one per browser / installed app that said yes to notifications.
// Staff rows carry the user; family rows carry the family-app session and the students it may hear about.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId

const pushSubscriptionSchema = new Schema({
  kind: { type: String, required: true }, // STAFF · FAMILY
  userId: ObjectId, // STAFF
  sessionId: ObjectId, // FAMILY: the PortalSession
  studentIds: { type: [ObjectId], default: undefined }, // FAMILY
  endpoint: { type: String, required: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  userAgent: String,
  lastSentAt: Date,
  failures: { type: Number, default: 0 },
}, { timestamps: true })
pushSubscriptionSchema.plugin(tenantPlugin)
pushSubscriptionSchema.index({ tenantId: 1, endpoint: 1 }, { unique: true })
pushSubscriptionSchema.index({ tenantId: 1, userId: 1 })
pushSubscriptionSchema.index({ tenantId: 1, studentIds: 1 })
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema, 'push_subscriptions')
