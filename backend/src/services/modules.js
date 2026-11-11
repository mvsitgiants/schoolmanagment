import {
  MODULES, MODULE_BY_ID, PAGE_BY_KEY, addOnActive, closeOverDependencies, dependentsOf, effectiveModules, missingDependencies,
} from '@schoolgiant/shared'
import { Plan, Tenant } from '../models/platform.js'
import { TenantModule } from '../models/tenant.js'
import { bumpAccessVersion, enabledModuleIds } from '../platform/access.js'
import { getContext, runAsTenant } from '../platform/context.js'
import { badRequest, conflict, notFound } from '../platform/errors.js'

/**
 * Make the tenant's modules match a plan: every plan module (plus hard dependencies)
 * on, everything else off. Role permissions are kept, so switching a module back on
 * restores what roles had (docs/04 §6).
 */
export async function syncModulesToPlan(tenantId, plan) {
  const tenant = await Tenant.findById(tenantId).select('moduleAdds moduleRemovals').lean()
  // the plan's modules, with this institution's own add-ons and removals (Super admin › Modules & screens)
  const target = new Set(effectiveModules(plan.modules, tenant ?? {}))
  const before = new Set(await enabledModuleIds(tenantId))
  const by = getContext()?.userName || 'System'
  await runAsTenant(tenantId, async () => {
    for (const m of MODULES) {
      if (m.mandatory) continue
      await TenantModule.updateOne(
        { moduleId: m.id },
        { $set: { enabled: target.has(m.id), changedAt: new Date(), changedBy: by } },
        { upsert: true },
      )
    }
  })
  await bumpAccessVersion(tenantId)
  return {
    enabled: [...target].filter((id) => !before.has(id)),
    disabled: [...before].filter((id) => !target.has(id) && !MODULE_BY_ID[id]?.mandatory),
  }
}

/**
 * A plan's module list was edited (Superadmin › Plans): pass only the change on to an institution on
 * that plan. Added modules come on and removed ones go off; a module the institution switched off
 * itself stays off (syncModulesToPlan would turn it back on).
 */
export async function applyPlanModuleChange(tenantId, { added = [], removed = [] }) {
  // an institution's own changes win: a module taken away from it stays off; one added for it stays on
  const tenant = await Tenant.findById(tenantId).select('moduleAdds moduleRemovals').lean()
  const takenAway = new Set((tenant?.moduleRemovals ?? []).map((r) => r.moduleId))
  const extra = new Set((tenant?.moduleAdds ?? []).filter((a) => addOnActive(a)).map((a) => a.moduleId))
  const on = added.filter((id) => !MODULE_BY_ID[id]?.mandatory && !takenAway.has(id))
  const off = removed.filter((id) => !MODULE_BY_ID[id]?.mandatory && !extra.has(id))
  if (!on.length && !off.length) return
  const by = getContext()?.userName || 'System'
  await runAsTenant(tenantId, async () => {
    for (const [ids, enabled] of [[on, true], [off, false]]) {
      for (const moduleId of ids) {
        await TenantModule.updateOne({ moduleId }, { $set: { enabled, changedAt: new Date(), changedBy: by } }, { upsert: true })
      }
    }
  })
  await bumpAccessVersion(tenantId)
}

/** The module registry screen: every catalog module with its state for this tenant. */
export async function listTenantModules(tenantId) {
  const tenant = await Tenant.findById(tenantId).lean()
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const planSet = new Set(closeOverDependencies(plan?.modules ?? []))
  const inPlan = new Set(effectiveModules(plan?.modules ?? [], tenant))
  const enabled = await enabledModuleIds(tenantId)
  const on = new Set(enabled)
  const addOf = new Map((tenant.moduleAdds ?? []).map((a) => [a.moduleId, a]))
  const removedOf = new Map((tenant.moduleRemovals ?? []).map((r) => [r.moduleId, r]))
  const hidden = new Map((tenant.hiddenPages ?? []).map((h) => [h.key, h]))
  return MODULES.map((m) => ({
    id: m.id, name: m.name, category: m.category, icon: m.icon, desc: m.desc, phase: m.phase,
    mandatory: !!m.mandatory, internal: !!m.internal,
    deps: m.deps ?? [],
    pageCount: m.pages.length,
    inPlan: inPlan.has(m.id),
    // why it is (or isn't) available: PLAN · ADDED (until) · ADDED_EXPIRED · REMOVED · NONE
    source: removedOf.has(m.id) ? 'REMOVED' : addOf.has(m.id) ? (addOnActive(addOf.get(m.id)) ? 'ADDED' : (planSet.has(m.id) ? 'PLAN' : 'ADDED_EXPIRED')) : planSet.has(m.id) ? 'PLAN' : inPlan.has(m.id) ? 'DEPENDENCY' : 'NONE',
    planIncludes: planSet.has(m.id),
    addOn: addOf.get(m.id) ?? null,
    removal: removedOf.get(m.id) ?? null,
    pages: m.pages.map((p) => ({ id: p.id, key: `${m.id}.${p.id}`, name: p.name, hidden: hidden.has(`${m.id}.${p.id}`), note: hidden.get(`${m.id}.${p.id}`)?.note ?? null })),
    enabled: on.has(m.id),
    blockedBy: on.has(m.id) ? dependentsOf(m.id, enabled) : missingDependencies(m.id, enabled),
  }))
}

