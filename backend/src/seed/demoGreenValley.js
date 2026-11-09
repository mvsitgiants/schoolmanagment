// Fill the Green Valley Public School demo institution with realistic data in every module — through the app's own
// API, signed in as its admin, so every record passes the same checks a school's own would.
//   npm run seed:demo --workspace @schoolgiant/backend      (after `npm run seed`; the dev database must be running)
// Each step looks first and skips itself when its data is there, so running it again adds nothing twice.
import mongoose from 'mongoose'
import request from 'supertest'
import { addDaysYmd } from '@schoolgiant/shared'
import { createApp } from '../app.js'
import { config } from '../config.js'
import { Tenant } from '../models/platform.js'
import { runAsTenant } from '../platform/context.js'
import { connectDb } from '../platform/db.js'
import { institutionNow } from '../platform/time.js'

const SLUG = 'green-valley-public-school'
const ADMIN = { email: 'admin@greenvalley.test', password: 'Admin@123' }
const ORIGIN = 'http://localhost:5190'

let app
let tenant
let today
const log = (...a) => console.log(' ', ...a)

/** A signed-in agent; `call` throws with the server's message unless the status is one of `ok`. */
async function signIn(email, password) {
  const agent = request.agent(app).set('Origin', ORIGIN)
  const res = await agent.post('/api/v1/auth/login').send({ email, password })
  if (res.status !== 200) throw new Error(`Sign-in as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`)
  const call = async (method, path, body, { ok = [200, 201], quiet = [] } = {}) => {
    const r = await agent[method](`/api/v1${path}`).send(body)
    if (ok.includes(r.status)) return r.body?.data ?? r.body
    if (quiet.includes(r.status)) return null
    throw new Error(`${method.toUpperCase()} ${path} → ${r.status}: ${r.body?.message ?? r.text}${r.body?.details ? ` ${JSON.stringify(r.body.details)}` : ''}`)
  }
  return {
    agent, me: res.body.data,
    get: (p, q) => agent.get(`/api/v1${p}`).query(q ?? {}).then((r) => { if (r.status !== 200) throw new Error(`GET ${p} → ${r.status}: ${r.body?.message ?? r.text}`); return r.body?.data ?? r.body }),
    getRaw: (p, q) => agent.get(`/api/v1${p}`).query(q ?? {}),
    post: (p, b, o) => call('post', p, b, o), patch: (p, b, o) => call('patch', p, b, o), put: (p, b, o) => call('put', p, b, o), del: (p, o) => call('delete', p, undefined, o),
  }
}

