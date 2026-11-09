import { MODULES } from './catalog.js'
import { closeOverDependencies } from './permissions.js'

// Default SaaS plans seeded into the platform. The superadmin edits them afterwards
// (Superadmin › Plans); these are only the starting point. Prices are in paise.
// Pricing follows the product plan: about ₹150 / ₹300 / ₹500 per student per year,
// sold as a tier with a student limit (the limit is what the plan is sized on).

const STARTER = ['students', 'academics', 'attendance', 'homework', 'exams', 'certificates', 'fees', 'communication', 'portal', 'reports']
const GROWTH = [...STARTER, 'admissions', 'timetable', 'lms', 'online-tests', 'finance', 'hrms', 'payroll', 'transport', 'library', 'events', 'analytics', 'ai', 'integrations']
const HIGHER_ED = [...GROWTH, 'programs', 'registration', 'coe', 'accreditation', 'placements', 'alumni']
const ENTERPRISE = MODULES.map((m) => m.id)

export const LIMIT_KEYS = [
  { key: 'students', label: 'Students', unit: '' },
  { key: 'users', label: 'Staff logins', unit: '' },
  { key: 'branches', label: 'Campuses', unit: '' },
  { key: 'storageGb', label: 'Storage', unit: 'GB' },
  { key: 'aiTokensK', label: 'AI allowance a month', unit: 'thousand tokens' }, // 0 / empty: no plan cap
]

export const DEFAULT_PLANS = [
  {
    code: 'STARTER', name: 'Starter', tagline: 'Schools and coaching institutes up to 500 students',
    priceMonthly: 750000, priceYearly: 7500000, trialDays: 30, sortOrder: 1, isPublic: true, highlight: false,
    modules: closeOverDependencies(STARTER),
    limits: { students: 500, users: 40, branches: 1, storageGb: 20 },
    features: ['Student records, attendance and homework', 'Exams and report cards', 'Fees with online payment and receipts', 'Notices, SMS and WhatsApp', 'Parent and student app'],
  },
  {
    code: 'GROWTH', name: 'Growth', tagline: 'Schools up to 1,500 students',
    priceMonthly: 3750000, priceYearly: 37500000, trialDays: 30, sortOrder: 2, isPublic: true, highlight: true,
    modules: closeOverDependencies(GROWTH),
    limits: { students: 1500, users: 150, branches: 2, storageGb: 100, aiTokensK: 2000 },
    features: ['Everything in Starter', 'Admissions CRM and timetable', 'LMS and online tests', 'Accounts, HR and payroll', 'Transport, library and AI assistant'],
  },
  {
    code: 'HIGHER_ED', name: 'Higher Ed', tagline: 'Colleges and universities up to 5,000 students',
    priceMonthly: 18750000, priceYearly: 187500000, trialDays: 30, sortOrder: 3, isPublic: true, highlight: false,
    modules: closeOverDependencies(HIGHER_ED),
    limits: { students: 5000, users: 500, branches: 3, storageGb: 500, aiTokensK: 5000 },
    features: ['Everything in Growth', 'Programs, CBCS and CO–PO mapping', 'Semester registration and exam controller', 'NAAC / NBA reports', 'Training and placements'],
  },
  {
    code: 'ENTERPRISE', name: 'Enterprise', tagline: 'School groups and trusts with many campuses',
    priceMonthly: 41700000, priceYearly: 417000000, trialDays: 30, sortOrder: 4, isPublic: true, highlight: false,
    modules: closeOverDependencies(ENTERPRISE),
    limits: { students: 20000, users: 2000, branches: 50, storageGb: 2000, aiTokensK: 20000 },
    features: ['Every module', 'Hostel, store, health and canteen', 'Multi-campus dashboards', 'API access and SSO', 'Dedicated success manager'],
  },
]

/** GST on the SaaS subscription itself (SAC 998314). */
export const SUBSCRIPTION_GST_PCT = 18

/**
 * Platform staff (Superadmin › Staff): what each role may change in the console. Everyone signed
 * in to the console can look; settings, staff and the audit log are for owners only.
 */
export const PLATFORM_PERMISSIONS = ['tenants.create', 'tenants.edit', 'billing', 'plans', 'coupons', 'templates', 'settings', 'staff', 'audit']
export const PLATFORM_ROLES = [
  { value: 'OWNER', label: 'Owner', perms: PLATFORM_PERMISSIONS },
  { value: 'BILLING', label: 'Billing', perms: ['billing', 'coupons'] },
  { value: 'SUPPORT', label: 'Support', perms: ['tenants.create', 'tenants.edit', 'templates'] },
  { value: 'READONLY', label: 'Read-only', perms: [] },
]
/** Can a platform role do this? (A platform user saved before roles existed is an owner.) */
export const platformCan = (role, perm) => !!PLATFORM_ROLES.find((r) => r.value === (role || 'OWNER'))?.perms.includes(perm)

/** GST state codes (the first two digits of a GSTIN), keyed by the INDIAN_STATES letter code. */
export const GST_STATE_CODES = {
  JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', HR: '06', DL: '07', RJ: '08', UP: '09', BR: '10', SK: '11', AR: '12',
  NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17', AS: '18', WB: '19', JH: '20', OR: '21', CT: '22', MP: '23', GJ: '24',
  MH: '27', KA: '29', GA: '30', KL: '32', TN: '33', PY: '34', AN: '35', TG: '36', AP: '37', LA: '38',
}
