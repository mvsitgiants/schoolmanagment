// Seed platform data (plans, role templates, platform owner) and demo hospitals.
//   npm run seed            add anything missing
//   npm run seed -- --reset wipe the database first
import mongoose from 'mongoose'
import { DEFAULT_PLANS, ROLE_TEMPLATES } from '@schoolgiant/shared'
import { config } from '../config.js'
import { Plan, PlatformUser, RoleTemplate, Tenant } from '../models/platform.js'
import { CustomFieldDef, Department, Branch, NumberSeries, Role, User } from '../models/tenant.js'
import { Patient } from '../models/patients.js'
import { saveSettings } from '../platform/settings.js'
import { registerPatient } from '../services/patients.js'
import { Appointment, DisplayScreen, Doctor, Queue, ScheduleBlock, Token } from '../models/frontoffice.js'
import { addDaysYmd, ageOf, displayName, sessionSlots, weekdayOf } from '@schoolgiant/shared'
import { nextNumber } from '../platform/numbering.js'
import { hospitalNow } from '../platform/time.js'
import { ensureDoctorQueue, issueToken } from '../services/queue.js'
import { enabledModuleIds } from '../platform/access.js'
import { hashPassword } from '../platform/auth/tokens.js'
import { runAsTenant, runWithContext } from '../platform/context.js'
import { connectDb } from '../platform/db.js'
import { provisionTenant } from '../services/provisioning.js'
import { createFromTemplates } from '../services/roles.js'
import { addCycle, issueInvoice, recordPayment, runBillingCycle } from '../services/subscription.js'
import { createUser } from '../services/users.js'
import { DEMO_SIGN_PIN, seedClinical } from './clinical.js'
import { seedBilling } from './billing.js'
import { seedLab } from './lab.js'
import { seedEngines } from './engines.js'
import { seedPharmacy } from './pharmacy.js'
import { seedProcurement } from './procurement.js'
import { seedRadiology } from './radiology.js'
import { seedIpd } from './ipd.js'
import { seedInpatientCare } from './inpatientCare.js'
import { seedSupport } from './support.js'
import { seedNursingCare } from './nursingCare.js'
import { seedEmergency } from './emergency.js'
import { seedAmbulance } from './ambulance.js'
import { seedOt } from './ot.js'
import { seedInsurance } from './insurance.js'
import { seedMrd } from './mrd.js'
import { seedCssd } from './cssd.js'
import { seedFeedback } from './feedback.js'
import { PORTAL_DEMO_MOBILE, seedPortal } from './portal.js'
import { seedAnalytics } from './analytics.js'
import { seedHrms } from './hrms.js'
import { seedPayroll } from './payroll.js'

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
}

const adminAuth = async (tenantId, user) => ({
  fullAccess: true, permissions: ['*'], tenantId: String(tenantId), user,
  userId: String(user._id), enabledModules: await enabledModuleIds(tenantId),
})

async function makePaid(tenant, { cycle = 'MONTHLY', startedDaysAgo = 20, history = 0 }) {
  const plan = await Plan.findOne({ code: tenant.planCode }).lean()
  // older, already-paid periods for a believable invoice history
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
  ['General Medicine', 'GMED', 'CLINICAL', ['Internal medicine', 'Diabetology']],
  ['General Surgery', 'GSUR', 'CLINICAL', ['Laparoscopy']],
  ['Orthopaedics', 'ORTH', 'CLINICAL', ['Joint replacement', 'Spine']],
  ['Obstetrics & Gynaecology', 'OBGY', 'CLINICAL', ['High-risk pregnancy', 'IVF']],
  ['Paediatrics', 'PAED', 'CLINICAL', ['Neonatology']],
  ['Cardiology', 'CARD', 'CLINICAL', ['Interventional cardiology']],
  ['Emergency Medicine', 'EMER', 'CLINICAL', []],
  ['Anaesthesiology', 'ANAE', 'CLINICAL', []],
  ['Pathology', 'PATH', 'DIAGNOSTIC', ['Haematology', 'Biochemistry', 'Microbiology']],
  ['Radiology', 'RADI', 'DIAGNOSTIC', ['CT', 'MRI', 'Ultrasound']],
  ['Nursing', 'NURS', 'NURSING', []],
  ['Pharmacy', 'PHAR', 'SUPPORT', []],
  ['Billing & Accounts', 'BILL', 'ADMINISTRATIVE', []],
  ['Front Office', 'FRNT', 'ADMINISTRATIVE', []],
]

