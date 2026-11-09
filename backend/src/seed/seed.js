// Seed platform data (plans, role templates, platform owner) and demo institutions.
//   npm run seed            add anything missing
//   npm run seed -- --reset wipe the database first
import mongoose from 'mongoose'
import { DEFAULT_PLANS, ROLE_TEMPLATES } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Plan, PlatformSetting, PlatformUser, RoleTemplate, Tenant } from '../models/platform.js'
import { Branch, Department, Role } from '../models/tenant.js'
import { MessagingConfig } from '../models/engines.js'
import { enabledModuleIds } from '../platform/access.js'
import { hashPassword } from '../platform/auth/tokens.js'
import { runAsTenant, runWithContext } from '../platform/context.js'
import { connectDb } from '../platform/db.js'
import { provisionTenant } from '../services/provisioning.js'
import { createFromTemplates } from '../services/roles.js'
import { addCycle, issueInvoice, recordPayment, runBillingCycle } from '../services/subscription.js'
import { createUser } from '../services/users.js'
import { quickSetup, saveSection, setAllocation } from '../services/academics.js'
import { AcademicYear, ClassLevel, Section, Subject } from '../models/academics.js'
import { admitStudent } from '../services/students.js'
import { User } from '../models/tenant.js'

const DAY = 864e5
const reset = process.argv.includes('--reset')

export async function seedPlatform() {
  for (const p of DEFAULT_PLANS) {
    await Plan.updateOne({ code: p.code }, { $setOnInsert: p }, { upsert: true })
  }
  for (const t of ROLE_TEMPLATES) {
    // Templates follow the catalog, so refresh them on every seed.
    await RoleTemplate.updateOne({ code: t.code }, { $set: { ...t, active: true } }, { upsert: true })
  }
  if (!await PlatformUser.exists({ email: config.superadmin.email })) {
    await PlatformUser.create({ name: 'Platform Owner', email: config.superadmin.email, passwordHash: await hashPassword(config.superadmin.password) })
  }
  if (!config.isProd) {
    await PlatformSetting.updateOne(
      { _id: 'platform' },
      { $setOnInsert: { company: { name: 'SchoolGiant' }, sms: { provider: 'TEST' } } },
      { upsert: true },
    )
  }
}

const adminAuth = async (tenantId, user) => ({
  fullAccess: true, permissions: ['*'], tenantId: String(tenantId), user,
  userId: String(user._id), enabledModules: await enabledModuleIds(tenantId),
})

/** Paid periods up to now, so the demo has an invoice history. */
async function makePaid(tenant, { cycle = 'YEARLY', startedDaysAgo = 40, history = 0 }) {
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  let start = new Date(Date.now() - startedDaysAgo * DAY)
  for (let i = history; i >= 1; i--) start = new Date(new Date(start).setMonth(start.getMonth() - (cycle === 'YEARLY' ? 12 : 1)))
  for (let i = 0; i <= history; i++) {
    const end = addCycle(start, cycle)
    const inv = await issueInvoice({ tenant, plan, cycle, kind: i === 0 ? 'NEW' : 'RENEWAL', periodStart: start, periodEnd: end })
    await recordPayment(inv._id, { method: i % 2 ? 'UPI' : 'BANK_TRANSFER', reference: `UTR${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`, recordedBy: 'Platform Owner' })
    start = end
  }
}

const DEPARTMENTS = [
  ['Pre-primary', 'PREP', 'ACADEMIC'], ['Primary', 'PRIM', 'ACADEMIC'], ['Middle school', 'MIDS', 'ACADEMIC'], ['Senior secondary', 'SENR', 'ACADEMIC'],
  ['Mathematics', 'MATHS', 'ACADEMIC'], ['Science', 'SCI', 'ACADEMIC'], ['Languages', 'LANG', 'ACADEMIC'],
  ['Accounts', 'ACCT', 'ADMINISTRATIVE'], ['Administration', 'ADMN', 'ADMINISTRATIVE'], ['Transport', 'TRAN', 'SUPPORT'],
]