/** Switch one module on/off inside what the plan allows. */
export async function setModuleEnabled(tenantId, moduleId, enabled) {
  const mod = MODULE_BY_ID[moduleId]
  if (!mod) throw notFound('Module')
  if (mod.mandatory) throw badRequest(`${mod.name} is always on.`)
  const tenant = await Tenant.findById(tenantId).lean()
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const inPlan = new Set(effectiveModules(plan?.modules ?? [], tenant))
  const current = await enabledModuleIds(tenantId)

  if (enabled) {
    if (!inPlan.has(moduleId)) throw conflict(`${mod.name} is not part of the ${plan?.name ?? 'current'} plan. Upgrade the plan to use it.`, { code: 'NOT_IN_PLAN' })
    const missing = missingDependencies(moduleId, current)
    if (missing.length) throw conflict(`Switch on ${missing.map((d) => MODULE_BY_ID[d].name).join(', ')} first — ${mod.name} needs it.`, { missing })
  } else {
    const dependents = dependentsOf(moduleId, current)
    if (dependents.length) throw conflict(`${dependents.map((d) => MODULE_BY_ID[d].name).join(', ')} need${dependents.length === 1 ? 's' : ''} ${mod.name}. Switch ${dependents.length === 1 ? 'it' : 'them'} off first.`, { dependents })
  }

  await runAsTenant(tenantId, () => TenantModule.updateOne(
    { moduleId },
    { $set: { enabled, changedAt: new Date(), changedBy: getContext()?.userName || 'System' } },
    { upsert: true },
  ))
  await bumpAccessVersion(tenantId)
  return { moduleId, enabled }
}

// ───────────────────────────────────────────────────────── per-institution changes (Super admin › Modules & screens)

/**
 * Bring an institution's switched-on modules in line with what it may use now: anything it may no longer
 * use goes off; `turnOn` (newly added modules) come on with their dependencies. A plan module the
 * institution switched off itself is left off. Returns { enabled, disabled }.
 */
export async function reconcileModules(tenantId, { turnOn = [] } = {}) {
  const tenant = await Tenant.findById(tenantId).lean()
  if (!tenant) throw notFound('Institution')
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const allowed = new Set(effectiveModules(plan?.modules ?? [], tenant))
  const before = new Set(await enabledModuleIds(tenantId))
  const on = new Set(closeOverDependencies(turnOn.filter((id) => allowed.has(id))).filter((id) => allowed.has(id)))
  const by = getContext()?.userName || 'System'
  const changes = { enabled: [], disabled: [] }
  await runAsTenant(tenantId, async () => {
    for (const m of MODULES) {
      if (m.mandatory) continue
      const want = allowed.has(m.id) ? (before.has(m.id) || on.has(m.id)) : false
      if (want === before.has(m.id)) continue
      await TenantModule.updateOne({ moduleId: m.id }, { $set: { enabled: want, changedAt: new Date(), changedBy: by } }, { upsert: true })
      changes[want ? 'enabled' : 'disabled'].push(m.id)
    }
  })
  await bumpAccessVersion(tenantId)
  return changes
}

/**
 * Save the platform's changes to one institution's plan: extra modules (optionally until a date), plan
 * modules taken away, and hidden screens. Refuses to take away a module another usable module needs.
 * input: { moduleAdds: [{ moduleId, until?, note? }], moduleRemovals: [{ moduleId, note? }], hiddenPages: [{ key, note? }] }
 */