const STAFF = [
  ['Dr. Arjun Mehta', 'dr.mehta@demo.test', 'Senior Consultant', 'CONSULTANT', 'CARD'],
  ['Dr. Kavya Reddy', 'dr.kavya@citycare.test', 'Consultant', 'CONSULTANT', 'OBGY'],
  ['Dr. Sameer Khan', 'dr.sameer@citycare.test', 'Consultant', 'CONSULTANT', 'ORTH'],
  ['Dr. Neha Iyer', 'dr.neha@citycare.test', 'Pathologist', 'LAB_TECH', 'PATH'],
  ['Priya Nair', 'priya.frontdesk@citycare.test', 'Front office executive', 'FRONT_DESK', 'FRNT'],
  ['Rahul Verma', 'rahul.frontdesk@citycare.test', 'Front office executive', 'FRONT_DESK', 'FRNT'],
  ['Sister Mary Thomas', 'mary.nurse@citycare.test', 'Staff nurse', 'STAFF_NURSE', 'NURS'],
  ['Anjali Desai', 'anjali.nurse@citycare.test', 'Staff nurse', 'STAFF_NURSE', 'NURS'],
  ['Suresh Kumar', 'suresh.cash@citycare.test', 'Cashier', 'CASHIER', 'BILL'],
  ['Meena Pillai', 'meena.billing@citycare.test', 'Billing manager', 'BILLING_MANAGER', 'BILL'],
  ['Imran Shaikh', 'imran.lab@citycare.test', 'Lab technician', 'LAB_TECH', 'PATH'],
  ['Deepa Joshi', 'deepa.pharma@citycare.test', 'Pharmacist', 'PHARMACIST', 'PHAR'],
]

