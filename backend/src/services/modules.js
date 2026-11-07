import {
  MODULES, MODULE_BY_ID, closeOverDependencies, dependentsOf, missingDependencies,
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
  const target = new Set(closeOverDependencies(plan.modules))
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
  const on = added.filter((id) => !MODULE_BY_ID[id]?.mandatory)
  const off = removed.filter((id) => !MODULE_BY_ID[id]?.mandatory)
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
  const inPlan = new Set(closeOverDependencies(plan?.modules ?? []))
  const enabled = await enabledModuleIds(tenantId)
  const on = new Set(enabled)
  return MODULES.map((m) => ({
    id: m.id, name: m.name, category: m.category, icon: m.icon, desc: m.desc, phase: m.phase,
    mandatory: !!m.mandatory, internal: !!m.internal,
    deps: m.deps ?? [],
    pageCount: m.pages.length,
    inPlan: inPlan.has(m.id),
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
  const inPlan = new Set(closeOverDependencies(plan?.modules ?? []))
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
