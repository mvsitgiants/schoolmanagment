// Seed platform data (plans, role templates, platform owner) and the demo institution, St. Thomas School.
//   npm run seed            add anything missing
//   npm run seed -- --reset wipe the database first
import mongoose from 'mongoose'
import { DEFAULT_PLANS, DOC_TYPES, ROLE_TEMPLATES } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Plan, PlatformSetting, PlatformUser, RoleTemplate, Tenant } from '../models/platform.js'
import { Branch, Department, NumberSeries, Role } from '../models/tenant.js'
import { MessagingConfig } from '../models/engines.js'
import { enabledModuleIds } from '../platform/access.js'
import { hashPassword } from '../platform/auth/tokens.js'
import { runAsTenant, runWithContext } from '../platform/context.js'
import { connectDb } from '../platform/db.js'
import { provisionTenant } from '../services/provisioning.js'
import { createFromTemplates } from '../services/roles.js'
import { addCycle, issueInvoice, recordPayment, runBillingCycle } from '../services/subscription.js'
import { createUser } from '../services/users.js'
import { saveClass, saveSection, saveSubject, setAllocation } from '../services/academics.js'
import { AcademicYear, ClassLevel, Section } from '../models/academics.js'
import { setModuleEnabled } from '../services/modules.js'
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
  ['Pre-primary', 'PREP', 'ACADEMIC'], ['Primary', 'PRIM', 'ACADEMIC'], ['Middle school', 'MIDS', 'ACADEMIC'], ['Secondary', 'SECN', 'ACADEMIC'],
  ['Senior secondary', 'SENR', 'ACADEMIC'], ['Mathematics', 'MATHS', 'ACADEMIC'], ['Science', 'SCI', 'ACADEMIC'], ['Languages', 'LANG', 'ACADEMIC'],
  ['Social Science', 'SOCS', 'ACADEMIC'], ['Accounts', 'ACCT', 'ADMINISTRATIVE'], ['Administration', 'ADMN', 'ADMINISTRATIVE'], ['Transport', 'TRAN', 'SUPPORT'],
]

// [name, email, designation, role template, department, campus (CBSE | UP)]
const STAFF = [
  ['Fr. Thomas Mathew', 'principal.cbse@stthomas.test', 'Principal (CBSE)', 'PRINCIPAL', 'ADMN', 'CBSE'],
  ['Dr. Rajendra Prasad Tiwari', 'principal.up@stthomas.test', 'Principal (UP Board)', 'PRINCIPAL', 'ADMN', 'UP'],
  ['Sunita Srivastava', 'teacher@stthomas.test', 'Class teacher, Class 5 (CBSE) — Mathematics', 'CLASS_TEACHER', 'MATHS', 'CBSE'],
  ['Alok Agarwal', 'accounts@stthomas.test', 'Accountant', 'ACCOUNTANT', 'ACCT', 'CBSE'],
  ['Shalini Saxena', 'admissions@stthomas.test', 'Admission counsellor', 'ADMISSION_COUNSELLOR', 'ADMN', 'CBSE'],
  ['Mohd. Arif Khan', 'frontdesk@stthomas.test', 'Receptionist', 'FRONT_DESK', 'ADMN', 'CBSE'],
]

const SUBJECTS = [
  ['English', 'ENG', 'LANGUAGE', 'LANG'], ['Hindi', 'HIN', 'LANGUAGE', 'LANG'], ['Sanskrit', 'SKT', 'LANGUAGE', 'LANG'],
  ['Mathematics', 'MATH', 'THEORY', 'MATHS'], ['Science', 'SCI', 'THEORY', 'SCI'], ['Social Science', 'SST', 'THEORY', 'SOCS'],
  ['Environmental Studies', 'EVS', 'THEORY', 'SCI'], ['Computer Science', 'CS', 'PRACTICAL', 'SCI'],
  ['Physics', 'PHY', 'THEORY', 'SCI'], ['Chemistry', 'CHEM', 'THEORY', 'SCI'], ['Biology', 'BIO', 'THEORY', 'SCI'],
  ['Physical Education', 'PE', 'ACTIVITY', null], ['Art & Craft', 'ART', 'ACTIVITY', null], ['Music', 'MUS', 'ACTIVITY', null],
]
const subjectsFor = (board, grade) => {
  if (grade <= 0) return ['ENG', 'HIN', 'MATH', 'EVS', 'ART', 'MUS']
  if (grade <= 5) return ['ENG', 'HIN', 'MATH', 'EVS', 'CS', 'PE', 'ART']
  if (grade <= 8) return ['ENG', 'HIN', 'SKT', 'MATH', 'SCI', 'SST', 'CS', 'PE', 'ART']
  if (grade <= 10) return ['HIN', 'ENG', 'MATH', 'SCI', 'SST', 'SKT', 'CS', 'PE'] // UP Board high school
  return ['HIN', 'ENG', 'PHY', 'CHEM', 'MATH', 'BIO', 'PE'] // UP Board intermediate, science stream
}
const deptFor = (grade) => (grade <= 0 ? 'PREP' : grade <= 5 ? 'PRIM' : grade <= 8 ? 'MIDS' : grade <= 10 ? 'SECN' : 'SENR')

