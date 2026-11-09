import { Router } from 'express'
import { Device } from '../models/integrations.js'
import { authenticate, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { notFound } from '../platform/errors.js'
import { objectId, z } from '../platform/validate.js'
import { phoneScanners } from '../services/devices.js'
import { gateScan, mayUseScanner, myPunchCode, resolveCode } from '../services/scan.js'
import { usePass } from '../services/passes.js'

// Scan: /api/v1/scan/* — what a scanned code is (every signed-in member of staff; what comes back follows their
// own modules, permissions and data scope), the phone gate scanners, and a member of staff's rotating punch code.
const router = Router()
router.use(authenticate, tenantOnly, subscriptionGate)

const codeBody = z.object({ code: z.string().trim().min(1).max(500) })

router.post('/resolve', async (req, res) => {
  res.json({ data: await resolveCode(codeBody.parse(req.body).code, req.auth) })
})

/** The phone scanners this person may scan at (students → mark attendance; staff → staff attendance). */
router.get('/gates', async (req, res) => {
  const all = await phoneScanners()
  res.json({ data: all.filter((d) => { try { mayUseScanner(d.usedFor, req.auth); return true } catch { return false } }) })
})

router.post('/gates/:id', async (req, res) => {
  const id = objectId.parse(req.params.id)
  const body = codeBody.extend({ direction: z.enum(['IN', 'OUT']).optional() }).parse(req.body)
  const d = await Device.findById(id).select('kind usedFor').lean()
  if (!d || d.kind !== 'PHONE') throw notFound('Scanner')
  mayUseScanner(d.usedFor, req.auth)
  res.json({ data: await gateScan(id, body, req.auth) })
})

/** A family's pass, scanned: check in at an event or a parent–teacher meeting, or hand a child over (early pickup). */
router.post('/passes/:kind/:id/:what', async (req, res) => {
  const { kind, what } = z.object({ kind: z.enum(['event', 'meeting', 'pickup']), what: z.enum(['check-in', 'hand-over']) }).parse(req.params)
  if ((kind === 'pickup') !== (what === 'hand-over')) throw notFound('Pass')
  res.json({ data: await usePass(kind, objectId.parse(req.params.id), req.auth, req) })
})

/** My workspace: the code a member of staff shows at a gate scanner (rotates; fresh for 90 seconds). */
router.get('/punch-code', async (req, res) => {
  if (!(req.auth.enabledModules ?? []).includes('hrms')) throw notFound('Staff & HR')
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: await myPunchCode(req.auth) })
})

export default router
