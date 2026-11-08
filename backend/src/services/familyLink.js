import { familyPath } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { getContext } from '../platform/context.js'
import { getSettings } from '../platform/settings.js'

/**
 * A link into this school's family app (e.g. `familyLink('results')`), for messages to families —
 * or '' when the app isn't switched on (Settings › App), so a message never points at a closed door.
 */
export async function familyLink(page = '') {
  const tenantId = getContext()?.tenantId
  if (!tenantId) return ''
  if (!(await getSettings('portal'))?.enabled) return ''
  const t = await Tenant.findById(tenantId).select('slug').lean()
  return t?.slug ? `${config.appUrl}${familyPath(t.slug)}${page ? `/${page}` : ''}` : ''
}