async function step(name, fn) {
  const t0 = Date.now()
  try {
    const r = await fn()
    console.log(`✓ ${name}${r ? ` — ${r}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`)
    if (process.env.DEMO_STRICT) throw e
  }
}

// ───────────────────────────────────────────────────────── shared lookups

const pick = (list, i) => list[((i % list.length) + list.length) % list.length]
const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Arjun', 'Kabir', 'Reyansh', 'Vihaan', 'Sai', 'Krishna', 'Rohan', 'Dhruv', 'Ayaan', 'Atharv', 'Shaurya', 'Pranav', 'Rudra', 'Yash', 'Kunal', 'Nikhil']
const FIRST_F = ['Saanvi', 'Ananya', 'Diya', 'Aadhya', 'Myra', 'Riya', 'Anika', 'Kiara', 'Ira', 'Navya', 'Meera', 'Tara', 'Sara', 'Avni', 'Prisha', 'Kavya', 'Nisha', 'Pari', 'Ishita', 'Aditi']
const LAST = ['Sharma', 'Verma', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Khan', 'Das', 'Patel', 'Rao', 'Menon', 'Kulkarni', 'Joshi', 'Shetty', 'Pillai', 'Bhat', 'Hegde', 'Mishra', 'Singh', 'Fernandes']
const FATHERS = ['Rohit', 'Amit', 'Suresh', 'Vikram', 'Anil', 'Rajesh', 'Manoj', 'Sanjay', 'Prakash', 'Deepak', 'Naveen', 'Kiran']
const MOTHERS = ['Neha', 'Priya', 'Kavita', 'Sunita', 'Anjali', 'Pooja', 'Meena', 'Ritu', 'Lakshmi', 'Divya', 'Shilpa', 'Rekha']
const AREAS = ['Marathahalli', 'HSR Layout', 'Bellandur', 'Whitefield', 'Koramangala', 'Indiranagar', 'Sarjapur Road', 'Kadubeesanahalli']

let lookup // academics lookup: classes, sections
let students = [] // { id, name, sectionId, classId }

async function loadStudents(admin) {
  const out = []
  for (let page = 1; page < 20; page++) {
    const r = await admin.getRaw('/students', { page, pageSize: 100, status: 'ACTIVE' })
    const rows = r.body?.data ?? []
    out.push(...rows)
    if (rows.length < 100) break
  }
  students = out.map((s) => ({ id: s.id, name: s.name ?? [s.firstName, s.lastName].filter(Boolean).join(' '), sectionId: s.sectionId, classId: s.classId, admissionNo: s.admissionNo }))
  return students
}
const studentsOf = (sectionId) => students.filter((s) => s.sectionId === sectionId)

// ───────────────────────────────────────────────────────── students

/** Every section gets 6–8 students (Class 8 keeps its 12 a section). */
async function fillStudents(admin) {
  await loadStudents(admin)
  let added = 0
  let n = students.length
  for (const sec of lookup.sections) {
    const want = 6 + (sec.label.length % 3)
    const have = studentsOf(sec.id).length
    const cls = lookup.classes.find((c) => c.id === sec.classId)
    const age = Math.max(3, Number(cls?.code) ? Number(cls.code) + 5 : { NUR: 3, LKG: 4, UKG: 5 }[cls?.code] ?? 5)
    for (let i = have; i < want; i++, n++) {
      const girl = n % 2 === 1
      const firstName = girl ? pick(FIRST_F, n * 3) : pick(FIRST_M, n * 3)
      const lastName = pick(LAST, n * 7)
      await admin.post('/students', {
        firstName, lastName, gender: girl ? 'FEMALE' : 'MALE', dob: `${2026 - age - 1}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`,
        sectionId: sec.id, rollNo: String(i + 1), admissionDate: '2026-04-01', category: pick(['GENERAL', 'OBC', 'GENERAL', 'SC', 'GENERAL', 'ST'], n), nationality: 'Indian',
        bloodGroup: pick(['B+', 'O+', 'A+', 'AB+', 'O-'], n),
        address: { line: `${10 + (n % 90)}, ${pick(['2nd Cross', '5th Main', 'Lake View Road', 'Temple Street', 'Park Avenue'], n)}, ${pick(AREAS, n)}`, city: 'Bengaluru', state: 'Karnataka', pincode: `5600${String(30 + (n % 20)).padStart(2, '0')}` },
        guardians: [
          { name: `${pick(FATHERS, n)} ${lastName}`, relation: 'FATHER', mobile: `9${String(845100000 + n * 37).slice(0, 9)}`, occupation: pick(['Software engineer', 'Business', 'Teacher', 'Doctor', 'Bank officer', 'Government service'], n), isPrimary: n % 3 !== 0 },
          { name: `${pick(MOTHERS, n)} ${lastName}`, relation: 'MOTHER', mobile: `9${String(886100000 + n * 41).slice(0, 9)}`, email: `${pick(MOTHERS, n).toLowerCase()}.${lastName.toLowerCase()}${n}@example.com`, isPrimary: n % 3 === 0 },
        ],
      })
      added++
    }
  }
  await loadStudents(admin)
  return `${added} admitted, ${students.length} in all`
}

// ───────────────────────────────────────────────────────── transport

const ROUTES = [
  { name: 'Route 1 — Marathahalli', code: 'R1', reg: 'KA03AB4521', driver: ['Manjunath Gowda', '9845223301'], attendant: ['Lakshmamma', '9845223302'], device: '358240051111111',
    stops: [['Kundalahalli Gate', 12.9634, 77.7162, '07:05', '15:55'], ['Brookefield', 12.9667, 77.7125, '07:12', '15:48'], ['AECS Layout', 12.9637, 77.7066, '07:20', '15:40'], ['Marathahalli Bridge', 12.9569, 77.7011, '07:30', '15:30'], ['School', 12.9545, 77.6988, '07:45', '15:15']] },
  { name: 'Route 2 — HSR & Bellandur', code: 'R2', reg: 'KA51CD7788', driver: ['Ravi Kumar', '9845223303'], attendant: ['Shobha', '9845223304'], device: '358240052222222',
    stops: [['HSR Sector 2', 12.9116, 77.6474, '06:55', '16:05'], ['Agara Lake', 12.9257, 77.6510, '07:05', '15:55'], ['Bellandur Gate', 12.9304, 77.6784, '07:18', '15:42'], ['Ecospace', 12.9268, 77.6832, '07:25', '15:35'], ['School', 12.9545, 77.6988, '07:45', '15:15']] },
]

async function fillTransport(admin) {
  if ((await admin.get('/transport/vehicles')).length) return 'already there'
  const fee = [1500000, 1400000, 1250000, 1100000, null]
  let riders = 0
  for (const [ri, r] of ROUTES.entries()) {
    const v = await admin.post('/transport/vehicles', {
      regNo: r.reg, type: 'BUS', capacity: 40, make: 'Tata Starbus 40', gpsDeviceId: r.device, status: 'ACTIVE',
      docs: [
        { kind: 'RC', number: `RC${r.reg}`, expiry: '2034-03-31' }, { kind: 'INSURANCE', number: `POL-${ri + 1}-88231`, expiry: addDaysYmd(today, ri ? 200 : 18) },
        { kind: 'FITNESS', number: `FC-${ri + 1}-2026`, expiry: addDaysYmd(today, 160) }, { kind: 'PERMIT', number: `KA-EIB-${ri + 1}11`, expiry: '2027-06-30' },
        { kind: 'PUC', number: `PUC${ri + 1}0921`, expiry: addDaysYmd(today, ri ? 40 : -6) }, { kind: 'SPEED_GOVERNOR', number: `SG-${ri + 1}55`, expiry: '2027-02-28' },
      ],
      driver: { name: r.driver[0], mobile: r.driver[1], licenceNo: `KA03 2011000${ri}4521`, licenceExpiry: '2031-08-15' },
      attendant: { name: r.attendant[0], mobile: r.attendant[1] },
    })
    const route = await admin.post('/transport/routes', {
      name: r.name, code: r.code, vehicleId: v.id,
      stops: r.stops.map(([name, lat, lng, pickupTime, dropTime], i) => ({ name, lat, lng, pickupTime, dropTime, fee: fee[i] ?? undefined })),
    })
    // students on this route: a slice of the school, at the first four stops
    const slice = students.filter((_, i) => i % 5 === ri).slice(0, 22)
    for (const [i, s] of slice.entries()) {
      await admin.post('/transport/assignments', { studentId: s.id, routeId: route.id, stopId: route.stops[i % 4].id, mode: i % 9 === 0 ? 'PICKUP' : 'BOTH', from: '2026-06-01' })
      riders++
    }
  }
  return `2 buses, 2 routes, ${riders} students`
}

// ───────────────────────────────────────────────────────── library

const BOOKS = [
  ['The Jungle Book', 'Rudyard Kipling', '9780141325293', 'Puffin', 2015, 'Fiction', '823 KIP', 3, 25000],
  ['Wings of Fire', 'A. P. J. Abdul Kalam; Arun Tiwari', '9788173711466', 'Universities Press', 1999, 'Biography', '920 KAL', 4, 19900],
  ['Malgudi Days', 'R. K. Narayan', '9780143039655', 'Penguin', 2006, 'Fiction', '823 NAR', 3, 29900],
  ['The Story of My Experiments with Truth', 'M. K. Gandhi', '9788172345662', 'Navajivan', 2010, 'Biography', '920 GAN', 2, 15000],
  ['Panchatantra', 'Vishnu Sharma', '9788171670823', 'Rupa', 2002, 'Folk tales', '398 VIS', 3, 17500],
  ['Ruskin Bond’s Children’s Omnibus', 'Ruskin Bond', '9788129104465', 'Rupa', 2004, 'Fiction', '823 BON', 3, 39500],
  ['Harry Potter and the Philosopher’s Stone', 'J. K. Rowling', '9781408855652', 'Bloomsbury', 2014, 'Fiction', '823 ROW', 4, 49900],
  ['Charlotte’s Web', 'E. B. White', '9780064400558', 'HarperCollins', 2012, 'Fiction', '813 WHI', 2, 32500],
  ['A Brief History of Time', 'Stephen Hawking', '9780553380163', 'Bantam', 1998, 'Science', '523 HAW', 2, 45000],
  ['The Diary of a Young Girl', 'Anne Frank', '9780553296983', 'Bantam', 1993, 'Biography', '940 FRA', 2, 29900],
  ['Swami and Friends', 'R. K. Narayan', '9788185986005', 'Indian Thought', 2010, 'Fiction', '823 NAR', 2, 19500],
  ['Oxford Student Atlas for India', 'Oxford', '9780199488698', 'Oxford University Press', 2019, 'Reference', '912 OXF', 3, 39500],
  ['Concise Oxford English Dictionary', 'Oxford', '9780199601080', 'Oxford University Press', 2011, 'Reference', '423 OXF', 2, 125000],
  ['NCERT Mathematics Class 8', 'NCERT', '9788174505088', 'NCERT', 2023, 'Textbook', '510 NCE', 6, 6500],
  ['NCERT Science Class 8', 'NCERT', '9788174505095', 'NCERT', 2023, 'Textbook', '500 NCE', 6, 6500],
  ['Ignited Minds', 'A. P. J. Abdul Kalam', '9780143029823', 'Penguin', 2003, 'Non-fiction', '954 KAL', 2, 25000],
]

async function fillLibrary(admin) {
  if ((await admin.getRaw('/library/titles', { pageSize: 1 })).body?.total) return 'already there'
  let copies = 0
  for (const [title, authors, isbn, publisher, year, category, callNo, count, price] of BOOKS) {
    const type = category === 'Reference' ? 'REFERENCE' : category === 'Textbook' ? 'TEXTBOOK' : 'BOOK'
    const r = await admin.post('/library/titles', { title, authors: authors.split(';').map((x) => x.trim()), isbn, publisher, year, category, callNo, language: 'English', type, copies: { count, price, shelf: `${callNo.slice(0, 1)}-${(copies % 6) + 1}` } }, { ok: [201], quiet: [400] })
    copies += r?.added ?? 0
  }
  for (const [title, url, desc] of [
    ['Storyweaver: free children’s books', 'https://storyweaver.org.in/', 'Thousands of free illustrated stories in English, Hindi, Kannada and more.'],
    ['NCERT e-textbooks', 'https://ncert.nic.in/textbook.php', 'All NCERT textbooks, chapter by chapter.'],
    ['National Digital Library of India', 'https://ndl.iitkgp.ac.in/', 'Books, articles and lectures for every class.'],
  ]) await admin.post('/library/titles', { title, type: 'EBOOK', ebookUrl: url, description: desc, forFamilies: true, category: 'E-library' })
  // loans: students borrow; a few are already late; some came back late with a fine
  const titles = (await admin.get('/library/titles', { pageSize: 50 }))
  const lendable = []
  for (const t of (titles.data ?? titles).filter((x) => x.type === 'BOOK')) {
    const d = await admin.get(`/library/titles/${t.id}`)
    lendable.push(...d.copyList.filter((c) => c.status === 'AVAILABLE').map((c) => c.accessionNo))
  }
  const borrowers = students.filter((s) => lookup.classes.find((c) => c.id === s.classId && Number(c.code) >= 4)).slice(0, 28)
  let issued = 0
  for (const [i, s] of borrowers.entries()) {
    const code = lendable[i]
    if (!code) break
    await admin.post('/library/issue', { kind: 'STUDENT', id: s.id, codes: [code] })
    issued++
  }
  // back-date some loans so the desk has overdue books and late returns (direct, as a librarian's history would be)
  await runAsTenant(tenant._id, async () => {
    const { LibraryLoan } = await import('../models/library.js')
    const loans = await LibraryLoan.find({ status: 'ISSUED' }).sort({ createdAt: 1 }).lean()
    for (const [i, l] of loans.entries()) {
      const issuedOn = addDaysYmd(today, -(i % 4 === 0 ? 24 : 3 + (i % 9)))
      await LibraryLoan.updateOne({ _id: l._id }, { $set: { issuedOn, dueOn: addDaysYmd(issuedOn, 14) } })
    }
  })
  return `${BOOKS.length} titles (${copies} copies) + 3 e-library links, ${issued} issued`
}

/** A few overdue books come back: late fines are made, and one is paid at the desk. */
async function libraryReturns(admin) {
  if ((await admin.getRaw('/library/fines', { status: 'ALL', pageSize: 1 })).body?.total) return 'already there'
  const overdue = await admin.get('/library/loans', { state: 'OVERDUE', pageSize: 50 })
  let fines = 0
  for (const l of overdue.slice(0, 3)) {
    const r = await admin.post('/library/return', { code: l.accessionNo })
    if (!r.fines?.length) continue
    fines++
    if (fines === 1) await admin.post('/library/fines/collect', { ids: [r.fines[0].id], mode: 'CASH' })
  }
  return `${fines} late returns with fines, 1 paid`
}

// ───────────────────────────────────────────────────────── events, meetings, gallery

async function fillEvents(admin) {
  if ((await admin.get('/events/events', { when: 'ALL' })).length) return 'already there'
  const sec = (label) => lookup.sections.find((s) => s.short === label)?.id
  const cls = (code) => lookup.classes.find((c) => c.code === code)?.id
  const plan = [
    { title: 'Children’s Day celebration', kind: 'CELEBRATION', startDate: '2026-11-14', startTime: '09:00', endTime: '12:30', venue: 'School grounds', description: 'Teachers put on a show for the students. Students come in colour dress.', remind: true },
    { title: 'Science exhibition', kind: 'EVENT', startDate: '2026-11-21', startTime: '10:00', endTime: '14:00', venue: 'Main block, labs', description: 'Classes 6–10 show their projects. Parents are welcome from 11 am.', audience: 'CLASSES', classIds: ['6', '7', '8', '9', '10'].map(cls).filter(Boolean), reply: { kind: 'RSVP', question: 'Will you visit the exhibition?', by: '2026-11-19' } },
    { title: 'Trip to Visvesvaraya Museum', kind: 'TRIP', startDate: '2026-11-27', startTime: '08:30', endTime: '15:30', venue: 'Visvesvaraya Industrial & Technological Museum, Kasturba Road', description: 'By school bus. Packed lunch and water bottle. Fee ₹350, collected by the class teacher.', audience: 'SECTIONS', sectionIds: [sec('8-A'), sec('8-B')].filter(Boolean), reply: { kind: 'CONSENT', question: 'May your child join the museum trip on 27 November?', by: '2026-11-23' }, remind: true },
    { title: 'Inter-house sports day', kind: 'SPORTS', startDate: '2026-12-05', endDate: '2026-12-06', venue: 'Kanteerava Stadium (outdoor)', description: 'Track events on Saturday, finals and prize-giving on Sunday.' },
    { title: 'Annual Day — “Rang Tarang”', kind: 'CULTURAL', startDate: '2026-12-19', startTime: '17:00', endTime: '20:00', venue: 'School auditorium', description: 'Dance, music and drama by every class. Two passes a family.', reply: { kind: 'RSVP', question: 'Will you come to the Annual Day?', by: '2026-12-15' }, remind: true },
    { title: 'Last date: half-yearly fee', kind: 'DEADLINE', startDate: '2026-11-30', description: 'Pay at the counter or online in the app. A late fee applies after this date.' },
    { title: 'Staff development workshop', kind: 'MEETING', startDate: '2026-11-28', startTime: '14:00', endTime: '17:00', venue: 'Conference room', audience: 'STAFF', description: 'Classroom assessment practices.' },
    { title: 'Independence Day assembly', kind: 'CELEBRATION', startDate: '2026-08-15', startTime: '08:00', endTime: '10:00', venue: 'School grounds' },
    { title: 'Diwali celebration', kind: 'CELEBRATION', startDate: '2026-11-06', startTime: '10:00', endTime: '12:00', venue: 'Assembly hall', description: 'Rangoli competition and a diya-making workshop.' },
  ]
  for (const e of plan) {
    const made = await admin.post('/events/events', { audience: 'EVERYONE', classIds: [], sectionIds: [], ...e })
    if (e.audience !== 'STAFF') await admin.post(`/events/events/${made.id}/publish`, { notify: false })
  }
  // replies from some families for the trip and the exhibition
  const events = await admin.get('/events/events', { when: 'ALL' })
  let replies = 0
  for (const e of events.filter((x) => x.reply?.kind && x.reply.kind !== 'NONE')) {
    const r = await admin.get(`/events/events/${e.id}/replies`)
    for (const [i, row] of r.rows.entries()) {
      if (i % 3 === 2) continue
      await admin.put(`/events/events/${e.id}/replies`, { studentId: row.studentId, answer: i % 7 === 4 ? 'NO' : 'YES', note: i % 5 === 0 ? 'Reply slip sent with the student' : undefined })
      replies++
    }
  }
  // the half-yearly parent–teacher meeting, with the class teachers
  const hosts = await admin.get('/events/ptm/class-teachers')
  if (hosts.length) {
    const ptm = await admin.post('/events/ptm', { title: 'Half-yearly parent–teacher meeting', date: '2026-11-21', startTime: '09:30', endTime: '12:30', slotMinutes: 10, gapMinutes: 0, mode: 'IN_PERSON', hosts, instructions: 'Please bring the half-yearly report card. Parking is at the back gate.' })
    await admin.post(`/events/ptm/${ptm.id}/open`, { notify: false })
    const full = await admin.get(`/events/ptm/${ptm.id}`)
    for (const h of full.hosts) {
      const kids = students.filter((s) => h.sectionIds.includes(s.sectionId)).slice(0, 7)
      for (const [i, s] of kids.entries()) await admin.post(`/events/ptm/${ptm.id}/bookings`, { hostId: h.id, time: full.slots[i * 2], studentId: s.id }, { ok: [201], quiet: [400, 409] })
    }
  }
  for (const a of [
    { title: 'Independence Day 2026', date: '2026-08-15', published: true },
    { title: 'Diwali celebration', date: '2026-11-06', published: true },
    { title: 'Class 8 science projects', date: '2026-10-10', audience: 'SECTIONS', sectionIds: [sec('8-A'), sec('8-B')].filter(Boolean), published: false },
  ]) await admin.post('/events/albums', { audience: 'EVERYONE', classIds: [], sectionIds: [], branchIds: [], ...a })
  return `${plan.length} events, ${replies} replies, a parent–teacher meeting with ${hosts.length} teachers, 3 albums (add photos from the Gallery page)`
}

// ───────────────────────────────────────────────────────── staff & HR

const MORE_STAFF = [
  ['Meenakshi Raghavan', 'TEACHING', 'PGT Mathematics', 'FEMALE', '2016-06-01', 6200000, ['Mathematics']],
  ['Arvind Kulkarni', 'TEACHING', 'PGT Physics', 'MALE', '2018-06-01', 5800000, ['Physics']],
  ['Sangeeta Rao', 'TEACHING', 'TGT English', 'FEMALE', '2019-06-03', 4600000, ['English']],
  ['Mohammed Irfan', 'TEACHING', 'TGT Social Science', 'MALE', '2020-07-01', 4400000, ['Social Science']],
  ['Lata Hegde', 'TEACHING', 'TGT Kannada', 'FEMALE', '2017-06-01', 4300000, ['Kannada']],
  ['Priyanka Das', 'TEACHING', 'PRT (Primary)', 'FEMALE', '2021-06-01', 3600000, ['English', 'EVS']],
  ['Joseph Mathew', 'TEACHING', 'Physical education teacher', 'MALE', '2015-06-01', 4000000, ['Physical Education']],
  ['Shalini Bhat', 'TEACHING', 'Nursery teacher', 'FEMALE', '2022-06-01', 2800000, []],
  ['Geetha Ramesh', 'ADMIN', 'Librarian', 'FEMALE', '2014-08-01', 3200000, []],
  ['Venkatesh Murthy', 'ADMIN', 'Office assistant', 'MALE', '2019-01-02', 2200000, []],
  ['Lakshmi Devi', 'SUPPORT', 'Ayah (pre-primary)', 'FEMALE', '2018-04-02', 1500000, []],
  ['Ramesh Naik', 'SECURITY', 'Security guard', 'MALE', '2020-03-01', 1600000, []],
  ['Manjunath Gowda', 'TRANSPORT', 'Bus driver', 'MALE', '2017-05-15', 2100000, []],
  ['Ravi Kumar', 'TRANSPORT', 'Bus driver', 'MALE', '2021-11-01', 2000000, []],
]
const LOGIN_STAFF = { // by name: category, joined, gross a month (paise), gender
  'Anita Sharma': ['ADMIN', '2012-04-01', 7000000, 'FEMALE'],
  'Dr. Kavita Menon': ['ADMIN', '2013-04-01', 12000000, 'FEMALE'],
  'Neha Sinha': ['TEACHING', '2017-06-01', 5200000, 'FEMALE'],
  'Rahul Verma': ['TEACHING', '2019-06-01', 5000000, 'MALE'],
  'Suresh Iyer': ['ADMIN', '2016-01-04', 4200000, 'MALE'],
  'Pooja Nair': ['ADMIN', '2022-02-01', 3500000, 'FEMALE'],
  'Farhan Ali': ['ADMIN', '2023-07-03', 2600000, 'MALE'],
}
const HOLIDAYS = [
  ['2026-08-15', 'Independence Day'], ['2026-09-14', 'Ganesh Chaturthi'], ['2026-10-02', 'Gandhi Jayanti'], ['2026-10-20', 'Vijayadashami'],
  ['2026-11-01', 'Kannada Rajyotsava'], ['2026-11-10', 'Balipadyami (Deepavali)'], ['2026-12-25', 'Christmas'], ['2027-01-01', 'New Year’s Day'],
  ['2027-01-14', 'Makara Sankranti'], ['2027-01-26', 'Republic Day'], ['2027-03-06', 'Maha Shivaratri'],
]

let employees = []
const loadEmployees = async (admin) => { employees = (await admin.get('/hrms/employees', { pageSize: 100 })); return employees }

async function fillStaff(admin) {
  await admin.patch('/core/settings/modules/hrms', { saturdaysOff: ['2', '4'], lateAfter: '08:15' })
  if ((await admin.getRaw('/hrms/employees', { pageSize: 1 })).body?.meta?.total > 5) return 'already there'
  await admin.post('/hrms/employees/from-logins', {})
  await loadEmployees(admin)
  const principal = employees.find((e) => /Kavita Menon/.test(e.name))
  let n = 0
  for (const e of employees) {
    const [category, joiningDate, gross, gender] = LOGIN_STAFF[e.name] ?? ['ADMIN', '2020-06-01', 4000000, 'FEMALE']
    await admin.patch(`/hrms/employees/${e.id}`, { category, joiningDate, gender, ...(principal && e.id !== principal.id && { reportingManagerId: principal.id }) })
    await admin.put(`/hrms/employees/${e.id}/salary`, { grossMonthly: gross, basicMonthly: Math.round(gross / 2) })
    n++
  }
  for (const [i, [name, category, designation, gender, joiningDate, gross, subjects]] of MORE_STAFF.entries()) {
    const e = await admin.post('/hrms/employees', { name, category, employmentType: i === 7 ? 'PROBATION' : 'PERMANENT', designation, gender, joiningDate, subjects, mobile: `9880${String(410000 + i * 113).padStart(6, '0')}`, ...(principal && { reportingManagerId: principal.id }) })
    await admin.put(`/hrms/employees/${e.id}/salary`, { grossMonthly: gross, basicMonthly: Math.round(gross / 2), esi: gross <= 2100000 })
    n++
  }
  await loadEmployees(admin)
  for (const [i, e] of employees.entries()) {
    const pan = `${'ABCDEFGHJK'[i % 10]}${'PQRSTUVWXY'[(i * 3) % 10]}${'LMNOP'[i % 5]}P${'KMRSV'[i % 5]}${String(1000 + i * 37).slice(-4)}${'ABCDEFGHJ'[i % 9]}`
    await admin.put(`/hrms/employees/${e.id}/sensitive`, { pan, uan: `1009${String(20000000 + i * 7919).slice(-8)}`, account: `5010${String(30000000 + i * 104729).slice(-8)}`, ifsc: i % 3 ? 'HDFC0001234' : 'SBIN0040230', bankName: i % 3 ? 'HDFC Bank' : 'State Bank of India' }, { ok: [200], quiet: [400] })
  }
  await admin.post('/hrms/holidays/bulk', { rows: HOLIDAYS.map(([date, name]) => ({ date, name })) }, { ok: [200, 201], quiet: [400, 409] })
  return `${employees.length} staff records with salary and bank details, ${HOLIDAYS.length} holidays`
}

/** Staff attendance for every working day from 1 October to yesterday, and a little leave. */
async function fillStaffAttendance(admin) {
  const marked = await runAsTenant(tenant._id, async () => (await import('../models/hrms.js')).StaffAttendance.countDocuments({ date: { $gte: '2026-10-01' } }))
  if (marked > 100) return 'already there'
  await loadEmployees(admin)
  const types = await admin.get('/hrms/leave/types')
  const cl = types.find((x) => x.code === 'CL')
  const sl = types.find((x) => x.code === 'SL')
  const leaves = await admin.getRaw('/hrms/leave', { pageSize: 1 })
  if (!leaves.body?.meta?.total) {
    const on = (name) => employees.find((e) => e.name.startsWith(name))
    for (const [who, type, from, to, reason] of [
      ['Sangeeta', cl, '2026-10-12', '2026-10-13', 'Family function'], ['Mohammed', sl, '2026-10-27', '2026-10-27', 'Fever'],
      ['Priyanka', cl, '2026-11-05', '2026-11-06', 'Sister’s wedding'], ['Venkatesh', cl, '2026-10-16', '2026-10-16', 'Personal work'],
    ]) if (on(who)) await admin.post('/hrms/leave', { employeeId: on(who).id, leaveTypeId: type.id, from, to, reason, approveNow: true }, { ok: [201], quiet: [400, 409] })
  }
  let days = 0
  for (let d = '2026-10-01'; d < today; d = addDaysYmd(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    const satNo = Math.ceil(Number(d.slice(8)) / 7)
    if (dow === 0 || (dow === 6 && [2, 4].includes(satNo)) || HOLIDAYS.some(([h]) => h === d)) continue
    const entries = employees.map((e, i) => {
      const k = (i * 31 + Number(d.slice(8)) * 7) % 41
      if (k === 0) return { employeeId: e.id, status: 'ABSENT' }
      if (k === 5) return { employeeId: e.id, status: 'HALF_DAY', inTime: '08:05', outTime: '12:00' }
      const late = k % 13 === 3
      return { employeeId: e.id, status: 'PRESENT', inTime: late ? '08:32' : `07:${String(45 + (k % 14)).padStart(2, '0')}`, outTime: dow === 6 ? '12:45' : `15:${String(30 + (k % 25)).padStart(2, '0')}` }
    })
    await admin.put('/hrms/attendance/day', { date: d, entries }, { ok: [200], quiet: [400, 403, 409] })
    days++
  }
  return `${days} working days marked for ${employees.length} staff, 4 leaves approved`
}

/** A teacher asks for leave next month; it waits with the principal. */
async function pendingLeave() {
  const neha = await signIn('teacher@greenvalley.test', 'Demo@123')
  const mine = await neha.get('/hrms/me/leave').catch(() => null)
  if (mine && (mine.requests ?? mine).length) return 'already there'
  const types = await neha.get('/hrms/me/leave').then((r) => r.balances ?? r.types ?? []).catch(() => [])
  const cl = types.find?.((x) => x.code === 'CL')
  if (!cl) return 'skipped (no leave types on My workspace)'
  await neha.post('/hrms/me/leave', { leaveTypeId: cl.leaveTypeId ?? cl.id, from: '2026-12-07', to: '2026-12-08', reason: 'Family function in Mysuru', arrangement: 'Rahul takes 8-A maths' })
  return 'Neha Sinha’s leave waits with the principal'
}

// ───────────────────────────────────────────────────────── payroll

async function fillPayroll(admin) {
  const runs = await admin.get('/payroll/runs').catch(() => [])
  if ((runs.data ?? runs).length) return 'already there'
  await loadEmployees(admin)
  const structures = await admin.get('/payroll/structures')
  const by = (code) => structures.find((x) => x.code === code)
  await admin.post('/payroll/assignments/bulk', { structureId: by('TEACHING').id, employeeIds: employees.filter((e) => e.category === 'TEACHING').map((e) => e.id), effectiveFrom: '2026-04-01' })
  await admin.post('/payroll/assignments/bulk', { structureId: by('STAFF').id, employeeIds: employees.filter((e) => e.category !== 'TEACHING').map((e) => e.id), effectiveFrom: '2026-04-01' })
  const driver = employees.find((e) => e.name === 'Ravi Kumar')
  if (driver) await admin.post('/payroll/loans', { employeeId: driver.id, type: 'ADVANCE', amount: 600000, instalment: 200000, startMonth: '2026-11', reason: 'Medical expenses' }, { ok: [201], quiet: [400, 409] })
  // the demo's single admin both prepares and approves, so separation of duties is switched off for the run, then back on
  await admin.put('/payroll/statutory', { separateDuties: false })
  try {
    const oct = await admin.post('/payroll/runs', { month: '2026-10' })
    await admin.post(`/payroll/runs/${oct.id}/calculate`, {})
    await admin.post(`/payroll/runs/${oct.id}/approve`, { note: 'Checked against attendance' })
    await admin.post(`/payroll/runs/${oct.id}/pay`, { date: '2026-11-02', mode: 'NEFT', reference: 'HDFCN26110200871' })
    const nov = await admin.post('/payroll/runs', { month: '2026-11' })
    await admin.post(`/payroll/runs/${nov.id}/calculate`, {})
  } finally {
    await admin.put('/payroll/statutory', { separateDuties: true })
  }
  return 'structures assigned, October paid (posted to Accounts), November calculated, 1 salary advance'
}

// ───────────────────────────────────────────────────────── accounts (expenses)

async function fillExpenses(admin) {
  if ((await admin.get('/finance/expenses').then((r) => r.data ?? r)).length) return 'already there'
  const heads = await admin.get('/finance/expenses/heads')
  const head = (re) => (heads.find((h) => re.test(h.name)) ?? heads[0]).id
  const list = [
    ['2026-10-05', /Electric/i, 'BESCOM', 'Electricity — September', 4825000, 'PAID', 'BANK_TRANSFER'],
    ['2026-10-07', /Water/i, 'BWSSB', 'Water — September', 612000, 'PAID', 'BANK_TRANSFER'],
    ['2026-10-10', /Internet|Telephone/i, 'ACT Fibernet', 'Internet — October', 354000, 'PAID', 'BANK_TRANSFER'],
    ['2026-10-14', /Stationery|Printing/i, 'Sapna Book House', 'Exam answer booklets and chart paper', 1876000, 'PAID', 'CHEQUE'],
    ['2026-10-21', /Repair|Maintenance/i, 'Sri Sai Electricals', 'Classroom fans and tube lights', 2640000, 'PAID', 'CASH'],
    ['2026-10-28', /Fuel|Transport|Vehicle/i, 'HP Petrol Bunk, ORR', 'Diesel for school buses — October', 9150000, 'PAID', 'BANK_TRANSFER'],
    ['2026-11-03', /Electric/i, 'BESCOM', 'Electricity — October', 4590000, 'APPROVED', null],
    ['2026-11-06', /Event|Function|Cultural/i, 'Shree Decorators', 'Diwali celebration decoration', 1250000, 'SUBMITTED', null],
  ]
  for (const [i, [date, re, payee, description, amount, status, mode]] of list.entries()) {
    const x = await admin.post('/finance/expenses', { date, accountId: head(re), payee: { name: payee }, description, amount })
    if (status === 'SUBMITTED') continue
    if (x.status !== 'APPROVED') await admin.post(`/finance/expenses/${x.id}/decide`, { approve: true })
    if (status === 'PAID') await admin.post(`/finance/expenses/${x.id}/pay`, { date: addDaysYmd(date, 2), mode, ...(mode !== 'CASH' && { reference: mode === 'CHEQUE' ? `CHQ${400100 + i}` : `UTR${9100023 + i * 17}` }) })
  }
  return `${list.length} expenses (6 paid)`
}

// ───────────────────────────────────────────────────────── LMS and online tests

const QUESTIONS = {
  SCI: [
    { type: 'MCQ', chapter: 'Force and pressure', text: 'The SI unit of force is', options: [{ text: 'Joule' }, { text: 'Newton', correct: true }, { text: 'Watt' }, { text: 'Pascal' }], marks: 1, difficulty: 'EASY' },
    { type: 'MCQ', chapter: 'Force and pressure', text: 'Pressure is force acting on a unit', options: [{ text: 'volume' }, { text: 'length' }, { text: 'area', correct: true }, { text: 'mass' }], marks: 1, difficulty: 'EASY' },
    { type: 'TRUE_FALSE', chapter: 'Friction', text: 'Friction always opposes motion.', options: [{ text: 'True', correct: true }, { text: 'False' }], marks: 1, difficulty: 'EASY' },
    { type: 'FILL', chapter: 'Friction', text: 'Friction between two surfaces can be reduced by using a ________.', answers: ['lubricant', 'lubricants', 'oil'], marks: 1, difficulty: 'MEDIUM' },
    { type: 'MULTI', chapter: 'Sound', text: 'Which of these need a medium to travel?', options: [{ text: 'Sound', correct: true }, { text: 'Light' }, { text: 'Seismic waves', correct: true }], marks: 2, difficulty: 'MEDIUM' },
    { type: 'MCQ', chapter: 'Sound', text: 'The unit of frequency is', options: [{ text: 'Hertz', correct: true }, { text: 'Decibel' }, { text: 'Metre' }], marks: 1, difficulty: 'EASY' },
    { type: 'SHORT', chapter: 'Force and pressure', text: 'Why are the tips of nails and needles made sharp?', marks: 2, difficulty: 'MEDIUM', answers: ['A sharp tip has a very small area, so the same force gives a much greater pressure.'] },
    { type: 'LONG', chapter: 'Friction', text: 'Give three ways in which friction is useful and two ways in which it is a nuisance.', marks: 5, difficulty: 'HARD' },
  ],
  MATH: [
    { type: 'MCQ', chapter: 'Rational numbers', text: 'The additive inverse of −7/9 is', options: [{ text: '7/9', correct: true }, { text: '−9/7' }, { text: '9/7' }, { text: '0' }], marks: 1, difficulty: 'EASY' },
    { type: 'FILL', chapter: 'Squares and square roots', text: 'The square root of 1764 is ____.', answers: ['42'], marks: 1, difficulty: 'MEDIUM' },
    { type: 'MCQ', chapter: 'Linear equations', text: 'If 3x + 5 = 20, then x is', options: [{ text: '3' }, { text: '5', correct: true }, { text: '15' }, { text: '25/3' }], marks: 1, difficulty: 'EASY' },
    { type: 'TRUE_FALSE', chapter: 'Squares and square roots', text: 'A perfect square can end in the digit 7.', options: [{ text: 'True' }, { text: 'False', correct: true }], marks: 1, difficulty: 'MEDIUM' },
    { type: 'SHORT', chapter: 'Linear equations', text: 'The sum of two consecutive odd numbers is 56. Find the numbers.', marks: 3, difficulty: 'MEDIUM', answers: ['27 and 29'] },
  ],
}

async function fillLms(admin) {
  if ((await admin.get('/lms/courses').then((r) => r.data ?? r)).length) return 'already there'
  const lk = await admin.get('/lms/lookup')
  const c8 = lookup.classes.find((c) => c.code === '8')
  const secs = lk.sections.filter((s) => s.classId === c8.id || lookup.sections.find((x) => x.id === s.id)?.classId === c8.id)
  // anchored: an unanchored /Science/ also matches "Computer Science", which comes first
  const subject = (code) => secs[0]?.subjects.find((x) => x.code === code || new RegExp(code === 'SCI' ? '^Science$' : '^Math', 'i').test(x.name))
  const out = []
  for (const [code, title, units] of [
    ['MATH', 'Mathematics — Class 8', [
      ['Rational numbers', [{ kind: 'NOTE', title: 'Key ideas', body: 'A rational number is p/q with q ≠ 0. Rational numbers are closed under addition, subtraction and multiplication.' }, { kind: 'VIDEO', title: 'Rational numbers on the number line', url: 'https://www.youtube.com/watch?v=4G1bq7BI0YQ', minutes: 9 }, { kind: 'LINK', title: 'NCERT chapter 1', url: 'https://ncert.nic.in/textbook.php?hemh1=1-13' }]],
      ['Linear equations in one variable', [{ kind: 'NOTE', title: 'Solving step by step', body: 'Do the same thing to both sides. Move the variable terms to one side and the numbers to the other.' }, { kind: 'LINK', title: 'Practice worksheet', url: 'https://www.khanacademy.org/math/cc-eighth-grade-math' }]],
      ['Squares and square roots', [{ kind: 'NOTE', title: 'Patterns in squares', body: 'A square never ends in 2, 3, 7 or 8. The square root of a perfect square can be found by prime factorisation.' }]],
    ]],
    ['SCI', 'Science — Class 8', [
      ['Force and pressure', [{ kind: 'NOTE', title: 'Summary', body: 'A force is a push or a pull. Pressure = force ÷ area. Liquids and gases exert pressure on the walls of their containers.' }, { kind: 'VIDEO', title: 'Atmospheric pressure experiment', url: 'https://www.youtube.com/watch?v=CN4oqQxv5yE', minutes: 6 }]],
      ['Friction', [{ kind: 'NOTE', title: 'Summary', body: 'Friction opposes relative motion between surfaces in contact. It depends on the nature of the surfaces and produces heat.' }, { kind: 'LINK', title: 'PhET: Forces and motion', url: 'https://phet.colorado.edu/en/simulations/forces-and-motion-basics' }]],
      ['Sound', [{ kind: 'NOTE', title: 'Summary', body: 'Sound is produced by vibration and needs a medium. Frequency is measured in hertz; loudness in decibels.' }]],
    ]],
  ]) {
    const subj = subject(code)
    if (!subj) continue
    const course = await admin.post('/lms/courses', { title, classId: c8.id, subjectId: subj.id, sectionIds: secs.map((s) => s.id), description: `Notes, videos and practice for ${title.split(' — ')[0]}, Class 8 (CBSE).` })
    await admin.put(`/lms/courses/${course.id}/outline`, { units: units.map(([t, items], i) => ({ ...(i === 0 && { id: course.units[0].id }), title: t, items })) })
    await admin.post(`/lms/courses/${course.id}/status`, { status: 'PUBLISHED' })
    const qs = []
    for (const q of QUESTIONS[code]) qs.push((await admin.post('/lms/questions', { subjectId: subj.id, classId: c8.id, ...q })).id)
    if (code === 'SCI') {
      await admin.post('/lms/live', { title: 'Doubt clearing — Force and pressure', classId: c8.id, subjectId: subj.id, sectionIds: secs.map((s) => s.id), date: addDaysYmd(today, 2), start: '16:00', durationMin: 40, notify: false })
      const test = await admin.post('/online-tests/tests', { title: 'Unit test — Force, friction and sound', classId: c8.id, subjectId: subj.id, sectionIds: secs.map((s) => s.id), durationMin: 25, opens: { date: addDaysYmd(today, -1), time: '08:00' }, closes: { date: addDaysYmd(today, 6), time: '20:00' }, results: 'AFTER_CLOSE', proctor: { maxTabSwitches: 3 } })
      await admin.post(`/online-tests/tests/${test.id}/questions`, { questionIds: qs })
      await admin.post(`/online-tests/tests/${test.id}/publish`, { notify: false })
    } else {
      await admin.post('/lms/live', { title: 'Revision — Linear equations', classId: c8.id, subjectId: subj.id, sectionIds: secs.map((s) => s.id), date: addDaysYmd(today, 3), start: '15:30', durationMin: 45, notify: false })
      const test = await admin.post('/online-tests/tests', { title: 'Practice quiz — Numbers and equations', classId: c8.id, subjectId: subj.id, sectionIds: secs.map((s) => s.id), durationMin: 15, opens: { date: today, time: '06:00' }, closes: { date: addDaysYmd(today, 10), time: '21:00' }, results: 'IMMEDIATE', attemptsAllowed: 2 })
      await admin.post(`/online-tests/tests/${test.id}/questions`, { questionIds: qs })
      await admin.post(`/online-tests/tests/${test.id}/publish`, { notify: false })
    }
    out.push(title)
  }
  return `${out.length} courses, ${QUESTIONS.SCI.length + QUESTIONS.MATH.length} bank questions, 2 live classes, 2 online tests (Class 8)`
}

// ───────────────────────────────────────────────────────── teachers, allocations, timetable

const hash = (...xs) => xs.reduce((h, x) => ((h * 31 + (typeof x === 'string' ? [...x].reduce((a, c) => a * 7 + c.charCodeAt(0), 0) : x)) >>> 0) % 1000003, 7)
const TEACHER_LOGINS = [
  ['Meenakshi Raghavan', 'meenakshi@greenvalley.test'], ['Arvind Kulkarni', 'arvind@greenvalley.test'], ['Sangeeta Rao', 'sangeeta@greenvalley.test'],
  ['Mohammed Irfan', 'irfan@greenvalley.test'], ['Lata Hegde', 'lata@greenvalley.test'], ['Priyanka Das', 'priyanka@greenvalley.test'],
  ['Joseph Mathew', 'joseph@greenvalley.test'], ['Shalini Bhat', 'shalini@greenvalley.test'],
]
const CLASS_TEACHERS = { '9-A': 'Meenakshi Raghavan', '9-B': 'Arvind Kulkarni', '7-A': 'Sangeeta Rao', '7-B': 'Mohammed Irfan', '6-A': 'Lata Hegde', '1-A': 'Priyanka Das', '6-B': 'Joseph Mathew', 'NUR-A': 'Shalini Bhat' }
const POOLS = [ // subject → teachers who take it, periods a week (about 27 a section; the rest are library and free periods)
  [/math/i, ['Meenakshi Raghavan', 'Neha Sinha'], 5], [/science|physics|chemistry|biology/i, ['Rahul Verma', 'Arvind Kulkarni'], 5],
  [/english/i, ['Sangeeta Rao', 'Priyanka Das'], 4], [/social|history|geography|civics/i, ['Mohammed Irfan', 'Sangeeta Rao'], 4],
  [/kannada|hindi|sanskrit|language/i, ['Lata Hegde', 'Priyanka Das'], 4], [/physical|sport|games/i, ['Joseph Mathew'], 2],
  [/computer|information/i, ['Shalini Bhat', 'Arvind Kulkarni'], 2], [/./, ['Shalini Bhat', 'Joseph Mathew'], 1],
]

async function fillTeachers(admin) {
  const roles = await admin.get('/core/roles')
  const roleOf = (code) => (roles.data ?? roles).find((r) => r.templateCode === code)?.id
  const users = await admin.get('/core/users', { pageSize: 100 })
  const have = new Set((users.data ?? users).map((u) => u.email))
  await loadEmployees(admin)
  let made = 0
  for (const [name, email] of TEACHER_LOGINS) {
    if (have.has(email)) continue
    const isClassTeacher = Object.values(CLASS_TEACHERS).includes(name)
    const u = await admin.post('/core/users', { name, email, roleIds: [roleOf(isClassTeacher ? 'CLASS_TEACHER' : 'SUBJECT_TEACHER') ?? roleOf('SUBJECT_TEACHER')], password: 'Demo@123', designation: MORE_STAFF.find((x) => x[0] === name)?.[2] })
    const e = employees.find((x) => x.name === name)
    if (e) await admin.put(`/hrms/employees/${e.id}/login`, { userId: u.user?.id ?? u.id }, { ok: [200], quiet: [400, 409] })
    made++
  }
  const all = (await admin.get('/core/users', { pageSize: 100 }))
  const userByName = new Map((all.data ?? all).map((u) => [u.name, u.id]))
  for (const [short, name] of Object.entries(CLASS_TEACHERS)) {
    const sec = lookup.sections.find((x) => x.short === short)
    if (sec && userByName.get(name)) await admin.patch(`/academics/sections/${sec.id}`, { classTeacherId: userByName.get(name) })
  }
  // who teaches what in Classes 6–10 (the timetable is made from this)
  const classes = (await admin.get('/academics/classes')).classes
  const load = new Map()
  let rows = 0
  for (const c of classes.filter((x) => ['6', '7', '8', '9', '10'].includes(x.code))) {
    for (const sec of c.sections) {
      for (const subj of c.subjects) {
        const [, pool, periods] = POOLS.find(([re]) => re.test(subj.name))
        const teacher = [...pool].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]
        const teacherId = userByName.get(teacher)
        if (!teacherId) continue
        load.set(teacher, (load.get(teacher) ?? 0) + periods)
        await admin.put('/academics/allocation', { sectionId: sec.id, subjectId: subj.id, teacherId, periodsPerWeek: periods })
        rows++
      }
    }
  }
  return `${made} teacher logins (password Demo@123), ${Object.keys(CLASS_TEACHERS).length} class teachers, ${rows} subject allocations for Classes 6–10`
}

async function fillTimetable(admin) {
  const ov = await admin.get('/timetable')
  if (ov.published) return 'already there'
  const draft = ov.draft ?? (await admin.post('/timetable/draft', {})).draft
  const g = await admin.post(`/timetable/${draft.id}/generate`, { seed: 7 })
  await admin.post(`/timetable/${draft.id}/publish`, { effectiveFrom: '2026-06-01' }, { ok: [200], quiet: [409] })
  return `generated (${g.placed} of ${g.wanted} periods placed${g.unplaced?.length ? `, ${g.unplaced.length} left for the timetable in-charge` : ''}), published from 1 June`
}

// ───────────────────────────────────────────────────────── rooms

/** A home classroom for every section (pre-primary on the ground floor, then a floor per few classes), plus labs and halls. */
async function fillRooms(admin) {
  if ((await admin.get('/timetable/rooms')).length) return 'already there'
  const floorOf = (code) => (['NUR', 'LKG', 'UKG', '1', '2'].includes(code) ? 0 : Number(code) <= 5 ? 1 : Number(code) <= 9 ? 2 : 3)
  const used = {}
  let n = 0
  for (const sec of lookup.sections) {
    const cls = lookup.classes.find((c) => c.id === sec.classId)
    const floor = floorOf(cls?.code)
    used[floor] = (used[floor] ?? 0) + 1
    const no = floor ? String(floor * 100 + used[floor]) : `G${String(used[floor]).padStart(2, '0')}`
    await admin.post('/timetable/rooms', { name: `Room ${no}`, code: floor ? `R${no}` : no, kind: 'CLASSROOM', capacity: 40, sectionId: sec.id })
    n++
  }
  const extra = [
    ['Physics lab', 'PHY-LAB', 'LAB', 30], ['Chemistry lab', 'CHE-LAB', 'LAB', 30], ['Biology lab', 'BIO-LAB', 'LAB', 30],
    ['Computer lab', 'COMP-1', 'COMPUTER', 36], ['Assembly hall', 'HALL', 'HALL', 400], ['Library', 'LIB', 'LIBRARY', 60], ['Sports ground', 'GROUND', 'GROUND', 300],
  ]
  for (const [name, code, kind, capacity] of extra) await admin.post('/timetable/rooms', { name, code, kind, capacity })
  return `${n} classrooms (each a section's home room) and ${extra.length} labs, halls and grounds`
}

// ───────────────────────────────────────────────────────── student attendance

const isSchoolDay = (d) => {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
  const satNo = Math.ceil(Number(d.slice(8)) / 7)
  return !(dow === 0 || (dow === 6 && [2, 4].includes(satNo)) || HOLIDAYS.some(([h]) => h === d))
}

async function fillAttendance(admin) {
  const probe = lookup.sections[0]
  const first = await admin.get('/attendance/sheet', { sectionId: probe.id, date: '2026-10-05' }).catch(() => null)
  if (first?.taken) return 'already there'
  let sheets = 0
  for (let d = '2026-10-01'; d < today; d = addDaysYmd(d, 1)) {
    if (!isSchoolDay(d)) continue
    for (const sec of lookup.sections) {
      const kids = studentsOf(sec.id)
      if (!kids.length) continue
      const entries = kids.map((k) => {
        const h = hash(k.id, d) % 60
        return { studentId: k.id, status: h < 3 ? 'A' : h === 3 ? 'L' : h === 4 ? 'HD' : 'P' }
      })
      await admin.put('/attendance/sheet', { sectionId: sec.id, date: d, entries })
      sheets++
    }
  }
  return `${sheets} class registers (1 October – yesterday)`
}

// ───────────────────────────────────────────────────────── fees

const FEE_PLANS = [
  ['Pre-primary 2026-27', ['NUR', 'LKG', 'UKG'], { TUITION: 4400000, ANNUAL: 600000 }],
  ['Classes 1–5 2026-27', ['1', '2', '3', '4', '5'], { TUITION: 5600000, ANNUAL: 800000, EXAM: 200000 }],
  ['Classes 6–8 2026-27', ['6', '7', '8'], { TUITION: 6400000, ANNUAL: 900000, LAB: 300000, EXAM: 200000 }],
  ['Classes 9–10 2026-27', ['9', '10'], { TUITION: 7600000, ANNUAL: 1000000, LAB: 500000, EXAM: 300000 }],
  ['Classes 11–12 2026-27', ['11', '12'], { TUITION: 8800000, ANNUAL: 1000000, LAB: 800000, EXAM: 400000 }],
]

async function fillFees(admin) {
  const existing = await admin.get('/fees/structures')
  if ((existing.structures ?? existing.data ?? existing).length) return 'already there'
  const heads = await admin.get('/fees/heads')
  const head = (code) => heads.find((h) => h.code === code).id
  for (const [name, codes, lines] of FEE_PLANS) {
    const total = Object.values(lines).reduce((a, b) => a + b, 0)
    const st = await admin.post('/fees/structures', {
      name, classIds: codes.map((c) => lookup.classes.find((x) => x.code === c)?.id).filter(Boolean),
      lines: Object.entries(lines).map(([code, amount]) => ({ feeHeadId: head(code), amount })),
      installments: [{ name: 'Term 1', dueDate: '2026-04-15', amount: total / 2 }, { name: 'Term 2', dueDate: '2026-10-15', amount: total / 2 }],
    })
    await admin.post(`/fees/structures/${st.id}/generate`, {})
  }
  // concessions first (they only lower what is unpaid): siblings and staff wards
  let concessions = 0
  for (const [i, s] of students.entries()) {
    if (i % 23 !== 4) continue
    const c = await admin.post('/fees/concessions', { studentId: s.id, kind: 'PCT', value: i % 2 ? 10 : 25, feeHeadIds: [head('TUITION')], reason: i % 2 ? 'Sibling studying in the school' : 'Staff ward' }, { ok: [201], quiet: [400, 409] })
    if (c) { await admin.post(`/fees/concessions/${c.id}/decide`, { approve: true }); concessions++ }
  }
  // payments: most families paid Term 1 in April and Term 2 in October; some are late or part-paid
  const MODES = [['UPI', 'UPI'], ['CASH', null], ['BANK_TRANSFER', 'NEFT'], ['CHEQUE', 'CHQ'], ['CARD', 'CARD'], ['UPI', 'UPI']]
  const backdate = []
  let receipts = 0
  for (const [i, s] of students.entries()) {
    const ledger = await admin.get(`/fees/students/${s.id}`)
    const inv = (ledger.invoices ?? []).filter((x) => x.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    if (!inv.length) continue
    const k = i % 10
    const plan = k <= 5 ? [[inv[0], 1], [inv[1], 1]] : k <= 7 ? [[inv[0], 1]] : k === 8 ? [[inv[0], 1], [inv[1], 0.5]] : [[inv[0], 0.6]]
    for (const [j, [x, share]] of plan.entries()) {
      if (!x) continue
      const amount = Math.round((x.balance * share) / 100) * 100
      const [mode, ref] = MODES[(i + j) % MODES.length]
      const r = await admin.post('/fees/collect', { studentId: s.id, amount, mode, ...(ref && { reference: `${ref}${String(hash(s.id, j)).padStart(7, '0')}` }), waiveLateFee: true }, { ok: [201], quiet: [400] })
      if (!r) continue
      const day = j === 0 ? `2026-04-${String(2 + (i % 24)).padStart(2, '0')}` : `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`
      backdate.push([r.id, day])
      receipts++
    }
  }
  // the receipts were taken today; date them (and their vouchers in Accounts) on the days the families paid
  await runAsTenant(tenant._id, async () => {
    const { FeePayment } = await import('../models/fees.js')
    const { Journal } = await import('../models/finance.js')
    for (const [id, day] of backdate) {
      await FeePayment.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { date: day } })
      await Journal.collection.updateMany({ 'source.id': new mongoose.Types.ObjectId(id) }, { $set: { date: day } })
    }
  })
  return `${FEE_PLANS.length} fee structures with invoices, ${concessions} concessions, ${receipts} receipts (April and October, posted to Accounts)`
}

// ───────────────────────────────────────────────────────── exams

async function runExam(admin, { name, typeCode, classCodes, start, maxMarks, passMarks, hours }) {
  const types = await admin.get('/exams/types')
  const classIds = classCodes.map((c) => lookup.classes.find((x) => x.code === c)?.id).filter(Boolean)
  const exam = await admin.post('/exams', { name, examTypeId: types.find((t) => t.code === typeCode).id, classIds, instructions: 'Reach the exam hall 15 minutes early with your hall ticket. No electronic devices.' })
  for (const classId of classIds) {
    const subs = await admin.get(`/exams/${exam.id}/classes/${classId}/suggest`)
    let d = start
    const papers = []
    for (const sub of subs) {
      while (new Date(`${d}T12:00:00Z`).getUTCDay() === 0 || HOLIDAYS.some(([h]) => h === d)) d = addDaysYmd(d, 1)
      papers.push(sub.gradeOnly
        ? { subjectId: sub.subjectId, date: d, startTime: '12:30', endTime: '13:30', gradeOnly: true }
        : { subjectId: sub.subjectId, date: d, startTime: '09:30', endTime: hours === 1 ? '10:30' : '12:30', maxMarks: maxMarks ?? sub.maxMarks, passMarks: passMarks ?? Math.round((maxMarks ?? sub.maxMarks) * 0.33) })
      if (!sub.gradeOnly) d = addDaysYmd(d, 1)
    }
    await admin.put(`/exams/${exam.id}/classes/${classId}/papers`, { papers })
  }
  await admin.post(`/exams/${exam.id}/schedule`, {})
  const full = await admin.get(`/exams/${exam.id}`)
  let sheets = 0
  for (const c of full.classes) {
    const secs = lookup.sections.filter((s) => s.classId === (c.classId ?? c.id))
    for (const p of c.papers) {
      for (const sec of secs) {
        const kids = studentsOf(sec.id)
        if (!kids.length) continue
        const entries = kids.map((k) => {
          const ability = 0.42 + (hash(k.id) % 55) / 100 // 0.42–0.96, the same student does about as well every time
          const noise = ((hash(k.id, p.id) % 21) - 10) / 100
          if (hash(k.id, p.id, 'x') % 97 === 0) return { studentId: k.id, absent: true }
          if (p.gradeOnly) return { studentId: k.id, grade: ability > 0.8 ? 'A' : ability > 0.6 ? 'B' : 'C' }
          return { studentId: k.id, marks: Math.max(0, Math.min(p.maxMarks, Math.round(p.maxMarks * (ability + noise)))) }
        })
        await admin.put(`/exams/marks/${p.id}/${sec.id}`, { entries })
        await admin.post(`/exams/marks/${p.id}/${sec.id}/lock`, {})
        sheets++
      }
    }
  }
  await admin.post(`/exams/${exam.id}/publish`, {})
  return sheets
}

async function fillExams(admin) {
  const list = await admin.get('/exams')
  if ((list.exams ?? list.data ?? list).length) return 'already there'
  const ut = await runExam(admin, { name: 'Unit Test 1', typeCode: 'UT', classCodes: ['6', '7', '8', '9', '10'], start: '2026-07-13', maxMarks: 25, passMarks: 9, hours: 1 })
  const hy = await runExam(admin, { name: 'Half-yearly examination', typeCode: 'HY', classCodes: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], start: '2026-09-21' })
  return `Unit Test 1 (Classes 6–10, ${ut} mark sheets) and the half-yearly (Classes 1–12, ${hy} mark sheets), both published`
}

// ───────────────────────────────────────────────────────── question papers

// Questions written straight into the paper (the demo bank has only a few per subject).
const PAPER_WRITES = {
  MCQ: [
    { text: 'Which of these is a contact force?', options: [{ text: 'Magnetic force' }, { text: 'Electrostatic force' }, { text: 'Muscular force', correct: true }, { text: 'Gravitational force' }], chapter: 'Force and pressure', difficulty: 'EASY' },
    { text: 'The pressure exerted by a liquid increases with', options: [{ text: 'depth', correct: true }, { text: 'the area of the container' }, { text: 'its colour' }, { text: 'the shape of the container' }], chapter: 'Force and pressure', difficulty: 'MEDIUM' },
    { text: 'Sound cannot travel through', options: [{ text: 'water' }, { text: 'steel' }, { text: 'air' }, { text: 'a vacuum', correct: true }], chapter: 'Sound', difficulty: 'EASY' },
  ],
  FILL: [
    { text: 'Rolling friction is ________ than sliding friction.', answers: ['less', 'smaller'], chapter: 'Friction', difficulty: 'EASY' },
    { text: 'The loudness of sound is measured in ________.', answers: ['decibels', 'decibel', 'dB'], chapter: 'Sound', difficulty: 'EASY' },
  ],
  SHORT: [
    { text: 'What is atmospheric pressure? Why don’t we feel it?', answers: ['The pressure of the air around us. The pressure inside our bodies balances it.'], explanation: 'Definition 1, reason 1', chapter: 'Force and pressure', difficulty: 'MEDIUM' },
    { text: 'Why do we sprinkle fine powder on a carrom board?', answers: ['The powder reduces friction, so the striker and coins slide easily.'], explanation: 'Friction reduced 1, effect 1', chapter: 'Friction', difficulty: 'EASY' },
    { text: 'Explain why sound cannot travel through a vacuum.', answers: ['Sound needs a medium whose particles vibrate; a vacuum has none.'], explanation: 'Needs a medium 1, no particles 1', chapter: 'Sound', difficulty: 'MEDIUM' },
    { text: 'State two factors that affect friction.', answers: ['The nature of the surfaces and how hard they are pressed together.'], explanation: '1 mark each', chapter: 'Friction', difficulty: 'EASY' },
  ],
  LONG: [
    { text: 'Describe an activity to show that liquids exert pressure on the walls of their container.', answers: ['A plastic bottle with holes at different heights, filled with water: the jets come out sideways, and further from the lower holes.'], explanation: 'Set-up 2, observation 2, conclusion 2', chapter: 'Force and pressure', difficulty: 'MEDIUM' },
    { text: 'How is sound produced, and how does it reach our ears? Draw a labelled diagram of the human ear.', answers: ['By vibrating objects; it travels through a medium as a wave to the eardrum, which vibrates and passes the vibrations on to the inner ear.'], explanation: 'Production 1, travel 2, diagram with 3 labels 3', chapter: 'Sound', difficulty: 'HARD' },
    { text: 'What is friction? Give two ways each in which friction can be increased and reduced, with examples.', answers: ['The force that opposes relative motion of surfaces in contact. Increased: treads on tyres, grip on shoes. Reduced: oiling, ball bearings.'], explanation: 'Definition 2, two ways to increase 2, two to reduce 2', chapter: 'Friction', difficulty: 'MEDIUM' },
    { text: 'With an activity, show that a force can change the shape of an object.', answers: ['Pressing a ball of dough flattens it; squeezing a rubber ball changes its shape.'], explanation: 'Activity 3, observation 2, conclusion 1', chapter: 'Force and pressure', difficulty: 'EASY' },
  ],
}

/**
 * One approved question paper with two shuffled sets: Unit Test 1, Class 8, the subject the demo question bank holds
 * Class 8 questions for. Bank questions are auto-picked; the rest are written into the paper.
 */
async function fillQuestionPapers(admin) {
  const c8 = lookup.classes.find((c) => c.code === '8')
  if (!c8) return 'no Class 8'
  const bank = await admin.getRaw('/lms/questions', { classId: c8.id, pageSize: 100 })
  const bySubject = new Map()
  for (const q of bank.body?.data ?? []) bySubject.set(q.subjectId, (bySubject.get(q.subjectId) ?? 0) + 1)
  if (!bySubject.size) return 'no Class 8 questions in the question bank'
  const board = await admin.get('/exams/question-papers/board')
  const ut = board.exams.find((e) => e.name === 'Unit Test 1') ?? board.exams[0]
  if (!ut) return 'no exams'
  const rows = (await admin.get('/exams/question-papers/board', { examId: ut.id })).rows.filter((r) => r.classId === c8.id)
  const row = [...bySubject.entries()].sort((a, b) => b[1] - a[1]).map(([sid]) => rows.find((r) => r.subjectId === sid)).find(Boolean)
  if (!row) return `no Class 8 paper in ${ut.name} for the bank’s subject`
  if (row.paper) return 'already there'
  let paper = await admin.post('/exams/question-papers', { examPaperId: row.examPaperId })
  paper = await admin.put(`/exams/question-papers/${paper.id}/blueprint`, {
    durationMin: paper.durationMin ?? 60, maxMarks: 25,
    instructions: 'All questions are compulsory. Section C: answer any three.\nSection D has an internal choice.\nDraw neat, labelled diagrams wherever needed.',
    sections: [
      { title: 'Section A', instructions: 'Choose the correct option.', type: 'MCQ', count: 5, marks: 1 },
      { title: 'Section B', instructions: 'Fill in the blanks.', type: 'FILL', count: 2, marks: 1 },
      { title: 'Section C', instructions: 'Answer in 30–40 words.', type: 'SHORT', count: 4, marks: 2, attempt: 3 },
      { title: 'Section D', instructions: 'Answer in 80–100 words.', type: 'LONG', count: 2, marks: 6, choice: true },
    ],
    difficulty: { EASY: 40, MEDIUM: 40, HARD: 20 },
  })
  const setA = () => paper.sets[0]
  paper = await admin.post(`/exams/question-papers/${paper.id}/sets/${setA().id}/auto-pick`, {}, { quiet: [409] }) ?? paper
  const queue = Object.fromEntries(Object.entries(PAPER_WRITES).map(([k, v]) => [k, [...v]]))
  for (const s of paper.sections) {
    const have = () => paper.sets[0].sections.find((x) => x.sectionId === s.id).items
    while (have().length < s.count && queue[s.type]?.length) {
      paper = await admin.post(`/exams/question-papers/${paper.id}/sets/${setA().id}/write`, { sectionId: s.id, question: queue[s.type].shift() })
    }
    if (!s.choice) continue
    for (let i = 0; i < have().length; i++) {
      if (have()[i].or || !queue[s.type]?.length) continue
      paper = await admin.post(`/exams/question-papers/${paper.id}/sets/${setA().id}/write`, { sectionId: s.id, question: queue[s.type].shift(), index: i, part: 'or' })
    }
  }
  paper = await admin.post(`/exams/question-papers/${paper.id}/sets`, { count: 2, mode: 'SHUFFLE', shuffleOptions: true })
  await admin.post(`/exams/question-papers/${paper.id}/submit`, {})
  await admin.post(`/exams/question-papers/${paper.id}/approve`, { note: 'Checked against the syllabus — fine to print.' })
  return `${ut.name} · ${row.className} · ${row.subject}: approved, sets A and B`
}

// ───────────────────────────────────────────────────────── homework

const HOMEWORK = {
  math: ['Exercise 3.2, questions 1–8', 'Worksheet: word problems on percentages', 'Revise the formulae of chapter 4 and solve the example questions', 'Exercise 5.1 — all questions'],
  science: ['Draw and label the diagram of the human ear', 'Write the observations of today’s experiment in the record book', 'Answer the back-exercise questions 1–6', 'Collect three examples of friction at home'],
  english: ['Read the next chapter and note five new words', 'Write a letter to your friend about Diwali (150 words)', 'Grammar worksheet: active and passive voice', 'Learn the poem by heart'],
  social: ['Map work: mark the major rivers of India', 'Answer questions 1–5 of the lesson on resources', 'Make a timeline of the events of 1857'],
  language: ['Copy the lesson neatly in your notebook', 'Write ten sentences about your school', 'Learn the meanings of the new words'],
}
const hwFor = (name) => (/math/i.test(name) ? HOMEWORK.math : /science|physics|chem|bio/i.test(name) ? HOMEWORK.science : /english/i.test(name) ? HOMEWORK.english : /social|history|geog/i.test(name) ? HOMEWORK.social : /kannada|hindi|sanskrit/i.test(name) ? HOMEWORK.language : null)

async function fillHomework(admin) {
  const list = await admin.get('/homework', { when: 'PAST' }).catch(() => [])
  if ((list.data ?? list).length) return 'already there'
  const lk = await admin.get('/homework/lookup')
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => Number(c.code) >= 3)
  const days = []
  for (let d = addDaysYmd(today, -14); d < today; d = addDaysYmd(d, 1)) if (isSchoolDay(d)) days.push(d)
  let n = 0
  for (const c of classes) {
    const sectionIds = c.sections.map((x) => x.id)
    const subjects = (lk.sections.find((x) => x.id === sectionIds[0])?.subjects ?? c.subjects).filter((x) => hwFor(x.name))
    for (const [di, d] of days.entries()) {
      const subj = subjects[(di + Number(c.code)) % subjects.length]
      if (!subj) continue
      const tasks = hwFor(subj.name)
      await admin.post('/homework', { sectionIds, subjectId: subj.id, title: tasks[(di + n) % tasks.length], setDate: d, dueDate: addDaysYmd(d, 2), notify: false }, { ok: [200, 201], quiet: [400] })
      n++
    }
  }
  return `${n} homework sets over the last two weeks (Classes 3–12)`
}