async function seedCityCare() {
  if (await Tenant.exists({ slug: 'city-care-hospital' })) return
  const { tenant, user: admin } = await provisionTenant({
    institutionName: 'City Care Hospital', planCode: 'HOSPITAL', trialDays: 14, createdVia: 'SEED',
    admin: { name: 'Anita Sharma', email: 'admin@citycare.test', mobile: '+91 98450 11223', password: 'Admin@123' },
    profile: { city: 'Bengaluru', state: 'Karnataka' },
  })
  await makePaid(tenant, { cycle: 'MONTHLY', startedDaysAgo: 18, history: 3 })
  // Raw collection update: Mongoose treats createdAt as immutable, but demo data needs history.
  await Tenant.collection.updateOne({ _id: tenant._id }, {
    $set: {
      'profile.addressLine': '42, 100 Feet Road, Indiranagar', 'profile.pincode': '560038', 'profile.phone': '+91 80 4123 4567',
      'profile.email': 'contact@citycare.test', 'profile.website': 'https://citycare.example', 'profile.gstin': '29ABCDE1234F1Z5',
      'profile.registrationNo': 'KA/BLR/2014/0457', 'profile.nabhNo': 'H-2019-0612', 'profile.legalName': 'City Care Healthcare Pvt. Ltd.',
      createdAt: new Date(Date.now() - 120 * DAY),
    },
  })

  await runAsTenant(tenant._id, async () => {
    const auth = await adminAuth(tenant._id, admin)
    await Branch.create({ name: 'City Care – Whitefield', code: 'WFD', city: 'Bengaluru', state: 'Karnataka', addressLine: 'ITPL Main Road, Whitefield', phone: '+91 80 4123 9900' })
    const depts = {}
    for (const [name, code, type, specialities] of DEPARTMENTS) depts[code] = await Department.create({ name, code, type, specialities })
    await createFromTemplates(['FRONT_DESK', 'CONSULTANT', 'STAFF_NURSE', 'CASHIER', 'BILLING_MANAGER', 'LAB_TECH', 'PHARMACIST'], auth)
    const roles = Object.fromEntries((await Role.find().lean()).map((r) => [r.templateCode, r._id]))
    for (const [name, email, designation, roleCode, dept] of STAFF) {
      await createUser({ name, email, designation, roleIds: [roles[roleCode]], departmentIds: [depts[dept]._id], password: 'Demo@123' }, auth)
    }
    await Department.updateOne({ code: 'CARD' }, { headUserId: (await User.findOne({ email: 'dr.mehta@demo.test' }))._id })
    await seedPatients(admin)
    await seedFrontOffice()
    const opd = await seedClinical()
    console.log(`City Care OPD: ${opd.visits} visits, ${opd.signed} signed consults.`)
    const bills = await seedBilling()
    console.log(`City Care billing: ${bills.bills} bills, ${bills.receipts} receipts, ${bills.shifts} closed shifts.`)
    const lab = await seedLab(auth, DEMO_SIGN_PIN)
    console.log(`City Care lab: ${lab.samples} samples, ${lab.results} results (${lab.verified} verified).`)
    const engines = await seedEngines(tenant._id, auth)
    console.log(`City Care engines: messages in test mode, ${engines.approvals} approval request waiting, online booking on, kiosk sign-in.`)
    const rad = await seedRadiology(auth, DEMO_SIGN_PIN)
    console.log(`City Care radiology: ${rad.exams} studies (${rad.signed} signed, ${rad.today} today).`)
    const ph = await seedPharmacy()
    console.log(`City Care pharmacy: ${ph.batches} batches from ${ph.grns} receipts, ${ph.sales} sales, ${ph.queue} prescriptions waiting today.`)
    const ipd = await seedIpd(auth)
    console.log(`City Care inpatients: ${ipd.beds} beds, ${ipd.inpatients} in now (${ipd.advised} going home), ${ipd.discharged} discharged, ${ipd.requests} requests waiting.`)
    const care = await seedInpatientCare(auth)
    console.log(`City Care ward care: ${care.meds} medicine orders, ${care.doses} doses charted, ${care.vitals} vitals, ${care.notes} notes, ${care.issues} pharmacy issues.`)
    const sup = await seedSupport(auth)
    console.log(`City Care support services: ${sup.bedTasks} bed turnarounds, ${sup.areaTasks} area rounds on ${sup.schedules} schedules, ${sup.bmw} waste entries; ${sup.dietOrders} diet orders, ${sup.meals} meals served (${sup.mealCharges} charged).`)
    const nc = await seedNursingCare(auth)
    console.log(`City Care nursing care: ${nc.assessments} assessments (${nc.overdueAssess} patients overdue), ${nc.plans} care plans, ${nc.lines} lines (${nc.overdueLines} past change date), ${nc.indents} ward indents, ${nc.uses} ward-stock uses.`)
    const pur = await seedProcurement(auth)
    console.log(`City Care purchase: ${pur.contracts} rate contracts, ${pur.requisitions} requisitions, ${pur.orders} purchase orders (${Object.entries(pur.byStatus).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')}), ${pur.returns} returns to suppliers.`)
    const er = await seedEmergency(auth)
    console.log(`City Care emergency: ${er.past} ER visits in the past fortnight (${er.admitted} admitted, ${er.mlc} MLC), ${er.now} in the ER now.`)
    const amb = await seedAmbulance(auth)
    console.log(`City Care ambulance: ${amb.vehicles} vehicles in the fleet, ${amb.trips} trips (${amb.activeTrip} live now), ${amb.requests} calls.`)
    const ot = await seedOt(auth)
    console.log(`City Care operation theatre: ${ot.cases} operations (${ot.completed} completed, ${ot.today} on today's list, ${ot.waiting} waiting for a slot).`)
    const ins = await seedInsurance(auth)
    console.log(`City Care insurance: ${ins.payers} payers, ${ins.preAuths} pre-auths, ${ins.claims} claims (${ins.outstanding} outstanding from payers).`)
    const mrd = await seedMrd(auth)
    console.log(`City Care medical records: ${mrd.files} discharge files (${mrd.coded} coded, ${mrd.drafts} in progress), ${mrd.notes} progress notes, ${mrd.requests} record requests.`)
    const cssd = await seedCssd(auth)
    console.log(`City Care CSSD: ${cssd.sets} instrument sets with ${cssd.units} units, ${cssd.cycles} cycles (${cssd.failed} failed, ${cssd.recalled} set under recall), ${cssd.issues} issues; ${cssd.sterile} sterile, ${cssd.issued} out, ${cssd.expired} past its date.`)
    const fb = await seedFeedback(auth)
    console.log(`City Care feedback: ${fb.responses} answers (NPS ${fb.nps}), ${fb.waiting} links waiting, ${fb.expired} expired; ${fb.complaints} complaints (${fb.breached} past SLA).`)
    const portal = await seedPortal(auth)
    console.log(`City Care patient portal: on, ${portal.items} posts; demo family of ${portal.family} on mobile ${portal.mobile} with ${portal.bookings} upcoming bookings.`)
    const qa = await seedAnalytics()
    console.log(`City Care quality events: ${qa.critical} critical values called back, ${qa.late} late and ${qa.missed} missed doses.`)
    const hr = await seedHrms(auth)
    console.log(`City Care staff & HR: ${hr.employees} employees (${hr.notice} on notice, ${hr.left} left), ${hr.credentials} licences and certificates, ${hr.documents} HR documents, ${hr.rosters} published ward rosters (${hr.swaps} swaps), ${hr.onCalls} on-call duties (${hr.callBacks} call-backs), ${hr.punches} punches (${hr.lates} late, ${hr.missed} missed punch-outs, ${hr.absent} absences), ${hr.regularizations} corrections, ${hr.leaves} leave requests.`)
    console.log(`City Care HR stage 2: ${hr.extras.requisitions} requisitions with ${hr.extras.candidates} candidates, ${hr.extras.checklists} onboarding / exit checklists, ${hr.extras.reviews} reviews in the half-yearly cycle, ${hr.extras.claims} expense claims.`)
    const pay = await seedPayroll(auth)
    console.log(`City Care payroll (demo add-on): ${pay.structures} salary structures, ${pay.assigned} staff assigned, ${pay.loans} loans/advances; ${pay.lastMonth} paid to ${pay.lastCount} staff (net ₹${Math.round(pay.lastNet / 100).toLocaleString('en-IN')}), ${pay.thisMonth} calculated for ${pay.curCount} and waiting for approval; ${pay.fnf} full-and-final settlement(s).`)
  })
}

