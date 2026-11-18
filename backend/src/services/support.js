import { randomUUID } from 'node:crypto'
import { FILE_MAX_MB, FILE_TYPES, SUPPORT_ACTIVE, SUPPORT_CATEGORY_BY, SUPPORT_FILES_MAX, SUPPORT_STATUS } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Plan, PlatformUser, SupportFile, SupportTicket, Tenant, nextSeq } from '../models/platform.js'
import { User } from '../models/tenant.js'
import { runAsTenant } from '../platform/context.js'
import { isOid } from '../platform/db.js'
import { badRequest, conflict, forbidden, notFound } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { putFile, readStream } from '../platform/storage.js'
import { escapeRegex } from '../platform/validate.js'
import { sniffType } from './files.js'
import { notifyUsers } from './notify.js'
import { getPlatformSettings } from './platformSettings.js'
import { sendPlatformMail } from './platformMail.js'

// Help & support. A school's staff ask the SchoolGiant team for help from the Help & support page; the team answers
// from Superadmin › Support. Requests live at platform level (SupportTicket) with the school's tenantId: the school's
// side always filters by it, and a staff member sees their own requests — a full-access admin sees all of the
// school's. Team notes (internal) never leave the console. A reply from the team rings the asker's bell and emails
// them; a new request or a school's reply emails the support team.

const oidStr = (v) => (v ? String(v) : null)

// ───────────────────────────────────────────────────────── shapes

function messageDto(m, { team = false } = {}) {
  return {
    id: String(m._id), from: m.from, byName: m.byName ?? null, body: m.body, at: m.at,
    ...(team && { internal: !!m.internal }),
    files: (m.files ?? []).map((f) => ({ id: String(f.fileId), name: f.name, mime: f.mime, size: f.size })),
  }
}

function ticketDto(t, { team = false, full = false } = {}) {
  const shown = (t.messages ?? []).filter((m) => team || !m.internal)
  const last = shown[shown.length - 1]
  return {
    id: String(t._id), ticketNo: t.ticketNo, subject: t.subject, category: t.category, categoryLabel: SUPPORT_CATEGORY_BY[t.category]?.label ?? t.category,
    priority: t.priority, status: t.status, statusLabel: SUPPORT_STATUS[t.status]?.label ?? t.status,
    createdBy: { name: t.createdBy?.name ?? null, ...(team && { email: t.createdBy?.email ?? null, mobile: t.createdBy?.mobile ?? null, userId: oidStr(t.createdBy?.userId) }) },
    createdAt: t.createdAt, updatedAt: t.updatedAt, solvedAt: t.solvedAt ?? null, rating: t.rating?.score ? t.rating : null,
    lastFrom: last?.from ?? null, lastAt: last?.at ?? t.createdAt, messageCount: shown.length,
    ...(team && {
      tenantId: String(t.tenantId), tenantName: t.tenantName, assignedTo: t.assignedTo ?? null, assignedToId: oidStr(t.assignedToId),
      firstReplyAt: t.firstReplyAt ?? null, lastSchoolAt: t.lastSchoolAt ?? null, context: t.context ?? {},
    }),
    ...(full && { context: t.context ?? {}, messages: shown.map((m) => messageDto(m, { team })) }),
  }
}

/** Files uploaded beforehand (uploadSupportFile), checked to belong to this school, for a message. */
async function attach(fileIds = [], tenantId, ticketId) {
  if (!fileIds.length) return []
  if (fileIds.length > SUPPORT_FILES_MAX) throw badRequest(`Up to ${SUPPORT_FILES_MAX} files with one message.`)
  const rows = await SupportFile.find({ _id: { $in: fileIds.filter(isOid) }, tenantId, $or: [{ ticketId: null }, { ticketId }] }).lean()
  if (rows.length !== fileIds.length) throw badRequest('A file is missing. Add it again.')
  await SupportFile.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { ticketId } })
  return rows.map((r) => ({ fileId: r._id, name: r.name, mime: r.mime, size: r.size }))
}

