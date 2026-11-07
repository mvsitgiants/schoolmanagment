import { ZodError } from 'zod'
import { logger } from './logger.js'

export class AppError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message)
    this.status = status
    this.code = code || defaultCode(status)
    this.details = details
  }
}

const defaultCode = (s) => ({ 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 402: 'SUBSCRIPTION_INACTIVE', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'LIMIT_REACHED' }[s] || 'ERROR')

export const badRequest = (msg, details) => new AppError(400, msg, { details })
export const unauthorized = (msg = 'Please sign in.') => new AppError(401, msg)
export const forbidden = (msg = "You don't have permission to do this.", details) => new AppError(403, msg, { details })
export const notFound = (what = 'Record') => new AppError(404, `${what} not found.`)
export const conflict = (msg, details) => new AppError(409, msg, { details })
export const limitReached = (msg, details) => new AppError(422, msg, { code: 'LIMIT_REACHED', details })

/** Zod issues → { field: message } for forms. */
export function zodDetails(err) {
  const fields = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    if (!fields[key]) fields[key] = issue.message
  }
  return { fields }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `No API route for ${req.method} ${req.path}`, code: 'NO_ROUTE' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const details = zodDetails(err)
    const first = Object.entries(details.fields)[0]
    return res.status(400).json({ message: first ? `${first[0]}: ${first[1]}` : 'Invalid input.', code: 'VALIDATION', details })
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, code: err.code, details: err.details })
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).filter((k) => k !== 'tenantId').join(', ')
    return res.status(409).json({ message: `This ${field || 'value'} is already in use.`, code: 'DUPLICATE', details: { fields: { [field]: 'Already in use' } } })
  }
  if (err?.name === 'CastError') {
    return res.status(404).json({ message: 'Record not found.', code: 'NOT_FOUND' })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON.', code: 'BAD_JSON' })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'That is too large to upload.', code: 'TOO_LARGE' })
  }
  logger.error({ err, path: req.path }, 'unhandled error')
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' })
}
