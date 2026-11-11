import { Router } from 'express'
import { cancelPickupPass, createPickupPass, familyPasses } from '../services/passes.js'
import { studentSelfCheckIn, studentSelfStatus } from '../services/selfAttendance.js'
import { forgetFamilySession, pushPublicKey, removePushSubscription, savePushSubscription } from '../services/push.js'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { enabledModuleIds } from '../platform/access.js'
import { audit } from '../platform/audit.js'
import { getContext } from '../platform/context.js'
import { AppError } from '../platform/errors.js'
import { authenticate, requireModule, requirePermission, subscriptionGate, tenantOnly } from '../platform/middleware.js'
import { getSettings, saveSettings } from '../platform/settings.js'
import { objectId, optionalText, z } from '../platform/validate.js'
import { maskMobile } from '@schoolgiant/shared'
import {
  appLink, applyLeave, attendanceFor, cancelLeave, certificatesFor, documentFor, featuresFor, feesFor, getContent, homeFor, homeworkFile, homeworkFor, timetableFor,
  familyChat, familyChatSend, familyChatTeachers, familyChats, familyNoticeFile, familyNotices, familyReadNotice,
  meView, profileFor, publicInfo, resultsFor, saveContent,
} from '../services/portal.js'
import {
  FAMILY_COOKIE, clearFamilyCookie, endFamilySession, readFamilySession, sendFamilyCode, setFamilyCookie, verifyFamilyCode,
} from '../services/portalAuth.js'
import { BLOCKED_STATUSES, effectiveStatus } from '../services/subscription.js'
import { createAppOrder, verifyAppPayment } from '../services/feePayments.js'
import { courseView, itemFile, joinLive, learningFor, markItem, viewItem } from '../services/lmsFamily.js'
import { busFor } from '../services/transport.js'
import { ebookFile, libraryFor } from '../services/libraryFamily.js'
import { familyCancelPreorder, familyCanteen, familyControls, familyPreorder, familyTopupStart, familyTopupVerify } from '../services/canteenFamily.js'
import { familyRespond, familySurvey, familySurveys } from '../services/surveysFill.js'
import { familyComplaints, familyRaiseComplaint } from '../services/frontOfficeComplaints.js'
import { FO_COMPLAINT_CATEGORIES } from '@schoolgiant/shared'
import { familyPlacements, familyRegister as familyPlacementRegister, familyWithdraw as familyPlacementWithdraw } from '../services/placementsFamily.js'
import { familyHealth } from '../services/health.js'
import { familyCancelOutpass, familyHostel, familyRequestOutpass } from '../services/hostel.js'
import { familyAlbum, familyAlbums, familyCalendar, familyEventReply, familyMeetingBook, familyMeetingCancel, familyMeetings, familyPhoto } from '../services/eventsFamily.js'
import { attemptView, logEvent, resultView, saveAnswer, startTest, submitAttempt, testsFor } from '../services/onlineTests.js'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

// ═════════════════════════════════════════════════════════ staff: /api/v1/portal

export const portalRouter = Router()
portalRouter.use(authenticate, tenantOnly, subscriptionGate, requireModule('portal'))

/** The app's address for families, with a QR to print on a notice. */
portalRouter.get('/link', requirePermission('portal.settings.view', 'portal.content.view'), async (req, res) => {
  res.json({ data: await appLink() })
})
/** Settings › App (enabled, student sign-in, fees and marks shown) — kept by the settings engine. */
portalRouter.get('/settings', requirePermission('portal.settings.view'), async (req, res) => {
  res.json({ data: await getSettings('portal') })
})
portalRouter.put('/settings', requirePermission('portal.settings.edit'), async (req, res) => {
  const input = z.object({ enabled: z.boolean(), studentLogins: z.boolean(), showFees: z.boolean(), showMarks: z.boolean(), chat: z.boolean() }).partial().parse(req.body)
  const before = await getSettings('portal')
  const after = await saveSettings('portal', input)
  const changed = Object.keys(input).filter((k) => before[k] !== after[k])
  if (changed.length) await audit({ action: 'UPDATE', module: 'portal', entityType: 'settings', entityId: 'portal', entityName: 'App settings', summary: `Changed the family app settings: ${changed.map((k) => `${k} → ${after[k] ? 'on' : 'off'}`).join(', ')}` }, req)
  res.json({ data: after })
})
portalRouter.get('/content', requirePermission('portal.content.view'), async (req, res) => {
  res.json({ data: await getContent() })
})
portalRouter.put('/content', requirePermission('portal.content.edit'), async (req, res) => {
  const input = z.object({
    welcome: optionalText(300),
    contact: z.object({ phone: optionalText(30), whatsapp: optionalText(30), email: optionalText(120), address: optionalText(300), mapUrl: optionalText(500) }).default({}),
    timings: z.array(z.object({ label: z.string().trim().max(60), hours: z.string().trim().max(80) })).max(12).default([]),
    help: optionalText(1000),
  }).parse(req.body)
  res.json({ data: await saveContent(input, req) })
})

