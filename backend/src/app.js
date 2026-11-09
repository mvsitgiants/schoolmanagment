import { registerFinanceListeners } from './services/financePosting.js'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { isAllowedOrigin } from './config.js'
import { contextMiddleware } from './platform/context.js'
import { errorHandler, notFoundHandler } from './platform/errors.js'
import { logger } from './platform/logger.js'
import { requireTrustedOrigin } from './platform/middleware.js'
import academicsRoutes from './routes/academics.js'
import attendanceRoutes from './routes/attendance.js'
import documentRoutes from './routes/documents.js'
import feeRoutes from './routes/fees.js'
import examRoutes from './routes/exams.js'
import coeRoutes from './routes/coe.js'
import registrationRoutes from './routes/registration.js'
import programRoutes from './routes/programs.js'
import integrationRoutes from './routes/integrations.js'
import aiRoutes from './routes/ai.js'
import analyticsRoutes from './routes/analytics.js'
import examSeatingRoutes from './routes/examSeating.js'
import questionPaperRoutes from './routes/questionPapers.js'
import yearResultRoutes from './routes/yearResults.js'
import frontOfficeRoutes from './routes/frontOffice.js'
import accreditationRoutes from './routes/accreditation.js'
import placementsRoutes from './routes/placements.js'
import researchRoutes from './routes/research.js'
import alumniRoutes from './routes/alumni.js'
import hostelRoutes from './routes/hostel.js'
import inventoryRoutes from './routes/inventory.js'
import healthRoutes from './routes/health.js'
import canteenRoutes from './routes/canteen.js'
import surveysRoutes from './routes/surveys.js'
import websiteRoutes from './routes/website.js'
import homeworkRoutes from './routes/homework.js'
import certificateRoutes from './routes/certificates.js'
import dashboardRoutes from './routes/dashboard.js'
import scanRoutes from './routes/scan.js'
import reportRoutes from './routes/reports.js'
import { familyRouter, portalRouter } from './routes/portal.js'
import communicationRoutes from './routes/communication.js'
import feePaymentRoutes from './routes/feePayments.js'
import admissionRoutes from './routes/admissions.js'
import admissionPublicRoutes from './routes/admissionsPublic.js'
import websitePublicRoutes from './routes/websitePublic.js'
import surveyPublicRoutes from './routes/surveysPublic.js'
import timetableRoutes from './routes/timetable.js'
import hrmsRoutes from './routes/hrms.js'
import payrollRoutes from './routes/payroll.js'
import financeRoutes from './routes/finance.js'
import lmsRoutes from './routes/lms.js'
import onlineTestRoutes from './routes/onlineTests.js'
import transportRoutes from './routes/transport.js'
import libraryRoutes from './routes/library.js'
import eventRoutes from './routes/events.js'
import studentRoutes from './routes/students.js'
import authRoutes from './routes/auth.js'
import coreRoutes from './routes/core/index.js'
import { commentsRouter, filesRouter } from './routes/files.js'
import hookRoutes from './routes/hooks.js'
import deviceHookRoutes from './routes/deviceHooks.js'
import publicRoutes from './routes/public.js'
import superadminRoutes from './routes/superadmin.js'
import { registerWebhookListeners } from './services/apiKeys.js'
import { registerNotificationListeners } from './services/notify.js'
import commsRoutes from './routes/comms.js'
import { registerPagingSockets } from './services/paging.js'
import { registerChatListeners, registerChatSockets } from './services/chat.js'

// Request log. Every request at debug; at info only what someone should look at — server errors
// and slow requests — so the screens' polling doesn't drown the log. LOG_REQUESTS=true logs all.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 2000
const LOG_ALL = process.env.LOG_REQUESTS === 'true'
function requestLog(req, res, next) {
  const started = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const line = { method: req.method, path: req.baseUrl + req.path, status: res.statusCode, ms: Math.round(ms) }
    if (res.statusCode >= 500) logger.warn(line, 'request failed')
    else if (ms >= SLOW_MS) logger.warn(line, 'slow request')
    else if (LOG_ALL) logger.info(line, 'request')
    else logger.debug(line, 'request')
  })
  next()
}

/** Ready = this instance can serve: the database answers. A load balancer stops sending traffic otherwise. */
async function dbReady() {
  if (mongoose.connection.readyState !== 1) return false
  try {
    await Promise.race([mongoose.connection.db.admin().ping(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000))])
    return true
  } catch { return false }
}