// ───────────────────────────────────────────────────────── syllabus and lesson plans

// NCERT-style chapters for Classes 6–10 (the subjects with a timetable): the year plan runs June to February
const CURRICULUM = {
  Mathematics: {
    6: ['Knowing Our Numbers', 'Whole Numbers', 'Playing with Numbers', 'Basic Geometrical Ideas', 'Understanding Elementary Shapes', 'Integers', 'Fractions', 'Decimals', 'Data Handling', 'Mensuration', 'Algebra', 'Ratio and Proportion'],
    7: ['Integers', 'Fractions and Decimals', 'Data Handling', 'Simple Equations', 'Lines and Angles', 'The Triangle and its Properties', 'Comparing Quantities', 'Rational Numbers', 'Perimeter and Area', 'Algebraic Expressions', 'Exponents and Powers', 'Symmetry'],
    8: ['Rational Numbers', 'Linear Equations in One Variable', 'Understanding Quadrilaterals', 'Data Handling', 'Squares and Square Roots', 'Cubes and Cube Roots', 'Comparing Quantities', 'Algebraic Expressions and Identities', 'Mensuration', 'Exponents and Powers', 'Direct and Inverse Proportions', 'Factorisation'],
    9: ['Number Systems', 'Polynomials', 'Coordinate Geometry', 'Linear Equations in Two Variables', 'Introduction to Euclid’s Geometry', 'Lines and Angles', 'Triangles', 'Quadrilaterals', 'Circles', 'Heron’s Formula', 'Surface Areas and Volumes', 'Statistics'],
    10: ['Real Numbers', 'Polynomials', 'Pair of Linear Equations in Two Variables', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry', 'Introduction to Trigonometry', 'Some Applications of Trigonometry', 'Circles', 'Areas Related to Circles', 'Surface Areas and Volumes', 'Statistics', 'Probability'],
  },
  Science: {
    6: ['Food: Where Does It Come From?', 'Components of Food', 'Fibre to Fabric', 'Sorting Materials into Groups', 'Separation of Substances', 'Changes Around Us', 'Getting to Know Plants', 'Body Movements', 'The Living Organisms and Their Surroundings', 'Motion and Measurement of Distances', 'Light, Shadows and Reflections', 'Electricity and Circuits', 'Fun with Magnets', 'Air Around Us'],
    7: ['Nutrition in Plants', 'Nutrition in Animals', 'Heat', 'Acids, Bases and Salts', 'Physical and Chemical Changes', 'Respiration in Organisms', 'Transportation in Animals and Plants', 'Reproduction in Plants', 'Motion and Time', 'Electric Current and its Effects', 'Light', 'Forests: Our Lifeline', 'Wastewater Story'],
    8: ['Crop Production and Management', 'Microorganisms: Friend and Foe', 'Coal and Petroleum', 'Combustion and Flame', 'Conservation of Plants and Animals', 'Reproduction in Animals', 'Reaching the Age of Adolescence', 'Force and Pressure', 'Friction', 'Sound', 'Chemical Effects of Electric Current', 'Some Natural Phenomena', 'Light'],
    9: ['Matter in Our Surroundings', 'Is Matter Around Us Pure?', 'Atoms and Molecules', 'Structure of the Atom', 'The Fundamental Unit of Life', 'Tissues', 'Motion', 'Force and Laws of Motion', 'Gravitation', 'Work and Energy', 'Sound', 'Improvement in Food Resources'],
    10: ['Chemical Reactions and Equations', 'Acids, Bases and Salts', 'Metals and Non-metals', 'Carbon and its Compounds', 'Life Processes', 'Control and Coordination', 'How do Organisms Reproduce?', 'Heredity', 'Light – Reflection and Refraction', 'The Human Eye and the Colourful World', 'Electricity', 'Magnetic Effects of Electric Current', 'Our Environment'],
  },
  'Social Science': {
    6: ['What, Where, How and When?', 'From Hunting-Gathering to Growing Food', 'In the Earliest Cities', 'Kingdoms, Kings and an Early Republic', 'The Earth in the Solar System', 'Globe: Latitudes and Longitudes', 'Motions of the Earth', 'Understanding Diversity', 'What is Government?', 'Panchayati Raj'],
    7: ['Tracing Changes Through a Thousand Years', 'New Kings and Kingdoms', 'The Delhi Sultans', 'Environment', 'Inside Our Earth', 'Our Changing Earth', 'Air', 'Water', 'On Equality', 'Role of the Government in Health'],
    8: ['How, When and Where', 'From Trade to Territory', 'Ruling the Countryside', 'Resources', 'Land, Soil, Water, Natural Vegetation and Wildlife', 'Agriculture', 'Industries', 'The Indian Constitution', 'Understanding Secularism', 'Parliament and the Making of Laws'],
    9: ['The French Revolution', 'Socialism in Europe and the Russian Revolution', 'Nazism and the Rise of Hitler', 'India – Size and Location', 'Physical Features of India', 'Drainage', 'Climate', 'What is Democracy?', 'Constitutional Design', 'Electoral Politics', 'The Story of Village Palampur', 'People as Resource'],
    10: ['The Rise of Nationalism in Europe', 'Nationalism in India', 'The Making of a Global World', 'Resources and Development', 'Water Resources', 'Agriculture', 'Power Sharing', 'Federalism', 'Political Parties', 'Development', 'Sectors of the Indian Economy', 'Money and Credit'],
  },
  English: ['Reading: unseen passages', 'Grammar: tenses', 'Literature: prose — chapter 1', 'Grammar: subject–verb agreement', 'Writing: formal letters', 'Literature: poem — the first poem', 'Grammar: active and passive voice', 'Literature: prose — chapter 2', 'Writing: notice and message', 'Grammar: reported speech', 'Literature: poem — the second poem', 'Writing: story and diary entry'],
  Hindi: ['व्याकरण: संज्ञा', 'गद्य: पाठ 1', 'व्याकरण: सर्वनाम', 'काव्य: कविता 1', 'व्याकरण: विशेषण', 'लेखन: पत्र लेखन', 'गद्य: पाठ 2', 'व्याकरण: क्रिया', 'काव्य: कविता 2', 'लेखन: अनुच्छेद लेखन', 'व्याकरण: मुहावरे', 'लेखन: निबंध'],
  'Computer Science': ['Computer fundamentals', 'Operating system basics', 'Word processing', 'Spreadsheets: formulas', 'Spreadsheets: charts', 'Presentations', 'Internet and email', 'Cyber safety', 'Introduction to programming', 'Programming: loops and decisions'],
}
// Nursery – Class 5: one topic list per subject (the tracker shows every class, not just the ones with a timetable)
const PRIMARY = {
  Mathematics: ['Numbers and counting', 'Place value', 'Addition', 'Subtraction', 'Multiplication tables', 'Shapes and patterns', 'Measurement: length and weight', 'Time and calendar', 'Money', 'Division', 'Fractions: halves and quarters', 'Data: pictographs'],
  English: ['Phonics and sounds', 'Reading: short stories', 'Naming words', 'Action words', 'Describing words', 'Poem recitation', 'Sentence making', 'Picture composition', 'Opposites and rhyming words', 'Reading comprehension', 'Letter writing basics', 'Storytelling'],
  Hindi: ['वर्णमाला: स्वर', 'वर्णमाला: व्यंजन', 'मात्राएँ', 'शब्द बनाना', 'कविता पाठ', 'कहानी पढ़ना', 'संज्ञा', 'वचन', 'लिंग', 'चित्र वर्णन', 'वाक्य रचना', 'अनुच्छेद लेखन'],
  'Environmental Studies': ['My body', 'My family', 'Food we eat', 'Plants around us', 'Animals around us', 'Water', 'Houses and shelter', 'Our helpers', 'Festivals', 'Travel and transport', 'Weather and seasons', 'Keeping clean'],
  'Computer Science': ['Parts of a computer', 'Using the mouse', 'Using the keyboard', 'Paint: drawing shapes', 'Paint: colours', 'Typing words', 'Uses of computers', 'Safe use of computers'],
  'Art & Craft': ['Colouring within lines', 'Crayon shading', 'Paper folding', 'Clay modelling', 'Collage', 'Vegetable printing', 'Greeting cards', 'Festival decorations'],
  Music: ['Rhythm and clapping', 'Rhymes with actions', 'National anthem', 'School prayer', 'Simple notes: sa re ga ma', 'Group songs', 'Percussion instruments', 'Annual day practice'],
  'Physical Education': ['Warm-up and stretching', 'Running and relay', 'Ball games', 'Balance and hopping', 'Yoga basics', 'Team games', 'Sports day practice', 'Fitness check'],
}
const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']

/** The year plan for a class and subject: the chapters spread June–February, three to a unit. */
function yearPlanFor(subject, code) {
  const senior = ['6', '7', '8', '9', '10'].includes(code)
  const list = senior ? ((Array.isArray(CURRICULUM[subject]) ? CURRICULUM[subject] : CURRICULUM[subject]?.[code]) ?? null) : (PRIMARY[subject] ?? null)
  if (!list) return null
  const monthOf = (i) => MONTHS[Math.min(MONTHS.length - 1, Math.floor((i / list.length) * MONTHS.length))]
  const units = []
  for (let i = 0; i < list.length; i += 3) {
    const topics = list.slice(i, i + 3).map((name, k) => ({ name, periods: 4 + ((i + k) % 3), month: monthOf(i + k) }))
    units.push({ name: `Unit ${units.length + 1}`, fromMonth: topics[0].month, toMonth: topics.at(-1).month, topics })
  }
  return units
}

const LESSON_LOOK = {
  Mathematics: { method: 'Recap the last class (5 min), work two examples on the board, pairs solve the textbook exercise, quick exit question.', resources: 'Textbook, board, graph paper / geometry box', homework: 'Exercise questions 1–6' },
  Science: { method: 'Start from an everyday question, show the demonstration, students note observations, discuss and summarise on the board.', resources: 'Textbook, demonstration kit, chart', homework: 'Answer the back exercise and draw the labelled diagram' },
  'Social Science': { method: 'Map / picture to start, read the key section together, group discussion on two questions, timeline or flow chart on the board.', resources: 'Textbook, atlas / wall map, pictures', homework: 'Write three key points and one question' },
  English: { method: 'Pre-reading questions, reading aloud in turns, vocabulary from the text, short written task.', resources: 'Textbook, dictionary, worksheet', homework: 'Write 100 words on the theme' },
  Hindi: { method: 'पाठ का पठन, कठिन शब्दों के अर्थ, प्रश्नोत्तर पर चर्चा, अभ्यास कार्य।', resources: 'पाठ्यपुस्तक, श्यामपट्ट', homework: 'पाठ के प्रश्न 1–4' },
  'Computer Science': { method: 'Show it on the projector, students try it at their desks in pairs, check each pair’s work.', resources: 'Computer lab, projector', homework: 'Practice the steps at home if possible' },
}
const REFLECTIONS = [
  'Most of the class followed; a few needed the example again.', 'Good participation — finished the exercise in class.', 'Took longer than planned; will finish the exercise next period.',
  'Students enjoyed the activity; doubts cleared at the end.', 'Covered the topic; the weaker group needs a short revision.', 'Went well — exit question answered correctly by most.',
]

async function fillPrimarySyllabus(admin) {
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => !['6', '7', '8', '9', '10', '11', '12'].includes(c.code))
  const month = today.slice(0, 7)
  let made = 0
  for (const c of classes) {
    for (const subj of c.subjects) {
      const units = yearPlanFor(subj.name, c.code)
      if (!units) continue
      const current = await admin.get('/homework/syllabus', { classId: c.id, subjectId: subj.id }).catch(() => null)
      if (current?.units?.length) continue
      const saved = await admin.put('/homework/syllabus', { classId: c.id, subjectId: subj.id, units })
      made++
      const done = (saved.units ?? []).flatMap((u) => u.topics.filter((t) => (t.month ?? u.fromMonth) < month).map((t) => t.id))
      // sections move at slightly different speeds, so the tracker shows a spread
      for (const [k, sec] of c.sections.entries()) {
        const ids = done.slice(0, Math.max(0, done.length - k))
        if (ids.length) await admin.post('/homework/syllabus/progress', { sectionId: sec.id, subjectId: subj.id, topicIds: ids, done: true, date: addDaysYmd(today, -12) }, { ok: [200], quiet: [400, 403] })
      }
    }
  }
  return made ? `${made} year plans for Nursery – Class 5` : 'already there'
}

