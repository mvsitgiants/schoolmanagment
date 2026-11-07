import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env.NODE_ENV || 'development'
const isTest = env === 'test' || !!process.env.VITEST
const backendDir = fileURLToPath(new URL('..', import.meta.url))

export const config = {
  env,
  isProd: env === 'production',
  isTest,
  port: Number(process.env.PORT) || 4100,
  mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27018/schoolgiant?replicaSet=rs0',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-before-production-000000',
  accessTtlSec: 15 * 60,
  refreshTtlDays: 30,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5190').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  signupEnabled: (process.env.SIGNUP_ENABLED ?? 'true') !== 'false',
  /**
   * Platform owners get an emailed code after the password once email works. The way back in when
   * the mail server breaks: PLATFORM_LOGIN_CODES=false, sign in, fix Superadmin › Settings, remove it.
   */
  platformLoginCodes: (process.env.PLATFORM_LOGIN_CODES ?? 'true') !== 'false',
  /** Background jobs (server.js). RUN_JOBS=false on API-only instances; the leases keep the rest from overlapping. */
  runJobs: (process.env.RUN_JOBS ?? 'true') !== 'false',
  /** Key for field-level encryption of ID numbers (Aadhaar, PAN…). 32+ random bytes in production. */
  dataKey: process.env.DATA_KEY || 'dev-only-data-key-change-me-before-production-00000',
  superadmin: {
    email: process.env.SUPERADMIN_EMAIL || 'owner@schoolgiant.test',
    password: process.env.SUPERADMIN_PASSWORD || 'Owner@123',
  },
  /** The web app's public address, for links sent to families (report cards, receipts, notices). */
  appUrl: (process.env.APP_URL || 'http://localhost:5190').replace(/\/+$/, ''),
  /** disk (default) or s3 — platform/storage.js. */
  storage: (process.env.STORAGE || 'disk').toLowerCase(),
  s3: {
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1',
    prefix: (process.env.S3_PREFIX || '').replace(/^\/+/, '').replace(/([^/])$/, '$1/'), // e.g. "prod/" — keeps environments apart in one bucket
    endpoint: process.env.S3_ENDPOINT || undefined, // only for an S3-compatible store (MinIO, R2…)
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  /** Where attachments are stored on disk (STORAGE=disk). */
  uploadDir: process.env.UPLOAD_DIR || (isTest ? join(tmpdir(), `schoolgiant-test-uploads-${process.pid}`) : join(backendDir, '.data', 'uploads')),
  /** Send queued SMS / WhatsApp / email in the background. Off in tests, which send on demand. */
  sendMessages: (process.env.SEND_MESSAGES ?? (isTest ? 'false' : 'true')) !== 'false',
  /**
   * Gotenberg (HTML → PDF, platform/pdf.js): an internal service, never the public internet.
   * Unset = no server-side PDF; prints stay HTML. Optional basic auth when Gotenberg runs
   * with --api-enable-basic-auth.
   */
  gotenberg: {
    url: (process.env.GOTENBERG_URL || '').trim().replace(/\/+$/, ''),
    timeoutMs: Math.min(120_000, Math.max(3_000, Number(process.env.GOTENBERG_TIMEOUT_MS) || 30_000)),
    username: process.env.GOTENBERG_USERNAME || '',
    password: process.env.GOTENBERG_PASSWORD || '',
  },
}

export function isAllowedOrigin(origin) {
  if (!origin) return true
  const clean = origin.trim().replace(/\/+$/, '').toLowerCase()
  if (config.corsOrigin.some((o) => o.toLowerCase() === clean)) return true
  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()
    // any localhost port only off production — on a staff PC any local page (a dev server, a tool)
    // would otherwise be trusted with the user's cookies; list an on-prem origin in CORS_ORIGIN
    if (!config.isProd && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return true
    if (host === 'schoolgiant.com' || host.endsWith('.schoolgiant.com')) return true
    if (host === 'schoolgiant.web.app' || host === 'schoolgiant.firebaseapp.com') return true
  } catch {}
  return false
}

if (config.isProd && (config.jwtSecret.startsWith('dev-only') || config.dataKey.startsWith('dev-only'))) {
  throw new Error('Set JWT_SECRET and DATA_KEY to long random values in production.')
}
if (config.isProd && (config.jwtSecret.length < 32 || config.dataKey.length < 32)) {
  throw new Error('JWT_SECRET and DATA_KEY must be at least 32 characters in production.')
}

/** True when MONGO_URL points at this machine (local dev / the in-memory test set). */
export function isLocalMongo(url = config.mongoUrl) {
  const hosts = String(url).replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0].split('@').pop().split(',')
  return hosts.every((h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h.trim()))
}

// Everything that keeps production safe (secrets above, no OTP test codes in API replies, secure
// cookies) keys off NODE_ENV=production. A server pointed at a real database with NODE_ENV unset
// would quietly run as development — so a non-local database needs NODE_ENV said out loud.
// Uploaded files (attachments, scans, imaging). With STORAGE=s3 they live in the bucket. On disk,
// inside the app folder they vanish with the next container or deploy — so in production a disk
// store must be a volume of its own, backed up with the database.
if (!['disk', 's3'].includes(config.storage)) throw new Error('STORAGE must be disk or s3.')
if (config.storage === 's3' && !config.s3.bucket) throw new Error('STORAGE=s3 needs S3_BUCKET.')
if (config.isProd && config.storage === 'disk' && (!process.env.UPLOAD_DIR || !isAbsolute(process.env.UPLOAD_DIR) || resolvePath(process.env.UPLOAD_DIR).startsWith(resolvePath(backendDir)))) {
  throw new Error('Set UPLOAD_DIR to an absolute folder on a persistent, backed-up volume outside the app (e.g. /var/lib/schoolgiant/uploads).')
}
if (!process.env.NODE_ENV && !isTest && !isLocalMongo()) {
  throw new Error('MONGO_URL is not a local database, so set NODE_ENV explicitly: NODE_ENV=production on a server, NODE_ENV=development for a dev machine using a remote database.')
}