// ───────────────────────────────────────────── demo patients (City Care)

const FIRST_M = ['Ramesh', 'Suresh', 'Arjun', 'Vikram', 'Rahul', 'Anil', 'Prakash', 'Mohan', 'Kiran', 'Imran', 'Joseph', 'Sanjay', 'Manoj', 'Harish', 'Deepak', 'Naveen', 'Gopal', 'Farhan', 'Rohit', 'Venkatesh', 'Abdul', 'Thomas', 'Ganesh', 'Ravi']
const FIRST_F = ['Lakshmi', 'Priya', 'Anjali', 'Kavya', 'Meena', 'Sunita', 'Fatima', 'Deepa', 'Shreya', 'Asha', 'Rekha', 'Divya', 'Pooja', 'Nisha', 'Geeta', 'Ayesha', 'Mary', 'Sneha', 'Radha', 'Bhavana']
const LAST = ['Sharma', 'Reddy', 'Nair', 'Iyer', 'Rao', 'Gowda', 'Patel', 'Khan', 'Shetty', 'Kumar', 'Menon', 'Joshi', 'Pillai', 'Das', 'Hegde', 'Naidu', 'Fernandes', 'Kulkarni', 'Singh', 'Bhat']
const AREAS = [['Indiranagar', '560038'], ['Koramangala', '560034'], ['Whitefield', '560066'], ['Jayanagar', '560041'], ['HSR Layout', '560102'], ['Malleshwaram', '560003'], ['Hebbal', '560024'], ['Marathahalli', '560037'], ['BTM Layout', '560076'], ['Yelahanka', '560064']]
const ALLERGENS = [['Penicillin', 'DRUG', 'SEVERE', 'Rash and breathlessness'], ['Sulfa drugs', 'DRUG', 'MODERATE', 'Hives'], ['Ibuprofen', 'DRUG', 'MILD', 'Stomach upset'], ['Peanuts', 'FOOD', 'SEVERE', 'Swelling of lips'], ['Shellfish', 'FOOD', 'MODERATE', 'Itching'], ['Latex', 'OTHER', 'MODERATE', 'Contact dermatitis']]

function rng(seed) { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647 }

