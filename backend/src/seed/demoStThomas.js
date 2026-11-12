// Fill the St. Thomas School demo institution (Lucknow; a CBSE campus and a UP Board campus) with realistic data in
// every module — through the app's own API, signed in as its admin or staff, so every record passes the same checks a
// school's own would.
//   npm run seed:demo      (after `npm run seed`; the dev database must be running)
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
import { lessonFor, subjectKind } from './demoContent.js'

const SLUG = 'st-thomas-school'
const ADMIN = { email: 'admin@stthomas.test', password: 'Admin@123' }
const ORIGIN = 'http://localhost:5190'

let app
let tenant
let today
const log = (...a) => console.log(' ', ...a)

/** A signed-in agent; `call` throws with the server's message unless the status is one of `ok`. */
// Sign-ins are kept for the whole run: the login limit (20 per 15 minutes from one address) would stop a second round.
const signedIn = new Map()
async function signIn(email, password) {
  if (!signedIn.has(email)) signedIn.set(email, await freshSignIn(email, password))
  return signedIn.get(email)
}

async function freshSignIn(email, password) {
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

// DEMO_ONLY=hostel,canteen runs only the steps whose names contain one of those words (for working on a few steps).
// --fresh-content (npm run seed:demo:content): clears every syllabus and all topic content first, then runs only the
// syllabus, teaching-material and subject-hub steps, so every class and subject is filled again from scratch.
const FRESH_CONTENT = process.argv.includes('--fresh-content')
const ONLY = process.env.DEMO_ONLY?.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  ?? (FRESH_CONTENT ? ['syllabus', 'teaching', 'subject hub'] : undefined)

async function step(name, fn) {
  if (ONLY?.length && !ONLY.some((w) => name.toLowerCase().includes(w))) return
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
const FIRST_M = ['Aarav', 'Ayush', 'Aditya', 'Anuj', 'Harsh', 'Shivam', 'Utkarsh', 'Divyansh', 'Prakhar', 'Kartik', 'Abhay', 'Saurabh', 'Vaibhav', 'Ansh', 'Shaurya', 'Yash', 'Rudra', 'Priyansh', 'Aryan', 'Devansh']
const FIRST_F = ['Ananya', 'Shreya', 'Khushi', 'Anushka', 'Riya', 'Prachi', 'Vaishnavi', 'Aditi', 'Sakshi', 'Muskan', 'Nandini', 'Ishita', 'Tanya', 'Kritika', 'Aarohi', 'Pari', 'Mahi', 'Garima', 'Saumya', 'Shivangi']
const LAST = ['Srivastava', 'Mishra', 'Tripathi', 'Pandey', 'Shukla', 'Verma', 'Yadav', 'Singh', 'Gupta', 'Agarwal', 'Dubey', 'Tiwari', 'Chaurasia', 'Maurya', 'Rastogi', 'Saxena', 'Kushwaha', 'Bajpai', 'Awasthi', 'Nigam']
const FATHERS = ['Rakesh', 'Sanjay', 'Anil', 'Vinod', 'Pramod', 'Manoj', 'Ashok', 'Rajesh', 'Alok', 'Pankaj', 'Dinesh', 'Sunil']
const MOTHERS = ['Sunita', 'Pooja', 'Neelam', 'Rekha', 'Anita', 'Kiran', 'Seema', 'Mamta', 'Archana', 'Shalini', 'Renu', 'Vandana']
const AREAS = [['Vikas Nagar', '226022'], ['Aliganj', '226024'], ['Indira Nagar', '226016'], ['Gomti Nagar', '226010'], ['Jankipuram', '226021'], ['Mahanagar', '226006'], ['Kapoorthala', '226024'], ['Sitapur Road', '226020']]
const STREETS = ['Sector 4', 'Sector 9', 'Sector C', 'Lane 3', 'Ram Nagar', 'Kursi Road', 'Mall Road colony', 'Shanti Vihar']

let lookup // academics lookup: classes, sections
let students = [] // { id, name, gender, sectionId, classId }

// class codes: C… for CBSE, U… for UP Board; CN / CLKG / CUKG / C1 … C8, UN … U12
const gradeOf = (code) => { const g = String(code ?? '').slice(1); return g === 'N' ? -2 : g === 'LKG' ? -1 : g === 'UKG' ? 0 : Number(g) }
const boardOf = (code) => (String(code ?? '')[0] === 'C' ? 'CBSE' : 'UP')
const classOf = (id) => lookup.classes.find((c) => c.id === id)
const classByCode = (code) => lookup.classes.find((c) => c.code === code)
const secOf = (code) => lookup.sections.find((s) => s.classId === classByCode(code)?.id)?.id
const codesFor = (board, from, to) => lookup.classes.filter((c) => boardOf(c.code) === board && gradeOf(c.code) >= from && gradeOf(c.code) <= to).map((c) => c.code)
const gradeOfStudent = (s) => gradeOf(classOf(s.classId)?.code)

async function loadStudents(admin) {
  const out = []
  for (let page = 1; page < 20; page++) {
    const r = await admin.getRaw('/students', { page, pageSize: 100, status: 'ACTIVE' })
    const rows = r.body?.data ?? []
    out.push(...rows)
    if (rows.length < 100) break
  }
  students = out.map((s) => ({ id: s.id, name: s.name ?? [s.firstName, s.lastName].filter(Boolean).join(' '), gender: s.gender, sectionId: s.sectionId, classId: s.classId, admissionNo: s.admissionNo }))
  return students
}
const studentsOf = (sectionId) => students.filter((s) => s.sectionId === sectionId)

// ───────────────────────────────────────────────────────── letterhead

async function fillLetterhead(admin) {
  await admin.put('/core/print/letterhead', {
    align: 'CENTER', showLogo: true, showContacts: true, ids: ['affiliationNo', 'schoolCode', 'udiseCode'],
    tagline: 'Lux et Veritas — Light and Truth', footerText: 'Run by St. Thomas Educational Society (Regd.), Lucknow',
  })
  return 'classic centred letterhead'
}

// ───────────────────────────────────────────────────────── students

/** Every class gets 5–10 students (one section a class), the right age for the class; older UP students carry APAAR and PEN. */
async function fillStudents(admin) {
  await loadStudents(admin)
  if (students.length) return 'already there' // (a class may be one short after the TC step: that student left)
  let added = 0
  let n = students.length
  for (const sec of lookup.sections) {
    const cls = classOf(sec.classId)
    const grade = gradeOf(cls?.code)
    const want = 5 + (hash(cls?.code) % 6)
    const have = studentsOf(sec.id).length
    const age = grade + 5
    for (let i = have; i < want; i++, n++) {
      const girl = n % 2 === 1
      const firstName = girl ? pick(FIRST_F, n * 3) : pick(FIRST_M, n * 3)
      const lastName = pick(LAST, n * 7)
      const [area, pincode] = pick(AREAS, n)
      const ids = boardOf(cls.code) === 'UP' && grade >= 9 && i % 2 === 0
        ? { apaarId: String(310000000000 + n * 7919).slice(0, 12), pen: `2${String(1100000000 + n * 104729).slice(0, 10)}` } : {}
      await admin.post('/students', {
        firstName, lastName, gender: girl ? 'FEMALE' : 'MALE', dob: `${2026 - age - 1}-${String(4 + (n % 9)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`,
        sectionId: sec.id, rollNo: String(i + 1), admissionDate: '2026-04-01', category: pick(['GENERAL', 'OBC', 'GENERAL', 'SC', 'OBC', 'GENERAL'], n), nationality: 'Indian', religion: 'Hindu',
        bloodGroup: pick(['B+', 'O+', 'A+', 'AB+', 'O-'], n), ...ids,
        address: { line: `${10 + (n % 90)}/${1 + (n % 7)}, ${pick(STREETS, n)}, ${area}`, city: 'Lucknow', state: 'Uttar Pradesh', pincode },
        guardians: [
          { name: `${pick(FATHERS, n)} ${lastName}`, relation: 'FATHER', mobile: `94${String(15000000 + n * 3739).slice(0, 8)}`, occupation: pick(['Government service', 'Business', 'Teacher', 'Doctor', 'Bank officer', 'Shopkeeper', 'Engineer'], n), isPrimary: n % 3 !== 0 },
          { name: `${pick(MOTHERS, n)} ${lastName}`, relation: 'MOTHER', mobile: `88${String(40000000 + n * 4111).slice(0, 8)}`, email: `${pick(MOTHERS, n).toLowerCase()}.${lastName.toLowerCase()}${n}@example.com`, occupation: pick(['Homemaker', 'Teacher', 'Homemaker', 'Nurse'], n), isPrimary: n % 3 === 0 },
        ],
      })
      added++
    }
  }
  await loadStudents(admin)
  return `${added} admitted, ${students.length} in all across ${lookup.sections.length} classes`
}

// ───────────────────────────────────────────────────────── transport

const SCHOOL_STOP = ['School (Kursi Road)', 26.8995, 80.9618]
const ROUTES = [
  { name: 'Route 1 — Aliganj & Jankipuram', code: 'R1', reg: 'UP32 KN 4521', driver: ['Ramesh Yadav', '9415223301'], attendant: ['Kamla Devi', '9415223302'], device: '358240051111111',
    stops: [['Jankipuram Sector H', 26.9268, 80.9408, '07:00', '14:50'], ['Kapoorthala crossing', 26.8834, 80.9441, '07:12', '14:38'], ['Aliganj Sector K', 26.8946, 80.9372, '07:20', '14:30'], ['Puraniya chauraha', 26.8862, 80.9302, '07:28', '14:22'], [...SCHOOL_STOP, '07:45', '14:05']] },
  { name: 'Route 2 — Indira Nagar & Gomti Nagar', code: 'R2', reg: 'UP32 HT 7788', driver: ['Sabir Ali', '9415223303'], attendant: ['Ram Kali', '9415223304'], device: '358240052222222',
    stops: [['Patrakarpuram, Gomti Nagar', 26.8530, 80.9925, '06:55', '14:55'], ['Munshipulia', 26.8869, 81.0046, '07:08', '14:42'], ['Indira Nagar Sector 14', 26.8796, 80.9972, '07:15', '14:35'], ['Mahanagar', 26.8723, 80.9531, '07:28', '14:22'], [...SCHOOL_STOP, '07:45', '14:05']] },
]

async function fillTransport(admin) {
  if ((await admin.get('/transport/vehicles')).length) return 'already there'
  const fee = [900000, 800000, 750000, 650000, null]
  let riders = 0
  for (const [ri, r] of ROUTES.entries()) {
    const v = await admin.post('/transport/vehicles', {
      regNo: r.reg.replace(/\s/g, ''), type: 'BUS', capacity: 40, make: 'Tata Starbus 40', gpsDeviceId: r.device, status: 'ACTIVE',
      docs: [
        { kind: 'RC', number: `RC${r.reg.replace(/\s/g, '')}`, expiry: '2034-03-31' }, { kind: 'INSURANCE', number: `POL-${ri + 1}-55231`, expiry: addDaysYmd(today, ri ? 200 : 18) },
        { kind: 'FITNESS', number: `FC-${ri + 1}-2026`, expiry: addDaysYmd(today, 160) }, { kind: 'PERMIT', number: `UP32-EIB-${ri + 1}11`, expiry: '2027-06-30' },
        { kind: 'PUC', number: `PUC${ri + 1}0921`, expiry: addDaysYmd(today, ri ? 40 : -6) }, { kind: 'SPEED_GOVERNOR', number: `SG-${ri + 1}55`, expiry: '2027-02-28' },
      ],
      driver: { name: r.driver[0], mobile: r.driver[1], licenceNo: `UP32 2011000${ri}4521`, licenceExpiry: '2031-08-15' },
      attendant: { name: r.attendant[0], mobile: r.attendant[1] },
    })
    const route = await admin.post('/transport/routes', {
      name: r.name, code: r.code, vehicleId: v.id,
      stops: r.stops.map(([name, lat, lng, pickupTime, dropTime], i) => ({ name, lat, lng, pickupTime, dropTime, fee: fee[i] ?? undefined })),
    })
    // students of both campuses on this route, at the first four stops
    const slice = students.filter((_, i) => i % 5 === ri).slice(0, 18)
    for (const [i, s] of slice.entries()) {
      await admin.post('/transport/assignments', { studentId: s.id, routeId: route.id, stopId: route.stops[i % 4].id, mode: i % 9 === 0 ? 'PICKUP' : 'BOTH', from: '2026-04-01' })
      riders++
    }
  }
  return `2 buses, 2 routes, ${riders} students`
}

// ───────────────────────────────────────────────────────── library

const BOOKS = [
  ['Godan', 'Munshi Premchand', '9788171828012', 'Rajkamal Prakashan', 2018, 'Hindi literature', '891.43 PRE', 3, 25000, 'Hindi'],
  ['Mansarovar (Part 1)', 'Munshi Premchand', '9788171826469', 'Rajkamal Prakashan', 2016, 'Hindi literature', '891.43 PRE', 3, 19900, 'Hindi'],
  ['Rashmirathi', 'Ramdhari Singh Dinkar', '9788185341059', 'Lokbharti Prakashan', 2015, 'Hindi literature', '891.43 DIN', 2, 15000, 'Hindi'],
  ['Madhushala', 'Harivansh Rai Bachchan', '9788121601801', 'Hind Pocket Books', 2012, 'Hindi literature', '891.43 BAC', 2, 12500, 'Hindi'],
  ['Wings of Fire', 'A. P. J. Abdul Kalam; Arun Tiwari', '9788173711466', 'Universities Press', 1999, 'Biography', '920 KAL', 4, 19900, 'English'],
  ['Malgudi Days', 'R. K. Narayan', '9780143039655', 'Penguin', 2006, 'Fiction', '823 NAR', 3, 29900, 'English'],
  ['Panchatantra', 'Vishnu Sharma', '9788171670823', 'Rupa', 2002, 'Folk tales', '398 VIS', 3, 17500, 'English'],
  ['Ruskin Bond’s Children’s Omnibus', 'Ruskin Bond', '9788129104465', 'Rupa', 2004, 'Fiction', '823 BON', 3, 39500, 'English'],
  ['The Jungle Book', 'Rudyard Kipling', '9780141325293', 'Puffin', 2015, 'Fiction', '823 KIP', 2, 25000, 'English'],
  ['The Story of My Experiments with Truth', 'M. K. Gandhi', '9788172345662', 'Navajivan', 2010, 'Biography', '920 GAN', 2, 15000, 'English'],
  ['Oxford Student Atlas for India', 'Oxford', '9780199488698', 'Oxford University Press', 2019, 'Reference', '912 OXF', 3, 39500, 'English'],
  ['Concise Oxford English Dictionary', 'Oxford', '9780199601080', 'Oxford University Press', 2011, 'Reference', '423 OXF', 2, 125000, 'English'],
  ['NCERT Mathematics Class 8', 'NCERT', '9788174505088', 'NCERT', 2023, 'Textbook', '510 NCE', 5, 6500, 'English'],
  ['NCERT Vigyan Kaksha 10 (Hindi medium)', 'NCERT', '9788174505569', 'NCERT', 2023, 'Textbook', '500 NCE', 5, 7000, 'Hindi'],
  ['Concepts of Physics (Vol. 1)', 'H. C. Verma', '9788177091878', 'Bharati Bhawan', 2019, 'Textbook', '530 VER', 3, 49500, 'English'],
]

async function fillLibrary(admin) {
  if ((await admin.getRaw('/library/titles', { pageSize: 1 })).body?.total) return 'already there'
  let copies = 0
  for (const [title, authors, isbn, publisher, year, category, callNo, count, price, language] of BOOKS) {
    const type = category === 'Reference' ? 'REFERENCE' : category === 'Textbook' ? 'TEXTBOOK' : 'BOOK'
    const r = await admin.post('/library/titles', { title, authors: authors.split(';').map((x) => x.trim()), isbn, publisher, year, category, callNo, language, type, copies: { count, price, shelf: `${callNo.slice(0, 1)}-${(copies % 6) + 1}` } }, { ok: [201], quiet: [400] })
    copies += r?.added ?? 0
  }
  for (const [title, url, desc] of [
    ['Storyweaver: free children’s books', 'https://storyweaver.org.in/', 'Thousands of free illustrated stories in English, Hindi and more.'],
    ['NCERT e-textbooks', 'https://ncert.nic.in/textbook.php', 'All NCERT textbooks (Hindi and English medium), chapter by chapter.'],
    ['National Digital Library of India', 'https://ndl.iitkgp.ac.in/', 'Books, articles and lectures for every class.'],
  ]) await admin.post('/library/titles', { title, type: 'EBOOK', ebookUrl: url, description: desc, forFamilies: true, category: 'E-library' })
  const titles = (await admin.get('/library/titles', { pageSize: 50 }))
  const lendable = []
  for (const t of (titles.data ?? titles).filter((x) => x.type === 'BOOK')) {
    const d = await admin.get(`/library/titles/${t.id}`)
    lendable.push(...d.copyList.filter((c) => c.status === 'AVAILABLE').map((c) => c.accessionNo))
  }
  const borrowers = students.filter((s) => gradeOfStudent(s) >= 4).filter((_, i) => i % 3 === 0).slice(0, 24)
  let issued = 0
  for (const [i, s] of borrowers.entries()) {
    const code = lendable[i]
    if (!code) break
    await admin.post('/library/issue', { kind: 'STUDENT', id: s.id, codes: [code] })
    issued++
  }
  // back-date the loans so the desk has overdue books and late returns (as a librarian's history would be)
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
  const cls = (code) => classByCode(code)?.id
  const plan = [
    { title: 'Children’s Day celebration', kind: 'CELEBRATION', startDate: '2026-11-14', startTime: '09:00', endTime: '12:30', venue: 'School grounds', description: 'Teachers put on a show for the students. Students come in colour dress.', remind: true },
    { title: 'Science exhibition', kind: 'EVENT', startDate: '2026-11-21', startTime: '10:00', endTime: '14:00', venue: 'Block B, science labs', description: 'Classes 6–12 of both boards show their projects. Parents are welcome from 11 am.', audience: 'CLASSES', classIds: [...codesFor('CBSE', 6, 8), ...codesFor('UP', 6, 12)].map(cls).filter(Boolean), reply: { kind: 'RSVP', question: 'Will you visit the exhibition?', by: '2026-11-19' } },
    { title: 'Trip to the State Museum and Ambedkar Park', kind: 'TRIP', startDate: '2026-11-27', startTime: '08:30', endTime: '14:30', venue: 'State Museum, Banarasi Bagh, Lucknow', description: 'By school bus. Packed lunch and water bottle. Fee ₹250, collected by the class teacher.', audience: 'SECTIONS', sectionIds: [secOf('C8'), secOf('U8')].filter(Boolean), reply: { kind: 'CONSENT', question: 'May your child join the museum trip on 27 November?', by: '2026-11-23' }, remind: true },
    { title: 'Annual sports meet', kind: 'SPORTS', startDate: '2026-12-05', endDate: '2026-12-06', venue: 'School grounds', description: 'Track events on Saturday, finals and prize-giving on Sunday. Both campuses take part.' },
    { title: 'Annual Day — “Utsav 2026”', kind: 'CULTURAL', startDate: '2026-12-19', startTime: '16:30', endTime: '19:30', venue: 'School auditorium', description: 'Dance, music and drama by every class. Two passes a family.', reply: { kind: 'RSVP', question: 'Will you come to the Annual Day?', by: '2026-12-15' }, remind: true },
    { title: 'Christmas celebration', kind: 'CELEBRATION', startDate: '2026-12-24', startTime: '09:00', endTime: '12:00', venue: 'Assembly hall', description: 'Carol singing, the nativity play and cake for every class.' },
    { title: 'Last date: Term 2 fee', kind: 'DEADLINE', startDate: '2026-11-30', description: 'Pay at the counter or online in the app. A late fee applies after this date.' },
    { title: 'Staff development workshop', kind: 'MEETING', startDate: '2026-11-28', startTime: '13:30', endTime: '16:30', venue: 'Conference room', audience: 'STAFF', description: 'Competency-based questions (CBSE) and the new UP Board blueprint.' },
    { title: 'Independence Day assembly', kind: 'CELEBRATION', startDate: '2026-08-15', startTime: '08:00', endTime: '10:00', venue: 'School grounds' },
    { title: 'Deepotsav celebration', kind: 'CELEBRATION', startDate: '2026-11-06', startTime: '10:00', endTime: '12:00', venue: 'Assembly hall', description: 'Rangoli competition and a diya-making workshop.' },
  ]
  for (const e of plan) {
    const made = await admin.post('/events/events', { audience: 'EVERYONE', classIds: [], sectionIds: [], ...e })
    if (e.audience !== 'STAFF') await admin.post(`/events/events/${made.id}/publish`, { notify: false })
  }
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
  let bookings = 0
  if (hosts.length) {
    const ptm = await admin.post('/events/ptm', { title: 'Half-yearly parent–teacher meeting', date: '2026-11-21', startTime: '09:30', endTime: '12:30', slotMinutes: 10, gapMinutes: 0, mode: 'IN_PERSON', hosts, instructions: 'Please bring the half-yearly report card. Parking is at the Kursi Road gate.' })
    await admin.post(`/events/ptm/${ptm.id}/open`, { notify: false })
    const full = await admin.get(`/events/ptm/${ptm.id}`)
    for (const h of full.hosts) {
      const kids = students.filter((s) => h.sectionIds.includes(s.sectionId)).slice(0, 5)
      for (const [i, s] of kids.entries()) if (await admin.post(`/events/ptm/${ptm.id}/bookings`, { hostId: h.id, time: full.slots[i * 2], studentId: s.id }, { ok: [201], quiet: [400, 409] })) bookings++
    }
  }
  for (const a of [
    { title: 'Independence Day 2026', date: '2026-08-15', published: true },
    { title: 'Deepotsav 2026', date: '2026-11-06', published: true },
    { title: 'Class 8 science projects', date: '2026-10-10', audience: 'SECTIONS', sectionIds: [secOf('C8'), secOf('U8')].filter(Boolean), published: false },
  ]) await admin.post('/events/albums', { audience: 'EVERYONE', classIds: [], sectionIds: [], branchIds: [], ...a })
  return `${plan.length} events, ${replies} replies, a parent–teacher meeting with ${hosts.length} class teachers and ${bookings} bookings, 3 albums`
}

// ───────────────────────────────────────────────────────── staff & HR

// [name, category, designation, gender, joined, gross a month (paise), subjects, campus, department code, login email]
const MORE_STAFF = [
  ['Neha Tripathi', 'TEACHING', 'TGT Mathematics', 'FEMALE', '2016-07-01', 4600000, ['Mathematics'], 'CBSE', 'MATHS', 'neha@stthomas.test'],
  ['Ritu Srivastava', 'TEACHING', 'TGT English', 'FEMALE', '2018-07-02', 4400000, ['English'], 'CBSE', 'LANG', 'ritu@stthomas.test'],
  ['Kavita Pandey', 'TEACHING', 'TGT Science', 'FEMALE', '2017-07-01', 4500000, ['Science'], 'CBSE', 'SCI', 'kavita@stthomas.test'],
  ['Pooja Verma', 'TEACHING', 'PRT (Primary)', 'FEMALE', '2021-07-01', 3200000, ['English', 'EVS'], 'CBSE', 'PRIM', 'pooja@stthomas.test'],
  ['Anjali Gupta', 'TEACHING', 'Nursery teacher', 'FEMALE', '2022-07-01', 2600000, ['Art & Craft'], 'CBSE', 'PREP', 'anjali@stthomas.test'],
  ['Amit Kumar Shukla', 'TEACHING', 'Lecturer, Physics (UP Board)', 'MALE', '2012-07-01', 6200000, ['Physics', 'Mathematics'], 'UP', 'SCI', 'amit@stthomas.test'],
  ['Seema Dubey', 'TEACHING', 'Lecturer, Chemistry & Biology (UP Board)', 'FEMALE', '2014-07-01', 5800000, ['Chemistry', 'Biology'], 'UP', 'SCI', 'seema@stthomas.test'],
  ['Pradeep Mishra', 'TEACHING', 'Assistant teacher, Hindi & Sanskrit', 'MALE', '2013-07-01', 4800000, ['Hindi', 'Sanskrit'], 'UP', 'LANG', 'pradeep@stthomas.test'],
  ['Mohd. Imran Siddiqui', 'TEACHING', 'Assistant teacher, Social Science', 'MALE', '2019-07-01', 4200000, ['Social Science'], 'UP', 'SOCS', 'imran@stthomas.test'],
  ['Rekha Yadav', 'TEACHING', 'Assistant teacher (Primary)', 'FEMALE', '2020-07-01', 3000000, ['Hindi', 'EVS'], 'UP', 'PRIM', 'rekha@stthomas.test'],
  ['Vikas Chaurasia', 'TEACHING', 'Computer teacher', 'MALE', '2020-07-01', 3400000, ['Computer Science'], 'UP', 'SCI', 'vikas@stthomas.test'],
  ['Deepak Singh', 'TEACHING', 'Physical education teacher', 'MALE', '2015-07-01', 3600000, ['Physical Education'], 'UP', null, 'deepak@stthomas.test'],
  ['Manju Awasthi', 'ADMIN', 'Librarian', 'FEMALE', '2014-08-01', 3000000, [], 'CBSE', 'ADMN', null],
  ['Ramesh Yadav', 'TRANSPORT', 'Bus driver', 'MALE', '2016-05-15', 1800000, [], 'CBSE', 'TRAN', null],
  ['Sabir Ali', 'TRANSPORT', 'Bus driver', 'MALE', '2021-11-01', 1700000, [], 'UP', 'TRAN', null],
  ['Shyam Lal', 'SUPPORT', 'Peon', 'MALE', '2011-04-01', 1300000, [], 'CBSE', 'ADMN', null],
  ['Bhola Prasad', 'SECURITY', 'Security guard', 'MALE', '2019-03-01', 1400000, [], 'UP', 'ADMN', null],
]
const LOGIN_STAFF = { // by name: category, joined, gross a month (paise), gender, campus
  'Rohit Chandra': ['ADMIN', '2010-04-01', 6500000, 'MALE', 'CBSE'],
  'Fr. Thomas Mathew': ['ADMIN', '2008-04-01', 11000000, 'MALE', 'CBSE'],
  'Dr. Rajendra Prasad Tiwari': ['ADMIN', '2011-07-01', 10000000, 'MALE', 'UP'],
  'Sunita Srivastava': ['TEACHING', '2014-07-01', 4800000, 'FEMALE', 'CBSE'],
  'Alok Agarwal': ['ADMIN', '2015-04-01', 4000000, 'MALE', 'CBSE'],
  'Shalini Saxena': ['ADMIN', '2021-06-01', 3000000, 'FEMALE', 'CBSE'],
  'Mohd. Arif Khan': ['ADMIN', '2022-07-01', 2400000, 'MALE', 'CBSE'],
}
const HOLIDAYS = [
  ['2026-08-15', 'Independence Day'], ['2026-08-28', 'Raksha Bandhan'], ['2026-09-04', 'Janmashtami'], ['2026-10-02', 'Gandhi Jayanti'],
  ['2026-10-20', 'Dussehra'], ['2026-11-09', 'Govardhan Puja'], ['2026-11-24', 'Guru Nanak Jayanti'], ['2026-12-25', 'Christmas'],
  ['2027-01-01', 'New Year’s Day'], ['2027-01-14', 'Makar Sankranti'], ['2027-01-26', 'Republic Day'], ['2027-03-22', 'Holi'],
]

let employees = []
const loadEmployees = async (admin) => { employees = (await admin.get('/hrms/employees', { pageSize: 100 })); return employees }
let branches = {} // CBSE | UP → id
const loadBranches = async (admin) => {
  const rows = await admin.get('/core/branches')
  branches = { CBSE: (rows.find((b) => b.code === 'CBSE') ?? rows[0])?.id, UP: rows.find((b) => b.code === 'UPB')?.id }
  return branches
}

async function fillStaff(admin) {
  await admin.patch('/core/settings/modules/hrms', { saturdaysOff: ['2', '4'], lateAfter: '08:10' })
  if ((await admin.getRaw('/hrms/employees', { pageSize: 1 })).body?.meta?.total > 7) return 'already there'
  await loadBranches(admin)
  const depts = new Map((await admin.get('/core/departments')).map((d) => [d.code, d.id]))
  await admin.post('/hrms/employees/from-logins', {})
  await loadEmployees(admin)
  const head = { CBSE: employees.find((e) => /Thomas Mathew/.test(e.name)), UP: employees.find((e) => /Rajendra/.test(e.name)) }
  let n = 0
  for (const e of employees) {
    const [category, joiningDate, gross, gender, campus] = LOGIN_STAFF[e.name] ?? ['ADMIN', '2020-06-01', 4000000, 'FEMALE', 'CBSE']
    const boss = e.id !== head[campus]?.id ? head[campus] ?? head.CBSE : null
    await admin.patch(`/hrms/employees/${e.id}`, { category, joiningDate, gender, branchId: branches[campus], ...(boss && e.id !== boss.id && { reportingManagerId: boss.id }) })
    await admin.put(`/hrms/employees/${e.id}/salary`, { grossMonthly: gross, basicMonthly: Math.round(gross / 2) })
    n++
  }
  for (const [i, [name, category, designation, gender, joiningDate, gross, subjects, campus, dept]] of MORE_STAFF.entries()) {
    const e = await admin.post('/hrms/employees', {
      name, category, employmentType: i === 4 ? 'PROBATION' : 'PERMANENT', designation, gender, joiningDate, subjects, mobile: `94150${String(41000 + i * 113).padStart(5, '0')}`,
      branchId: branches[campus], ...(dept && depts.get(dept) && { departmentId: depts.get(dept) }), ...(head[campus] && { reportingManagerId: head[campus].id }),
    })
    await admin.put(`/hrms/employees/${e.id}/salary`, { grossMonthly: gross, basicMonthly: Math.round(gross / 2), esi: gross <= 2100000 })
    n++
  }
  await loadEmployees(admin)
  for (const [i, e] of employees.entries()) {
    const pan = `${'ABCDEFGHJK'[i % 10]}${'PQRSTUVWXY'[(i * 3) % 10]}${'LMNOP'[i % 5]}P${'KMRSV'[i % 5]}${String(1000 + i * 37).slice(-4)}${'ABCDEFGHJ'[i % 9]}`
    await admin.put(`/hrms/employees/${e.id}/sensitive`, { pan, uan: `1009${String(20000000 + i * 7919).slice(-8)}`, account: `3${String(1000000000 + i * 104729).slice(-10)}`, ifsc: i % 3 ? 'PUNB0123400' : 'SBIN0001234', bankName: i % 3 ? 'Punjab National Bank' : 'State Bank of India' }, { ok: [200], quiet: [400] })
  }
  await admin.post('/hrms/holidays/bulk', { rows: HOLIDAYS.map(([date, name]) => ({ date, name })) }, { ok: [200, 201], quiet: [400, 409] })
  return `${employees.length} staff records on both campuses with salary and bank details, ${HOLIDAYS.length} holidays`
}

/** Staff attendance for every working day from 1 September to yesterday, and a little leave. */
async function fillStaffAttendance(admin) {
  const marked = await runAsTenant(tenant._id, async () => (await import('../models/hrms.js')).StaffAttendance.countDocuments({ date: { $gte: '2026-09-01' } }))
  if (marked > 100) return 'already there'
  await loadEmployees(admin)
  const types = await admin.get('/hrms/leave/types')
  const cl = types.find((x) => x.code === 'CL')
  const sl = types.find((x) => x.code === 'SL')
  const leaves = await admin.getRaw('/hrms/leave', { pageSize: 1 })
  if (!leaves.body?.data?.total) {
    const on = (name) => employees.find((e) => e.name.startsWith(name))
    for (const [who, type, from, to, reason] of [
      ['Ritu', cl, '2026-10-12', '2026-10-13', 'Family function'], ['Mohd. Imran', sl, '2026-10-27', '2026-10-27', 'Fever'],
      ['Rekha', cl, '2026-11-05', '2026-11-06', 'Sister’s wedding in Gorakhpur'], ['Shyam', cl, '2026-10-16', '2026-10-16', 'Personal work'],
    ]) if (on(who)) await admin.post('/hrms/leave', { employeeId: on(who).id, leaveTypeId: type.id, from, to, reason, approveNow: true }, { ok: [201], quiet: [400, 409] })
  }
  let days = 0
  for (let d = '2026-09-01'; d < today; d = addDaysYmd(d, 1)) {
    if (!isSchoolDay(d)) continue
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    const entries = employees.map((e, i) => {
      const k = (i * 31 + Number(d.slice(8)) * 7 + Number(d.slice(5, 7))) % 41
      if (k === 0) return { employeeId: e.id, status: 'ABSENT' }
      if (k === 5) return { employeeId: e.id, status: 'HALF_DAY', inTime: '08:00', outTime: '11:30' }
      const late = k % 13 === 3
      return { employeeId: e.id, status: 'PRESENT', inTime: late ? '08:25' : `07:${String(40 + (k % 18)).padStart(2, '0')}`, outTime: dow === 6 ? '12:45' : `14:${String(20 + (k % 30)).padStart(2, '0')}` }
    })
    await admin.put('/hrms/attendance/day', { date: d, entries }, { ok: [200], quiet: [400, 403, 409] })
    days++
  }
  return `${days} working days marked for ${employees.length} staff, 4 leaves approved`
}

/** The class teacher asks for leave next month; it waits with the principal. */
async function pendingLeave() {
  const t = await signIn('teacher@stthomas.test', 'Demo@123')
  const mine = await t.get('/hrms/me/leave').catch(() => null)
  if (mine && (mine.requests ?? mine).length) return 'already there'
  const types = await t.get('/hrms/me/leave').then((r) => r.balances ?? r.types ?? []).catch(() => [])
  const cl = types.find?.((x) => x.code === 'CL')
  if (!cl) return 'skipped (no leave types on My workspace)'
  await t.post('/hrms/me/leave', { leaveTypeId: cl.leaveTypeId ?? cl.id, from: '2026-12-07', to: '2026-12-08', reason: 'Family function in Varanasi', arrangement: 'Neha Tripathi takes Class 5 maths' })
  return 'Sunita Srivastava’s leave waits with the principal'
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
  const driver = employees.find((e) => e.name === 'Sabir Ali')
  if (driver) await admin.post('/payroll/loans', { employeeId: driver.id, type: 'ADVANCE', amount: 600000, instalment: 200000, startMonth: '2026-11', reason: 'Daughter’s school admission' }, { ok: [201], quiet: [400, 409] })
  // the demo's single admin both prepares and approves, so separation of duties is switched off for the runs, then back on
  await admin.put('/payroll/statutory', { separateDuties: false })
  try {
    for (const [month, paid, ref] of [['2026-09', '2026-10-01', 'PNBN26100100412'], ['2026-10', '2026-11-02', 'PNBN26110200871']]) {
      const run = await admin.post('/payroll/runs', { month })
      await admin.post(`/payroll/runs/${run.id}/calculate`, {})
      await admin.post(`/payroll/runs/${run.id}/approve`, { note: 'Checked against attendance' })
      await admin.post(`/payroll/runs/${run.id}/pay`, { date: paid, mode: 'NEFT', reference: ref })
    }
  } finally {
    await admin.put('/payroll/statutory', { separateDuties: true })
  }
  return 'structures assigned, September and October salaries paid (posted to Accounts), 1 salary advance'
}

// ───────────────────────────────────────────────────────── accounts (expenses)

async function fillExpenses(admin) {
  if ((await admin.get('/finance/expenses').then((r) => r.data ?? r)).length) return 'already there'
  const heads = await admin.get('/finance/expenses/heads')
  const head = (re) => (heads.find((h) => re.test(h.name)) ?? heads[0]).id
  const list = [
    ['2026-10-05', /Electric/i, 'Madhyanchal Vidyut Vitran Nigam Ltd', 'Electricity — September', 3825000, 'PAID', 'BANK_TRANSFER'],
    ['2026-10-07', /Water/i, 'Jal Sansthan, Lucknow', 'Water — July to September', 412000, 'PAID', 'CHEQUE'],
    ['2026-10-10', /Internet|Telephone/i, 'Airtel Business', 'Internet — October', 294000, 'PAID', 'BANK_TRANSFER'],
    ['2026-10-14', /Stationery|Printing/i, 'Universal Booksellers, Hazratganj', 'Exam answer sheets and chart paper', 1576000, 'PAID', 'CHEQUE'],
    ['2026-10-21', /Repair|Maintenance/i, 'Gupta Electricals, Aminabad', 'Classroom fans and tube lights', 2140000, 'PAID', 'CASH'],
    ['2026-10-28', /Fuel|Transport|Vehicle/i, 'Indian Oil, Kursi Road', 'Diesel for school buses — October', 7150000, 'PAID', 'BANK_TRANSFER'],
    ['2026-11-03', /Electric/i, 'Madhyanchal Vidyut Vitran Nigam Ltd', 'Electricity — October', 3590000, 'APPROVED', null],
    ['2026-11-06', /Event|Function|Cultural/i, 'Awadh Tent House', 'Deepotsav decoration and sound', 950000, 'SUBMITTED', null],
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
  const c8 = lookup.classes.find((c) => c.code === 'C8')
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

// FNV-1a over every part, 32-bit all the way
const hash = (...xs) => xs.reduce((h, x) => { for (const c of String(x)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return Math.imul(h ^ 124, 16777619) >>> 0 }, 2166136261) % 1000003
const TEACHER_LOGINS = [['Sunita Srivastava', 'teacher@stthomas.test'], ...MORE_STAFF.filter((x) => x[9]).map((x) => [x[0], x[9]])]
const CLASS_TEACHERS = {
  CN: 'Anjali Gupta', C1: 'Pooja Verma', C3: 'Ritu Srivastava', C5: 'Sunita Srivastava', C6: 'Kavita Pandey', C8: 'Neha Tripathi',
  U1: 'Rekha Yadav', U6: 'Pradeep Mishra', U8: 'Mohd. Imran Siddiqui', U9: 'Vikas Chaurasia', U10: 'Deepak Singh', U11: 'Amit Kumar Shukla', U12: 'Seema Dubey',
}
const POOLS = [ // subject → teachers who take it, periods a week (about 30 a class)
  [/physics/i, ['Amit Kumar Shukla'], 5], [/chemistry|biology/i, ['Seema Dubey'], 5],
  [/math/i, ['Neha Tripathi', 'Sunita Srivastava', 'Amit Kumar Shukla'], 5], [/science/i, ['Kavita Pandey', 'Seema Dubey', 'Amit Kumar Shukla'], 5],
  [/english/i, ['Ritu Srivastava', 'Pooja Verma', 'Anjali Gupta'], 4], [/social/i, ['Mohd. Imran Siddiqui'], 4],
  [/hindi/i, ['Pradeep Mishra', 'Rekha Yadav', 'Pooja Verma'], 4], [/sanskrit/i, ['Pradeep Mishra', 'Rekha Yadav'], 2],
  [/physical/i, ['Deepak Singh'], 2], [/computer/i, ['Vikas Chaurasia'], 2], [/./, ['Anjali Gupta', 'Deepak Singh'], 1],
]

async function fillTeachers(admin) {
  const roles = await admin.get('/core/roles')
  const roleOf = (code) => (roles.data ?? roles).find((r) => r.templateCode === code)?.id
  const users = await admin.get('/core/users', { pageSize: 100 })
  const have = new Set((users.data ?? users).map((u) => u.email))
  if (TEACHER_LOGINS.every(([, email]) => have.has(email))) return 'already there'
  await loadEmployees(admin)
  await loadBranches(admin)
  let made = 0
  for (const [name, email] of TEACHER_LOGINS) {
    if (have.has(email)) continue
    const row = MORE_STAFF.find((x) => x[0] === name)
    const isClassTeacher = Object.values(CLASS_TEACHERS).includes(name)
    const u = await admin.post('/core/users', { name, email, roleIds: [roleOf(isClassTeacher ? 'CLASS_TEACHER' : 'SUBJECT_TEACHER') ?? roleOf('SUBJECT_TEACHER')], password: 'Demo@123', designation: row?.[2], branchId: branches[row?.[7] ?? 'CBSE'] })
    const e = employees.find((x) => x.name === name)
    if (e) await admin.put(`/hrms/employees/${e.id}/login`, { userId: u.user?.id ?? u.id }, { ok: [200], quiet: [400, 409] })
    made++
  }
  const all = (await admin.get('/core/users', { pageSize: 100 }))
  const userByName = new Map((all.data ?? all).map((u) => [u.name, u.id]))
  for (const [code, name] of Object.entries(CLASS_TEACHERS)) {
    const sec = secOf(code)
    if (sec && userByName.get(name)) await admin.patch(`/academics/sections/${sec}`, { classTeacherId: userByName.get(name) })
  }
  // who teaches what in Classes 6–8 (CBSE) and 6–12 (UP Board); the timetable is made from this
  const classes = (await admin.get('/academics/classes')).classes
  const load = new Map()
  let rows = 0
  for (const c of classes.filter((x) => gradeOf(x.code) >= 6)) {
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
  // the junior classes: the class teacher takes the main subjects
  for (const c of classes.filter((x) => gradeOf(x.code) >= 1 && gradeOf(x.code) <= 5)) {
    const teacherId = userByName.get(CLASS_TEACHERS[c.code])
    if (!teacherId) continue
    for (const sec of c.sections) for (const subj of c.subjects.filter((x) => /math|english|hindi|environment/i.test(x.name))) {
      await admin.put('/academics/allocation', { sectionId: sec.id, subjectId: subj.id, teacherId, periodsPerWeek: 6 })
      rows++
    }
  }
  return `${made} teacher logins (password Demo@123), ${Object.keys(CLASS_TEACHERS).length} class teachers, ${rows} subject allocations`
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

/** A home classroom for every class (CBSE in Block A, UP Board in Block B), plus labs and halls. */
async function fillRooms(admin) {
  if ((await admin.get('/timetable/rooms')).length) return 'already there'
  const floorOf = (g) => (g <= 2 ? 0 : g <= 5 ? 1 : g <= 9 ? 2 : 3)
  const used = {}
  let n = 0
  for (const sec of lookup.sections) {
    const cls = classOf(sec.classId)
    const block = boardOf(cls?.code) === 'CBSE' ? 'A' : 'B'
    const floor = floorOf(gradeOf(cls?.code))
    const key = `${block}${floor}`
    used[key] = (used[key] ?? 0) + 1
    const no = floor ? String(floor * 100 + used[key]) : `G${String(used[key]).padStart(2, '0')}`
    await admin.post('/timetable/rooms', { name: `Room ${block}-${no}`, code: `${block}${no}`, kind: 'CLASSROOM', capacity: 40, sectionId: sec.id })
    n++
  }
  const extra = [
    ['Physics lab', 'PHY-LAB', 'LAB', 30], ['Chemistry lab', 'CHE-LAB', 'LAB', 30], ['Biology lab', 'BIO-LAB', 'LAB', 30],
    ['Computer lab', 'COMP-1', 'COMPUTER', 36], ['Assembly hall', 'HALL', 'HALL', 400], ['Library', 'LIB', 'LIBRARY', 60], ['Sports ground', 'GROUND', 'GROUND', 300],
  ]
  for (const [name, code, kind, capacity] of extra) await admin.post('/timetable/rooms', { name, code, kind, capacity })
  return `${n} classrooms (each a class's home room) and ${extra.length} labs, halls and grounds`
}

// ───────────────────────────────────────────────────────── student attendance

const isSchoolDay = (d) => {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
  const satNo = Math.ceil(Number(d.slice(8)) / 7)
  return !(dow === 0 || (dow === 6 && [2, 4].includes(satNo)) || HOLIDAYS.some(([h]) => h === d))
}

/** Six weeks of class registers, up to yesterday. */
async function fillAttendance(admin) {
  const from = addDaysYmd(today, -42)
  let probeDay = from
  while (!isSchoolDay(probeDay)) probeDay = addDaysYmd(probeDay, 1)
  const first = await admin.get('/attendance/sheet', { sectionId: lookup.sections[0].id, date: probeDay }).catch(() => null)
  if (first?.taken) return 'already there'
  let sheets = 0
  for (let d = from; d < today; d = addDaysYmd(d, 1)) {
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
  return `${sheets} class registers (${from} – yesterday)`
}

// ───────────────────────────────────────────────────────── fees

const FEE_PLANS = [ // the UP Board school charges less
  ['CBSE Pre-primary 2026-27', () => codesFor('CBSE', -2, 0), { TUITION: 3600000, ANNUAL: 500000 }],
  ['CBSE Classes 1–5 2026-27', () => codesFor('CBSE', 1, 5), { TUITION: 4200000, ANNUAL: 600000, EXAM: 150000 }],
  ['CBSE Classes 6–8 2026-27', () => codesFor('CBSE', 6, 8), { TUITION: 4800000, ANNUAL: 700000, LAB: 200000, EXAM: 200000 }],
  ['UP Board Pre-primary 2026-27', () => codesFor('UP', -2, 0), { TUITION: 1800000, ANNUAL: 300000 }],
  ['UP Board Classes 1–5 2026-27', () => codesFor('UP', 1, 5), { TUITION: 2160000, ANNUAL: 300000, EXAM: 100000 }],
  ['UP Board Classes 6–8 2026-27', () => codesFor('UP', 6, 8), { TUITION: 2640000, ANNUAL: 400000, EXAM: 100000 }],
  ['UP Board Classes 9–10 2026-27', () => codesFor('UP', 9, 10), { TUITION: 3000000, ANNUAL: 500000, LAB: 200000, EXAM: 150000 }],
  ['UP Board Classes 11–12 2026-27', () => codesFor('UP', 11, 12), { TUITION: 3600000, ANNUAL: 500000, LAB: 300000, EXAM: 150000 }],
]
const BANKS = ['State Bank of India', 'Punjab National Bank', 'Bank of Baroda', 'HDFC Bank', 'Union Bank of India']

async function fillFees(admin) {
  const existing = await admin.get('/fees/structures')
  if ((existing.structures ?? existing.data ?? existing).length) return 'already there'
  const heads = await admin.get('/fees/heads')
  const head = (code) => heads.find((h) => h.code === code).id
  for (const [name, codes, lines] of FEE_PLANS) {
    const total = Object.values(lines).reduce((a, b) => a + b, 0)
    const st = await admin.post('/fees/structures', {
      name, classIds: codes().map((c) => classByCode(c)?.id).filter(Boolean),
      lines: Object.entries(lines).map(([code, amount]) => ({ feeHeadId: head(code), amount })),
      installments: [{ name: 'Term 1', dueDate: '2026-04-15', amount: total / 2 }, { name: 'Term 2', dueDate: '2026-10-15', amount: total / 2 }],
    })
    await admin.post(`/fees/structures/${st.id}/generate`, {})
  }
  // concessions first (they only lower what is unpaid)
  let concessions = 0
  const REASONS = [[25, 'Staff child'], [10, 'Sibling'], [50, 'Financial need'], [10, 'Sibling'], [20, 'Merit scholarship']]
  for (const [i, s] of students.entries()) {
    if (i % 37 !== 5) continue
    const [pct, reason] = pick(REASONS, concessions)
    const c = await admin.post('/fees/concessions', { studentId: s.id, kind: 'PCT', value: pct, feeHeadIds: [head('TUITION')], reason }, { ok: [201], quiet: [400, 409] })
    if (c) { await admin.post(`/fees/concessions/${c.id}/decide`, { approve: true }); concessions++ }
  }
  // payments: most families paid Term 1 in April and Term 2 in October; some are late or part-paid
  const MODES = [['UPI', 'UPI'], ['CASH', null], ['CHEQUE', null], ['CASH', null], ['UPI', 'UPI'], ['BANK_TRANSFER', 'NEFT']]
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
      const day = j === 0 ? `2026-04-${String(2 + (i % 24)).padStart(2, '0')}` : `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`
      const extra = mode === 'CHEQUE' ? { reference: String(400000 + hash(s.id, j) % 99999).padStart(6, '0'), chequeBank: pick(BANKS, i), chequeDate: day } : ref ? { reference: `${ref}${String(hash(s.id, j)).padStart(7, '0')}` } : {}
      const r = await admin.post('/fees/collect', { studentId: s.id, amount, mode, ...extra, waiveLateFee: true }, { ok: [201], quiet: [400, 409] })
      if (!r) continue
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
  return `${FEE_PLANS.length} fee structures (CBSE and UP Board) with invoices, ${concessions} concessions, ${receipts} receipts (cash, UPI, cheque, NEFT; April and October, posted to Accounts)`
}

/** Today at the counter: a few families pay, one refund of an excess payment, and day-end closings (today and three October days). */
async function fillFeeCounter(admin) {
  const closings = await admin.get('/fees/day-end/closings', { from: '2026-04-01', to: today }).catch(() => [])
  if ((closings.rows ?? closings.data ?? closings).length) return 'already there'
  // a few Term 2 payments today
  let paidToday = 0
  for (const [i, s] of students.filter((_, k) => k % 10 === 7).slice(0, 4).entries()) {
    const ledger = await admin.get(`/fees/students/${s.id}`)
    const due = (ledger.invoices ?? []).filter((x) => x.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    if (!due) continue
    const mode = ['CASH', 'UPI', 'CASH', 'CHEQUE'][i]
    const extra = mode === 'UPI' ? { reference: `UPI${String(hash(s.id, 'today')).padStart(7, '0')}` } : mode === 'CHEQUE' ? { reference: '512407', chequeBank: 'State Bank of India', chequeDate: today } : {}
    if (await admin.post('/fees/collect', { studentId: s.id, amount: due.balance, mode, ...extra, waiveLateFee: true }, { ok: [201], quiet: [400, 409] })) paidToday++
  }
  // one refund: a family paid Term 1 twice over the counter (an October cash receipt), part of it goes back in cash
  let refund = null
  const r = await admin.getRaw('/fees/receipts', { pageSize: 50 })
  const rows = r.body?.data?.rows ?? r.body?.data ?? []
  const cashOne = rows.find((x) => x.mode === 'CASH' && x.amount >= 200000 && String(x.date).startsWith('2026-10'))
  if (cashOne) refund = await admin.post(`/fees/receipts/${cashOne.id}/refund`, { amount: 100000, mode: 'CASH', reason: 'Excess paid by mistake — ₹1,000 returned to the father' }, { ok: [201], quiet: [400, 409] })
  // close the day: today and three October days with receipts, cash counted exactly
  const days = [today]
  for (let d = '2026-10-05'; days.length < 4 && d <= '2026-10-20'; d = addDaysYmd(d, 1)) {
    const sum = await admin.get('/fees/day-end', { date: d })
    if (sum.receipts?.length && !sum.closing) days.push(d)
  }
  let closed = 0
  for (const d of days) {
    const sum = await admin.get('/fees/day-end', { date: d })
    if (!sum.receipts?.length || sum.closing) continue
    await admin.post('/fees/day-end/close', { date: d, cashCounted: sum.expectedCash, note: d === today ? 'Cash handed to the accountant' : 'Counted with the accountant' })
    closed++
  }
  return `${paidToday} paid today, ${refund ? `refund ${refund.refundNo ?? ''} of ₹1,000` : 'no refund (no cash receipt found)'}, ${closed} day-end closings`
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
  const pt = await runExam(admin, { name: 'Periodic Test 1', typeCode: 'UT', classCodes: codesFor('CBSE', 1, 8), start: '2026-07-13', maxMarks: 20, passMarks: 7, hours: 1 })
  const hy = await runExam(admin, { name: 'Half-yearly examination', typeCode: 'HY', classCodes: codesFor('CBSE', 1, 8), start: '2026-09-21' })
  const up = await runExam(admin, { name: 'Ardhvarshik Pariksha (Half-yearly)', typeCode: 'HY', classCodes: codesFor('UP', 1, 12), start: '2026-10-05' })
  return `CBSE: Periodic Test 1 (${pt} mark sheets) and Half-yearly (${hy}); UP Board: Ardhvarshik Pariksha (${up}) — all published`
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
 * One approved question paper with two shuffled sets: Periodic Test 1, Class 8 (CBSE), the subject the demo question bank holds
 * Class 8 questions for. Bank questions are auto-picked; the rest are written into the paper.
 */
async function fillQuestionPapers(admin) {
  const c8 = lookup.classes.find((c) => c.code === 'C8')
  if (!c8) return 'no Class 8'
  const bank = await admin.getRaw('/lms/questions', { classId: c8.id, pageSize: 100 })
  const bySubject = new Map()
  for (const q of bank.body?.data ?? []) bySubject.set(q.subjectId, (bySubject.get(q.subjectId) ?? 0) + 1)
  if (!bySubject.size) return 'no Class 8 questions in the question bank'
  const board = await admin.get('/exams/question-papers/board')
  const ut = board.exams.find((e) => e.name === 'Periodic Test 1') ?? board.exams[0]
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
  math: ['Exercise 3.2, questions 1–8', 'Worksheet: word problems on percentages', 'Revise the formulae of the chapter and solve the examples', 'Exercise 5.1 — all questions'],
  science: ['Draw and label the diagram from today’s lesson', 'Write the observations of today’s experiment in the record book', 'Answer the back-exercise questions 1–6', 'Collect three examples from home of what we learnt'],
  english: ['Read the next chapter and note five new words', 'Write a letter to your friend about Deepotsav (150 words)', 'Grammar worksheet: active and passive voice', 'Learn the poem by heart'],
  social: ['Map work: mark the major rivers of Uttar Pradesh', 'Answer questions 1–5 of the lesson', 'Make a timeline of the events of 1857 (Lucknow and Awadh)'],
  language: ['पाठ को सुंदर लेख में कॉपी में लिखिए', 'अपने विद्यालय पर दस वाक्य लिखिए', 'नए शब्दों के अर्थ याद कीजिए', 'शब्द रूप याद कीजिए (संस्कृत)'],
}
const hwFor = (name) => (/math/i.test(name) ? HOMEWORK.math : /science|physics|chem|bio/i.test(name) ? HOMEWORK.science : /english/i.test(name) ? HOMEWORK.english : /social|history|geog/i.test(name) ? HOMEWORK.social : /hindi|sanskrit/i.test(name) ? HOMEWORK.language : null)

async function fillHomework(admin) {
  const list = await admin.get('/homework', { when: 'PAST' }).catch(() => [])
  if ((list.data ?? list).length) return 'already there'
  const lk = await admin.get('/homework/lookup')
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => gradeOf(c.code) >= 3)
  const days = []
  for (let d = addDaysYmd(today, -14); d < today; d = addDaysYmd(d, 1)) if (isSchoolDay(d)) days.push(d)
  let n = 0
  for (const c of classes) {
    const sectionIds = c.sections.map((x) => x.id)
    const subjects = (lk.sections.find((x) => x.id === sectionIds[0])?.subjects ?? c.subjects).filter((x) => hwFor(x.name))
    for (const [di, d] of days.entries()) {
      const subj = subjects[(di + gradeOf(c.code)) % subjects.length]
      if (!subj) continue
      const tasks = hwFor(subj.name)
      await admin.post('/homework', { sectionIds, subjectId: subj.id, title: tasks[(di + n) % tasks.length], setDate: d, dueDate: addDaysYmd(d, 2), notify: false }, { ok: [200, 201], quiet: [400] })
      n++
    }
  }
  return `${n} homework sets over the last two weeks (Classes 3 and up, both boards)`
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
  Sanskrit: ['वर्णमाला और उच्चारण', 'शब्द रूप: अकारान्त पुंलिङ्ग', 'शब्द रूप: आकारान्त स्त्रीलिङ्ग', 'धातु रूप: लट् लकार', 'धातु रूप: लृट् लकार', 'संख्या: एक से पचास', 'सन्धि: स्वर सन्धि', 'कारक और विभक्ति', 'पाठ: सुभाषितानि', 'पाठ: कथा', 'अनुवाद: हिन्दी से संस्कृत', 'पत्र लेखन'],
  'Physical Education': ['Warm-up and fitness', 'Athletics: sprints and relays', 'Long jump and high jump', 'Football skills', 'Volleyball skills', 'Kho-kho and kabaddi', 'Yoga: asanas and pranayama', 'Health and nutrition', 'First aid basics', 'Sports day practice'],
  'Art & Craft': ['Pencil shading', 'Still life drawing', 'Colour wheel and mixing', 'Poster making', 'Madhubani painting', 'Paper craft', 'Clay modelling', 'Landscape painting', 'Calligraphy', 'Collage from waste material'],
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
const SENIOR = { // UP Board intermediate (NCERT books)
  Mathematics: {
    11: ['Sets', 'Relations and Functions', 'Trigonometric Functions', 'Complex Numbers and Quadratic Equations', 'Linear Inequalities', 'Permutations and Combinations', 'Binomial Theorem', 'Sequences and Series', 'Straight Lines', 'Conic Sections', 'Limits and Derivatives', 'Statistics', 'Probability'],
    12: ['Relations and Functions', 'Inverse Trigonometric Functions', 'Matrices', 'Determinants', 'Continuity and Differentiability', 'Application of Derivatives', 'Integrals', 'Application of Integrals', 'Differential Equations', 'Vector Algebra', 'Three Dimensional Geometry', 'Linear Programming', 'Probability'],
  },
  Physics: {
    11: ['Units and Measurements', 'Motion in a Straight Line', 'Motion in a Plane', 'Laws of Motion', 'Work, Energy and Power', 'System of Particles and Rotational Motion', 'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids', 'Thermal Properties of Matter', 'Thermodynamics', 'Kinetic Theory', 'Oscillations', 'Waves'],
    12: ['Electric Charges and Fields', 'Electrostatic Potential and Capacitance', 'Current Electricity', 'Moving Charges and Magnetism', 'Magnetism and Matter', 'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves', 'Ray Optics and Optical Instruments', 'Wave Optics', 'Dual Nature of Radiation and Matter', 'Atoms', 'Nuclei', 'Semiconductor Electronics'],
  },
  Chemistry: {
    11: ['Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements and Periodicity', 'Chemical Bonding and Molecular Structure', 'Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Organic Chemistry: Basic Principles', 'Hydrocarbons'],
    12: ['Solutions', 'Electrochemistry', 'Chemical Kinetics', 'The d- and f-Block Elements', 'Coordination Compounds', 'Haloalkanes and Haloarenes', 'Alcohols, Phenols and Ethers', 'Aldehydes, Ketones and Carboxylic Acids', 'Amines', 'Biomolecules'],
  },
  Biology: {
    11: ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Morphology of Flowering Plants', 'Cell: The Unit of Life', 'Biomolecules', 'Cell Cycle and Cell Division', 'Photosynthesis in Higher Plants', 'Respiration in Plants', 'Plant Growth and Development', 'Breathing and Exchange of Gases', 'Body Fluids and Circulation'],
    12: ['Sexual Reproduction in Flowering Plants', 'Human Reproduction', 'Reproductive Health', 'Principles of Inheritance and Variation', 'Molecular Basis of Inheritance', 'Evolution', 'Human Health and Disease', 'Microbes in Human Welfare', 'Biotechnology: Principles and Processes', 'Biotechnology and its Applications', 'Organisms and Populations', 'Biodiversity and Conservation'],
  },
}

/** The year plan for a class and subject: the chapters spread June–February, three to a unit. */
function yearPlanFor(subject, grade) {
  const list = grade >= 11 ? SENIOR[subject]?.[grade] ?? (Array.isArray(CURRICULUM[subject]) ? CURRICULUM[subject] : null)
    : grade >= 6 ? ((Array.isArray(CURRICULUM[subject]) ? CURRICULUM[subject] : CURRICULUM[subject]?.[grade]) ?? null)
      : (PRIMARY[subject] ?? null)
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
  Sanskrit: { method: 'श्लोक / वाक्यों का शुद्ध उच्चारण, शब्दार्थ, हिन्दी अनुवाद, व्याकरण बिंदु का अभ्यास।', resources: 'पाठ्यपुस्तक, श्यामपट्ट, शब्द-रूप तालिका', homework: 'शब्द रूप / धातु रूप तीन बार लिखें' },
  'Physical Education': { method: 'Warm-up, demonstration of the skill, practice in pairs and groups, a short game, cool-down.', resources: 'Playground, cones, balls, whistle', homework: 'Ten minutes of stretching at home' },
  'Art & Craft': { method: 'Show the sample, demonstrate step by step, students work on their own piece, display and share.', resources: 'Drawing books, colours, craft paper, glue', homework: 'Finish the piece at home' },
  'Computer Science': { method: 'Show it on the projector, students try it at their desks in pairs, check each pair’s work.', resources: 'Computer lab, projector', homework: 'Practice the steps at home if possible' },
}
const REFLECTIONS = [
  'Most of the class followed; a few needed the example again.', 'Good participation — finished the exercise in class.', 'Took longer than planned; will finish the exercise next period.',
  'Students enjoyed the activity; doubts cleared at the end.', 'Covered the topic; the weaker group needs a short revision.', 'Went well — exit question answered correctly by most.',
]

async function fillPrimarySyllabus(admin) {
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => gradeOf(c.code) <= 5)
  const month = today.slice(0, 7)
  let made = 0
  for (const c of classes) {
    for (const subj of c.subjects) {
      const units = yearPlanFor(subj.name, gradeOf(c.code))
      if (!units) continue
      const current = await admin.get('/homework/syllabus', { classId: c.id, subjectId: subj.id }).catch(() => null)
      if (current?.units?.length) continue
      const saved = await admin.put('/homework/syllabus', { classId: c.id, subjectId: subj.id, units })
      made++
      const done = (saved.units ?? []).flatMap((u) => u.topics.filter((t) => (t.month ?? u.fromMonth) < month).map((t) => t.id))
      for (const sec of c.sections) {
        const ids = done.slice(0, Math.max(0, done.length - (hash(c.code) % 2)))
        if (ids.length) await admin.post('/homework/syllabus/progress', { sectionId: sec.id, subjectId: subj.id, topicIds: ids, done: true, date: addDaysYmd(today, -12) }, { ok: [200], quiet: [400, 403] })
      }
    }
  }
  return made ? `${made} year plans for Nursery – Class 5 (both boards)` : 'already there'
}

// teaching material on a few upcoming topics (book, how to teach, questions) and how one class stands on them:
// partly taught, an extra class tomorrow, a taught topic due for revision. Skips topics that already have material.
// Teaching material on every syllabus topic: the board's book with chapter and pages, how to teach it (in the way that
// subject is taught), key points, three questions and a homework idea. Topics that already have material are left alone.
function materialFor({ topic, unit, subject, className, grade, board, n }) {
  const junior = grade <= 0
  const kind = { ENGLISH: 'LANGUAGE', HINDI: 'LANGUAGE' }[subjectKind(subject, grade)] ?? subjectKind(subject, grade)
  const book = board === 'CBSE'
    ? `NCERT ${subject}${junior ? ' activity book' : ''} — ${className.replace(/\s*\(CBSE\)/, '')}`
    : `${subject} (UP Board, NCERT-based) — ${className.replace(/\s*\(UP\)/, '')}`
  const from = 6 + n * 7
  const how = {
    JUNIOR: `Begin with a rhyme or a short story about “${topic}”. Show picture cards, let each child name or point to one, then play a quick game (matching, sorting or colouring) on it. Keep each activity to 5–7 minutes and end with the rhyme again.`,
    MATHS: `Recap the last class with two quick oral questions. Introduce “${topic}” with an everyday example, work two examples on the board step by step, then let pairs solve the first three textbook questions while you go round. Close with one exit question on a slip.`,
    SCIENCE: `Start with a question from daily life on “${topic}”. Do the textbook activity as a demonstration (or in groups if material is there), ask pupils to predict before each step, and write the observation and conclusion on the board. End with the three key points.`,
    LANGUAGE: `Read “${topic}” aloud with expression, then let pupils read paragraph by paragraph. Explain difficult words on the board, discuss the central idea, and do one grammar point from the lesson with three examples. Pupils write two sentences of their own.`,
    SOCIAL: `Show the map / timeline for “${topic}” first. Tell the main story in 10 minutes, then let groups answer one question each from the text and report back. Link it to something in Uttar Pradesh or the pupils’ own town.`,
    COMPUTER: `Explain “${topic}” on the board with a labelled diagram, then show it on the lab computer / projector. Pupils try it in pairs for 10 minutes; check each pair and end with two quick questions.`,
    ARTS: `Show a finished sample of “${topic}” and talk about it for two minutes. Demonstrate each step slowly, then let pupils work on their own piece while you go round and help. Display a few pieces at the end and let pupils say what they like.`,
    PE: `Warm up for five minutes. Demonstrate “${topic}”, let pupils practise it in pairs, then in groups, and finish with a short game that uses the skill. Cool down and talk about one safety rule.`,
    GENERAL: `Introduce “${topic}” with a question to the class, explain the main idea with one example, let pupils try one task in pairs, and close with a two-line summary in their notebooks.`,
  }[kind]
  const points = {
    JUNIOR: [`Name and recognise: ${topic}`, 'Say it, show it, colour it', 'Praise every try'],
    MATHS: [`Meaning of “${topic}” in simple words`, 'Step-by-step method for the worked example', 'Common mistake: skipping a step or a sign'],
    SCIENCE: [`What “${topic}” is and where we see it`, 'Observation and conclusion of the activity', 'One safety point / one real-life use'],
    LANGUAGE: ['Central idea of the lesson', 'New words and their meanings', 'Grammar point with examples'],
    SOCIAL: ['Main events / places in order', 'Why it matters today', 'Map / timeline work'],
    COMPUTER: [`What “${topic}” does`, 'Steps to do it on the computer', 'One shortcut or tip'],
    ARTS: ['Materials and the steps, in order', 'Neat, careful work', 'Every pupil finishes and shares'],
    PE: ['Warm-up before, cool-down after', 'The skill done correctly before fast', 'Safety and fair play'],
    GENERAL: [`Main idea of “${topic}”`, 'One example', 'Summary in two lines'],
  }[kind]
  const questions = junior
    ? [
      { question: `Show and tell: what do you see in the picture of “${topic}”?`, answer: 'Any correct naming or description.', kind: 'SHORT', use: 'CLASS' },
      { question: `Colour the pictures that belong to “${topic}”.`, answer: 'Correct pictures coloured.', kind: 'SHORT', use: 'HOMEWORK' },
    ]
    : kind === 'ARTS' || kind === 'PE' ? [
      { question: `Show the class one step of “${topic}” and say why it matters.`, answer: 'The step done correctly with a sensible reason.', kind: 'SHORT', use: 'CLASS' },
      { question: kind === 'PE' ? `Practise “${topic}” for ten minutes at home and note how it went.` : `Finish your “${topic}” work at home and bring it to the next class.`, answer: 'Done and shown to the teacher.', kind: 'SHORT', use: 'HOMEWORK' },
    ]
    : [
      { question: `Explain “${topic}” in your own words with one example.`, answer: 'Correct meaning with a suitable example.', kind: 'SHORT', use: 'CLASS' },
      { question: `Which statement about “${topic}” is correct?`, answer: 'B', kind: 'MCQ', options: ['A', 'B', 'C', 'D'], use: 'CLASS' },
      { question: kind === 'LANGUAGE' ? `Write the answers to the textbook questions of “${topic}” and learn the new words.` : `Do the textbook exercise on “${topic}” (questions 1–5).`, answer: 'As in the textbook / teacher’s key.', kind: 'LONG', use: 'HOMEWORK' },
    ]
  return {
    book: { name: book, chapter: unit, pages: `p. ${from}–${from + 6}` },
    howTo: how, keyPoints: points, questions,
    homeworkHint: junior ? `Colour and paste one picture of “${topic}” in the activity book.` : questions.at(-1).question,
  }
}

async function fillAllTopicMaterial(admin) {
  const classes = (await admin.get('/academics/classes')).classes
  let filled = 0
  for (const c of classes) {
    const board = String(c.code).startsWith('C') ? 'CBSE' : 'UP'
    for (const subj of c.subjects ?? []) {
      const syl = await admin.get('/homework/syllabus', { classId: c.id, subjectId: subj.id }).catch(() => null)
      let n = 0
      for (const u of syl?.units ?? []) {
        for (const t of u.topics ?? []) {
          n++
          if (t.hasContent) continue
          await admin.put(`/homework/syllabus/topics/${t.id}`, materialFor({ topic: t.name, unit: u.name, subject: subj.name, className: c.name, grade: gradeOf(c.code), board, n }))
          filled++
        }
      }
    }
  }
  return filled ? `${filled} topics given teaching material` : 'already there'
}

// --fresh-content: remove every syllabus (units, topics, teacher's notes, questions), what was marked taught or planned
// on them, the lesson plans, and all content shared for a topic (Subject hub, Create content) with its files. The
// class + subject courses that only held that content go too; courses made on the course page keep their own items.
async function clearContentAndSyllabus() {
  return runAsTenant(tenant._id, async () => {
    const { LessonPlan, SectionTopicPlan, Syllabus, SyllabusDone } = await import('../models/homework.js')
    const { Course, CourseProgress } = await import('../models/lms.js')
    const { Attachment } = await import('../models/engines.js')
    const topicIds = (await Syllabus.find().select('units.topics._id').lean()).flatMap((s) => s.units.flatMap((u) => u.topics.map((t) => String(t._id))))
    const planIds = (await LessonPlan.find().select('_id').lean()).map((x) => String(x._id))
    const itemIds = []
    const emptied = []
    for (const c of await Course.find({ 'units.items': { $elemMatch: { $or: [{ topicId: { $ne: null } }, { hub: true }] } } })) {
      for (const u of c.units) {
        for (const i of u.items.filter((x) => x.topicId || x.hub)) { itemIds.push(String(i._id)); u.items.pull(i._id) }
      }
      if (!c.sectionIds.length && !c.units.some((u) => u.items.length)) emptied.push(c._id)
      else await c.save()
    }
    await Course.deleteMany({ _id: { $in: emptied } })
    await CourseProgress.deleteMany({ courseId: { $in: emptied } })
    const files = await Attachment.updateMany({ 'deleted.at': null, $or: [
      { entityType: 'lms_item', entityId: { $in: itemIds } }, { entityType: 'syllabus_topic', entityId: { $in: topicIds } }, { entityType: 'lesson_plan', entityId: { $in: planIds } },
    ] }, { $set: { deleted: { at: new Date(), by: 'Demo data', reason: 'Syllabus and content cleared to be filled again' } } })
    const [syl] = await Promise.all([Syllabus.deleteMany({}), SyllabusDone.deleteMany({}), SectionTopicPlan.deleteMany({}), LessonPlan.deleteMany({})])
    return `${syl.deletedCount} syllabi (${topicIds.length} topics), ${planIds.length} lesson plans, ${itemIds.length} content items, ${emptied.length} content courses, ${files.modifiedCount} files removed`
  })
}

// Subject hub: student content on every topic of every class and subject (a lesson page, two sub-topics, and exam
// questions added to the topic's own), written the way the subject is taught (demoContent.js); then each unit is
// published to all its students. Topics that already have content are left alone, so a second run adds nothing.
async function fillSubjectHub(admin) {
  const classes = (await admin.get('/academics/classes')).classes
  let topicsDone = 0
  let unitsPublished = 0
  for (const c of classes) {
    const grade = gradeOf(c.code)
    // subjects in parallel: each has its own syllabus and course, so the saves never meet
    await Promise.all((c.subjects ?? []).map(async (subj) => {
      const place = { classId: c.id, subjectId: subj.id }
      const first = await admin.get('/teaching/hub', place).catch(() => null)
      for (const u of first?.units ?? []) {
        const hub = await admin.get('/teaching/hub', { ...place, unitId: u.id }).catch(() => null)
        if (!hub?.topics?.length) continue
        let wrote = false
        for (const t of hub.topics) {
          if (t.content?.html) continue
          const lesson = lessonFor({ topic: t.name, unit: u.name, subject: subj.name, grade })
          const own = t.questions.map(({ id, options, ...q }) => ({ id, ...q, ...(q.kind === 'MCQ' && { options }) }))
          await admin.put(`/teaching/hub/topics/${t.id}`, {
            ...place, contentHtml: lesson.contentHtml,
            questions: own.some((q) => q.use === 'EXAM') ? own : [...own, ...lesson.questions],
            ...(!t.subTopics?.length && { subTopics: lesson.subTopics }),
          })
          topicsDone++
          wrote = true
        }
        if (wrote || ['DRAFT', 'MIXED'].includes(hub.unit?.status)) {
          await admin.post(`/teaching/hub/units/${u.id}/publish`, { ...place, publish: true, when: 'NOW', visibility: 'ALL' })
          unitsPublished++
        }
      }
    }))
  }
  return topicsDone || unitsPublished ? `${topicsDone} topics given student content, ${unitsPublished} units published (${classes.length} classes)` : 'already there'
}

async function fillTeachingPlanner(admin) {
  const classes = (await admin.get('/academics/classes')).classes
  const picks = [classes.find((c) => c.code === 'C8'), classes.find((c) => c.code === 'C5')].filter(Boolean)
  let topicsFilled = 0
  let marks = 0
  for (const c of picks) {
    const subj = c.subjects.find((x) => /math/i.test(x.name)) ?? c.subjects[0]
    const sec = c.sections[0]
    if (!subj || !sec) continue
    const syl = await admin.get('/homework/syllabus', { classId: c.id, subjectId: subj.id }).catch(() => null)
    const topics = (syl?.units ?? []).flatMap((u) => u.topics.map((t) => ({ ...t, unit: u.name })))
    if (!topics.length) continue
    const status = (t) => (syl.sections ?? []).find((x) => x.id === sec.id)?.topicPlan?.[t.id]?.status ?? 'NOT_STARTED'
    const upcoming = topics.filter((t) => status(t) !== 'TAUGHT').slice(0, 3)
    const taught = topics.filter((t) => status(t) === 'TAUGHT').slice(-1)
    if (upcoming.some((t) => t.hasContent)) continue // done on an earlier run
    for (const [i, t] of upcoming.entries()) {
      if (t.hasContent) continue
      await admin.put(`/homework/syllabus/topics/${t.id}`, {
        book: { name: `${subj.name} textbook (NCERT), Class ${c.name.replace(/^Class\s*/i, '')}`, chapter: t.unit, pages: `p. ${40 + i * 8}–${46 + i * 8}` },
        howTo: `Start with a quick question from daily life about “${t.name}”. Show one worked example on the board, then let pairs try two problems from the book while you go round the class. Close with the three key points and the exit question.`,
        keyPoints: [`What “${t.name}” means, in the pupils’ own words`, 'One worked example, step by step', 'The common mistake to watch for'],
        questions: [
          { question: `Explain “${t.name}” with an example of your own.`, answer: 'Any correct example that uses the idea properly.', kind: 'SHORT', use: 'CLASS' },
          { question: `Which of these best describes “${t.name}”?`, answer: 'B', kind: 'MCQ', options: ['A', 'B', 'C', 'D'], use: 'CLASS' },
          { question: `Solve exercise ${i + 1}.${i + 2} (questions 1–5) from the book.`, answer: 'Answers at the back of the book.', kind: 'LONG', use: 'HOMEWORK' },
        ],
        homeworkHint: `Exercise ${i + 1}.${i + 2}, questions 1–5, in the homework notebook.`,
      })
      topicsFilled++
    }
    const plan = (topic, body) => admin.post('/homework/topic-plan', { sectionId: sec.id, subjectId: subj.id, topicId: topic.id, ...body }, { ok: [200], quiet: [400, 403] }).then(() => { marks++ })
    if (upcoming[0] && status(upcoming[0]) === 'NOT_STARTED') await plan(upcoming[0], { status: 'PARTLY', date: today })
    if (upcoming[1]) await plan(upcoming[1], { addExtra: { date: addDaysYmd(today, 1), note: 'Extra class before the unit test' } })
    if (taught[0]) await plan(taught[0], { needsRevision: true, revisionBy: addDaysYmd(today, 3) })
  }
  return topicsFilled || marks ? `${topicsFilled} topics with material, ${marks} class records` : 'already there'
}

async function fillLessonPlans(admin) {
  const existing = await admin.get('/homework/lesson-plans', { from: addDaysYmd(today, -20), to: addDaysYmd(today, 20) }).catch(() => [])
  if (existing.total ?? (existing.rows ?? existing.data ?? existing).length) return 'already there'
  const classes = (await admin.get('/academics/classes')).classes.filter((c) => gradeOf(c.code) >= 6)
  // 1 · the year plan for each class and subject; chapters planned before this month are ticked as taught
  const topicsOf = new Map() // `${classId}|${subjectId}` → [{ id, name, month }]
  let syllabi = 0
  const month = today.slice(0, 7)
  for (const c of classes) {
    for (const subj of c.subjects) {
      const units = yearPlanFor(subj.name, gradeOf(c.code))
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
  return `${syllabi} year plans (Classes 6 and up, both boards), ${plans} lesson plans by ${TEACHER_LOGINS.length} teachers — ${taught} taught, ${skipped} skipped, the rest planned`
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
    { classId: cls('CN'), seats: 40, meritBasis: 'FIRST_COME', testRequired: false }, { classId: cls('C1'), seats: 6, meritBasis: 'TEST', testRequired: true }, { classId: cls('U11'), seats: 20, meritBasis: 'SCORE', testRequired: false },
  ] })
  await admin.post(`/admissions/cycles/${cycle.id}/status`, { status: 'OPEN' })
  const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'SOCIAL', 'REFERRAL', 'NEWSPAPER', 'EVENT']
  const kids = ['Aarohi', 'Vedant', 'Mira', 'Advik', 'Anvi', 'Kiaan', 'Siya', 'Rehan', 'Zoya', 'Arnav', 'Tanvi', 'Neel', 'Ahana', 'Dev', 'Ira', 'Vivaan', 'Ria', 'Om']
  let enq = 0
  for (const [i, child] of kids.entries()) {
    const code = i % 3 === 0 ? 'CN' : i % 3 === 1 ? 'C1' : 'U11'
    const last = pick(LAST, i * 5 + 3)
    const e = await admin.post('/admissions/enquiries', { childName: `${child} ${last}`, parentName: `${pick(FATHERS, i + 4)} ${last}`, mobile: `94540${String(51000 + i * 7).padStart(5, '0')}`, classId: cls(code), source: pick(SOURCES, i) })
    enq++
    if (i % 4 === 1) await admin.post(`/admissions/enquiries/${e.id}/follow-ups`, { type: 'CALL', note: 'Explained the fee structure; will visit on Saturday', stage: 'VISIT' })
    if (i % 4 === 2) await admin.post(`/admissions/enquiries/${e.id}/follow-ups`, { type: 'VISIT', note: 'Visited with the child, saw the campus', stage: 'VISITED' })
    if (i === 17) await admin.patch(`/admissions/enquiries/${e.id}`, { stage: 'LOST', lostReason: 'Chose a school nearer home' })
  }
  // applications: Nursery (first come), Class 1 (entrance test), Class 11 (by Class 10 score)
  const apps = []
  for (const [i, child] of kids.slice(0, 14).entries()) {
    const code = i % 3 === 0 ? 'CN' : i % 3 === 1 ? 'C1' : 'U11'
    const last = pick(LAST, i * 5 + 3)
    const age = { CN: 3, C1: 6, U11: 15 }[code]
    const a = await admin.post('/admissions/applications', { cycleId: cycle.id, classId: cls(code), child: { firstName: child, lastName: last, dob: `${2027 - age - 1}-${String(1 + (i % 12)).padStart(2, '0')}-12`, gender: i % 2 ? 'MALE' : 'FEMALE' }, parent: { name: `${pick(FATHERS, i + 4)} ${last}`, relation: 'FATHER', mobile: `94540${String(51000 + i * 7).padStart(5, '0')}` } }, { ok: [201], quiet: [409] })
    if (a) apps.push({ ...a, code, i })
  }
  for (const a of apps.filter((x) => x.code === 'U11')) await admin.patch(`/admissions/applications/${a.id}`, { score: 68 + (a.i * 7) % 30 })
  const test = await admin.post('/admissions/tests', { cycleId: cycle.id, name: 'Class 1 entrance interaction', classIds: [cls('C1')], date: addDaysYmd(today, -6), time: '10:00', venue: 'Primary block, room 3', maxMarks: 50 })
  await admin.post(`/admissions/tests/${test.id}/assign`, {})
  const sheet = await admin.get(`/admissions/tests/${test.id}/marks`)
  await admin.put(`/admissions/tests/${test.id}/marks`, { entries: sheet.rows.map((r, i) => ({ applicationId: r.id, marks: 28 + ((i * 9) % 21) })) })
  await admin.post(`/admissions/merit/${cycle.id}/${cls('C1')}/publish`, {})
  const allot = await admin.post(`/admissions/merit/${cycle.id}/${cls('C1')}/allot`, {})
  const nur = apps.filter((x) => x.code === 'CN')
  if (nur[1]) await admin.post(`/admissions/applications/${nur[1].id}/status`, { status: 'UNDER_REVIEW', note: 'Documents being checked' })
  if (nur[2]) await admin.post(`/admissions/applications/${nur[2].id}/status`, { status: 'SHORTLISTED', note: 'Parents met the coordinator' })
  return `cycle 2027-28 open, ${enq} enquiries, ${apps.length} applications, Class 1 test marked (${allot.offered ?? 0} offered, ${allot.waitlisted ?? 0} waitlisted)`
}

// ───────────────────────────────────────────────────────── notices

async function fillNotices(admin) {
  const list = await admin.get('/communication/notices').catch(() => [])
  if ((list.data ?? list).length) return 'already there'
  const notices = [
    { title: 'Half-yearly report cards', body: 'Report cards for the half-yearly examination (CBSE) and the Ardhvarshik Pariksha (UP Board) are in the app under Results. Printed copies will be handed over at the parent–teacher meeting on 21 November.', category: 'Exam', audience: { kind: 'ALL' }, pinned: true },
    { title: 'Children’s Day — colour dress', body: 'Students may come in colour dress on Saturday 14 November. Classes end at 12:30 pm; buses leave at 12:45 pm.', category: 'Event', audience: { kind: 'ALL' } },
    { title: 'Term 2 fees due', body: 'Term 2 fees were due on 15 October. Please clear the dues by 30 November to avoid a late fee. Pay at the counter or online in the app.', category: 'Fees', audience: { kind: 'ALL' } },
    { title: 'Winter timings from 1 December', body: 'From 1 December school starts at 8:30 am and ends at 2:30 pm. Buses will pick up 30 minutes later than now.', category: 'Circular', audience: { kind: 'ALL' } },
    { title: 'UP Board registration — Classes 9 and 11', body: 'Check the spelling of your child’s name, parents’ names and date of birth on the registration list sent home, sign it and return it by 20 November.', category: 'Circular', audience: { kind: 'CLASSES', classIds: ['U9', 'U11'].map((c) => classByCode(c)?.id).filter(Boolean) } },
    { title: 'Bus route 2 timing change', body: 'From Monday, Route 2 picks up at Patrakarpuram at 6:50 am (5 minutes earlier) because of road work near Munshipulia.', category: 'Transport', audience: { kind: 'ALL' } },
  ]
  for (const n of notices) {
    const made = await admin.post('/communication/notices', n)
    await admin.post(`/communication/notices/${made.id}/publish`, { channels: [] })
  }
  return `${notices.length} notices published`
}

// ───────────────────────────────────────────────────────── certificates and TC

const firstOf = (code, k = 0) => studentsOf(secOf(code))[k]

async function fillCertificates(admin) {
  if ((await admin.getRaw('/certificates', { pageSize: 1 })).body?.meta?.total) return 'already there'
  const a = firstOf('C7')
  const b = firstOf('U10', 1)
  const bona = await admin.post('/certificates', { kind: 'BONAFIDE', studentIds: [a.id], purpose: 'Passport application', issueDate: today })
  const char = await admin.post('/certificates', { kind: 'CHARACTER', studentIds: [b.id], conduct: 'Very good', purpose: 'Admission to a polytechnic', remarks: 'Regular, disciplined and helpful to classmates.' })
  return `bonafide (${a.name}) ${bona.numbers?.[0] ?? ''}, character (${b.name}) ${char.numbers?.[0] ?? ''}`
}

/** A Class 7 (UP Board) student leaves: the family moves to Kanpur. */
async function fillTc(admin) {
  const r = await admin.get('/students/tc', { status: 'ISSUED' })
  if (r.total || r.rows?.length) return 'already there'
  const kids = studentsOf(secOf('U7'))
  const s = kids.at(-1)
  if (!s) return 'skipped (no Class 7 UP students)'
  const tc = await admin.post('/students/tc', { studentId: s.id, leavingDate: addDaysYmd(today, -2), applicationDate: addDaysYmd(today, -6), reason: 'RELOCATION', reasonText: 'Father transferred to Kanpur', conduct: 'Good', promotedTo: 'Class 8', feesPaidUpTo: 'October 2026', remarks: 'No dues.' })
  const done = await admin.post(`/students/tc/${tc.id}/issue`, {})
  students = students.filter((x) => x.id !== s.id)
  return `TC ${done.tcNo ?? ''} for ${s.name}`
}

// ───────────────────────────────────────────────────────── front office

async function fillFrontOffice(admin) {
  if ((await admin.getRaw('/frontoffice/complaints', {})).body?.data?.total) return 'already there'
  const users = (await admin.get('/core/users', { pageSize: 100 }))
  const userId = (email) => (users.data ?? users).find((u) => u.email === email)?.id
  const s1 = firstOf('C4')
  const s2 = firstOf('U6', 1)
  const visitors = [
    { name: 'Rakesh Chandra Gupta', mobile: '9415123456', purpose: 'PARENT_MEETING', studentId: s1?.id, people: 2, idType: 'AADHAAR', idNumber: 'XXXX XXXX 4521', note: 'Met the class teacher about the half-yearly result' },
    { name: 'Anil Kumar', mobile: '9839012345', purpose: 'VENDOR', from: 'Universal Booksellers, Hazratganj', vehicleNo: 'UP32 FT 2231', note: 'Delivered answer sheets' },
    { name: 'Kiran Bajpai', mobile: '9452011223', purpose: 'ADMISSION_ENQUIRY', people: 2, note: 'Nursery 2027-28' },
    { name: 'Sub-officer, UP Fire Service', purpose: 'OTHER', purposeNote: 'Fire safety inspection', from: 'Fire Station, Aliganj' },
    { name: 'Sanjay Tripathi', mobile: '9935512345', purpose: 'MEET_STAFF', hostId: userId('principal.up@stthomas.test'), from: 'Jankipuram', note: 'UP Board registration form' },
  ]
  let checkedOut = 0
  for (const [i, v] of visitors.entries()) {
    const made = await admin.post('/frontoffice/visitors', v)
    if (i < 3 && await admin.post(`/frontoffice/visitors/${made.id}/checkout`, {}, { ok: [200, 201], quiet: [409] })) checkedOut++
  }
  let passes = 0
  for (const [k, s, reason, leaveAt] of [[0, s1, 'Fever since morning — going home with the father', '11:30'], [1, s2, 'Family function in Barabanki', '12:15']]) {
    if (!s) continue
    const d = await admin.get(`/students/${s.id}`)
    const g = (d.guardians ?? d.student?.guardians ?? [])[0]
    const p = await admin.post('/frontoffice/gate-passes', { kind: 'STUDENT', studentId: s.id, reason, leaveAt, collector: { type: 'OTHER', name: g?.name ?? 'Father', relation: 'Father', mobile: g?.mobile }, approveNow: true }).catch((e) => { log(`gate pass: ${e.message}`); return null })
    if (!p) continue
    passes++
    if (k === 0) await admin.post(`/frontoffice/gate-passes/${p.id}/left`, {}, { ok: [200, 201], quiet: [409] })
  }
  const complaints = [
    { source: 'PARENT', category: 'TRANSPORT', priority: 'HIGH', subject: 'Route 2 bus late three days this week', description: 'The bus reached Indira Nagar after 7:30 am on Monday, Tuesday and Thursday.', complainant: { name: 'Pankaj Shukla', mobile: '9415998877' }, studentId: s1?.id, resolve: 'Spoke to the driver; road work at Munshipulia. Pick-up moved 5 minutes earlier.' },
    { source: 'STUDENT', category: 'FACILITIES', subject: 'Water cooler on the second floor not cooling', complainant: { name: 'Class 9 (UP) monitor' }, assignedToId: userId('frontdesk@stthomas.test') },
    { source: 'PARENT', category: 'FEES', subject: 'Receipt for the October cheque not received', complainant: { name: 'Neelam Verma', mobile: '8840012345' } },
  ]
  for (const { resolve, ...c } of complaints) {
    const made = await admin.post('/frontoffice/complaints', c)
    if (resolve) await admin.post(`/frontoffice/complaints/${made.id}/status`, { status: 'RESOLVED', resolution: resolve })
  }
  return `${visitors.length} visitors today (${checkedOut} checked out), ${passes} gate passes, ${complaints.length} complaints (1 resolved)`
}

// ───────────────────────────────────────────────────────── hostel

async function fillHostel(admin) {
  if ((await admin.get('/hostel/blocks')).length) return 'already there'
  const out = []
  for (const [name, code, kind, warden, mobile] of [['St. Joseph Boys Hostel', 'SJB', 'BOYS', 'Deepak Singh', '9415334455'], ['St. Mary Girls Hostel', 'SMG', 'GIRLS', 'Seema Dubey', '9415334466']]) {
    const block = await admin.post('/hostel/blocks', { name, code, kind, floors: 2, warden: { name: warden, mobile } })
    const beds = []
    for (const [number, floor] of [['101', 1], ['102', 1], ['201', 2], ['202', 2]]) {
      const room = await admin.post('/hostel/rooms', { blockId: block.id, number, floor, capacity: 3, type: 'TRIPLE', fee: 4500000 })
      beds.push(...room.beds.map((b) => b.id))
    }
    out.push({ kind, beds })
  }
  // UP Board Classes 9–12 board here
  const seniors = students.filter((s) => boardOf(classOf(s.classId)?.code) === 'UP' && gradeOfStudent(s) >= 9)
  let allotted = 0
  let firstBoy = null
  for (const { kind, beds } of out) {
    const kids = seniors.filter((s) => (kind === 'BOYS' ? s.gender === 'MALE' : s.gender === 'FEMALE')).filter((_, i) => i % 2 === 0).slice(0, 8)
    for (const [i, s] of kids.entries()) {
      if (!beds[i]) break
      if (await admin.post('/hostel/allotments', { studentId: s.id, bedId: beds[i], from: '2026-04-05' }, { ok: [201], quiet: [400, 409] })) {
        allotted++
        if (kind === 'BOYS' && !firstBoy) firstBoy = s
      }
    }
  }
  if (firstBoy) await admin.post('/hostel/outpasses', { studentId: firstBoy.id, kind: 'HOME', leaveDate: today, leaveTime: '15:00', returnDate: addDaysYmd(today, 3), returnTime: '18:00', reason: 'Going home to Sitapur for the weekend', destination: 'Sitapur', escort: { name: 'Father', relation: 'Father', mobile: '9415220011' }, approve: true }, { ok: [201], quiet: [400, 409] })
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const menu = { BREAKFAST: ['Poha, tea / milk', 'Aloo paratha, curd', 'Bread, butter, banana', 'Upma, milk', 'Puri sabzi', 'Idli sambhar', 'Chhole bhature'], LUNCH: ['Dal, rice, roti, aloo gobhi', 'Rajma chawal, roti', 'Kadhi chawal, roti', 'Dal, rice, roti, bhindi', 'Chhole, rice, roti', 'Dal, rice, roti, lauki', 'Veg biryani, raita'], DINNER: ['Roti, mix veg, dal', 'Roti, paneer, dal', 'Roti, seasonal sabzi, dal', 'Roti, soyabean, dal', 'Khichdi, papad, achar', 'Roti, kofta, dal', 'Roti, aloo matar, kheer'] }
  await admin.put('/hostel/mess/menu', { items: days.flatMap((day, i) => Object.entries(menu).map(([meal, list]) => ({ day, meal, dishes: list[i] }))) }, { ok: [200], quiet: [400] })
  return `2 hostels (boys and girls), 8 rooms, ${allotted} UP Board students (Classes 9–12) allotted, 1 home outpass, the week's mess menu`
}

// ───────────────────────────────────────────────────────── canteen

const MENU = [
  ['Samosa (2 pcs)', 2000, 'SNACK', 'VEG', ['FRIED']], ['Veg patty', 2000, 'SNACK', 'VEG', ['FRIED']], ['Poha', 2500, 'MEAL', 'VEG', []],
  ['Aloo paratha with curd', 4000, 'MEAL', 'VEG', []], ['Veg thali', 6000, 'MEAL', 'VEG', []], ['Chhole kulche', 4000, 'MEAL', 'VEG', ['SPICY']],
  ['Egg roll', 3500, 'SNACK', 'EGG', []], ['Fruit bowl', 3000, 'SNACK', 'VEG', []], ['Sweet lassi', 2500, 'BEVERAGE', 'VEG', ['SUGARY']], ['Nimbu pani', 1500, 'BEVERAGE', 'VEG', []],
]

async function fillCanteen(admin) {
  const have = await admin.get('/canteen/menu')
  if ((have.items ?? have).length) return 'already there'
  const items = []
  for (const [i, [name, price, category, mark, tags]] of MENU.entries()) items.push(await admin.post('/canteen/menu', { name, price, category, mark, tags, days: [], order: i + 1 }))
  const buyers = students.filter((s) => gradeOfStudent(s) >= 5).filter((_, i) => i % 4 === 1).slice(0, 18)
  let topups = 0
  for (const [i, s] of buyers.entries()) {
    if (await admin.post(`/canteen/wallets/${s.id}/topup`, { amount: [50000, 100000, 30000][i % 3], mode: i % 2 ? 'CASH' : 'UPI', ...(i % 2 ? {} : { reference: `UPI${String(hash(s.id, 'w')).padStart(7, '0')}` }) }, { ok: [201], quiet: [400, 409] })) topups++
  }
  let orders = 0
  for (const [i, s] of buyers.slice(0, 12).entries()) {
    const lines = [{ itemId: items[i % items.length].id, qty: 1 }, ...(i % 3 === 0 ? [{ itemId: items[8].id, qty: 1 }] : [])]
    if (await admin.post('/canteen/orders', { studentId: s.id, lines, payMode: 'WALLET' }, { ok: [201], quiet: [400, 409] })) orders++
  }
  for (const k of [0, 4, 9]) if (await admin.post('/canteen/orders', { lines: [{ itemId: items[k].id, qty: 2 }], payMode: 'CASH' }, { ok: [201], quiet: [400, 409] })) orders++
  return `${items.length} menu items, ${topups} wallets topped up, ${orders} orders today`
}

// ───────────────────────────────────────────────────────── store & assets

async function fillInventory(admin) {
  if ((await admin.getRaw('/inventory/items', { active: 'ALL' })).body?.data?.length) return 'already there'
  const ITEMS = [
    ['CHALK-W', 'White chalk (box of 100)', 'STATIONERY', 'BOX', 4500, 10], ['PAPER-A4', 'A4 paper, 75 gsm', 'STATIONERY', 'REAM', 32000, 10], ['MARKER-WB', 'Whiteboard marker', 'STATIONERY', 'PCS', 2500, 30],
    ['REG-ATT', 'Attendance register', 'STATIONERY', 'PCS', 12000, 5], ['TT-15', 'Test tubes (15 ml)', 'LAB', 'DOZEN', 18000, 5], ['PHENYL', 'Phenyl', 'CLEANING', 'LITRE', 9000, 10],
    ['FOOTBALL', 'Football (size 5)', 'SPORTS', 'PCS', 65000, 2],
  ]
  const items = {}
  for (const [code, name, category, unit, rate, reorderLevel] of ITEMS) items[code] = await admin.post('/inventory/items', { code, name, category, unit, rate, reorderLevel, location: 'Store room, Block A' })
  const vendors = {}
  for (const [key, name, contactPerson, phone, categories] of [
    ['books', 'Universal Booksellers & Stationers', 'Anil Kumar', '9839012345', ['STATIONERY', 'BOOKS']],
    ['lab', 'Sharma Scientific Traders, Aminabad', 'Vivek Sharma', '9415667788', ['LAB']],
    ['sports', 'Lucknow Sports House, Hazratganj', 'Imtiaz Ahmad', '9335011223', ['SPORTS']],
    ['clean', 'Shri Ram Cleaning Supplies', 'Ramesh Gupta', '9454001122', ['CLEANING']],
  ]) vendors[key] = await admin.post('/inventory/vendors', { name, contactPerson, phone, categories, address: 'Lucknow' })
  // a purchase order for stationery: submitted, approved, received in full
  const po = await admin.post('/inventory/purchase-orders', { vendorId: vendors.books.id, date: addDaysYmd(today, -20), expectedOn: addDaysYmd(today, -12), lines: [{ itemId: items['CHALK-W'].id, qty: 20 }, { itemId: items['PAPER-A4'].id, qty: 30 }, { itemId: items['MARKER-WB'].id, qty: 100 }, { itemId: items['REG-ATT'].id, qty: 30 }], terms: 'Delivery at school. Payment within 30 days.' })
  await admin.post(`/inventory/purchase-orders/${po.id}/submit`, {})
  await admin.post(`/inventory/purchase-orders/${po.id}/approve`, { note: 'Rates as last year' })
  await admin.post(`/inventory/purchase-orders/${po.id}/receive`, { lines: po.lines.map((l) => ({ lineId: l.id, qty: l.qty })), date: addDaysYmd(today, -10), invoiceNo: 'UB/2026/1182' })
  // a second one waits for approval
  const po2 = await admin.post('/inventory/purchase-orders', { vendorId: vendors.lab.id, lines: [{ itemId: items['TT-15'].id, qty: 10 }], note: 'For the Class 11–12 practicals' })
  await admin.post(`/inventory/purchase-orders/${po2.id}/submit`, {})
  await admin.post('/inventory/stock/adjust', { itemId: items.PHENYL.id, qty: 20, reason: 'COUNT' }, { ok: [200, 201], quiet: [400] })
  const meta = await admin.get('/inventory/meta')
  const dept = (re) => (meta.departments ?? []).find((d) => re.test(d.name))?.id
  let issues = 0
  for (const [re, lines, note] of [[/Primary/, [{ itemId: items['CHALK-W'].id, qty: 5 }, { itemId: items['MARKER-WB'].id, qty: 20 }], 'For the primary classes'], [/Administration/, [{ itemId: items['PAPER-A4'].id, qty: 6 }, { itemId: items['REG-ATT'].id, qty: 4 }], 'Office use']]) {
    const id = dept(re)
    if (id && await admin.post('/inventory/stock/issue', { to: { kind: 'DEPARTMENT', id }, lines, note, date: addDaysYmd(today, -5) }, { ok: [201], quiet: [400, 409] })) issues++
  }
  const ASSETS = [
    ['Interactive smart board 75"', 'AV', 'Samsung', 'Flip 2', 18500000, '2025-06-10', 'Room A-201'], ['Desktop computer', 'IT', 'HP', 'ProDesk 400 G9', 5200000, '2024-07-01', 'Computer lab'],
    ['Desktop computer', 'IT', 'HP', 'ProDesk 400 G9', 5200000, '2024-07-01', 'Computer lab'], ['RO water cooler 150 L', 'ELECTRICAL', 'Usha', 'FC 150', 6800000, '2023-04-15', 'Block B, 2nd floor'],
    ['Steel almirah', 'FURNITURE', 'Godrej', 'Storwel', 1450000, '2022-05-20', 'Staff room'], ['Compound microscope', 'LAB', 'Labomed', 'Vision 2000', 2250000, '2023-08-01', 'Biology lab'],
    ['Diesel generator 15 kVA', 'ELECTRICAL', 'Kirloskar', 'KG1-15AS', 42500000, '2021-03-10', 'Generator room'],
  ]
  const tags = []
  for (const [i, [name, category, make, model, cost, purchaseDate, location]] of ASSETS.entries()) {
    const a = await admin.post('/inventory/assets', { name, category, make, model, cost, purchaseDate, location, serialNo: `SN${String(hash(name, i)).padStart(7, '0')}`, condition: i === 3 ? 'FAIR' : 'GOOD', lifeYears: category === 'IT' ? 5 : 10 })
    tags.push(a.assetTag)
  }
  return `${ITEMS.length} items, 4 vendors, 2 purchase orders (1 received, 1 waiting for approval), ${issues} store issues, ${ASSETS.length} assets tagged ${tags[0]} …`
}

// ───────────────────────────────────────────────────────── health

async function fillHealth(admin) {
  const probe = students[0] && await admin.get(`/health/records/${students[0].id}`).catch(() => null)
  if (probe?.record?.id) return 'already there'
  const ALLERGIES = [[], [], ['Dust'], [], ['Peanuts'], [], [], ['Pollen']]
  let records = 0
  for (const [i, s] of students.filter((_, k) => k % 6 === 0).entries()) {
    const g = Math.max(gradeOfStudent(s), -2)
    const heightCm = Math.round(95 + (g + 2) * 6 + (hash(s.id) % 9))
    const weightKg = Math.round(14 + (g + 2) * 3 + (hash(s.id, 'w') % 6))
    await admin.put(`/health/records/${s.id}`, {
      bloodGroup: pick(['B+', 'O+', 'A+', 'AB+', 'O-'], i), allergies: pick(ALLERGIES, i),
      vaccinations: [{ name: 'MMR', date: `${2026 - g - 5 + 1}-04-10`, dose: '2' }, { name: 'Tdap booster', date: '2026-07-20', dose: '1' }],
      doctor: { name: 'Dr. S. K. Awasthi', phone: '9415012345', hospital: 'Vivekananda Polyclinic, Niralanagar' },
      ...(i % 9 === 4 && { conditions: ['Asthma (mild)'], medications: [{ name: 'Salbutamol inhaler', dose: '2 puffs', schedule: 'as needed' }] }),
      measurement: { date: '2026-08-05', heightCm, weightKg },
    })
    records++
  }
  const pool = students.filter((s) => gradeOfStudent(s) >= 3)
  const visits = [
    [pool[2], 'FEVER', 'Felt feverish after the second period', { tempC: 38.3, pulse: 96 }, 'Paracetamol 250 mg, rest', { outcome: 'SENT_HOME', outcomeNote: 'Mother came at 11:45', pickedUpBy: 'Mother', notifyGuardian: false }],
    [pool[11], 'INJURY', 'Scraped knee during games period', { pulse: 88 }, 'Wound cleaned and dressed', { outcome: 'BACK_TO_CLASS', outcomeNote: 'Fine to continue' }],
    [pool[20], 'STOMACH_ACHE', 'Stomach ache after lunch', { tempC: 37.0 }, 'Rest in the infirmary, ORS', null],
  ]
  let n = 0
  for (const [s, complaint, complaintNote, vitals, treatment, close] of visits) {
    if (!s) continue
    const v = await admin.post('/health/visits', { personType: 'STUDENT', studentId: s.id, complaint, complaintNote, vitals, treatment })
    if (close) await admin.patch(`/health/visits/${v.id}`, close)
    n++
  }
  return `${records} health records (blood group, vaccinations, height and weight), ${n} infirmary visits today`
}

// ───────────────────────────────────────────────────────── family app sign-in (for the survey and the chat)

async function familySignIn(mobile) {
  const agent = request.agent(app).set('Origin', ORIGIN)
  const base = `/api/v1/family/${SLUG}`
  const otp = await agent.post(`${base}/otp`).send({ mobile })
  if (![200, 201].includes(otp.status)) throw new Error(`Family sign-in (${mobile}) → ${otp.status}: ${otp.body?.message ?? otp.text}`)
  const v = await agent.post(`${base}/verify`).send({ challengeId: otp.body.data.challengeId, code: otp.body.data.testCode })
  if (![200, 201].includes(v.status)) throw new Error(`Family verify (${mobile}) → ${v.status}: ${v.body?.message ?? v.text}`)
  const call = async (method, p, body) => {
    const r = await agent[method](`${base}${p}`).send(body)
    if ([200, 201].includes(r.status)) return r.body?.data ?? r.body
    throw new Error(`${method.toUpperCase()} family${p} → ${r.status}: ${r.body?.message ?? r.text}${r.body?.details ? ` ${JSON.stringify(r.body.details)}` : ''}`)
  }
  return { me: v.body.data, get: (p) => call('get', p), post: (p, b) => call('post', p, b) }
}
const primaryMobile = async (admin, studentId) => {
  const d = await admin.get(`/students/${studentId}`)
  const gs = d.guardians ?? d.student?.guardians ?? []
  return (gs.find((g) => g.isPrimary) ?? gs[0])?.mobile
}

// ───────────────────────────────────────────────────────── survey

async function fillSurvey(admin) {
  const list = await admin.get('/surveys')
  if ((list.data ?? list).length) return 'already there'
  const forms = await admin.get('/surveys/questionnaires')
  const form = forms.find((f) => f.code === 'PARENT_SATISFACTION')
  if (!form) return 'skipped (no parent questionnaire)'
  const sv = await admin.post('/surveys', { title: 'Parent feedback 2026-27 (Term 1)', intro: 'Tell us how the first term went for your child. It takes two minutes.', formId: form.formId, audience: 'PARENTS', classIds: [], sectionIds: [], anonymous: false, opensOn: addDaysYmd(today, -5), closesOn: addDaysYmd(today, 20) })
  await admin.post(`/surveys/${sv.id}/publish`, { notify: false })
  const answers = [
    { TEACHING: 5, PROGRESS: 4, COMMUNICATION: 4, SAFETY: 5, FACILITIES: 4, TRANSPORT: 'Happy', BEST: ['Teachers', 'Discipline'], RECOMMEND: 'YES', COMMENTS: 'Teachers are very caring. Please start a skating club.' },
    { TEACHING: 4, PROGRESS: 4, COMMUNICATION: 3, SAFETY: 5, FACILITIES: 3, TRANSPORT: 'We don’t use it', BEST: ['Values', 'Results'], RECOMMEND: 'YES', COMMENTS: 'Homework diary is not always filled in.' },
    { TEACHING: 3, PROGRESS: 3, COMMUNICATION: 4, SAFETY: 4, FACILITIES: 3, TRANSPORT: 'Not happy', BEST: ['Activities and sports'], RECOMMEND: 'YES', COMMENTS: 'The bus is often late in the morning.' },
    { TEACHING: 5, PROGRESS: 5, COMMUNICATION: 5, SAFETY: 5, FACILITIES: 5, TRANSPORT: 'Very happy', BEST: ['Teachers', 'Results', 'Facilities'], RECOMMEND: 'YES' },
    { TEACHING: 4, PROGRESS: 3, COMMUNICATION: 3, SAFETY: 4, FACILITIES: 4, TRANSPORT: 'Happy', BEST: ['Discipline'], RECOMMEND: 'YES', COMMENTS: 'Fee receipts could come on WhatsApp.' },
    { TEACHING: 3, PROGRESS: 2, COMMUNICATION: 2, SAFETY: 4, FACILITIES: 3, TRANSPORT: 'We don’t use it', BEST: ['Values'], RECOMMEND: 'NO', COMMENTS: 'Would like more English speaking practice.' },
  ]
  const families = students.filter((_, i) => i % 29 === 3).slice(0, answers.length)
  let n = 0
  for (const [i, s] of families.entries()) {
    try {
      const fam = await familySignIn(await primaryMobile(admin, s.id))
      await fam.post(`/students/${s.id}/surveys/${sv.id}`, { values: answers[i] })
      n++
    } catch (e) { log(`survey: ${e.message}`) }
  }
  return `parent survey open till ${addDaysYmd(today, 20)}, ${n} families answered in the app`
}

// ───────────────────────────────────────────────────────── website

async function fillWebsite(admin) {
  const { pages } = await admin.get('/website/pages')
  if (pages.find((p) => p.kind === 'HOME')?.status === 'PUBLISHED') return 'already there'
  const BLOCKS = {
    HOME: [
      { id: 'hero', type: 'HERO', data: { heading: 'St. Thomas School, Lucknow', subheading: 'A CBSE school (Nursery – Class 8) and a UP Board school (Nursery – Class 12) on one campus on Kursi Road, run by St. Thomas Educational Society since 1987.', buttonLabel: 'Apply for 2027-28', apply: true } },
      { id: 'stats', type: 'STATS', data: { heading: 'At a glance', items: [{ value: '1987', label: 'Founded' }, { value: '2', label: 'Boards: CBSE and UP Board' }, { value: '26', label: 'Classes' }, { value: '2', label: 'Hostels' }] } },
      { id: 'why', type: 'CARDS', data: { heading: 'Why St. Thomas', items: [{ title: 'Caring teachers', text: 'Small classes and a class teacher who knows every child.' }, { title: 'Science labs', text: 'Physics, chemistry, biology and computer labs for the senior classes.' }, { title: 'Safe transport', text: 'GPS-tracked buses on two routes across Lucknow.' }] } },
      { id: 'notices', type: 'NOTICES', data: { heading: 'Latest notices', count: 5 } },
      { id: 'events', type: 'EVENTS', data: { heading: 'Coming up', count: 5 } },
    ],
    ABOUT: [
      { id: 'about', type: 'TEXT', data: { heading: 'About the school', body: 'St. Thomas School was founded in 1987 by St. Thomas Educational Society (Regd.), Lucknow. The CBSE school is affiliated to CBSE, New Delhi (Affiliation No. 2130417). The UP Board school is recognised by the Board of High School & Intermediate Education, Uttar Pradesh, Prayagraj.\n\nOur motto, “Lux et Veritas”, asks every student to seek light and truth.' } },
      { id: 'leaders', type: 'CARDS', data: { heading: 'Our principals', items: [{ title: 'Fr. Thomas Mathew', text: 'Principal, CBSE school' }, { title: 'Dr. Rajendra Prasad Tiwari', text: 'Principal, UP Board school' }] } },
    ],
    ADMISSIONS: [
      { id: 'adm', type: 'TEXT', data: { heading: 'Admissions 2027-28', body: 'Registration for Nursery and Class 1 (CBSE) and Class 11 (UP Board, science) is open. Nursery: age 3 on 31 March 2027. Class 1 has a short interaction. Class 11 seats are given on Class 10 marks.' } },
      { id: 'cta', type: 'CTA', data: { heading: 'Ready to apply?', text: 'Fill in the form online; the office will call you within two working days.', buttonLabel: 'Apply online', apply: true } },
    ],
    CONTACT: [
      { id: 'contact', type: 'CONTACT', data: { heading: 'Visit us', address: 'Sector 12, Kursi Road, Vikas Nagar, Lucknow 226022', phone: '+91 522 4012 345', email: 'office@stthomas.test', lat: 26.8995, lng: 80.9618, showMap: true } },
    ],
  }
  let n = 0
  for (const p of pages) {
    const blocks = BLOCKS[p.kind]
    if (!blocks) continue
    await admin.patch(`/website/pages/${p.id}`, { blocks })
    await admin.post(`/website/pages/${p.id}/publish`, {})
    n++
  }
  await admin.put('/website/site', { live: true, tagline: 'Lux et Veritas — Light and Truth', footer: '© St. Thomas Educational Society (Regd.), Lucknow', contact: { phone: '+91 522 4012 345', email: 'office@stthomas.test', address: 'Sector 12, Kursi Road, Vikas Nagar, Lucknow 226022' } })
  return `${n} pages published (home, about, admissions, contact), site live`
}

// ───────────────────────────────────────────────────────── staff chat and call bell

const as = (email) => signIn(email, email === ADMIN.email ? ADMIN.password : 'Demo@123')

async function fillStaffChat(admin) {
  const { channels } = await admin.get('/comms/chat/channels')
  const whole = channels.find((c) => c.type === 'INSTITUTION')
  const seen = whole ? await admin.get(`/comms/chat/channels/${whole.id}/messages`, { limit: 5 }).catch(() => null) : null
  if (whole?.lastMessageAt || whole?.lastMessage || (seen?.messages ?? seen?.rows ?? seen ?? []).length) return 'already there'
  const users = (await admin.get('/core/users', { pageSize: 100 }))
  const idOf = (email) => (users.data ?? users).find((u) => u.email === email)?.id
  const posted = [] // [message id, minutes ago]
  const say = async (email, channelOf, text, minutesAgo) => {
    const me = await as(email)
    const { channels: mine } = await me.get('/comms/chat/channels')
    const ch = channelOf(mine)
    if (!ch) return
    const m = await me.post(`/comms/chat/channels/${ch.id}/messages`, { text, clientId: `demo-${hash(email, text)}` }, { ok: [200, 201], quiet: [400, 403, 404, 409] })
    if (m) posted.push([m.id, ch.id, minutesAgo])
  }
  const wholeStaff = (list) => list.find((c) => c.type === 'INSTITUTION')
  const dept = (name) => (list) => list.find((c) => c.type === 'DEPARTMENT' && c.name === name)
  await say('principal.cbse@stthomas.test', wholeStaff, 'Good morning, everyone. The half-yearly report cards go home at the PTM on 21 November — class teachers, please finish the remarks by Wednesday.', 2900)
  await say('principal.up@stthomas.test', wholeStaff, 'UP Board registration forms for Classes 9 and 11 must reach the office by 20 November. Please remind your classes.', 2850)
  await say('accounts@stthomas.test', wholeStaff, 'Salary for October has been credited. Payslips are in My workspace.', 1500)
  await say(ADMIN.email, wholeStaff, 'Winter timings start on 1 December: 8:30 am to 2:30 pm. The bus timings will be shared separately.', 300)
  await say('teacher@stthomas.test', dept('Mathematics'), 'Sharing the Class 5 worksheet on fractions in the library folder — feel free to use it.', 1400)
  await say('neha@stthomas.test', dept('Mathematics'), 'Thanks Sunita ji! I’ll use it for the Class 6 revision too.', 1380)
  await say('amit@stthomas.test', dept('Science'), 'Physics lab needs new meter bridges before the practicals. I’ve raised a store request.', 900)
  await say('seema@stthomas.test', dept('Science'), 'Test tubes for chemistry are on order as well — the PO is waiting for approval.', 880)
  await say('pradeep@stthomas.test', dept('Languages'), 'हिंदी दिवस की प्रतियोगिता के प्रमाणपत्र तैयार हैं, कृपया कार्यालय से ले लें।', 2000)
  // direct messages
  const dm = async (from, to, text, minutesAgo) => {
    const me = await as(from)
    const m = await me.post(`/comms/chat/direct/${idOf(to)}/messages`, { text, clientId: `demo-${hash(from, to, text)}` }, { ok: [200, 201], quiet: [400, 403, 404, 409] })
    if (m) posted.push([m.id, m.channelId, minutesAgo])
  }
  await dm('principal.cbse@stthomas.test', 'teacher@stthomas.test', 'Sunita, can you take the Class 5 assembly on Friday?', 700)
  await dm('teacher@stthomas.test', 'principal.cbse@stthomas.test', 'Yes Father, we’ll do a short skit on cleanliness.', 690)
  await dm('frontdesk@stthomas.test', 'accounts@stthomas.test', 'A parent is at the counter for a duplicate fee receipt — Class 4 (CBSE).', 120)
  await dm('accounts@stthomas.test', 'frontdesk@stthomas.test', 'Send them over, I’ll print it.', 118)
  // date the messages over the last two days (the API stamps them now)
  const { StaffChatMessage, StaffChatChannel } = await import('../models/comms.js')
  const latest = new Map()
  for (const [id, channelId, minutesAgo] of posted) {
    const at = new Date(Date.now() - minutesAgo * 60000)
    await StaffChatMessage.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: at, updatedAt: at } })
    if (!latest.has(channelId) || latest.get(channelId) < at) latest.set(channelId, at)
  }
  for (const [channelId, at] of latest) await StaffChatChannel?.collection.updateOne({ _id: new mongoose.Types.ObjectId(channelId) }, { $set: { lastMessageAt: at, 'lastMessage.at': at } })
  return `${posted.length} messages (Whole staff, Mathematics, Science, Languages and 2 direct chats)`
}

async function fillCalls(admin) {
  const done = await admin.get('/comms/paging/calls', { status: 'CLOSED' })
  if ((done.rows ?? done).length) return 'already there'
  const users = (await admin.get('/core/users', { pageSize: 100 }))
  const idOf = (email) => (users.data ?? users).find((u) => u.email === email)?.id
  const calls = [
    ['principal.up@stthomas.test', 'amit@stthomas.test', 'Please come to my office after this period — UP Board practical schedule.', 'Principal’s office (Block B)', 'ACK', 2600],
    ['frontdesk@stthomas.test', 'principal.cbse@stthomas.test', 'A parent is waiting at reception about a TC.', 'Reception', 'BUSY', 1700],
    ['teacher@stthomas.test', 'frontdesk@stthomas.test', 'A Class 5 child is unwell — please call the parents.', 'Room A-105', 'ACK', 1450],
    ['principal.cbse@stthomas.test', 'accounts@stthomas.test', 'Please bring the October fee collection summary.', 'Principal’s office (Block A)', 'ACK', 260],
  ]
  const made = []
  for (const [from, to, message, room, answer, minutesAgo] of calls) {
    const caller = await as(from)
    const c = await caller.post('/comms/paging/calls', { target: { type: 'USER', ids: [idOf(to)] }, priority: 'ROUTINE', message, location: { room } }, { ok: [201], quiet: [400, 403, 409] })
    if (!c) continue
    const callee = await as(to)
    await callee.post(`/comms/paging/calls/${c.id}/respond`, answer === 'ACK' ? { action: 'ACK', etaMinutes: 5 } : { action: 'BUSY', reason: 'In a meeting with a parent' }, { ok: [200, 201], quiet: [400, 403, 409] })
    await caller.post(`/comms/paging/calls/${c.id}/close`, { note: 'Done' }, { ok: [200, 201], quiet: [400, 403, 409] })
    made.push([c.id, minutesAgo])
  }
  // date them over the last two days
  const { PageCall } = await import('../models/comms.js')
  for (const [id, minutesAgo] of made) {
    const at = new Date(Date.now() - minutesAgo * 60000)
    const doc = await PageCall.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })
    const shift = (d) => (d ? new Date(new Date(d).getTime() - (Date.now() - at.getTime())) : d)
    await PageCall.collection.updateOne({ _id: doc._id }, { $set: {
      createdAt: at, updatedAt: shift(doc.updatedAt), firstAckAt: shift(doc.firstAckAt), 'closed.at': shift(doc.closed?.at),
      recipients: (doc.recipients ?? []).map((r) => ({ ...r, firstRungAt: shift(r.firstRungAt), lastRungAt: shift(r.lastRungAt), respondedAt: shift(r.respondedAt) })),
    } })
  }
  return `${made.length} past calls (answered, busy), closed`
}

// ───────────────────────────────────────────────────────── parent–teacher chat

async function fillParentChat(admin) {
  const teacher = await as('teacher@stthomas.test')
  const mine = await teacher.get('/communication/chat')
  if ((mine.rows ?? mine.data ?? mine).length) return 'already there'
  const threads = [
    ['teacher@stthomas.test', 'C5', 'Namaste. Your child has not submitted the maths notebook for two days. Please check it at home.', 'Sorry ma’am, he was unwell. He will bring it tomorrow.', 'Thank you. Hope he feels better.'],
    ['neha@stthomas.test', 'C8', 'Good news — your daughter scored the highest in the Class 8 periodic test in maths!', 'Thank you so much ma’am, she worked hard. Any books you suggest for practice?', 'R. S. Aggarwal for extra questions; I’ll also share worksheets in the app.'],
  ]
  let n = 0
  for (const [email, code, open, reply, back] of threads) {
    const kid = firstOf(code)
    if (!kid) continue
    const t = await as(email)
    const conv = await t.post('/communication/chat/start', { studentId: kid.id, text: open }, { ok: [200, 201], quiet: [400, 403, 409] })
    if (!conv) continue
    try {
      const fam = await familySignIn(await primaryMobile(admin, kid.id))
      await fam.post(`/students/${kid.id}/chat`, { staffUserId: conv.staffUserId, text: reply })
    } catch (e) { log(`parent chat: ${e.message}`) }
    await t.post(`/communication/chat/${conv.id}/reply`, { text: back }, { ok: [200, 201], quiet: [400, 403, 409] })
    n++
  }
  return `${n} parent–teacher conversations (teacher, family, teacher)`
}

// ───────────────────────────────────────────────────────── alumni

async function fillAlumni(admin) {
  const r = await admin.getRaw('/alumni/directory', {})
  if (r.body?.total || r.body?.data?.length) return 'already there'
  const ALUMNI = [
    ['Abhishek Srivastava', 2012, 'Class 12 Science (UP Board)', 'MALE', 'Bengaluru', 'Infosys', 'Senior engineer'],
    ['Priya Mishra', 2014, 'Class 12 Science (UP Board)', 'FEMALE', 'Lucknow', 'King George’s Medical University', 'Resident doctor'],
    ['Saurabh Yadav', 2016, 'Class 12 Science (UP Board)', 'MALE', 'Prayagraj', 'Allahabad High Court', 'Advocate'],
    ['Nidhi Agarwal', 2018, 'Class 12 Science (UP Board)', 'FEMALE', 'Delhi', 'Deloitte', 'Analyst'],
    ['Mohd. Faizan', 2019, 'Class 10 (UP Board)', 'MALE', 'Lucknow', 'Indian Army', 'Lance Naik'],
    ['Shivangi Tripathi', 2021, 'Class 12 Science (UP Board)', 'FEMALE', 'Kanpur', 'IIT Kanpur', 'B.Tech student'],
  ]
  for (const [i, [name, batch, program, gender, city, organisation, designation]] of ALUMNI.entries()) {
    await admin.post('/alumni/directory', { name, batch, program, gender, city, country: 'India', organisation, designation, mobile: `98390${String(10000 + i * 731).padStart(5, '0')}`, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, consent: i % 3 !== 2 })
  }
  // the student who left with a TC this year joins as a leaver
  const leavers = await admin.get('/alumni/directory/leavers').catch(() => null)
  const year = leavers?.years?.find((y) => y.leavers > y.imported)?.year
  const imp = year ? await admin.post('/alumni/directory/import-leavers', { year }, { ok: [200, 201], quiet: [400, 409] }) : null
  return `${ALUMNI.length} alumni${imp?.added ? ` + ${imp.added} leaver from ${year}` : ''}`
}

// ───────────────────────────────────────────────────────── run

async function main() {
  const dbName = String(config.mongoUrl).split('?')[0].split('/').pop() || ''
  if (config.isProd || /prod/i.test(dbName)) throw new Error(`Refusing to fill "${dbName}": this looks like production.`)
  await connectDb(config.mongoUrl)
  tenant = await Tenant.findOne({ slug: SLUG }).lean()
  if (!tenant) throw new Error('St. Thomas School isn’t in this database. Run `npm run seed` first.')
  app = createApp()
  today = (await runAsTenant(tenant._id, () => institutionNow())).date
  const admin = await signIn(ADMIN.email, ADMIN.password)
  lookup = await admin.get('/academics/lookup')
  console.log(`Filling ${tenant.name} (today ${today}, ${lookup.sections.length} classes)`)
  await admin.patch('/core/settings/modules/portal', { enabled: true }).catch(() => {})
  await loadBranches(admin)
  if (FRESH_CONTENT) await step('Clear every syllabus and all topic content', () => clearContentAndSyllabus())
  await step('Letterhead', () => fillLetterhead(admin))
  await step('Students', () => fillStudents(admin))
  await step('Staff & HR', () => fillStaff(admin))
  await step('Teachers and subject allocation', () => fillTeachers(admin))
  await step('Staff attendance and leave', () => fillStaffAttendance(admin))
  await step('Leave waiting for approval', () => pendingLeave())
  await step('Payroll', () => fillPayroll(admin))
  await step('Expenses', () => fillExpenses(admin))
  await step('Transport', () => fillTransport(admin))
  await step('Library', () => fillLibrary(admin))
  await step('Library returns and fines', () => libraryReturns(admin))
  await step('Rooms', () => fillRooms(admin))
  await step('Timetable', () => fillTimetable(admin))
  await step('Student attendance', () => fillAttendance(admin))
  await step('Fees', () => fillFees(admin))
  await step('Fee counter: today, refund, day-end', () => fillFeeCounter(admin))
  await step('Exams and results', () => fillExams(admin))
  await step('Courses, question bank, online tests', () => fillLms(admin))
  await step('Question papers', () => fillQuestionPapers(admin))
  await step('Homework', () => fillHomework(admin))
  await step('Syllabus and lesson plans', () => fillLessonPlans(admin))
  await step('Syllabus for the junior classes', () => fillPrimarySyllabus(admin))
  await step('Teaching planner (topic material, revision, extra class)', () => fillTeachingPlanner(admin))
  await step('Teaching material on every syllabus topic', () => fillAllTopicMaterial(admin))
  await step('Subject hub (lesson content, published)', () => fillSubjectHub(admin))
  await step('Admissions 2027-28', () => fillAdmissions(admin))
  await step('Notices', () => fillNotices(admin))
  await step('Events, meetings, gallery', () => fillEvents(admin))
  await step('Certificates', () => fillCertificates(admin))
  await step('Front office', () => fillFrontOffice(admin))
  await step('Hostel', () => fillHostel(admin))
  await step('Canteen', () => fillCanteen(admin))
  await step('Store & assets', () => fillInventory(admin))
  await step('Health', () => fillHealth(admin))
  await step('Survey', () => fillSurvey(admin))
  await step('Website', () => fillWebsite(admin))
  await step('Staff chat', () => fillStaffChat(admin))
  await step('Call bell', () => fillCalls(admin))
  await step('Parent–teacher chat', () => fillParentChat(admin))
  await step('Transfer certificate', () => fillTc(admin))
  await step('Alumni', () => fillAlumni(admin))
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
