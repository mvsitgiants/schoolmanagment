import express, { Router } from 'express'
import { FILE_MAX_MB, SUPPORT_CATEGORIES, SUPPORT_MESSAGE_MAX } from '@schoolgiant/shared'
import { authenticate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  createTicket, getSchoolTicket, listSchoolTickets, openSupportFile, schoolReply, schoolSolve, supportContact, uploadSupportFile,
} from '../services/support.js'
import { articleFeedback, readArticle, searchArticles } from '../services/helpArticles.js'

// Help & support, the school's side: /api/v1/support. Every signed-in staff member may ask and sees their own
// requests (a full-access admin sees all of the school's). Open even when the subscription has lapsed — that is
// often exactly when a school needs help.
const router = Router()
router.use(authenticate, tenantOnly)

const body = z.string().trim().min(2, 'Write a few words').max(SUPPORT_MESSAGE_MAX)
const fileIds = z.array(objectId).max(5).default([])

router.get('/contact', async (req, res) => { res.json({ data: await supportContact() }) })

// help articles (published ones), in the reader's language where translated
const lang = z.string().regex(/^[a-z]{2}$/).optional()
router.get('/articles', async (req, res) => {
  const q = z.object({ q: z.string().max(100).optional(), page: z.string().max(80).optional(), lang }).parse(req.query)
  res.json({ data: await searchArticles(q) })
})
router.get('/articles/:slug', async (req, res) => {
  res.json({ data: await readArticle(z.string().max(80).parse(req.params.slug), lang.parse(req.query.lang)) })
})
router.post('/articles/:slug/feedback', async (req, res) => {
  const { helpful } = z.object({ helpful: z.boolean() }).parse(req.body)
  res.json({ data: await articleFeedback(z.string().max(80).parse(req.params.slug), helpful) })
})

router.get('/tickets', async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'OPEN', 'IN_PROGRESS', 'WAITING', 'SOLVED', 'CLOSED']).optional() }).parse(req.query)
  res.json({ data: await listSchoolTickets(req.auth, { status }) })
})
router.post('/tickets', async (req, res) => {
  const input = z.object({
    category: z.enum(SUPPORT_CATEGORIES.map((c) => c.value)), subject: z.string().trim().min(3, 'Say in a few words what it is about').max(160), body,
    priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'), fileIds,
    context: z.object({ path: optionalText(300), module: optionalText(60), page: optionalText(80), userAgent: optionalText(400), appVersion: optionalText(40) }).default({}),
  }).parse(req.body)
  res.status(201).json({ data: await createTicket(input, req.auth) })
})
router.get('/tickets/:id', async (req, res) => { res.json({ data: await getSchoolTicket(req.params.id, req.auth) }) })
router.post('/tickets/:id/messages', async (req, res) => {
  res.json({ data: await schoolReply(req.params.id, z.object({ body, fileIds }).parse(req.body), req.auth) })
})
router.post('/tickets/:id/solve', async (req, res) => {
  const input = z.object({ score: z.number().int().min(1).max(5).optional(), note: optionalText(500) }).parse(req.body ?? {})
  res.json({ data: await schoolSolve(req.params.id, input, req.auth) })
})

// a file for a message about to be sent: the body is the file, its name in X-File-Name
router.post('/files', express.raw({ type: () => true, limit: `${FILE_MAX_MB}mb` }), async (req, res) => {
  let fileName = req.get('x-file-name') || 'file'
  try { fileName = decodeURIComponent(fileName) } catch { /* keep as sent */ }
  res.status(201).json({ data: await uploadSupportFile({ tenantId: req.auth.tenantId, fileName, by: req.auth.user?.name, byId: req.auth.userId }, Buffer.isBuffer(req.body) ? req.body : null) })
})
router.get('/files/:id', async (req, res) => { await sendSupportFile(req, res) })

/** Stream a request's file (school or team; access checked by openSupportFile). */
export async function sendSupportFile(req, res) {
  const { file, stream } = await openSupportFile(req.params.id, req.auth)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', 'private, no-store')
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
}

export default router
