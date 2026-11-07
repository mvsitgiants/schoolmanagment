import nodemailer from 'nodemailer'
import { formatINR } from '@schoolgiant/shared'
import { config } from '../config.js'
import { decrypt } from '../platform/crypto.js'
import { AppError, badRequest } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { emailReady, getPlatformSettings, markEmailVerified } from './platformSettings.js'

// Email the platform itself sends to staff and institution owners (security notices, and later
// sign-in codes, invites and subscription invoices), over the SMTP server set in Superadmin ›
// Settings. Not the institution's own patient messaging (services/messaging.js).

const TIMEOUT_MS = 15_000

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = (d = new Date()) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d)

/**
 * Each template gives a subject and paragraphs (plain text); the layout turns them into the
 * text and HTML bodies, so every email looks the same and nothing unescaped reaches the HTML.
 */
const TEMPLATES = {
  test: ({ company }) => ({
    subject: `Test email from ${company}`,
    lines: ['This is a test from the platform console. Outgoing email is working.'],
  }),
  passwordChanged: ({ name, at, ip, platform }) => ({
    subject: 'Your password was changed',
    lines: [
      `Hello ${name},`,
      `The password for your account was changed on ${at}${ip ? ` from ${ip}` : ''}. Your other devices were signed out.`,
      platform ? 'If this wasn’t you, reset the password from the server straight away.' : 'If this wasn’t you, ask your institution administrator to reset your password straight away.',
    ],
  }),
  loginCode: ({ name, code, minutes }) => ({
    subject: `${code} is your sign-in code`,
    lines: [`Hello ${name},`, `Your sign-in code is ${code}. It works for ${minutes} minutes.`, 'If you didn’t just try to sign in, change your password: someone else knows it.'],
  }),
  verifyEmail: ({ name, code, minutes, link, hours }) => ({
    subject: 'Confirm your email address',
    lines: [`Hello ${name},`, link ? 'Click the button to confirm this is your email address. You don’t need to be signed in.' : `Enter ${code} to confirm this is your email address.`],
    action: link ? { label: 'Confirm my email', url: link } : undefined,
    after: [
      ...(link ? [`The button works once, for ${hours} hours. Or enter this code on your Account page within ${minutes} minutes: ${code}`] : [`The code works for ${minutes} minutes.`]),
      'If you didn’t ask for this, ignore this email.',
    ],
  }),
  portalCode: ({ institution, code, minutes }) => ({
    subject: `${code} is your ${institution} sign-in code`,
    lines: [`Enter ${code} to sign in to the ${institution} patient portal. It works for ${minutes} minutes.`, 'If you didn’t try to sign in, ignore this email. Never share this code — the institution will never ask for it.'],
  }),
  resetCode: ({ code, minutes }) => ({
    subject: `${code} is your password reset code`,
    lines: [`Enter ${code} to choose a new password. It works for ${minutes} minutes.`, 'If you didn’t ask for this, ignore this email — your password stays the same.'],
  }),
  signupCode: ({ name, code, minutes }) => ({
    subject: `${code} is your sign-up code`,
    lines: [`Hello ${name},`, `Enter ${code} to confirm your email and create your institution workspace. It works for ${minutes} minutes.`, 'If you didn’t sign up, ignore this email — nothing has been created.'],
  }),
  welcome: ({ name, institution, trialEnds, email, link }) => ({
    subject: `${institution} is ready`,
    lines: [
      `Hello ${name},`,
      `Your ${institution} workspace is ready${trialEnds ? `, and your free trial runs until ${trialEnds}` : ''}.`,
      `Sign in at ${link} with ${email}. The setup checklist walks you through departments, roles, staff and your price list.`,
    ],
  }),
  invoiceIssued: ({ name, institution, number, amount, due, period, link, attached }) => ({
    subject: `Invoice ${number} for ${institution}: ${amount}`,
    lines: [`Hello ${name},`, `Invoice ${number} for ${institution} (${period}) is ${amount}, due on ${due}.${attached ? ' The invoice is attached.' : ''}`, `Pay it, or download it, in Subscription & billing: ${link}`],
  }),
  invoiceDue: ({ name, institution, number, amount, due, link }) => ({
    subject: `Reminder: invoice ${number} is due ${due}`,
    lines: [`Hello ${name},`, `Invoice ${number} for ${institution} (${amount}) is due on ${due}. Pay it in Subscription & billing to keep everything running: ${link}`],
  }),
  invoiceOverdue: ({ name, institution, number, amount, days, link }) => ({
    subject: `Invoice ${number} is ${days} days overdue`,
    lines: [`Hello ${name},`, `Invoice ${number} for ${institution} (${amount}) is ${days} days past its due date. Unpaid subscriptions are paused after the grace period. Pay it here: ${link}`, 'Already paid? Reply to this email with the payment reference.'],
  }),
  trialEnding: ({ name, institution, days, date, link }) => ({
    subject: days <= 1 ? `${institution}: your free trial ends tomorrow` : `${institution}: your free trial ends in ${days} days`,
    lines: [`Hello ${name},`, `The free trial for ${institution} ends on ${date}. Choose a plan in Subscription & billing so your team keeps working without a break — your data stays exactly as it is: ${link}`],
  }),
  paymentLink: ({ name, institution, number, amount, due, link }) => ({
    subject: `Invoice ${number} for ${institution}: ${amount}`,
    lines: [`Hello ${name},`, `Invoice ${number} for ${institution} is ${amount}${due ? `, due on ${due}` : ''}. Pay online by card, UPI or net banking:`, link, 'The subscription stays active once it is paid. You can also pay from Administration › Subscription & billing.'],
  }),
  invite: ({ name, institution, by, link, days }) => ({
    subject: `You’re invited to ${institution}`,
    lines: [`Hello ${name},`, `${by} added you to ${institution}. Open this link to choose your password and sign in:`, link, `The link works once, for ${days} days.`],
  }),
}