// ═════════════════════════════════════════════════════════ families: /api/v1/family/:slug
//
// No staff sign-in here, and no staff permission is ever granted: the caller is a family, known only
// by this school's app session cookie (services/portalAuth.js). The whole app answers 404 when the
// module is off, the app is switched off (Settings › App), or the school's subscription has stopped.


export const familyRouter = Router({ mergeParams: true })

const limit = (windowMs, max, message) => rateLimit({ windowMs, limit: config.isTest ? 1000 : max, message: { message }, standardHeaders: true, legacyHeaders: false })
const pageLimiter = limit(60_000, 120, 'Too many requests. Try again in a minute.')
const otpLimiter = limit(15 * 60_000, 10, 'Too many codes asked from this network. Try again in a few minutes.')
const verifyLimiter = limit(15 * 60_000, 30, 'Too many tries from this network. Try again in a few minutes.')
const appOff = () => new AppError(404, 'This school’s app isn’t available.', { code: 'APP_OFF' })

/** The school at :slug, if its app is on. Every query after this runs inside it. */
async function familySchool(req, res, next) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw appOff()
  const tenant = await Tenant.findOne({ slug }).lean()
  if (!tenant || BLOCKED_STATUSES.includes(effectiveStatus(tenant))) throw appOff()
  const enabledModules = await enabledModuleIds(tenant._id)
  if (!enabledModules.includes('portal')) throw appOff()
  Object.assign(getContext(), { tenantId: String(tenant._id), userId: null, userName: 'Family app' })
  const settings = await getSettings('portal')
  if (!settings.enabled) throw appOff()
  req.family = { tenant, slug, settings, enabledModules, features: featuresFor(settings, enabledModules) }
  res.setHeader('Cache-Control', 'private, no-store')
  next()
}

/** A signed-in family of this school; sets the students this request may read. */
async function requireFamily(req, res, next) {
  const { session, students } = await readFamilySession(req.cookies?.[FAMILY_COOKIE], req.family.tenant._id, { studentLogins: !!req.family.settings.studentLogins })
  Object.assign(req.family, { session, students })
  getContext().userName = session.kind === 'STUDENT' ? 'Student (family app)' : `Parent ${maskMobile(session.mobile)}`
  next()
}

familyRouter.use(pageLimiter, familySchool)

familyRouter.get('/', async (req, res) => { res.json({ data: await publicInfo(req.family) }) })