async function fillLessonPlans(admin) {
  const existing = await admin.get('/homework/lesson-plans', { from: addDaysYmd(today, -20), to: addDaysYmd(today, 20) }).catch(() => [])
  if ((existing.data ?? existing).length) return 'already there'
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => ['6', '7', '8', '9', '10'].includes(c.code))
  // 1 · the year plan for each class and subject; chapters planned before this month are ticked as taught
  const topicsOf = new Map() // `${classId}|${subjectId}` → [{ id, name, month }]
  let syllabi = 0
  const month = today.slice(0, 7)
  for (const c of classes) {
    for (const subj of c.subjects) {
      const units = yearPlanFor(subj.name, c.code)
      if (!units) continue
      const saved = await admin.put('/homework/syllabus', { classId: c.id, subjectId: subj.id, units })
      const topics = (saved.units ?? []).flatMap((u) => u.topics.map((t) => ({ id: t.id, name: t.name, month: t.month ?? u.fromMonth, periods: t.periods ?? 4 })))
      topicsOf.set(`${c.id}|${subj.id}`, topics)
      syllabi++
      const done = topics.filter((t) => t.month < month).map((t) => t.id)
      if (done.length) for (const sec of c.sections) await admin.post('/homework/syllabus/progress', { sectionId: sec.id, subjectId: subj.id, topicIds: done, done: true, date: addDaysYmd(today, -15) }, { ok: [200], quiet: [400, 403] })
    }
  }
  // 2 · each teacher plans their own periods: last week taught (with how it went), this week and next planned
  const classOfSection = new Map(classes.flatMap((c) => c.sections.map((sec) => [sec.id, c.id])))
  const days = []
  for (let d = addDaysYmd(today, -7); d <= addDaysYmd(today, 8); d = addDaysYmd(d, 1)) if (isSchoolDay(d)) days.push(d)
  const code = (d) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${d}T12:00:00Z`).getUTCDay()]
  const pointer = new Map() // section|subject → { i, part }
  let plans = 0, taught = 0, skipped = 0
  for (const [name, email] of TEACHER_LOGINS) {
    const teacher = await signIn(email, 'Demo@123').catch(() => null)
    if (!teacher) continue
    const week = await teacher.get('/timetable/mine').catch(() => null)
    if (!week?.cells) continue
    for (const d of days) {
      for (const [period, cell] of Object.entries(week.cells[code(d)] ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const topics = topicsOf.get(`${classOfSection.get(cell.sectionId)}|${cell.subjectId}`)
        if (!topics?.length) continue
        const key = `${cell.sectionId}|${cell.subjectId}`
        if (!pointer.has(key)) pointer.set(key, { i: Math.max(0, topics.findIndex((t) => t.month >= month)), part: 1 })
        const at = pointer.get(key)
        const topic = topics[Math.min(at.i, topics.length - 1)]
        const parts = Math.min(3, Math.max(1, Math.round(topic.periods / 2)))
        const look = LESSON_LOOK[cell.subject] ?? LESSON_LOOK.English
        const plan = await teacher.post('/homework/lesson-plans', {
          sectionId: cell.sectionId, subjectId: cell.subjectId, date: d, period: Number(period),
          title: parts > 1 ? `${topic.name} (${at.part}/${parts})` : topic.name, topicIds: [topic.id],
          objectives: `Students can explain the main ideas of “${topic.name}” and solve / answer the related textbook questions.`,
          method: look.method, resources: look.resources, homeworkNote: at.part === parts ? look.homework : undefined,
        }, { ok: [200, 201], quiet: [400, 403] })
        if (!plan) continue
        plans++
        if (d < today) {
          const skip = (plans % 13) === 0
          await teacher.post(`/homework/lesson-plans/${plan.id}/status`, skip
            ? { status: 'SKIPPED', reflection: 'Period taken for the school assembly rehearsal — moved to the next class.' }
            : { status: 'DONE', reflection: REFLECTIONS[plans % REFLECTIONS.length] }, { ok: [200], quiet: [400, 403] })
          if (skip) { skipped++; continue }
          taught++
        }
        if (at.part >= parts) { at.i++; at.part = 1 } else at.part++
      }
    }
    void name
  }
  return `${syllabi} year plans (Classes 6–10), ${plans} lesson plans by ${TEACHER_LOGINS.length} teachers — ${taught} taught, ${skipped} skipped, the rest planned`
}

// ───────────────────────────────────────────────────────── admissions

async function fillAdmissions(admin) {
  const cycles = await admin.get('/admissions/cycles').catch(() => [])
  if ((cycles.data ?? cycles).length) return 'already there'
  const years = await admin.get('/academics/years')
  let next = (years.data ?? years).find((y) => y.name === '2027-28')
  if (!next) next = await admin.post('/academics/years', { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', terms: [{ name: 'Term 1', startDate: '2027-04-01', endDate: '2027-09-30' }, { name: 'Term 2', startDate: '2027-10-01', endDate: '2028-03-31' }] })
  const cls = (code) => lookup.classes.find((c) => c.code === code).id
  const cycle = await admin.post('/admissions/cycles', { name: 'Admissions 2027-28', academicYearId: next.id, classes: [
    { classId: cls('NUR'), seats: 40, meritBasis: 'FIRST_COME', testRequired: false }, { classId: cls('1'), seats: 6, meritBasis: 'TEST', testRequired: true }, { classId: cls('11'), seats: 20, meritBasis: 'SCORE', testRequired: false },
  ] })
  await admin.post(`/admissions/cycles/${cycle.id}/status`, { status: 'OPEN' })
  const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'SOCIAL', 'REFERRAL', 'NEWSPAPER', 'EVENT']
  const kids = ['Aarohi', 'Vedant', 'Mira', 'Advik', 'Anvi', 'Kiaan', 'Siya', 'Rehan', 'Zoya', 'Arnav', 'Tanvi', 'Neel', 'Ahana', 'Dev', 'Ira', 'Vivaan', 'Ria', 'Om']
  let enq = 0
  for (const [i, child] of kids.entries()) {
    const code = i % 3 === 0 ? 'NUR' : i % 3 === 1 ? '1' : '11'
    const last = pick(LAST, i * 5 + 3)
    const e = await admin.post('/admissions/enquiries', { childName: `${child} ${last}`, parentName: `${pick(FATHERS, i + 4)} ${last}`, mobile: `97400${String(51000 + i * 7).padStart(5, '0')}`, classId: cls(code), source: pick(SOURCES, i) })
    enq++
    if (i % 4 === 1) await admin.post(`/admissions/enquiries/${e.id}/follow-ups`, { type: 'CALL', note: 'Explained the fee structure; will visit on Saturday', stage: 'VISIT' })
    if (i % 4 === 2) await admin.post(`/admissions/enquiries/${e.id}/follow-ups`, { type: 'VISIT', note: 'Visited with the child, saw the campus', stage: 'VISITED' })
    if (i === 17) await admin.patch(`/admissions/enquiries/${e.id}`, { stage: 'LOST', lostReason: 'Chose a school nearer home' })
  }
  // applications: Nursery (first come), Class 1 (entrance test), Class 11 (by Class 10 score)
  const apps = []
  for (const [i, child] of kids.slice(0, 14).entries()) {
    const code = i % 3 === 0 ? 'NUR' : i % 3 === 1 ? '1' : '11'
    const last = pick(LAST, i * 5 + 3)
    const age = { NUR: 3, 1: 6, 11: 15 }[code]
    const a = await admin.post('/admissions/applications', { cycleId: cycle.id, classId: cls(code), child: { firstName: child, lastName: last, dob: `${2027 - age - 1}-${String(1 + (i % 12)).padStart(2, '0')}-12`, gender: i % 2 ? 'MALE' : 'FEMALE' }, parent: { name: `${pick(FATHERS, i + 4)} ${last}`, relation: 'FATHER', mobile: `97400${String(51000 + i * 7).padStart(5, '0')}` } }, { ok: [201], quiet: [409] })
    if (a) apps.push({ ...a, code, i })
  }
  for (const a of apps.filter((x) => x.code === '11')) await admin.patch(`/admissions/applications/${a.id}`, { score: 68 + (a.i * 7) % 30 })
  const test = await admin.post('/admissions/tests', { cycleId: cycle.id, name: 'Class 1 entrance interaction', classIds: [cls('1')], date: addDaysYmd(today, -6), time: '10:00', venue: 'Primary block, room 3', maxMarks: 50 })
  await admin.post(`/admissions/tests/${test.id}/assign`, {})
  const sheet = await admin.get(`/admissions/tests/${test.id}/marks`)
  await admin.put(`/admissions/tests/${test.id}/marks`, { entries: sheet.rows.map((r, i) => ({ applicationId: r.id, marks: 28 + ((i * 9) % 21) })) })
  await admin.post(`/admissions/merit/${cycle.id}/${cls('1')}/publish`, {})
  const allot = await admin.post(`/admissions/merit/${cycle.id}/${cls('1')}/allot`, {})
  const nur = apps.filter((x) => x.code === 'NUR')
  if (nur[1]) await admin.post(`/admissions/applications/${nur[1].id}/status`, { status: 'UNDER_REVIEW', note: 'Documents being checked' })
  if (nur[2]) await admin.post(`/admissions/applications/${nur[2].id}/status`, { status: 'SHORTLISTED', note: 'Parents met the coordinator' })
  return `cycle 2027-28 open, ${enq} enquiries, ${apps.length} applications, Class 1 test marked (${allot.offered ?? 0} offered, ${allot.waitlisted ?? 0} waitlisted)`
}

// ───────────────────────────────────────────────────────── notices

async function fillNotices(admin) {
  const list = await admin.get('/communication/notices').catch(() => [])
  if ((list.data ?? list).length) return 'already there'
  const cls = (code) => lookup.classes.find((c) => c.code === code)?.id
  const notices = [
    { title: 'Half-yearly report cards', body: 'Report cards for the half-yearly examination are in the app under Results. Printed copies will be handed over at the parent–teacher meeting on 21 November.', category: 'Exam', audience: { kind: 'ALL' }, pinned: true },
    { title: 'Children’s Day — colour dress', body: 'Students may come in colour dress on Saturday 14 November. Classes end at 12:30 pm; buses leave at 12:45 pm.', category: 'Event', audience: { kind: 'ALL' } },
    { title: 'Term 2 fees due', body: 'Term 2 fees were due on 15 October. Please clear the dues by 30 November to avoid a late fee. Pay at the counter or online in the app.', category: 'Fees', audience: { kind: 'ALL' } },
    { title: 'Deepavali holidays', body: 'The school stays closed on Tuesday 10 November for Balipadyami. Classes resume on Wednesday 11 November.', category: 'Holiday', audience: { kind: 'ALL' } },
    { title: 'Board exam registration — Class 10', body: 'Check the spelling of your child’s name and date of birth on the registration list sent home, sign it and return it by 20 November.', category: 'Circular', audience: { kind: 'CLASSES', classIds: [cls('10')].filter(Boolean) } },
    { title: 'Bus route 2 timing change', body: 'From Monday, Route 2 picks up at HSR Sector 2 at 6:55 am (5 minutes earlier) because of road work at Agara.', category: 'Transport', audience: { kind: 'ALL' } },
  ]
  for (const n of notices) {
    const made = await admin.post('/communication/notices', n)
    await admin.post(`/communication/notices/${made.id}/publish`, { channels: [] })
  }
  return `${notices.length} notices published`
}

// ───────────────────────────────────────────────────────── run

async function main() {
  const dbName = String(config.mongoUrl).split('?')[0].split('/').pop() || ''
  if (config.isProd || /prod/i.test(dbName)) throw new Error(`Refusing to fill "${dbName}": this looks like production.`)
  await connectDb(config.mongoUrl)
  tenant = await Tenant.findOne({ slug: SLUG }).lean()
  if (!tenant) throw new Error('Green Valley Public School isn’t in this database. Run `npm run seed` first.')
  app = createApp()
  today = (await runAsTenant(tenant._id, () => institutionNow())).date
  const admin = await signIn(ADMIN.email, ADMIN.password)
  lookup = await admin.get('/academics/lookup')
  console.log(`Filling ${tenant.name} (today ${today}, ${lookup.sections.length} sections)`)
  await admin.patch('/core/settings/modules/portal', { enabled: true }).catch(() => {})
  await step('Students', () => fillStudents(admin))
  await step('Transport', () => fillTransport(admin))
  await step('Library', () => fillLibrary(admin))
  await step('Library returns and fines', () => libraryReturns(admin))
  await step('Events, meetings, gallery', () => fillEvents(admin))
  await step('Staff & HR', () => fillStaff(admin))
  await step('Staff attendance and leave', () => fillStaffAttendance(admin))
  await step('Leave waiting for approval', () => pendingLeave())
  await step('Payroll', () => fillPayroll(admin))
  await step('Expenses', () => fillExpenses(admin))
  await step('Courses, question bank, online tests', () => fillLms(admin))
  await step('Teachers and subject allocation', () => fillTeachers(admin))
  await step('Timetable', () => fillTimetable(admin))
  await step('Rooms', () => fillRooms(admin))
  await step('Student attendance', () => fillAttendance(admin))
  await step('Fees', () => fillFees(admin))
  await step('Exams and results', () => fillExams(admin))
  await step('Question papers', () => fillQuestionPapers(admin))
  await step('Homework', () => fillHomework(admin))
  await step('Syllabus and lesson plans', () => fillLessonPlans(admin))
  await step('Syllabus for the junior classes', () => fillPrimarySyllabus(admin))
  await step('Admissions', () => fillAdmissions(admin))
  await step('Notices', () => fillNotices(admin))
  await mongoose.disconnect()
  console.log('Done.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(err)
    await mongoose.disconnect()
    process.exit(1)
  })
}
