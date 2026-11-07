import { formatINR } from '@schoolgiant/shared'
import { config } from '../config.js'
import { SubscriptionInvoice, Tenant } from '../models/platform.js'
import { User } from '../models/tenant.js'
import { runAsTenant } from '../platform/context.js'
import { logger } from '../platform/logger.js'
import { pdfOrNull } from '../platform/pdf.js'
import { sendPlatformMail } from './platformMail.js'
import { emailReady } from './platformSettings.js'
import { invoiceFileName, renderInvoiceHtml } from './subscriptionInvoiceDoc.js'

// Billing emails to an institution's owner (and its billing email): a new invoice (PDF attached when
// Gotenberg is set up), the trial ending (7, 3, 1 days before), an invoice due tomorrow, and an
// overdue invoice once a week. Run by the hourly billing job (services/subscription.js). Each
// email is claimed first (an atomic $addToSet on remindersSent), so it goes out at most once.

const DAY = 864e5
const TRIAL_STEPS = [1, 3, 7]
const MAX_OVERDUE_WEEKS = 6
const day = (d) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(d))
const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const link = () => `${config.appUrl}/core/subscription`

/** Owner and the institution's billing email, without repeats. */
async function recipients(tenant) {
  const owner = tenant.ownerUserId ? await runAsTenant(tenant._id, () => User.findById(tenant.ownerUserId).select('name email active').lean()) : null
  const out = new Map()
  if (owner?.active && owner.email) out.set(owner.email.toLowerCase(), owner.name)
  const billing = tenant.profile?.email?.trim().toLowerCase()
  if (billing && !out.has(billing)) out.set(billing, tenant.name)
  return [...out].map(([email, name]) => ({ email, name }))
}

const claim = (Model, id, key) => Model.updateOne({ _id: id, remindersSent: { $ne: key } }, { $addToSet: { remindersSent: key } }).then((r) => r.modifiedCount === 1)

async function send(tenant, template, vars, opts) {
  for (const r of await recipients(tenant)) sendPlatformMail(r.email, template, { name: r.name, institution: tenant.name, ...vars }, opts)
}

/** A new invoice to pay: emailed once, with the PDF when one can be made. */
export async function notifyInvoiceIssued(invoice, tenant) {
  if (invoice.status !== 'DUE' || !invoice.total || !await emailReady()) return false
  if (!await claim(SubscriptionInvoice, invoice._id, 'issued')) return false
  const pdf = await pdfOrNull(await renderInvoiceHtml(invoice), { fileName: invoiceFileName(invoice) })
  await send(tenant, 'invoiceIssued', {
    number: invoice.number, amount: formatINR(invoice.total), due: day(invoice.dueDate),
    period: `${day(invoice.periodStart)} – ${day(invoice.periodEnd)}`, link: link(), attached: !!pdf,
  }, pdf ? { attachments: [{ filename: invoiceFileName(invoice), content: pdf, contentType: 'application/pdf' }] } : undefined)
  return true
}

/** The hourly pass: trial endings, invoices due tomorrow, overdue invoices. */
export async function sendBillingReminders(now = new Date()) {
  if (!await emailReady()) return { sent: 0 }
  let sent = 0

  // new invoices not emailed yet (made inside a plan change, or by this job's renewals)
  const fresh = await SubscriptionInvoice.find({ status: 'DUE', total: { $gt: 0 }, issuedAt: { $gte: new Date(+now - 3 * DAY) }, remindersSent: { $ne: 'issued' } }).lean()
  for (const inv of fresh) {
    const t = await Tenant.findById(inv.tenantId).lean()
    if (t && t.status !== 'CANCELLED' && await notifyInvoiceIssued(inv, t)) sent++
  }

  // trial ending: the nearest step reached (a first run 2 days out sends "3 days", not 7 and 3)
  const trials = await Tenant.find({ status: 'TRIAL', trialEndsAt: { $gt: now, $lte: new Date(+now + 7 * DAY) } }).lean()
  for (const t of trials) {
    const daysLeft = Math.ceil((+new Date(t.trialEndsAt) - +now) / DAY)
    const step = TRIAL_STEPS.find((s) => daysLeft <= s)
    const key = `trial:${ymd(t.trialEndsAt)}:${step}`
    if (!await claim(Tenant, t._id, key)) continue
    // the bigger steps count as done too, so they never arrive after this one
    await Tenant.updateOne({ _id: t._id }, { $addToSet: { remindersSent: { $each: TRIAL_STEPS.filter((s) => s > step).map((s) => `trial:${ymd(t.trialEndsAt)}:${s}`) } } })
    await send(t, 'trialEnding', { days: daysLeft, date: day(t.trialEndsAt), link: link() })
    sent++
  }

  const tenantOf = new Map()
  const tenant = async (id) => {
    if (!tenantOf.has(String(id))) tenantOf.set(String(id), await Tenant.findById(id).lean())
    return tenantOf.get(String(id))
  }

  // due tomorrow
  const dueSoon = await SubscriptionInvoice.find({ status: 'DUE', total: { $gt: 0 }, dueDate: { $gt: now, $lte: new Date(+now + DAY) } }).lean()
  for (const inv of dueSoon) {
    const t = await tenant(inv.tenantId)
    if (!t || t.status === 'CANCELLED' || !await claim(SubscriptionInvoice, inv._id, 'due')) continue
    await send(t, 'invoiceDue', { number: inv.number, amount: formatINR(inv.total), due: day(inv.dueDate), link: link() })
    sent++
  }

  // overdue: once a week, for a few weeks
  const overdue = await SubscriptionInvoice.find({ status: 'DUE', total: { $gt: 0 }, dueDate: { $lte: new Date(+now - DAY) } }).lean()
  for (const inv of overdue) {
    const days = Math.floor((+now - +new Date(inv.dueDate)) / DAY)
    const week = Math.floor(days / 7) + 1
    if (week > MAX_OVERDUE_WEEKS) continue
    const t = await tenant(inv.tenantId)
    if (!t || t.status === 'CANCELLED' || !await claim(SubscriptionInvoice, inv._id, `overdue:${week}`)) continue
    await send(t, 'invoiceOverdue', { number: inv.number, amount: formatINR(inv.total), days, link: link() })
    sent++
  }

  if (sent) logger.info({ sent }, 'billing reminders sent')
  return { sent }
}
