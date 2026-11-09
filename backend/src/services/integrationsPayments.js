import { IntegrationLog } from '../models/integrations.js'
import { clean } from '../platform/db.js'
import { paymentsView } from './feePayments.js'

// Integrations › Payment gateway: the school's own Razorpay account. The gateway itself (keys, webhook, orders,
// receipts) is Fees' (services/feePayments.js) — this page reads and saves the same IntegrationConfig through it,
// and adds what an integrations admin looks at: health, and the gateway's last webhooks.

/** Setup view + the last 10 webhooks Razorpay sent (redacted outline only). */
export async function paymentsHub(baseUrl) {
  const [view, hooks] = await Promise.all([
    paymentsView(baseUrl),
    IntegrationLog.find({ provider: 'RAZORPAY', direction: 'IN' }).sort({ createdAt: -1 }).limit(10).lean(),
  ])
  const since = new Date(Date.now() - 86_400_000)
  const day = await IntegrationLog.aggregate([{ $match: { provider: 'RAZORPAY', createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  return { ...view, webhooks: clean(hooks), last24h: Object.fromEntries(day.map((d) => [d._id, d.n])) }
}
