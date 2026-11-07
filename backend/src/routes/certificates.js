import { Router } from 'express'
import { CERTIFICATE_KINDS } from '@schoolgiant/shared'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { objectId, optionalText, pageParams, z } from '../platform/validate.js'
import { cancelCertificate, issueCertificates, listCertificates, previewCertificate } from '../services/certificates.js'

// Certificates: /api/v1/certificates/*  (the public check is /api/v1/public/verify/certificate/:code)
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate, requireModule('certificates'))

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const issueSchema = z.object({
  kind: z.enum(CERTIFICATE_KINDS.map((k) => k.value)),
  studentIds: z.array(objectId).min(1, 'Pick the student').max(200, 'Up to 200 at a time'),
  issueDate: ymd.optional(),
  purpose: optionalText(120), remarks: optionalText(500),
  conduct: optionalText(40),
  fromClass: optionalText(60), toClass: optionalText(60),
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'e.g. 2026-27').optional(),
  event: optionalText(160), achievement: optionalText(120), eventDate: ymd.optional().or(z.literal('').transform(() => undefined)),
})

router.post('/preview', requirePermission('certificates.issue.create'), async (req, res) => {
  res.json({ data: await previewCertificate(issueSchema.parse(req.body), req.auth) })
})
router.post('/', requirePermission('certificates.issue.create'), async (req, res) => {
  res.status(201).json({ data: await issueCertificates(issueSchema.parse(req.body), req.auth, req) })
})
router.get('/', requirePermission('certificates.register.view', 'certificates.issue.view'), async (req, res) => {
  const q = z.object({
    kind: z.enum(CERTIFICATE_KINDS.map((k) => k.value)).optional(), status: z.enum(['ISSUED', 'CANCELLED']).optional(),
    studentId: objectId.optional(), from: ymd.optional(), to: ymd.optional(),
  }).parse(req.query)
  res.json(await listCertificates(q, pageParams(req.query), req.auth))
})
router.post('/:id/cancel', requirePermission('certificates.register.cancel'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(200) }).parse(req.body)
  res.json({ data: await cancelCertificate(objectId.parse(req.params.id), reason, req.auth, req) })
})

export default router