export function createApp() {
  registerNotificationListeners()
  registerWebhookListeners()
  registerFinanceListeners()
  registerPagingSockets()
  registerChatSockets()
  registerChatListeners()
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet())

  // Chrome Private Network Access (PNA) preflight support (public HTTPS -> localhost)
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
    next()
  })

  // Normalize /v1/... to /api/v1/... so clients calling without the /api prefix work seamlessly
  app.use((req, res, next) => {
    if (req.url.startsWith('/v1/')) {
      req.url = '/api' + req.url
    } else if (req.url === '/health') {
      req.url = '/api/health'
    }
    next()
  })

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin))
      },
      credentials: true,
      // a download's file name; how many records a printed document left out (ID cards)
      exposedHeaders: ['Content-Disposition', 'X-Skipped'],
    })
  )
  // inbound webhooks need the raw body (signatures) — before express.json()
  app.use('/api/v1/hooks', hookRoutes)
  app.use('/api/v1/hooks', deviceHookRoutes)
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(requireTrustedOrigin(isAllowedOrigin)) // CSRF: cookie-signed writes only from the app
  app.use(contextMiddleware)
  app.use(requestLog)

  // live: the process is up (restart it if not). ready / health: it can serve — the database answers.
  app.get('/api/health/live', (req, res) => res.json({ ok: true }))
  const ready = async (req, res) => {
    const db = await dbReady()
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'up' : 'down', time: new Date().toISOString() })
  }
  app.get('/api/health/ready', ready)
  app.get('/api/health', ready)
  app.use('/api/v1/public/admissions/:slug', admissionPublicRoutes)
  app.use('/api/v1/public/surveys/:slug', surveyPublicRoutes)
  app.use('/api/v1/public/site/:slug', websitePublicRoutes)
  app.use('/api/v1/public', publicRoutes)
  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/core', coreRoutes)
  app.use('/api/v1/superadmin', superadminRoutes)
  app.use('/api/v1/files', filesRouter)
  app.use('/api/v1/comments', commentsRouter)
  // Module routes mount here as each module is built.
  app.use('/api/v1/academics', academicsRoutes)
  app.use('/api/v1/students', studentRoutes)
  app.use('/api/v1/attendance', attendanceRoutes)
  app.use('/api/v1/fees/online', feePaymentRoutes)
  app.use('/api/v1/fees', feeRoutes)
  app.use('/api/v1/exams/seating', examSeatingRoutes)
  app.use('/api/v1/exams/question-papers', questionPaperRoutes)
  app.use('/api/v1/exams/year-results', yearResultRoutes)
  app.use('/api/v1/exams', examRoutes)
  app.use('/api/v1/coe', coeRoutes)
  app.use('/api/v1/registration', registrationRoutes)
  app.use('/api/v1/programs', programRoutes)
  app.use('/api/v1/integrations', integrationRoutes)
  app.use('/api/v1/ai', aiRoutes)
  app.use('/api/v1/analytics', analyticsRoutes)
  app.use('/api/v1/frontoffice', frontOfficeRoutes)
  app.use('/api/v1/accreditation', accreditationRoutes)
  app.use('/api/v1/placements', placementsRoutes)
  app.use('/api/v1/research', researchRoutes)
  app.use('/api/v1/alumni', alumniRoutes)
  app.use('/api/v1/hostel', hostelRoutes)
  app.use('/api/v1/inventory', inventoryRoutes)
  app.use('/api/v1/health', healthRoutes)
  app.use('/api/v1/canteen', canteenRoutes)
  app.use('/api/v1/surveys', surveysRoutes)
  app.use('/api/v1/website', websiteRoutes)
  app.use('/api/v1/homework', homeworkRoutes)
  app.use('/api/v1/certificates', certificateRoutes)
  app.use('/api/v1/dashboard', dashboardRoutes)
  app.use('/api/v1/scan', scanRoutes)
  app.use('/api/v1/reports', reportRoutes)
  app.use('/api/v1/portal', portalRouter)
  app.use('/api/v1/communication', communicationRoutes)
  app.use('/api/v1/comms', commsRoutes)
  app.use('/api/v1/admissions', admissionRoutes)
  app.use('/api/v1/timetable', timetableRoutes)
  app.use('/api/v1/hrms', hrmsRoutes)
  app.use('/api/v1/payroll', payrollRoutes)
  app.use('/api/v1/finance', financeRoutes)
  app.use('/api/v1/lms', lmsRoutes)
  app.use('/api/v1/online-tests', onlineTestRoutes)
  app.use('/api/v1/transport', transportRoutes)
  app.use('/api/v1/library', libraryRoutes)
  app.use('/api/v1/events', eventRoutes)
  app.use('/api/v1/family/:slug', familyRouter)
  app.use('/api/v1/documents', documentRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