/** `action`: one button (a link in the text version); `after`: paragraphs below it. */
function render(company, { subject, lines, action, after = [] }) {
  const footer = [company.name, company.supportEmail && `Help: ${company.supportEmail}`].filter(Boolean).join(' · ')
  const text = [...lines, ...(action ? [`${action.label}: ${action.url}`] : []), ...after, '', '—', footer].join('\n\n')
  const para = (l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${esc(l)}</p>`
  const button = action ? `<p style="margin:20px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#0E7C86;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px">${esc(action.label)}</a></p>` : ''
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-weight:600;font-size:16px">${esc(company.name)}</p>
${lines.map(para).join('\n')}
${button}
${after.map(para).join('\n')}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${esc(footer)}</p>
</div></body></html>`
  return { subject, text, html }
}

async function deliver(to, template, vars, { attachments } = {}) {
  const s = await getPlatformSettings()
  const e = s.email ?? {}
  if (!e.host || !e.fromEmail) throw badRequest('Set up outgoing email first (SMTP server and from address).')
  const company = { name: s.company?.name || 'SchoolGiant', supportEmail: s.company?.supportEmail }
  const msg = render(company, TEMPLATES[template]({ company: company.name, ...vars }))
  const transport = nodemailer.createTransport({
    host: e.host, port: e.port || (e.secure ? 465 : 587), secure: !!e.secure,
    auth: e.user ? { user: e.user, pass: decrypt(e.pass) ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
  })
  const from = e.fromName ? `"${e.fromName.replace(/"/g, '')}" <${e.fromEmail}>` : e.fromEmail
  await transport.sendMail({ from, to, replyTo: e.replyTo || undefined, ...msg, attachments })
}

/** Send a test email; on success outgoing email counts as working. SMTP errors come back readable. */
export async function sendTestEmail(to) {
  try {
    await deliver(to, 'test', {})
  } catch (err) {
    if (err.status) throw err
    throw badRequest(`The email server refused the message: ${err.message}`)
  }
  await markEmailVerified()
}

/**
 * Send in the background: never delays or fails the request that caused it. Skipped (and
 * logged) while outgoing email isn't working.
 */
export function sendPlatformMail(to, template, vars, opts) {
  if (!to) return
  ;(async () => {
    if (!await emailReady()) { logger.info({ template }, 'platform email not set up — not sent'); return }
    await deliver(to, template, vars, opts)
  })().catch((err) => logger.warn({ err, template }, 'platform email failed'))
}

/** Send a template now, from a request that needs it (a code someone is waiting for). Throws when it can't. */
export async function sendPlatformMailNow(to, template, vars) {
  try {
    await deliver(to, template, vars)
  } catch (err) {
    if (err.status) throw err
    logger.warn({ err, template }, 'platform email failed')
    // not a 5xx: the web app reads those as "server down"
    throw new AppError(409, 'We couldn’t send the email just now. Please try again in a minute.', { code: 'EMAIL_FAILED' })
  }
}

/** Security notice after someone changes their own password (`platform`: a platform owner). */
export function mailPasswordChanged(user, req, { platform = false } = {}) {
  sendPlatformMail(user.email, 'passwordChanged', { name: user.name, at: when(), ip: req.ip, platform })
}

/** The invite link (services/users.js). The token rides in the fragment, so it never reaches a server log. */
export function mailInvite(user, token, { institution, by, days }) {
  sendPlatformMail(user.email, 'invite', { name: user.name, institution, by, days, link: `${config.appUrl}/accept-invite#${token}` })
}

/** After an institution is created (self sign-up or by the platform owner): where to sign in, trial end. */
export function mailWelcome(user, tenant) {
  const trialEnds = tenant.trialEndsAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(tenant.trialEndsAt)) : null
  sendPlatformMail(user.email, 'welcome', { name: user.name, institution: tenant.name, trialEnds, email: user.email, link: `${config.appUrl}/login` })
}

/** A payment link for a subscription invoice (Superadmin › Institutions). */
export function mailPaymentLink(owner, { institution, invoice, url }) {
  const due = invoice.dueDate ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(invoice.dueDate)) : null
  sendPlatformMail(owner.email, 'paymentLink', { name: owner.name, institution, number: invoice.number, amount: formatINR(invoice.total), due, link: url })
}