export async function saveModuleOverrides(tenantId, input, by) {
  const tenant = await Tenant.findById(tenantId)
  if (!tenant) throw notFound('Institution')
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  const planSet = new Set(closeOverDependencies(plan?.modules ?? []))
  const now = new Date()
  const keep = (list, keyOf) => new Map((list ?? []).map((x) => [keyOf(x), x]))
  const oldAdds = keep(tenant.moduleAdds, (a) => a.moduleId)
  const oldRemovals = keep(tenant.moduleRemovals, (r) => r.moduleId)
  const oldHidden = keep(tenant.hiddenPages, (h) => h.key)

  const adds = []
  for (const a of input.moduleAdds ?? []) {
    const mod = MODULE_BY_ID[a.moduleId]
    if (!mod) throw badRequest(`Unknown module "${a.moduleId}".`)
    if (mod.mandatory) continue
    if (planSet.has(a.moduleId)) throw badRequest(`${mod.name} is already in the ${plan?.name ?? ''} plan — no need to add it.`)
    const prev = oldAdds.get(a.moduleId)
    const same = prev && (prev.until ?? null) === (a.until ?? null) && (prev.note ?? null) === (a.note ?? null)
    adds.push(same ? prev : { moduleId: a.moduleId, until: a.until || undefined, note: a.note || undefined, by, at: now })
  }
  const removals = []
  for (const r of input.moduleRemovals ?? []) {
    const mod = MODULE_BY_ID[r.moduleId]
    if (!mod) throw badRequest(`Unknown module "${r.moduleId}".`)
    if (mod.mandatory) throw badRequest(`${mod.name} is always on and can't be taken away.`)
    if (adds.some((a) => a.moduleId === r.moduleId)) throw badRequest(`${mod.name} can't be both added and taken away.`)
    const prev = oldRemovals.get(r.moduleId)
    removals.push(prev && (prev.note ?? null) === (r.note ?? null) ? prev : { moduleId: r.moduleId, note: r.note || undefined, by, at: now })
  }
  const hidden = []
  for (const h of input.hiddenPages ?? []) {
    if (!PAGE_BY_KEY[h.key]) throw badRequest(`Unknown screen "${h.key}".`)
    const prev = oldHidden.get(h.key)
    hidden.push(prev && (prev.note ?? null) === (h.note ?? null) ? prev : { key: h.key, note: h.note || undefined, by, at: now })
  }
  // a module still usable may need one being taken away
  const allowed = new Set(effectiveModules(plan?.modules ?? [], { moduleAdds: adds, moduleRemovals: [] }))
  const takenAway = new Set(removals.map((r) => r.moduleId))
  for (const id of allowed) {
    if (takenAway.has(id)) continue
    const needs = (MODULE_BY_ID[id]?.deps ?? []).filter((d) => takenAway.has(d))
    if (needs.length) throw conflict(`${MODULE_BY_ID[id].name} needs ${needs.map((d) => MODULE_BY_ID[d].name).join(', ')}. Take ${MODULE_BY_ID[id].name} away too, or keep ${needs.map((d) => MODULE_BY_ID[d].name).join(', ')}.`, { needs })
  }

  const newlyAdded = adds.filter((a) => !oldAdds.has(a.moduleId) || (!addOnActive(oldAdds.get(a.moduleId)) && addOnActive(a))).map((a) => a.moduleId)
  tenant.moduleAdds = adds.length ? adds : undefined
  tenant.moduleRemovals = removals.length ? removals : undefined
  tenant.hiddenPages = hidden.length ? hidden : undefined
  await tenant.save()
  const changes = await reconcileModules(tenantId, { turnOn: newlyAdded })
  return {
    changes,
    summary: {
      added: adds.map((a) => a.moduleId), removed: removals.map((r) => r.moduleId), hidden: hidden.map((h) => h.key),
      newlyAdded, nowOff: changes.disabled,
    },
  }
}

/** Hourly: add-ons whose end date has passed switch off (the entry stays, shown as ended). */
export async function expireModuleAddOns() {
  const today = new Date().toISOString().slice(0, 10)
  const tenants = await Tenant.find({ moduleAdds: { $elemMatch: { until: { $lt: today } } } }).select('_id moduleAdds').lean()
  let switchedOff = 0
  for (const t of tenants) {
    const r = await reconcileModules(t._id)
    switchedOff += r.disabled.length
  }
  return switchedOff
}

