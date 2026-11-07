import { SETTINGS, coerceSetting, settingDefaults } from '@schoolgiant/shared'
import { CustomFieldDef, Setting } from '../models/tenant.js'
import { badRequest } from './errors.js'
import { getContext } from './context.js'

// Settings engine (E3): code defaults (packages/shared/settings.js) overridden by
// the tenant's own rows. Read settings through here, never from the collection.

export async function getSettings(module) {
  const rows = await Setting.find({ module }).lean()
  const out = settingDefaults(module)
  for (const r of rows) if (r.key in out) out[r.key] = r.value
  return out
}

export async function getSetting(module, key) {
  return (await getSettings(module))[key]
}

/** Save several settings of one module; unknown keys and bad values are refused. */
export async function saveSettings(module, values) {
  const defs = SETTINGS.filter((s) => s.module === module)
  const fields = {}
  const clean = {}
  for (const [key, raw] of Object.entries(values ?? {})) {
    const def = defs.find((d) => d.key === key)
    if (!def) { fields[key] = 'Unknown setting'; continue }
    const r = coerceSetting(def, raw)
    if (r.error) fields[key] = r.error
    else clean[key] = r.value
  }
  if (Object.keys(fields).length) throw badRequest('Some settings are not valid.', { fields })
  const by = getContext()?.userName
  for (const [key, value] of Object.entries(clean)) {
    await Setting.updateOne({ module, key }, { $set: { value, updatedBy: by } }, { upsert: true })
  }
  return getSettings(module)
}

/** Active custom field definitions for an entity, in display order. */
export const customFieldsFor = (entity) => CustomFieldDef.find({ entity, active: true }).sort({ order: 1, createdAt: 1 }).lean()
