import { z } from 'zod'
import { isOid } from './db.js'

export { z }

export const objectId = z.string().refine(isOid, 'Invalid id')
export const optionalText = (max = 200) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined))
export const email = z.string().trim().toLowerCase().email('Enter a valid email address')
export const mobile = z.string().trim().regex(/^[+\d][\d\s-]{6,16}$/, 'Enter a valid mobile number')

/** ?page=&pageSize=&search=&sort= → normalised values. */
export function pageParams(q = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 25))
  return { page, pageSize, skip: (page - 1) * pageSize, search: String(q.search || '').trim() }
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Case-insensitive "contains" across fields. */
export function searchFilter(search, fields) {
  if (!search) return {}
  const re = new RegExp(escapeRegex(search), 'i')
  return { $or: fields.map((f) => ({ [f]: re })) }
}

export const listResponse = (items, total, { page, pageSize }) => ({
  data: items,
  meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
})
