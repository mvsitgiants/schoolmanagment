import { config } from '../../config.js'
import { LoginThrottle } from '../../models/platform.js'
import { AppError } from '../errors.js'

// Per-account lockout for staff / platform sign-in. The per-IP limiter (routes/auth.js) doesn't
// stop a slow guess from many addresses at one account; this does: MAX wrong passwords within
// WINDOW lock that email for LOCK. A correct password clears the count. The check runs before
// the password is compared, so a locked account costs no bcrypt work either.

const MAX = config.isTest ? 1000 : 10
const WINDOW_MS = 15 * 60_000
const LOCK_MS = 15 * 60_000

const keyOf = (email) => String(email ?? '').trim().toLowerCase()

export async function assertNotLocked(email) {
  const row = await LoginThrottle.findById(keyOf(email)).select('lockedUntil').lean()
  const until = row?.lockedUntil ? new Date(row.lockedUntil) : null
  if (until && until > new Date()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000))
    throw new AppError(429, `Too many wrong passwords for this account. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask your administrator to reset your password.`, { code: 'ACCOUNT_LOCKED' })
  }
}

export async function recordFailedLogin(email) {
  const _id = keyOf(email)
  const now = new Date()
  // an old window starts again from zero
  await LoginThrottle.updateOne({ _id, windowStart: { $lt: new Date(now - WINDOW_MS) } }, { $set: { fails: 0, windowStart: now } })
  const row = await LoginThrottle.findOneAndUpdate({ _id }, { $inc: { fails: 1 }, $setOnInsert: { windowStart: now } }, { upsert: true, new: true }).lean()
  if (row.fails >= MAX) await LoginThrottle.updateOne({ _id }, { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), fails: 0, windowStart: now } })
}

export const clearFailedLogins = (email) => LoginThrottle.deleteOne({ _id: keyOf(email) })