async function seedPatients(admin) {
  await NumberSeries.create({ docType: 'UHID', pattern: 'CC{YY}{SEQ:6}', reset: 'NEVER', updatedBy: 'Anita Sharma' })
  await saveSettings('patients', { defaultState: 'Karnataka', defaultCity: 'Bengaluru', defaultLanguage: 'Kannada', requiredFields: ['mobile', 'age', 'pincode'] })
  await CustomFieldDef.create([
    { entity: 'patient', code: 'diet_preference', label: 'Diet preference', type: 'SELECT', options: ['Vegetarian', 'Non-vegetarian', 'Eggetarian', 'Jain'], order: 1, showInList: false },
    { entity: 'patient', code: 'employer', label: 'Employer / company', type: 'TEXT', order: 2, help: 'For corporate patients' },
  ])
  const auth = { user: { name: admin.name, branchId: admin.branchId }, userId: String(admin._id), permissions: ['*'], fullAccess: true }
  const r = rng(42)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const made = []
  for (let i = 0; i < 118; i++) {
    const female = r() < 0.5
    const age = Math.floor(r() < 0.12 ? r() * 12 : r() < 0.2 ? 60 + r() * 30 : 18 + r() * 45)
    const [area, pin] = pick(AREAS)
    const body = {
      title: age < 12 ? (female ? 'Baby' : 'Master') : female ? (r() < 0.6 ? 'Mrs' : 'Ms') : 'Mr',
      firstName: female ? pick(FIRST_F) : pick(FIRST_M),
      lastName: pick(LAST),
      gender: female ? 'FEMALE' : 'MALE',
      age: { years: age, months: age < 1 ? 1 + Math.floor(r() * 10) : 0 },
      mobile: `${pick(['9', '8', '7', '6'])}${String(Math.floor(r() * 1e9)).padStart(9, '0')}`,
      bloodGroup: r() < 0.7 ? pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'A-', 'B-']) : undefined,
      address: { line1: `${1 + Math.floor(r() * 400)}, ${pick(['1st Main', '4th Cross', '12th Main', '80 Feet Road', 'Church Street'])}, ${area}`, city: 'Bengaluru', state: 'Karnataka', pincode: pin },
      ids: r() < 0.45 ? [{ type: 'AADHAAR', value: String(2 + Math.floor(r() * 7)) + String(Math.floor(r() * 1e11)).padStart(11, '0') }] : [],
      abha: r() < 0.2 ? { number: String(Math.floor(1e13 + r() * 8.9e13)) } : undefined,
      category: age >= 60 ? 'SENIOR' : r() < 0.08 ? 'CORPORATE' : r() < 0.05 ? 'STAFF' : 'GENERAL',
      source: pick(['WALK_IN', 'WALK_IN', 'WALK_IN', 'PHONE', 'ONLINE', 'REFERRAL']),
      emergencyContact: r() < 0.6 ? { name: `${pick(r() < 0.5 ? FIRST_F : FIRST_M)} ${pick(LAST)}`, relation: pick(['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother']), mobile: `9${String(Math.floor(r() * 1e9)).padStart(9, '0')}` } : undefined,
      allergies: r() < 0.18 ? [(([a, t, sv, re]) => ({ allergen: a, type: t, severity: sv, reaction: re }))(pick(ALLERGENS))] : [],
      noKnownAllergies: r() < 0.5,
      flags: r() < 0.1 ? [{ code: pick(['VIP', 'FALL_RISK', 'DEFAULTER', 'MLC', 'DIFFICULT_ACCESS']) }] : [],
      consents: { dataProcessing: true, sms: true, whatsapp: r() < 0.85, language: pick(['English', 'Kannada', 'Hindi', 'Tamil']) },
      customFields: { diet_preference: pick(['Vegetarian', 'Non-vegetarian', 'Eggetarian']) },
    }
    if (body.category === 'CORPORATE') body.customFields.employer = pick(['Infosys', 'Wipro', 'Bosch', 'IBM India', 'Flipkart'])
    if (age >= 60 && r() < 0.4) body.flags.push({ code: 'FALL_RISK' })
    if (body.ids.length && body.ids[0].value.length !== 12) body.ids = []
    made.push(await registerPatient(body, auth))
  }
  // a likely duplicate pair for the merge screen
  const twin = { title: 'Mr', firstName: 'Ramesh', lastName: 'Kumar', gender: 'MALE', age: { years: 52 }, mobile: '9845012345', address: { city: 'Bengaluru', state: 'Karnataka', pincode: '560038' }, consents: { dataProcessing: true } }
  made.push(await registerPatient(twin, auth))
  made.push(await registerPatient({ ...twin, lastName: 'Kumaar', bloodGroup: 'B+' }, auth))
  // spread registrations over the last 90 days (newest = last created)
  const now = Date.now()
  for (let i = 0; i < made.length; i++) {
    const daysAgo = Math.floor(((made.length - 1 - i) / made.length) * 90)
    const at = new Date(now - daysAgo * 864e5 - Math.floor(r() * 8) * 36e5)
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(made[i].id) }, { $set: { createdAt: at, updatedAt: at } })
  }
}

async function seedSunrise() {
  if (await Tenant.exists({ slug: 'sunrise-clinic' })) return
  // A brand-new workspace: exactly one role (Hospital Admin) and one user.
  await provisionTenant({
    institutionName: 'Sunrise Clinic', planCode: 'CLINIC', trialDays: 12, createdVia: 'SIGNUP',
    admin: { name: 'Dr. Rohan Gupta', email: 'admin@sunrise.test', mobile: '+91 99000 22110', password: 'Admin@123' },
    profile: { city: 'Pune', state: 'Maharashtra' },
  })
}