/** Email whoever on the team handles support (active owners and support staff). Never throws. */
async function tellTeam(template, vars) {
  try {
    const team = await PlatformUser.find({ active: true, role: { $in: ['OWNER', 'SUPPORT', null] } }).select('email').lean()
    const to = [...new Set(team.map((u) => u.email).filter(Boolean))]
    const cfg = await getPlatformSettings()
    if (cfg.company?.supportEmail && !to.includes(cfg.company.supportEmail)) to.push(cfg.company.supportEmail)
    for (const email of to) sendPlatformMail(email, template, vars)
  } catch (err) { logger.warn({ err }, 'support: telling the team failed') }
}

// ───────────────────────────────────────────────────────── the school's side

/** The school's view: their own requests, or all of the school's for a full-access admin. */
const mine = (auth) => ({ tenantId: auth.tenantId, ...(auth.fullAccess ? {} : { 'createdBy.userId': auth.userId }) })

async function schoolTicket(id, auth) {
  if (!isOid(id)) throw notFound('Request')
  const t = await SupportTicket.findOne({ _id: id, ...mine(auth) })
  if (!t) throw notFound('Request')
  return t
}

/** How to reach the team: email, phone, WhatsApp, hours — set in Superadmin › Settings. */
export async function supportContact() {
  const cfg = await getPlatformSettings()
  return {
    company: cfg.company?.name || 'SchoolGiant', email: cfg.company?.supportEmail || null, phone: cfg.company?.supportPhone || null,
    whatsapp: cfg.support?.whatsapp || null, hours: cfg.support?.hours || null, note: cfg.support?.note || null,
  }
}

export async function listSchoolTickets(auth, { status } = {}) {
  const filter = mine(auth)
  if (status === 'ACTIVE') filter.status = { $in: ['OPEN', 'IN_PROGRESS', 'WAITING'] }
  else if (status) filter.status = status
  const rows = await SupportTicket.find(filter).sort({ updatedAt: -1 }).limit(200).lean()
  return { all: !!auth.fullAccess, rows: rows.map((t) => ticketDto(t)) }
}

export async function getSchoolTicket(id, auth) {
  return ticketDto((await schoolTicket(id, auth)).toObject(), { full: true })
}

export async function createTicket({ category, subject, body, priority, context, fileIds }, auth) {
  const [tenant, user] = await Promise.all([
    Tenant.findById(auth.tenantId).select('name').lean(),
    User.findById(auth.userId).select('name email mobile').lean(),
  ])
  const ticketNo = `SUP-${String(await nextSeq('SUPPORT')).padStart(5, '0')}`
  const t = new SupportTicket({
    ticketNo, tenantId: auth.tenantId, tenantName: tenant?.name, category: SUPPORT_CATEGORY_BY[category] ? category : 'OTHER', subject,
    priority: priority === 'URGENT' ? 'URGENT' : 'NORMAL', status: 'OPEN',
    createdBy: { userId: auth.userId, name: user?.name ?? auth.user?.name, email: user?.email, mobile: user?.mobile },
    context, lastSchoolAt: new Date(),
  })
  t.messages.push({ from: 'SCHOOL', byId: auth.userId, byName: user?.name ?? auth.user?.name, body, files: await attach(fileIds, auth.tenantId, t._id) })
  await t.save()
  tellTeam('supportNew', { ticketNo, school: t.tenantName, name: t.createdBy.name, subject, category: SUPPORT_CATEGORY_BY[t.category]?.label, urgent: t.priority === 'URGENT', body, link: `${config.appUrl}/superadmin/support/${t._id}` })
  return ticketDto(t.toObject(), { full: true })
}

/** The school writes back; a request that was solved or waiting goes back to the team. */
export async function schoolReply(id, { body, fileIds }, auth) {
  const t = await schoolTicket(id, auth)
  if (t.status === 'CLOSED') throw conflict('This request is closed. Start a new one if you still need help.')
  t.messages.push({ from: 'SCHOOL', byId: auth.userId, byName: auth.user?.name, body, files: await attach(fileIds, auth.tenantId, t._id) })
  if (t.status !== 'IN_PROGRESS') t.status = 'OPEN'
  t.lastSchoolAt = new Date()
  t.solvedAt = undefined
  await t.save()
  tellTeam('supportReply', { ticketNo: t.ticketNo, school: t.tenantName, name: auth.user?.name, subject: t.subject, body, link: `${config.appUrl}/superadmin/support/${t._id}` })
  return ticketDto(t.toObject(), { full: true })
}