const STAFF = [
  ['Dr. Kavita Menon', 'principal@greenvalley.test', 'Principal', 'PRINCIPAL', 'ADMN'],
  ['Neha Sinha', 'teacher@greenvalley.test', 'Class teacher, 8-A (Mathematics)', 'CLASS_TEACHER', 'MATHS'],
  ['Rahul Verma', 'rahul.science@greenvalley.test', 'Science teacher', 'SUBJECT_TEACHER', 'SCI'],
  ['Suresh Iyer', 'accounts@greenvalley.test', 'Accountant', 'ACCOUNTANT', 'ACCT'],
  ['Pooja Nair', 'admissions@greenvalley.test', 'Admission counsellor', 'ADMISSION_COUNSELLOR', 'ADMN'],
  ['Farhan Ali', 'frontdesk@greenvalley.test', 'Receptionist', 'FRONT_DESK', 'ADMN'],
]

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Arjun', 'Saanvi', 'Ananya', 'Diya', 'Aadhya', 'Myra', 'Kabir', 'Riya', 'Reyansh', 'Anika', 'Vihaan', 'Kiara']
const LAST = ['Sharma', 'Verma', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Khan', 'Das', 'Patel', 'Rao']

async function seedGreenValley() {
  if (await Tenant.exists({ slug: 'green-valley-public-school' })) return
  const { tenant, user: admin } = await provisionTenant({
    institutionName: 'Green Valley Public School', planCode: 'GROWTH', trialDays: 30, createdVia: 'SEED',
    admin: { name: 'Anita Sharma', email: 'admin@greenvalley.test', mobile: '+91 98450 11223', password: 'Admin@123' },
    profile: { city: 'Bengaluru', state: 'Karnataka' },
  })
  await makePaid(tenant, { cycle: 'YEARLY', startedDaysAgo: 40 })
  // Raw collection update: Mongoose treats createdAt as immutable, but demo data needs history.
  await Tenant.collection.updateOne({ _id: tenant._id }, {
    $set: {
      'profile.addressLine': '12, Outer Ring Road, Marathahalli', 'profile.pincode': '560037', 'profile.phone': '+91 80 4123 4567',
      'profile.email': 'office@greenvalley.test', 'profile.website': 'https://greenvalley.example', 'profile.legalName': 'Green Valley Educational Trust',
      createdAt: new Date(Date.now() - 60 * DAY),
    },
  })

  await runAsTenant(tenant._id, async () => {
    await MessagingConfig.updateOne({}, { $setOnInsert: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true })
    const auth = await adminAuth(tenant._id, admin)
    await Branch.create({ name: 'Green Valley – Whitefield', code: 'WFD', city: 'Bengaluru', state: 'Karnataka', addressLine: 'ITPL Main Road, Whitefield', phone: '+91 80 4123 9900' })
    const depts = {}
    for (const [name, code, type] of DEPARTMENTS) depts[code] = await Department.create({ name, code, type })
    await createFromTemplates([...new Set(STAFF.map((s) => s[3]))], auth)
    const roles = Object.fromEntries((await Role.find().lean()).map((r) => [r.templateCode, r._id]))
    for (const [name, email, designation, roleCode, dept] of STAFF) {
      await createUser({ name, email, designation, roleIds: [roles[roleCode]], departmentIds: [depts[dept]._id], password: 'Demo@123' }, auth)
    }
    // Classes Nursery–12 with sections A and B (and the common subjects), the default year.
    await quickSetup({ preset: 'K12', sectionsPerClass: 2, addSubjects: true })
    const userId = async (email) => (await User.findOne({ email }).select('_id').lean())._id
    const neha = await userId('teacher@greenvalley.test')
    const rahul = await userId('rahul.science@greenvalley.test')
    const c8 = await ClassLevel.findOne({ code: '8' }).lean()
    const [s8a, s8b] = await Section.find({ classId: c8._id }).sort({ name: 1 }).lean()
    await saveSection(s8a._id, { classTeacherId: neha, room: '204', capacity: 40 })
    await saveSection(s8b._id, { classTeacherId: rahul, room: '205', capacity: 40 })
    const subj = async (code) => (await Subject.findOne({ code }).select('_id').lean())._id
    for (const sec of [s8a, s8b]) {
      await setAllocation({ sectionId: sec._id, subjectId: await subj('MATH'), teacherId: neha })
      await setAllocation({ sectionId: sec._id, subjectId: await subj('SCI'), teacherId: rahul })
    }
    // A handful of students in Class 8 so plan usage, sections and family messages have
    // something to point at. (The Students module brings the admission flow.)
    // Students go through the same admission service a school uses (numbers, history, limits).
    const FATHERS = ['Rohit', 'Amit', 'Suresh', 'Vikram', 'Anil', 'Rajesh', 'Manoj', 'Sanjay']
    const MOTHERS = ['Neha', 'Priya', 'Kavita', 'Sunita', 'Anjali', 'Pooja', 'Meena', 'Ritu']
    const year = (await AcademicYear.findOne({ isCurrent: true }).lean())
    for (let i = 0; i < 24; i++) {
      const firstName = FIRST[i % FIRST.length]
      const lastName = LAST[(i * 7) % LAST.length]
      const sec = i % 2 ? s8b : s8a
      await admitStudent({
        firstName, lastName, gender: [0, 1, 2, 3, 4, 10, 12, 14].includes(i % 16) ? 'MALE' : 'FEMALE',
        dob: `2013-0${1 + (i % 9)}-1${i % 9}`, sectionId: sec._id, rollNo: String(Math.floor(i / 2) + 1),
        admissionDate: year.startDate, category: ['GENERAL', 'OBC', 'GENERAL', 'SC'][i % 4], nationality: 'Indian',
        address: { line: `${12 + i}, ${['MG Road', 'Outer Ring Road', 'HSR Layout', 'Whitefield Main Road'][i % 4]}`, city: 'Bengaluru', state: 'Karnataka', pincode: `5600${String(30 + (i % 9))}` },
        guardians: [
          { name: `${FATHERS[i % 8]} ${lastName}`, relation: 'FATHER', mobile: `98450${String(20000 + i).padStart(5, '0')}`, occupation: ['Engineer', 'Business', 'Teacher', 'Doctor'][i % 4], isPrimary: i % 3 !== 0 },
          { name: `${MOTHERS[i % 8]} ${lastName}`, relation: 'MOTHER', mobile: `98860${String(30000 + i).padStart(5, '0')}`, email: `${MOTHERS[i % 8].toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`, isPrimary: i % 3 === 0 },
        ],
      }, auth, null)
    }
  })
}

async function seedSunrise() {
  if (await Tenant.exists({ slug: 'sunrise-college-of-engineering' })) return
  await provisionTenant({
    institutionName: 'Sunrise College of Engineering', planCode: 'HIGHER_ED', trialDays: 30, createdVia: 'SEED',
    admin: { name: 'Prof. Ramesh Kulkarni', email: 'admin@sunrise.test', mobile: '+91 99000 22334', password: 'Admin@123' },
    profile: { city: 'Pune', state: 'Maharashtra' },
  })
}

/** The seed writes demo institutions with known passwords (and --reset drops the database): never on production by accident. */
function assertSafeToSeed() {
  if (config.isProd && !process.env.SUPERADMIN_PASSWORD) throw new Error('Set SUPERADMIN_PASSWORD — the default one is public.')
  if (process.argv.includes('--i-know-this-is-production')) return
  const dbName = String(config.mongoUrl).split('?')[0].split('/').pop() || ''
  if (config.isProd || /prod/i.test(dbName)) {
    throw new Error(`Refusing to seed "${dbName || config.mongoUrl}": this looks like production. Point MONGO_URL at a dev database, or pass --i-know-this-is-production.`)
  }
}

async function main() {
  assertSafeToSeed()
  await connectDb(config.mongoUrl)
  if (reset) {
    await mongoose.connection.dropDatabase()
    for (const model of Object.values(mongoose.models)) await model.init()
    console.log('Database cleared.')
  }
  await runWithContext({ system: true, userName: 'Demo data', tenantId: null }, async () => {
    await seedPlatform()
    await seedGreenValley()
    await seedSunrise()
    const billing = await runBillingCycle()
    console.log('Billing cycle:', billing)
  })
  console.log(`
Seed complete.
  Platform owner      ${config.superadmin.email} / ${config.superadmin.password}
  Green Valley (paid) admin@greenvalley.test / Admin@123 — school on the Growth plan, 2 campuses, classes Nursery–12, 24 students in Class 8
  Staff               principal@, teacher@, rahul.science@, accounts@, admissions@, frontdesk@greenvalley.test / Demo@123
  Sunrise (trial)     admin@sunrise.test / Admin@123 — college on a Higher Ed trial, only the Institution Admin role
`)
  await mongoose.disconnect()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(err)
    await mongoose.disconnect()
    process.exit(1)
  })
}
