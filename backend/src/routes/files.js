import express, { Router } from 'express'
import { FILE_MAX_MB, RECORD_TYPES } from '@schoolgiant/shared'
import { authenticate, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import {
  addComment, deleteComment, deleteFile, editComment, listComments, listFiles, openFile, uploadFile,
} from '../services/files.js'

// Files and discussion on records: /api/v1/files, /api/v1/comments (docs/00 §7 E15).
// Access follows the record: whoever may open the student (or other record) sees its files.

const recordType = z.enum(Object.keys(RECORD_TYPES))
const guard = [authenticate, tenantOnly, subscriptionGate]

const files = Router()
files.use(...guard)

files.get('/', async (req, res) => {
  const q = z.union([
    z.object({ studentId: objectId, includeDeleted: z.string().optional() }),
    z.object({ entityType: recordType, entityId: objectId, includeDeleted: z.string().optional() }),
  ]).parse(req.query)
  res.json({ data: await listFiles({ ...q, includeDeleted: q.includeDeleted === '1' }, req.auth) })
})

// The file itself is the request body (any content type); its details ride in the query.
files.post('/', express.raw({ type: () => true, limit: `${FILE_MAX_MB}mb` }), async (req, res) => {
  const q = z.object({ entityType: recordType, entityId: objectId, category: optionalText(30), title: optionalText(120) }).parse(req.query)
  let fileName = req.get('x-file-name') || 'file'
  try { fileName = decodeURIComponent(fileName) } catch { /* keep as sent */ }
  res.status(201).json({ data: await uploadFile({ ...q, fileName }, Buffer.isBuffer(req.body) ? req.body : null, req.auth, req) })
})

files.get('/:id/content', async (req, res) => {
  const { file, stream } = await openFile(objectId.parse(req.params.id), req.auth, req)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', 'private, no-store')
  await new Promise((resolve, reject) => {
    stream.on('error', reject)
    stream.on('end', resolve)
    stream.pipe(res)
  })
})

files.delete('/:id', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why it is removed').max(200) }).parse(req.body ?? {})
  res.json({ data: await deleteFile(objectId.parse(req.params.id), reason, req.auth, req) })
})

const comments = Router()
comments.use(...guard)

comments.get('/', async (req, res) => {
  const q = z.object({ entityType: recordType, entityId: objectId }).parse(req.query)
  res.json({ data: await listComments(q, req.auth) })
})
comments.post('/', async (req, res) => {
  const body = z.object({ entityType: recordType, entityId: objectId, body: z.string().max(4000), parentId: objectId.nullable().optional() }).parse(req.body)
  res.status(201).json({ data: await addComment(body, req.auth, req) })
})
comments.patch('/:id', async (req, res) => {
  const { body } = z.object({ body: z.string().max(4000) }).parse(req.body)
  res.json({ data: await editComment(objectId.parse(req.params.id), body, req.auth) })
})
comments.delete('/:id', async (req, res) => {
  res.json({ data: await deleteComment(objectId.parse(req.params.id), req.auth, req) })
})

export { files as filesRouter, comments as commentsRouter }
