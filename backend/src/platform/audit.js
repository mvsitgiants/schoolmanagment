import { AuditLog } from '../models/tenant.js'
import { getContext } from './context.js'
import { logger } from './logger.js'

/**
 * Append an audit entry for the current tenant. Never throws — an audit hiccup
 * must not undo the user's work (the write itself already succeeded).
 */
export async function audit(entry, req) {
  const ctx = getContext()
  try {
    await AuditLog.create({
      ...entry,
      userId: ctx?.superadmin ? undefined : ctx?.userId,
      userName: ctx?.superadmin ? `${ctx.userName} (platform support)` : ctx?.userName || 'System',
      ip: req?.ip,
    })
  } catch (err) {
    logger.warn({ err, entry }, 'audit write failed')
  }
}

const norm = (v) => (v instanceof Date ? v.toISOString() : v && typeof v === 'object' ? JSON.stringify(v) : v ?? null)

/** Field-level changes between two plain objects, for the listed fields. */
export function diffFields(before, after, fields) {
  const changes = []
  for (const field of fields) {
    const a = before?.[field]
    const b = after?.[field]
    if (norm(a) !== norm(b)) changes.push({ field, from: a ?? null, to: b ?? null })
  }
  return changes
}

/** Added / removed members of two string lists (permissions, role ids…). */
export function diffLists(before = [], after = []) {
  const a = new Set(before.map(String))
  const b = new Set(after.map(String))
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) }
}
