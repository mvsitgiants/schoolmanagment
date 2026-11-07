import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { config } from '../../config.js'

export const ACCESS_COOKIE = 'hx_at'
export const REFRESH_COOKIE = 'hx_rt'
const REFRESH_PATH = '/api/v1/auth'

/** Access token claims: sub (user id), sid (session id), tid (tenant id) or sa (superadmin). */
export const signAccess = (claims) =>
  jwt.sign(claims, config.jwtSecret, { expiresIn: config.accessTtlSec, algorithm: 'HS256' })

export function verifyAccess(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}

export const newRefreshToken = () => randomBytes(48).toString('base64url')
export const hashToken = (t) => createHash('sha256').update(t).digest('hex')

export const hashPassword = (pw) => bcrypt.hash(pw, 10)
export const checkPassword = (pw, hash) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false))

const baseCookie = (res) => {
  const origin = res?.req?.get('origin') || ''
  const isCrossSite = origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')
  if (isCrossSite) {
    return { httpOnly: true, sameSite: 'none', secure: true }
  }
  return { httpOnly: true, sameSite: 'lax', secure: config.isProd }
}

export function setAuthCookies(res, { access, refresh }) {
  const opts = baseCookie(res)
  res.cookie(ACCESS_COOKIE, access, { ...opts, path: '/', maxAge: config.accessTtlSec * 1000 })
  if (refresh) {
    res.cookie(REFRESH_COOKIE, refresh, { ...opts, path: '/', maxAge: config.refreshTtlDays * 864e5 })
  }
}

export function clearAuthCookies(res) {
  const opts = baseCookie(res)
  res.clearCookie(ACCESS_COOKIE, { ...opts, path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: REFRESH_PATH })
}

/** Password rule shown on every password form. */
export const PASSWORD_RULE = 'At least 8 characters, with a letter and a number.'
export const isStrongPassword = (pw) => typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw)