async function seedOthers() {
  const others = [
    { name: 'Shanti Diagnostics', plan: 'DIAGNOSTICS', city: 'Ahmedabad', email: 'admin@shanti.test', paid: { cycle: 'YEARLY', startedDaysAgo: 40, history: 0 }, age: 80 },
    { name: 'Metro Multispeciality Hospital', plan: 'ENTERPRISE', city: 'Hyderabad', email: 'admin@metro.test', paid: { cycle: 'MONTHLY', startedDaysAgo: 33, history: 2 }, age: 110 },
    { name: 'Green Valley Clinic', plan: 'CLINIC', city: 'Mysuru', email: 'admin@greenvalley.test', expired: true, age: 30 },
    { name: 'Lotus Children Hospital', plan: 'HOSPITAL', city: 'Chennai', email: 'admin@lotus.test', trialDays: 5, age: 9 },
    { name: 'Care Point Polyclinic', plan: 'CLINIC', city: 'Kochi', email: 'admin@carepoint.test', paid: { cycle: 'MONTHLY', startedDaysAgo: 5, history: 1 }, age: 50, visitingDoctor: true },
  ]
  for (const o of others) {
    if (await Tenant.exists({ name: o.name })) continue
    const { tenant, user } = await provisionTenant({
      institutionName: o.name, planCode: o.plan, trialDays: o.expired ? 0 : o.trialDays ?? 14, createdVia: 'SEED',
      admin: { name: 'Hospital Admin', email: o.email, password: 'Admin@123' }, profile: { city: o.city },
    })
    if (o.paid) await makePaid(tenant, o.paid)
    if (o.visitingDoctor) {
      // Dr. Mehta also works here — signing in with his email asks which hospital.
      await runAsTenant(tenant._id, async () => {
        const auth = await adminAuth(tenant._id, user)
        const { created } = await createFromTemplates(['CONSULTANT'], auth)
        await createUser({ name: 'Dr. Arjun Mehta', email: 'dr.mehta@demo.test', designation: 'Visiting consultant', roleIds: [created[0].id], password: 'Demo@123' }, auth)
      })
    }
    const set = { createdAt: new Date(Date.now() - o.age * DAY) }
    if (o.expired) set.trialEndsAt = new Date(Date.now() - 2 * DAY)
    await Tenant.collection.updateOne({ _id: tenant._id }, { $set: set })
  }
}