/**
 * The classes of both boards, kept apart: Nursery (CBSE) … Class 8 (CBSE) and Nursery (UP) … Class 12 (UP).
 * grade: -2 Nursery, -1 LKG, 0 UKG, 1–12. Each class is taught as one group: its only section is named after
 * the class code, which makes every label show just the class ("Class 5 (CBSE)", short "5 CBSE").
 */
export const ST_THOMAS_CLASSES = [['CBSE', 'C', 8], ['UP', 'U', 12]].flatMap(([board, prefix, top]) => [
  ['Nursery', 'N', -2], ['LKG', 'LKG', -1], ['UKG', 'UKG', 0], ...Array.from({ length: top }, (_, i) => [`Class ${i + 1}`, String(i + 1), i + 1]),
].map(([name, code, grade]) => ({ board, grade, name: `${name} (${board})`, code: `${prefix}${code}` })))

const ST_THOMAS = {
  slug: 'st-thomas-school',
  name: 'St. Thomas School',
  city: 'Lucknow', state: 'Uttar Pradesh',
}

async function seedStThomas() {
  if (await Tenant.exists({ slug: ST_THOMAS.slug })) return
  const { tenant, user: admin, branch: main } = await provisionTenant({
    institutionName: ST_THOMAS.name, planCode: 'ENTERPRISE', billingCycle: 'YEARLY', trialDays: 30, createdVia: 'SEED',
    admin: { name: 'Rohit Chandra', email: 'admin@stthomas.test', mobile: '+91 94150 12345', password: 'Admin@123' },
    profile: { city: ST_THOMAS.city, state: ST_THOMAS.state },
  })
  await makePaid(tenant, { cycle: 'YEARLY', startedDaysAgo: 220 })
  // Raw collection update: Mongoose treats createdAt as immutable, but demo data needs history.
  await Tenant.collection.updateOne({ _id: tenant._id }, {
    $set: {
      'profile.addressLine': 'Sector 12, Kursi Road, Vikas Nagar', 'profile.pincode': '226022', 'profile.phone': '+91 522 4012 345',
      'profile.email': 'office@stthomas.test', 'profile.website': 'https://stthomas.example', 'profile.legalName': 'St. Thomas School',
      'profile.trustName': 'St. Thomas Educational Society (Regd.)', 'profile.pan': 'AAATS4521K', 'profile.registrationNo': 'LKO/1987/0452',
      'profile.board': 'Affiliated to CBSE, New Delhi', 'profile.affiliationNo': '2130417', 'profile.schoolCode': '71417', 'profile.udiseCode': '09221100417',
      createdAt: new Date(Date.now() - 240 * DAY),
    },
  })

  await runAsTenant(tenant._id, async () => {
    await MessagingConfig.updateOne({}, { $setOnInsert: { sms: { provider: 'TEST' }, whatsapp: { provider: 'TEST' } } }, { upsert: true })
    // college-only modules off (dependents first); everything else the Enterprise plan has stays on
    for (const id of ['coe', 'registration', 'accreditation', 'placements', 'research', 'programs']) await setModuleEnabled(tenant._id, id, false)
    const auth = await adminAuth(tenant._id, admin)
    // two campuses, each its own school on paper: the CBSE school (default) and the UP Board school
    await Branch.updateOne({ _id: main._id }, { $set: {
      name: 'St. Thomas School', code: 'CBSE', addressLine: 'Sector 12, Kursi Road, Vikas Nagar', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226022', phone: '+91 522 4012 345',
      identity: { printName: 'St. Thomas School', board: 'Affiliated to CBSE, New Delhi', affiliationNo: '2130417', schoolCode: '71417', udiseCode: '09221100417', email: 'cbse@stthomas.test', principalName: 'Fr. Thomas Mathew' },
    } })
    const up = await Branch.create({
      name: 'St. Thomas School – UP Board', code: 'UPB', addressLine: 'Sector 12, Kursi Road, Vikas Nagar (Block B)', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226022', phone: '+91 522 4012 346',
      identity: { printName: 'St. Thomas School', board: 'Board of High School & Intermediate Education, Uttar Pradesh (UP Board), Prayagraj', affiliationNo: 'Recognition No. 2468/UPB/1996', schoolCode: '1071', udiseCode: '09221100418', email: 'upboard@stthomas.test', principalName: 'Dr. Rajendra Prasad Tiwari' },
    })
    const campus = { CBSE: main._id, UP: up._id }
    // numbers counted per campus carry the campus code (CBSE/FI2627000001, UPB/FI2627000001), so the two campuses never clash
    for (const d of DOC_TYPES.filter((x) => x.perBranch)) await NumberSeries.updateOne({ docType: d.code }, { $set: { pattern: `{BR}/${d.pattern}`, reset: d.reset, updatedBy: 'Demo data' } }, { upsert: true }) // as Settings › Number series saves it
    const depts = {}
    for (const [name, code, type] of DEPARTMENTS) depts[code] = await Department.create({ name, code, type })
    await createFromTemplates([...new Set(STAFF.map((s) => s[3])), 'SUBJECT_TEACHER', 'LIBRARIAN', 'TRANSPORT_MANAGER', 'HOSTEL_WARDEN', 'STORE_KEEPER', 'CANTEEN_MANAGER', 'NURSE', 'HR_MANAGER'], auth)
    const roles = Object.fromEntries((await Role.find().lean()).map((r) => [r.templateCode, r._id]))
    for (const [name, email, designation, roleCode, dept, board] of STAFF) {
      await createUser({ name, email, designation, roleIds: [roles[roleCode]], departmentIds: [depts[dept]._id], branchId: campus[board], password: 'Demo@123' }, auth)
    }
    // subjects, the classes of both boards and one section a class (named after the class code)
    const subj = {}
    for (const [name, code, type, dept] of SUBJECTS) subj[code] = (await saveSubject(null, { name, code, type, ...(dept && { departmentId: depts[dept]._id }) })).id
    const year = await AcademicYear.findOne({ isCurrent: true }).lean()
    for (const [i, c] of ST_THOMAS_CLASSES.entries()) {
      const cls = await saveClass(null, { name: c.name, code: c.code, order: i + 1, departmentId: depts[deptFor(c.grade)]._id, subjectIds: subjectsFor(c.board, c.grade).map((x) => subj[x]) })
      await saveSection(null, { classId: cls.id, academicYearId: year._id, name: c.code, branchId: campus[c.board], capacity: 40, room: c.board === 'CBSE' ? `A-${100 + i + 1}` : `B-${100 + i - 10}` })
    }
    // the class teacher login: Class 5 (CBSE), Mathematics
    const sunita = (await User.findOne({ email: 'teacher@stthomas.test' }).select('_id').lean())._id
    const c5 = await ClassLevel.findOne({ code: 'C5' }).lean()
    const s5 = await Section.findOne({ classId: c5._id }).lean()
    await saveSection(s5._id, { classTeacherId: sunita })
    await setAllocation({ sectionId: s5._id, subjectId: subj.MATH, teacherId: sunita, periodsPerWeek: 6 })
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
    await seedStThomas()
    const billing = await runBillingCycle()
    console.log('Billing cycle:', billing)
  })
  console.log(`
Seed complete.
  Platform owner      ${config.superadmin.email} / ${config.superadmin.password}
  St. Thomas School   admin@stthomas.test / Admin@123 — Lucknow, Enterprise plan; CBSE campus (Nursery–Class 8) and UP Board campus (Nursery–Class 12)
  Staff               principal.cbse@, principal.up@, teacher@ (Class 5 CBSE), accounts@, admissions@, frontdesk@stthomas.test / Demo@123
  Fill it with data   npm run seed:demo — students, staff, fees, exams … in every module
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
