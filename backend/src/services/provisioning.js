import { ADMIN_ROLE_NAME, FULL_ACCESS } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { Branch, Role, User } from '../models/tenant.js'
import { audit } from '../platform/audit.js'
import { hashPassword } from '../platform/auth/tokens.js'
import { runAsTenant } from '../platform/context.js'
import { withTransaction } from '../platform/db.js'
import { getPlan, recordEvent } from './subscription.js'
import { syncModulesToPlan } from './modules.js'
import { ensureAcademicSetup } from './academics.js'
import { ensureFeeSetup } from './fees.js'
import { ensureExamSetup } from './exams.js'

const DAY = 864e5

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'school'

async function uniqueSlug(name) {
  const base = slugify(name)
  let slug = base
  for (let i = 2; await Tenant.exists({ slug }); i++) slug = `${base}-${i}`
  return slug
}

/**
 * Create an institution's workspace (a school, college or trust). In one transaction:
 *   tenant (TRIAL) → main campus → plan modules → ONE role "Institution Admin"
 *   (system, locked, full access) → first admin user holding that role.
 * Every other role is created afterwards by that admin (from the role templates or by hand).
 */
export async function provisionTenant({
  institutionName, planCode, billingCycle = 'MONTHLY', trialDays, admin, profile = {}, createdVia = 'SUPERADMIN',
}) {
  const plan = await getPlan(planCode, { activeOnly: true })
  const passwordHash = admin.passwordHash ?? await hashPassword(admin.password)
  const slug = await uniqueSlug(institutionName)
  const days = trialDays ?? plan.trialDays ?? 14

  const out = await withTransaction(async () => {
    const [tenant] = await Tenant.create([{
      name: institutionName.trim(),
      slug,
      status: 'TRIAL',
      planCode: plan.code,
      billingCycle,
      trialEndsAt: new Date(Date.now() + days * DAY),
      createdVia,
      profile: { legalName: institutionName.trim(), email: admin.email, phone: admin.mobile, ...profile },
    }])

    const result = await runAsTenant(tenant._id, async () => {
      const [branch] = await Branch.create([{ name: 'Main campus', code: 'MAIN', isDefault: true, city: profile.city, state: profile.state }])
      await syncModulesToPlan(tenant._id, plan)
      const [role] = await Role.create([{
        name: ADMIN_ROLE_NAME,
        description: 'Full access to every page and action of every module in your plan, including modules added later. Created with the institution; it cannot be renamed, reduced or deleted.',
        icon: 'ShieldCheck',
        system: true,
        locked: true,
        fullAccess: true,
        permissions: [FULL_ACCESS],
        dataScopes: { default: 'ALL' },
        homePage: '/',
      }])
      const [user] = await User.create([{
        name: admin.name.trim(),
        email: admin.email,
        mobile: admin.mobile,
        passwordHash,
        designation: 'Administrator',
        roleIds: [role._id],
        branchId: branch._id,
        emailVerifiedAt: admin.emailVerifiedAt,
      }])
      await audit({ action: 'CREATE', module: 'core', entityType: 'tenant', entityId: String(tenant._id), entityName: tenant.name, summary: `Institution workspace created on the ${plan.name} plan with one role: ${ADMIN_ROLE_NAME}` })
      return { branch, role, user }
    })

    tenant.ownerUserId = result.user._id
    await tenant.save()
    await recordEvent(tenant._id, 'TRIAL_STARTED', { to: plan.code, note: `${days}-day free trial` })
    return { tenant, ...result }
  })
  // Starter content every institution can edit later; each module adds its own here.
  await runAsTenant(out.tenant._id, async () => {
    await ensureAcademicSetup() // the current academic year with two terms, a 9-point grading scheme
    await ensureFeeSetup() // the usual fee heads
    await ensureExamSetup() // unit test, half-yearly, annual …
  })
  return out
}