/** The school says it is sorted (and may say how the help was). */
export async function schoolSolve(id, { score, note } = {}, auth) {
  const t = await schoolTicket(id, auth)
  if (t.status === 'CLOSED') throw conflict('This request is closed.')
  if (t.status !== 'SOLVED') { t.status = 'SOLVED'; t.solvedAt = new Date() }
  if (score) t.rating = { score: Math.min(5, Math.max(1, Math.round(score))), note: note?.trim() || undefined, at: new Date() }
  await t.save()
  return ticketDto(t.toObject(), { full: true })
}

// ───────────────────────────────────────────────────────── files (both sides)

/** Keep a file for a message not yet sent; the message carries its id. */
export async function uploadSupportFile({ tenantId, fileName, by, byId, fromSupport = false }, buffer) {
  if (!buffer?.length) throw badRequest('The file is empty.')
  if (buffer.length > FILE_MAX_MB * 1024 * 1024) throw badRequest(`Files can be up to ${FILE_MAX_MB} MB.`)
  const name = String(fileName || 'file').replace(/[\\/\0\r\n"]/g, '_').trim().slice(0, 120) || 'file'
  const mime = sniffType(buffer, name)
  if (!mime) throw badRequest('Only PDF, pictures (JPEG, PNG, WebP), Word, Excel, PowerPoint and MP4 / WebM video files can be added.')
  const ext = FILE_TYPES.find((x) => x.mime === mime).ext
  const now = new Date()
  const storageKey = `${tenantId}/support/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
  await putFile(storageKey, buffer)
  const f = await SupportFile.create({ tenantId, name, mime, size: buffer.length, storageKey, by, byId, fromSupport })
  return { id: String(f._id), name, mime, size: buffer.length }
}

/** A file of a request: the school opens only its own (on a request it may see); the team opens any. */
export async function openSupportFile(fileId, auth) {
  if (!isOid(fileId)) throw notFound('File')
  const f = await SupportFile.findById(fileId).lean()
  if (!f) throw notFound('File')
  if (!auth.superadmin) {
    if (String(f.tenantId) !== String(auth.tenantId)) throw notFound('File')
    if (f.ticketId) {
      const t = await SupportTicket.findOne({ _id: f.ticketId, ...mine(auth) }).select('messages.internal messages.files').lean()
      if (!t) throw notFound('File')
      // a file the team kept on an internal note is not the school's to open
      if (t.messages.some((m) => m.internal && m.files.some((x) => String(x.fileId) === String(f._id)))) throw notFound('File')
    } else if (String(f.byId) !== String(auth.userId)) throw forbidden('This file isn’t yours.')
  }
  return { file: f, stream: readStream(f.storageKey) }
}

// ───────────────────────────────────────────────────────── the team's side (Superadmin › Support)

/** The inbox: oldest unanswered first, then the rest by last change. */
export async function listAllTickets({ status, priority, tenantId, assignedToId, search }, { page = 1, pageSize = 50 } = {}) {
  const filter = {}
  if (status === 'ACTIVE') filter.status = { $in: SUPPORT_ACTIVE }
  else if (status) filter.status = status
  if (priority) filter.priority = priority
  if (isOid(tenantId)) filter.tenantId = tenantId
  if (assignedToId === 'NONE') filter.assignedToId = null
  else if (isOid(assignedToId)) filter.assignedToId = assignedToId
  if (search?.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i')
    filter.$or = [{ ticketNo: re }, { subject: re }, { tenantName: re }, { 'createdBy.name': re }]
  }
  const [rows, total, counts] = await Promise.all([
    SupportTicket.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ])
  // what needs the team first: open and urgent, waiting longest
  const rank = (t) => (SUPPORT_ACTIVE.includes(t.status) ? 0 : t.status === 'WAITING' ? 1 : 2)
  const time = (d) => new Date(d ?? 0).getTime()
  rows.sort((a, b) => rank(a) - rank(b) || (b.priority === 'URGENT') - (a.priority === 'URGENT')
    || (rank(a) === 0 ? time(a.lastSchoolAt) - time(b.lastSchoolAt) : time(b.updatedAt) - time(a.updatedAt)))
  return { rows: rows.map((t) => ticketDto(t, { team: true })), total, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) }
}

export async function getTeamTicket(id) {
  if (!isOid(id)) throw notFound('Request')
  const t = await SupportTicket.findById(id).lean()
  if (!t) throw notFound('Request')
  const tenant = await Tenant.findById(t.tenantId).select('name slug status planCode profile').lean()
  const plan = tenant?.planCode ? await Plan.findOne({ code: tenant.planCode }).select('name').lean() : null
  const earlier = await SupportTicket.find({ tenantId: t.tenantId, _id: { $ne: t._id } }).sort({ createdAt: -1 }).limit(5).select('ticketNo subject status createdAt').lean()
  return {
    ...ticketDto(t, { team: true, full: true }),
    school: tenant ? { id: String(tenant._id), name: tenant.name, slug: tenant.slug, status: tenant.status, plan: plan?.name ?? null, city: tenant.profile?.city ?? null, phone: tenant.profile?.phone ?? null } : null,
    earlier: earlier.map((e) => ({ id: String(e._id), ticketNo: e.ticketNo, subject: e.subject, status: e.status, createdAt: e.createdAt })),
  }
}

/** The team answers (or keeps a note for itself). An answer waits for the school unless another status is picked. */
export async function teamReply(id, { body, internal = false, status, fileIds }, auth) {
  const t = await SupportTicket.findById(id)
  if (!t) throw notFound('Request')
  t.messages.push({ from: 'SUPPORT', byId: auth.user?._id, byName: auth.user?.name, body, internal, files: await attach(fileIds, t.tenantId, t._id) })
  if (!internal) {
    t.status = status && SUPPORT_STATUS[status] ? status : 'WAITING'
    t.lastSupportAt = new Date()
    if (!t.firstReplyAt) t.firstReplyAt = new Date()
    if (t.status === 'SOLVED') t.solvedAt = new Date()
    if (!t.assignedToId && auth.user?._id) { t.assignedToId = auth.user._id; t.assignedTo = auth.user.name }
  } else if (status && SUPPORT_STATUS[status]) t.status = status
  await t.save()
  if (!internal) await tellAsker(t, body)
  return getTeamTicket(id)
}

/** Status, urgency or who looks after it. */
export async function updateTeamTicket(id, { status, priority, assignedToId }) {
  const t = await SupportTicket.findById(id)
  if (!t) throw notFound('Request')
  if (status && SUPPORT_STATUS[status]) { t.status = status; if (status === 'SOLVED') t.solvedAt = new Date() }
  if (priority) t.priority = priority === 'URGENT' ? 'URGENT' : 'NORMAL'
  if (assignedToId !== undefined) {
    const u = assignedToId ? await PlatformUser.findById(assignedToId).select('name').lean() : null
    t.assignedToId = u?._id
    t.assignedTo = u?.name
  }
  await t.save()
  return getTeamTicket(id)
}

/** The team's people who can be given a request. */
export async function supportStaff() {
  const rows = await PlatformUser.find({ active: true }).select('name role').sort({ name: 1 }).lean()
  return rows.map((u) => ({ id: String(u._id), name: u.name, role: u.role ?? 'OWNER' }))
}

/** The asker's bell (and an email): the team answered. Never throws. */
async function tellAsker(t, body) {
  try {
    const link = `/help?request=${t._id}`
    if (t.createdBy?.userId) {
      await runAsTenant(t.tenantId, () => notifyUsers([t.createdBy.userId], {
        event: 'support.reply', title: `Support replied: ${t.subject}`.slice(0, 140), message: body.slice(0, 200), link, tone: 'info',
        entityType: 'support_ticket', entityId: String(t._id),
      }))
    }
    if (t.createdBy?.email) sendPlatformMail(t.createdBy.email, 'supportAnswered', { name: t.createdBy.name, ticketNo: t.ticketNo, subject: t.subject, body, link: `${config.appUrl}${link}` })
  } catch (err) { logger.warn({ err }, 'support: telling the school failed') }
}