/** A web-app manifest for "Add to home screen": opens straight into this school's app. */
familyRouter.get('/manifest.webmanifest', async (req, res) => {
  const { tenant, slug } = req.family
  const color = tenant.profile?.primaryColor || '#0E7C86'
  res.setHeader('Content-Type', 'application/manifest+json')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.send(JSON.stringify({
    id: `/app/${slug}`, name: tenant.name, short_name: tenant.name.slice(0, 24), description: `${tenant.name} — attendance, homework, fees and results for parents.`,
    start_url: `${config.appUrl}/app/${slug}`, scope: `${config.appUrl}/app/${slug}`, display: 'standalone', orientation: 'portrait',
    background_color: '#F5F6F8', theme_color: color,
    icons: [
      ...(tenant.profile?.logoUrl ? [{ src: tenant.profile.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }] : [
        { src: `${config.appUrl}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${config.appUrl}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ]),
      { src: `${config.appUrl}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }))
})

familyRouter.post('/otp', otpLimiter, async (req, res) => {
  const { mobile } = z.object({ mobile: z.string().trim().min(10).max(20) }).parse(req.body)
  res.json({ data: await sendFamilyCode(mobile, { ip: req.ip, studentLogins: !!req.family.settings.studentLogins }) })
})

familyRouter.post('/verify', verifyLimiter, async (req, res) => {
  const { challengeId, code } = z.object({ challengeId: z.string().max(40), code: z.string().max(12) }).parse(req.body)
  const f = req.family
  const { token, session, students } = await verifyFamilyCode(challengeId, code, { ip: req.ip, userAgent: req.get('user-agent'), tenantId: f.tenant._id, studentLogins: !!f.settings.studentLogins })
  setFamilyCookie(res, f.slug, token)
  await audit({ action: 'LOGIN', module: 'portal', entityType: 'portal_session', entityId: String(session._id), entityName: `Mobile ${maskMobile(session.mobile)}`, summary: `Family app sign-in (${session.kind === 'STUDENT' ? 'student' : `parent of ${students.length}`})` }, req)
  res.json({ data: await meView({ ...f, session, students }) })
})

familyRouter.use(requireFamily)

familyRouter.get('/me', async (req, res) => { res.json({ data: await meView(req.family) }) })
familyRouter.get('/push/key', async (req, res) => { res.json({ data: { publicKey: await pushPublicKey() } }) })
familyRouter.post('/push', async (req, res) => {
  const { subscription } = z.object({ subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) }).parse(req.body)
  const f = req.family
  res.json({ data: await savePushSubscription(subscription, { kind: 'FAMILY', sessionId: f.session._id, studentIds: f.students.map((x) => x._id) }, req.get('user-agent')) })
})
familyRouter.post('/push/off', async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body)
  res.json({ data: await removePushSubscription(endpoint) })
})
familyRouter.post('/logout', async (req, res) => {
  await forgetFamilySession(req.family.session._id)
  await endFamilySession(req.family.session._id)
  clearFamilyCookie(res, req.family.slug)
  res.json({ data: { signedOut: true } })
})

const sid = (req) => objectId.parse(req.params.studentId)
familyRouter.get('/students/:studentId/home', async (req, res) => { res.json({ data: await homeFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/attendance', async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query)
  res.json({ data: await attendanceFor(req.family, sid(req), month) })
})
familyRouter.post('/students/:studentId/leave', async (req, res) => {
  const input = z.object({ from: ymd, to: ymd, reason: z.string().trim().min(3, 'Say why').max(300) }).parse(req.body)
  res.status(201).json({ data: await applyLeave(req.family, sid(req), input, req) })
})
familyRouter.post('/students/:studentId/leave/:leaveId/cancel', async (req, res) => {
  res.json({ data: await cancelLeave(req.family, sid(req), req.params.leaveId, req) })
})
familyRouter.get('/students/:studentId/timetable', async (req, res) => { res.json({ data: await timetableFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/homework', async (req, res) => {
  const { when } = z.object({ when: z.enum(['OPEN', 'PAST']).optional() }).parse(req.query)
  res.json({ data: await homeworkFor(req.family, sid(req), { when }) })
})
familyRouter.get('/students/:studentId/homework/:homeworkId/files/:fileId', async (req, res) => {
  const { file, stream } = await homeworkFile(req.family, sid(req), req.params.homeworkId, req.params.fileId)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
})
// learning: courses, material, live classes
familyRouter.get('/students/:studentId/learning', async (req, res) => { res.json({ data: await learningFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/learning/courses/:courseId', async (req, res) => { res.json({ data: await courseView(req.family, sid(req), req.params.courseId) }) })
familyRouter.post('/students/:studentId/learning/courses/:courseId/items/:itemId', async (req, res) => {
  const { done } = z.object({ done: z.boolean().default(true) }).parse(req.body ?? {})
  res.json({ data: await markItem(req.family, sid(req), req.params.courseId, req.params.itemId, done) })
})
familyRouter.get('/students/:studentId/learning/courses/:courseId/items/:itemId/files/:fileId', async (req, res) => {
  const { file, stream } = await itemFile(req.family, sid(req), req.params.courseId, req.params.itemId, req.params.fileId)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
})
familyRouter.post('/students/:studentId/learning/courses/:courseId/items/:itemId/view', async (req, res) => { res.json({ data: await viewItem(req.family, sid(req), req.params.courseId, req.params.itemId) }) })
familyRouter.post('/students/:studentId/learning/live/:liveId/join', async (req, res) => { res.json({ data: await joinLive(req.family, sid(req), req.params.liveId) }) })
// online tests: list, start (or carry on), save answers as they go, report leaving the test, submit, result
// calendar, parent–teacher meetings, photos
familyRouter.get('/students/:studentId/calendar', async (req, res) => {
  const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query)
  res.json({ data: await familyCalendar(req.family, sid(req), q) })
})
familyRouter.put('/students/:studentId/events/:eventId/reply', async (req, res) => {
  const body = z.object({ answer: z.enum(['YES', 'NO']), note: z.string().trim().max(300).optional() }).parse(req.body)
  res.json({ data: await familyEventReply(req.family, sid(req), req.params.eventId, body) })
})
familyRouter.get('/students/:studentId/meetings', async (req, res) => { res.json({ data: await familyMeetings(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/meetings/:sessionId/book', async (req, res) => {
  const body = z.object({ hostId: z.string().regex(/^[a-f0-9]{24}$/i), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(req.body)
  res.json({ data: await familyMeetingBook(req.family, sid(req), req.params.sessionId, body) })
})
familyRouter.delete('/students/:studentId/meetings/bookings/:bookingId', async (req, res) => { res.json({ data: await familyMeetingCancel(req.family, sid(req), req.params.bookingId) }) })
familyRouter.get('/students/:studentId/albums', async (req, res) => { res.json({ data: await familyAlbums(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/albums/:albumId', async (req, res) => { res.json({ data: await familyAlbum(req.family, sid(req), req.params.albumId) }) })
familyRouter.get('/students/:studentId/albums/:albumId/photos/:fileId', async (req, res) => {
  const { file, stream } = await familyPhoto(req.family, sid(req), req.params.albumId, req.params.fileId)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
})

// hostel: room and bed, today's menu, outpasses (ask for one, withdraw one still waiting)
familyRouter.get('/students/:studentId/hostel', async (req, res) => { res.json({ data: await familyHostel(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/hostel/outpasses', async (req, res) => {
  const body = z.object({
    kind: z.enum(['DAY', 'NIGHT', 'HOME', 'MEDICAL']).default('HOME'),
    leaveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), leaveTime: z.string().regex(/^\d{2}:\d{2}$/),
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), returnTime: z.string().regex(/^\d{2}:\d{2}$/),
    reason: z.string().trim().min(3).max(300), destination: optionalText(200),
  }).parse(req.body)
  res.status(201).json({ data: await familyRequestOutpass(req.family, sid(req), body, req) })
})
familyRouter.post('/students/:studentId/hostel/outpasses/:outpassId/cancel', async (req, res) => { res.json({ data: await familyCancelOutpass(req.family, sid(req), req.params.outpassId, req) }) })
// health card (read-only)
familyRouter.get('/students/:studentId/health', async (req, res) => { res.json({ data: await familyHealth(req.family, sid(req)) }) })
// placements: open drives, registering, progress through the rounds, offers
familyRouter.get('/students/:studentId/placements', async (req, res) => { res.json({ data: await familyPlacements(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/placements/:driveId/register', async (req, res) => {
  const body = z.object({ tenthPct: z.coerce.number().min(0).max(100).optional(), twelfthPct: z.coerce.number().min(0).max(100).optional() }).parse(req.body ?? {})
  res.json({ data: await familyPlacementRegister(req.family, sid(req), req.params.driveId, body, req) })
})
familyRouter.post('/students/:studentId/placements/:driveId/withdraw', async (req, res) => { res.json({ data: await familyPlacementWithdraw(req.family, sid(req), req.params.driveId, req) }) })
// complaints: raise one about the child's school life, follow it to resolution
familyRouter.get('/students/:studentId/complaints', async (req, res) => { res.json({ data: await familyComplaints(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/complaints', async (req, res) => {
  const body = z.object({
    category: z.enum(FO_COMPLAINT_CATEGORIES.map((c) => c.value)),
    subject: z.string().trim().min(3, 'Say what it is about').max(150),
    description: z.string().trim().max(3000).optional(),
  }).parse(req.body)
  res.status(201).json({ data: await familyRaiseComplaint(req.family, sid(req), body, req) })
})
// surveys: the school's questionnaires for this child's family (or the student), answered once
familyRouter.get('/students/:studentId/surveys', async (req, res) => { res.json({ data: await familySurveys(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/surveys/:surveyId', async (req, res) => { res.json({ data: await familySurvey(req.family, sid(req), req.params.surveyId) }) })
familyRouter.post('/students/:studentId/surveys/:surveyId', async (req, res) => {
  const { values } = z.object({ values: z.record(z.string(), z.any()).default({}) }).parse(req.body)
  res.status(201).json({ data: await familyRespond(req.family, sid(req), req.params.surveyId, values) })
})
// library: books out, fines, the e-library
familyRouter.get('/students/:studentId/library', async (req, res) => { res.json({ data: await libraryFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/library/ebooks/:titleId/files/:fileId', async (req, res) => {
  const { file, stream } = await ebookFile(req.family, sid(req), req.params.titleId, req.params.fileId)
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
})

// the school bus: route, stop, today's trips, where the bus is
familyRouter.get('/students/:studentId/bus', async (req, res) => { res.json({ data: await busFor(req.family, sid(req)) }) })

familyRouter.get('/students/:studentId/tests', async (req, res) => { res.json({ data: await testsFor(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/tests/:testId/start', async (req, res) => { res.json({ data: await startTest(req.family, sid(req), req.params.testId) }) })
familyRouter.get('/students/:studentId/attempts/:attemptId', async (req, res) => { res.json({ data: await attemptView(req.family, sid(req), req.params.attemptId) }) })
familyRouter.put('/students/:studentId/attempts/:attemptId/answers', async (req, res) => {
  const body = z.object({ index: z.coerce.number().int().min(0).max(500), value: z.union([z.string().max(20000), z.number(), z.array(z.number()).max(10), z.null()]) }).parse(req.body)
  res.json({ data: await saveAnswer(req.family, sid(req), req.params.attemptId, body) })
})
familyRouter.post('/students/:studentId/attempts/:attemptId/events', async (req, res) => {
  res.json({ data: await logEvent(req.family, sid(req), req.params.attemptId, z.object({ type: z.enum(['BLUR', 'FOCUS', 'FULLSCREEN_EXIT', 'FULLSCREEN_ENTER']) }).parse(req.body)) })
})
familyRouter.post('/students/:studentId/attempts/:attemptId/submit', async (req, res) => { res.json({ data: await submitAttempt(req.family, sid(req), req.params.attemptId) }) })
familyRouter.get('/students/:studentId/attempts/:attemptId/result', async (req, res) => { res.json({ data: await resultView(req.family, sid(req), req.params.attemptId) }) })
familyRouter.get('/students/:studentId/fees', async (req, res) => { res.json({ data: await feesFor(req.family, sid(req)) }) })
// pay online: an order for what is due now, then Checkout's signed response
const payLimiter = limit(15 * 60_000, 30, 'Too many payment tries. Try again in a few minutes.')

// canteen: the wallet, online top-up, the parent's controls, pre-orders
familyRouter.get('/students/:studentId/canteen', async (req, res) => { res.json({ data: await familyCanteen(req.family, sid(req)) }) })
familyRouter.put('/students/:studentId/canteen/controls', async (req, res) => {
  const body = z.object({ dailyLimit: z.number().int().min(0).max(10_000_00).nullable().optional(), blockedTags: z.array(z.string().max(20)).max(10).optional(), blockedItemIds: z.array(objectId).max(200).optional() }).parse(req.body)
  res.json({ data: await familyControls(req.family, sid(req), body, req) })
})
familyRouter.post('/students/:studentId/canteen/preorders', async (req, res) => {
  const body = z.object({ date: ymd, lines: z.array(z.object({ itemId: objectId, qty: z.number().int().min(1).max(20) })).min(1).max(20) }).parse(req.body)
  res.status(201).json({ data: await familyPreorder(req.family, sid(req), body, req) })
})
familyRouter.post('/students/:studentId/canteen/preorders/:orderId/cancel', async (req, res) => { res.json({ data: await familyCancelPreorder(req.family, sid(req), req.params.orderId, req) }) })
familyRouter.post('/students/:studentId/canteen/topup', payLimiter, async (req, res) => {
  const { amount } = z.object({ amount: z.number().int().min(100).max(10_000_00) }).parse(req.body)
  res.json({ data: await familyTopupStart(req.family, sid(req), { amount }) })
})
familyRouter.post('/students/:studentId/canteen/topup/verify', payLimiter, async (req, res) => {
  const body = z.object({ orderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) }).parse(req.body)
  res.json({ data: await familyTopupVerify(req.family, sid(req), body) })
})

familyRouter.post('/students/:studentId/pay', payLimiter, async (req, res) => { res.json({ data: await createAppOrder(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/pay/verify', payLimiter, async (req, res) => {
  const body = z.object({ orderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) }).parse(req.body)
  res.json({ data: await verifyAppPayment(req.family, sid(req), body) })
})
familyRouter.get('/students/:studentId/results', async (req, res) => { res.json({ data: await resultsFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/certificates', async (req, res) => { res.json({ data: await certificatesFor(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/profile', async (req, res) => { res.json({ data: await profileFor(req.family, sid(req)) }) })

const sendFile = async (res, req, { file, stream }) => {
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.pipe(res) })
}
familyRouter.get('/students/:studentId/notices', async (req, res) => { res.json({ data: await familyNotices(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/notices/:noticeId/read', async (req, res) => { res.json({ data: await familyReadNotice(req.family, sid(req), req.params.noticeId) }) })
familyRouter.get('/students/:studentId/notices/:noticeId/files/:fileId', async (req, res) => {
  await sendFile(res, req, await familyNoticeFile(req.family, sid(req), req.params.noticeId, req.params.fileId))
})
familyRouter.get('/students/:studentId/chat/teachers', async (req, res) => { res.json({ data: await familyChatTeachers(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/chat', async (req, res) => { res.json({ data: await familyChats(req.family, sid(req)) }) })
familyRouter.get('/students/:studentId/chat/:conversationId', async (req, res) => { res.json({ data: await familyChat(req.family, sid(req), req.params.conversationId) }) })
familyRouter.post('/students/:studentId/chat', async (req, res) => {
  const body = z.object({ staffUserId: objectId, text: z.string().trim().min(1, 'Write something').max(1000) }).parse(req.body)
  res.status(201).json({ data: await familyChatSend(req.family, sid(req), body, req) })
})

/** One of the family's own printed documents (receipt, report card, hall ticket, certificate), as HTML. */
familyRouter.get('/doc/:docType/:id', async (req, res) => {
  const docType = z.enum(['FEE_RECEIPT', 'REPORT_CARD', 'HALL_TICKET', 'YEAR_REPORT_CARD', 'CERTIFICATE']).parse(req.params.docType)
  const html = await documentFor(req.family, docType, req.params.id)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// passes a family shows on their phone: event and meeting passes, and the early-pickup pass (Scan at school)
familyRouter.get('/students/:studentId/passes', async (req, res) => { res.json({ data: await familyPasses(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/pickup-passes', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2, 'Who is collecting?').max(80), relation: z.string().trim().max(40).optional(), mobile: z.string().trim().max(20).optional(), reason: z.string().trim().max(200).optional() }).parse(req.body)
  res.status(201).json({ data: await createPickupPass(req.family, sid(req), body, req) })
})
familyRouter.post('/students/:studentId/pickup-passes/:passId/cancel', async (req, res) => { res.json({ data: await cancelPickupPass(req.family, sid(req), req.params.passId) }) })
// the student app: check in / out from the student's own phone, inside an attendance site (Settings › Attendance)
const selfBody = z.object({
  direction: z.enum(['IN', 'OUT']).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional() }).optional(),
  locationError: z.enum(['DENIED', 'UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED']).optional(),
})
familyRouter.get('/students/:studentId/self-attendance', async (req, res) => { res.json({ data: await studentSelfStatus(req.family, sid(req)) }) })
familyRouter.post('/students/:studentId/self-attendance', async (req, res) => { res.json({ data: await studentSelfCheckIn(req.family, sid(req), selfBody.parse(req.body ?? {})) }) })