/** The seed writes demo hospitals with known passwords (and --reset drops the database): never on production by accident. */
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
    await seedCityCare()
    await seedSunrise()
    await seedOthers()
    const billing = await runBillingCycle()
    console.log('Billing cycle:', billing)
  })
  console.log(`
Seed complete.
  Platform owner   ${config.superadmin.email} / ${config.superadmin.password}
  City Care (paid) admin@citycare.test / Admin@123   — every module filled with two weeks of demo data
  Sunrise (trial)  admin@sunrise.test / Admin@123    — brand new: only the Hospital Admin role
  Two hospitals    dr.mehta@demo.test / Demo@123     — City Care + Care Point, asks which hospital
  Staff            priya.frontdesk@citycare.test, mary.nurse@citycare.test, lata.nurse@citycare.test (nursing supervisor),
                   suresh.cash@citycare.test (cashier), rekha.hk@citycare.test (housekeeping), divya.diet@citycare.test (dietician), ravi.store@citycare.test (store keeper), dr.nikhil@citycare.test (ER doctor), reena.er@citycare.test (ER nurse), grace.ot@citycare.test (OT nurse), dr.meera@citycare.test (anaesthetist), farah.tpa@citycare.test (TPA desk), joseph.mrd@citycare.test (medical records), sunil.cssd@citycare.test (CSSD technician),
                   pooja.gro@citycare.test (patient relations), nisha.hr@citycare.test (HR manager), sanjana.hr@citycare.test (HR executive),
                   prakash.payroll@citycare.test (payroll officer), revathi.accounts@citycare.test (accounts — pays payroll),
                   meena.billing@citycare.test (billing manager), imran.lab@citycare.test (lab technician),
                   dr.neha@citycare.test (pathologist, PIN ${DEMO_SIGN_PIN}), deepa.pharma@citycare.test (pharmacist),
                   dr.vikram@citycare.test (radiologist, PIN ${DEMO_SIGN_PIN}), ramesh.xray@citycare.test (radiographer) … / Demo@123
  Doctors          dr.kavya@citycare.test, dr.sameer@citycare.test / Demo@123 — signing PIN ${DEMO_SIGN_PIN}
  Kiosk            kiosk@citycare.test / Demo@123 — open /kiosk; online booking at /book/city-care-hospital
  Patient portal   /my/city-care-hospital — mobile ${PORTAL_DEMO_MOBILE}, the SMS code shows on screen (test mode)
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

// ───────────────────────────────────────────── doctors, appointments, queues (City Care)

const MON_SAT = [1, 2, 3, 4, 5, 6]
const sess = (days, start, end, slotMinutes, room) => days.map((weekday) => ({ weekday, start, end, slotMinutes, room }))

async function seedFrontOffice() {
  const dept = Object.fromEntries((await Department.find().lean()).map((d) => [d.code, d._id]))
  const user = async (email) => (await User.findOne({ email }).lean())?._id
  const DOCS = [
    { name: 'Dr. Arjun Mehta', gender: 'MALE', userId: await user('dr.mehta@demo.test'), departmentId: dept.CARD, specialities: ['Interventional cardiology'], qualification: 'MBBS, MD, DM (Cardiology)', registrationNo: 'KMC-48211', council: 'Karnataka Medical Council', room: 'OPD 3', fees: { newVisit: 80000, followUp: 50000 }, sessions: [...sess(MON_SAT, '09:00', '13:00', 15, 'OPD 3'), ...sess([1, 3, 5], '17:00', '19:00', 15, 'OPD 3')] },
    { name: 'Dr. Kavya Reddy', gender: 'FEMALE', userId: await user('dr.kavya@citycare.test'), departmentId: dept.OBGY, specialities: ['High-risk pregnancy'], qualification: 'MBBS, MS (OBG)', registrationNo: 'KMC-51877', council: 'Karnataka Medical Council', room: 'OPD 5', fees: { newVisit: 70000, followUp: 40000 }, sessions: sess(MON_SAT, '10:00', '14:00', 20, 'OPD 5') },
    { name: 'Dr. Sameer Khan', gender: 'MALE', userId: await user('dr.sameer@citycare.test'), departmentId: dept.ORTH, specialities: ['Joint replacement'], qualification: 'MBBS, MS (Ortho)', registrationNo: 'KMC-46309', council: 'Karnataka Medical Council', room: 'OPD 2', fees: { newVisit: 80000, followUp: 50000 }, sessions: [...sess([1, 2, 3, 4, 5], '09:30', '13:30', 15, 'OPD 2'), ...sess([2, 4], '16:00', '19:00', 15, 'OPD 2')] },
    { name: 'Dr. Ravi Prasad', gender: 'MALE', departmentId: dept.GMED, specialities: ['Internal medicine', 'Diabetology'], qualification: 'MBBS, MD (Medicine)', registrationNo: 'KMC-39954', council: 'Karnataka Medical Council', room: 'OPD 1', fees: { newVisit: 50000, followUp: 30000 }, sessions: [...sess(MON_SAT, '09:00', '14:00', 10, 'OPD 1'), ...sess(MON_SAT, '17:00', '20:00', 10, 'OPD 1')] },
    { name: 'Dr. Farah Siddiqui', gender: 'FEMALE', departmentId: dept.PAED, specialities: ['Neonatology'], qualification: 'MBBS, MD (Paediatrics)', registrationNo: 'KMC-55120', council: 'Karnataka Medical Council', room: 'OPD 4', fees: { newVisit: 60000, followUp: 40000 }, sessions: sess(MON_SAT, '10:00', '13:00', 15, 'OPD 4') },
    { name: 'Dr. Anand Rao', gender: 'MALE', departmentId: dept.GSUR, specialities: ['Laparoscopy'], type: 'VISITING', qualification: 'MBBS, MS (Surgery)', registrationNo: 'KMC-41002', council: 'Karnataka Medical Council', room: 'OPD 6', fees: { newVisit: 90000, followUp: 60000 }, sessions: sess([2, 4, 6], '11:00', '14:00', 20, 'OPD 6') },
  ]
  const doctors = []
  for (const d of DOCS) {
    const doc = await Doctor.create(d)
    await ensureDoctorQueue(doc)
    doctors.push(doc)
  }
  const now = await hospitalNow()
  await ScheduleBlock.create({ doctorId: doctors[4]._id, from: addDaysYmd(now.date, 1), to: addDaysYmd(now.date, 1), allDay: true, reason: 'Paediatrics conference', createdBy: 'Anita Sharma' })
  await ScheduleBlock.create({ doctorId: doctors[5]._id, from: addDaysYmd(now.date, 9), to: addDaysYmd(now.date, 9), allDay: true, reason: 'Surgery at another hospital', createdBy: 'Anita Sharma' })

  const counters = [
    await Queue.create({ name: 'Billing counter', type: 'BILLING', prefix: 'BL', room: 'Ground floor' }),
    await Queue.create({ name: 'Sample collection', type: 'LAB', prefix: 'LB', room: 'Lab, 1st floor' }),
    await Queue.create({ name: 'Pharmacy', type: 'PHARMACY', prefix: 'PH', room: 'Ground floor' }),
  ]
  const doctorQueues = await Queue.find({ type: 'DOCTOR' }).lean()
  await DisplayScreen.create({ name: 'OPD waiting area', queueIds: doctorQueues.map((q) => q._id), message: 'Please keep your UHID card ready. Seniors and emergencies are seen first.' })
  await DisplayScreen.create({ name: 'Ground floor counters', queueIds: counters.map((q) => q._id), message: 'Pay at the billing counter before sample collection.' })

  const patients = await Patient.find({ status: 'ACTIVE' }).lean()
  const r = rng(7)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const snap = (p) => ({ name: displayName(p), uhid: p.uhid, mobile: p.mobile, gender: p.gender, age: ageOf(p.dob)?.label })
  const used = new Set()
  const book = async (doc, date, time, status, extra = {}) => {
    const p = pick(patients)
    const key = `${p._id}:${date}`
    if (used.has(key)) return null
    used.add(key)
    return Appointment.create({
      apptNo: await nextNumber('APPOINTMENT', { date: new Date(`${date}T06:00:00Z`) }), studentId: p._id, patient: snap(p),
      doctorId: doc._id, doctorName: doc.name, departmentId: doc.departmentId, date, time,
      type: r() < 0.3 ? 'FOLLOW_UP' : 'NEW', source: pick(['DESK', 'DESK', 'PHONE', 'ONLINE', 'WHATSAPP']),
      status, history: [{ status: 'BOOKED', by: 'Priya Nair' }, ...(status !== 'BOOKED' ? [{ status, by: 'Priya Nair' }] : [])],
      bookedBy: 'Priya Nair', ...extra,
    })
  }

  for (const doc of doctors) {
    // past two weeks
    for (let back = 14; back >= 1; back--) {
      const date = addDaysYmd(now.date, -back)
      for (const s of doc.sessions.filter((x) => x.weekday === weekdayOf(date))) {
        for (const time of sessionSlots(s)) {
          if (r() > 0.45) continue
          const roll = r()
          await book(doc, date, time, roll < 0.82 ? 'COMPLETED' : roll < 0.92 ? 'NO_SHOW' : 'CANCELLED', roll >= 0.92 ? { cancelReason: 'Patient called to cancel' } : {})
        }
      }
    }
    // today — around the current time
    const queue = await Queue.findOne({ doctorId: doc._id })
    let inConsult = false
    for (const s of doc.sessions.filter((x) => x.weekday === weekdayOf(now.date))) {
      for (const time of sessionSlots(s)) {
        if (r() > 0.6) continue
        const [h, m] = time.split(':').map(Number)
        const mins = h * 60 + m
        if (mins < now.minutes - 45) {
          const a = await book(doc, now.date, time, r() < 0.88 ? 'COMPLETED' : 'NO_SHOW')
          if (a?.status === 'COMPLETED') {
            const t = await issueToken({ queueId: queue._id, studentId: a.studentId, appointmentId: a._id })
            await Token.updateOne({ _id: t.id }, { $set: { status: 'DONE', issuedAt: new Date(Date.now() - (now.minutes - mins + 5) * 60000), calledAt: new Date(Date.now() - (now.minutes - mins - 4 - Math.floor(r() * 18)) * 60000), doneAt: new Date(Date.now() - (now.minutes - mins - 25) * 60000), calls: 1 } })
            await Appointment.updateOne({ _id: a._id }, { $set: { tokenId: t.id, tokenNumber: t.number, checkedInAt: new Date(Date.now() - (now.minutes - mins + 5) * 60000) } })
          }
        } else if (mins < now.minutes + 30) {
          const status = !inConsult ? 'IN_CONSULT' : 'CHECKED_IN'
          const a = await book(doc, now.date, time, status)
          if (!a) continue
          const t = await issueToken({ queueId: queue._id, studentId: a.studentId, appointmentId: a._id })
          await Token.updateOne({ _id: t.id }, { $set: { issuedAt: new Date(Date.now() - Math.floor(5 + r() * 30) * 60000) } })
          if (status === 'IN_CONSULT') await Token.updateOne({ _id: t.id }, { $set: { status: 'CALLED', calledAt: new Date(), calls: 1, calledBy: doc.name } })
          await Appointment.updateOne({ _id: a._id }, { $set: { tokenId: t.id, tokenNumber: t.number, checkedInAt: new Date() } })
          inConsult = true
        } else {
          await book(doc, now.date, time, r() < 0.5 ? 'CONFIRMED' : 'BOOKED')
        }
      }
    }
    // next six days
    for (let ahead = 1; ahead <= 6; ahead++) {
      const date = addDaysYmd(now.date, ahead)
      if (await ScheduleBlock.exists({ doctorId: doc._id, from: { $lte: date }, to: { $gte: date } })) continue
      for (const s of doc.sessions.filter((x) => x.weekday === weekdayOf(date))) {
        for (const time of sessionSlots(s)) if (r() < 0.32) await book(doc, date, time, r() < 0.4 ? 'CONFIRMED' : 'BOOKED')
      }
    }
  }
  // a few walk-ins waiting at the counters
  for (const q of counters) {
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) await issueToken({ queueId: q._id, studentId: pick(patients)._id }).catch(() => null)
  }
}
