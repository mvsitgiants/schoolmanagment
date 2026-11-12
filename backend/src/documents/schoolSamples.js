// Made-up records for the template editor's preview of the everyday school documents (fee receipt and challan, report
// cards, hall ticket, TC, certificates, admission form, ID cards, payslip, label sheets, exam seating, question paper),
// used only while the institution has none of that record yet. Wherever the document has a model function, the sample
// is a made-up raw record passed through that same function (registry.js DOCS[…].model), so it is exactly what its
// template sees. One family throughout: Aarav Sharma, son of Rajesh Sharma, Class 8 – A of a Lucknow school, 2026-27.
// samples.js picks them up.
import { DOCS } from './registry.js'

const day = (offset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10) }
const model = (docType, raw) => DOCS[docType].model(raw)

const YEAR = '2026-27'
const PLACE = { label: 'Class 8 – A', className: 'Class 8', section: 'A' }
const AARAV = {
  _id: 's1', firstName: 'Aarav', lastName: 'Sharma', admissionNo: '20210118', rollNo: '7', gender: 'MALE', dob: '2013-05-10',
  guardians: [{ relation: 'FATHER', name: 'Rajesh Sharma', isPrimary: true, occupation: 'Bank officer', mobile: '+91 94150 23456', email: 'rajesh.sharma@example.in' }, { relation: 'MOTHER', name: 'Sunita Sharma', occupation: 'Teacher', mobile: '+91 94150 65432' }],
}
const AARAV_NAME = 'Aarav Sharma'

// ── the institution's details as the ID cards print them (the real profile when there is one)
const cardInstitution = (inst = {}) => ({
  name: inst.name || 'Green Valley Public School', logoUrl: inst.logoUrl || null, color: inst.primaryColor || null,
  address: [inst.addressLine, inst.city, [inst.state, inst.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '12, Vikas Nagar, Lucknow, Uttar Pradesh 226022',
  phone: inst.phone || '+91 522 400 1234', email: inst.email || 'office@greenvalley.example.in', website: inst.website || null,
})

// ── fees: the term's two invoices, the receipt paid against them
const INVOICES = [
  {
    _id: 'inv1', invoiceNo: 'INV2627000231', installment: 'Term 2 (Oct–Dec)', dueDate: day(-5), gross: 2450000, concession: 0, lateFee: 0, net: 2450000, paid: 2450000, balance: 0, status: 'PAID',
    lines: [{ name: 'Tuition fee', amount: 1800000, concession: 0 }, { name: 'Computer lab fee', amount: 250000, concession: 0 }, { name: 'Activity fee', amount: 150000, concession: 0 }, { name: 'Transport fee (Gomti Nagar route)', amount: 250000, concession: 0 }],
  },
]

const feeReceipt = () => model('FEE_RECEIPT', {
  payment: {
    receiptNo: 'RC2627000418', date: day(-2), at: new Date(), mode: 'UPI', reference: '431278905512', amount: 2450000, verifyCode: 'R7KQ2M9X', collectedBy: 'Neha Verma (Accounts)',
    status: 'PAID', refunded: 0, note: '', allocations: [{ invoiceId: 'inv1', amount: 2450000 }],
  },
  student: AARAV, place: PLACE, invoices: INVOICES, balance: 0, year: YEAR,
})

const feeInvoice = () => model('FEE_INVOICE', {
  invoice: {
    invoiceNo: 'INV2627000312', installment: 'Term 3 (Jan–Mar)', dueDate: day(20), createdAt: day(-1), status: 'UNPAID',
    gross: 2450000, concession: 180000, lateFee: 0, net: 2270000, paid: 0, balance: 2270000,
    lines: [{ name: 'Tuition fee', amount: 1800000, concession: 180000 }, { name: 'Computer lab fee', amount: 250000, concession: 0 }, { name: 'Activity fee', amount: 150000, concession: 0 }, { name: 'Transport fee (Gomti Nagar route)', amount: 250000, concession: 0 }],
  },
  student: AARAV, place: PLACE, year: YEAR, today: day(), lateFeeDue: 0, lateFee: { perDay: 1000, graceDays: 7 },
  upiId: 'greenvalley@sbi', bank: { name: 'Green Valley Public School', bankName: 'State Bank of India', branch: 'Vikas Nagar, Lucknow', ifsc: 'SBIN0012345', last4: '4821' }, arrears: 0,
})

// ── exams: the half-yearly with seven subjects, the CBSE eight-point grade scale
const BANDS = [
  ['A1', 91, 100, 'Outstanding'], ['A2', 81, 90.99, 'Excellent'], ['B1', 71, 80.99, 'Very good'], ['B2', 61, 70.99, 'Good'],
  ['C1', 51, 60.99, 'Fair'], ['C2', 41, 50.99, 'Satisfactory'], ['D', 33, 40.99, 'Pass'], ['E', 0, 32.99, 'Needs improvement'],
].map(([grade, min, max, remark]) => ({ grade, min, max, remark }))
const SUBJECTS = [['English', 'ENG', 84], ['Hindi', 'HIN', 78], ['Sanskrit', 'SKT', 88], ['Mathematics', 'MAT', 92], ['Science', 'SCI', 81], ['Social Science', 'SST', 76], ['Computer Science', 'CSC', 95]]
const ACTIVITIES = [['Work education', 'A'], ['Art education', 'B'], ['Health & physical education', 'A'], ['Discipline', 'A']]
const EXAM = { name: 'Half-yearly examination', term: 'Term 1', status: 'PUBLISHED', publishedAt: day(-10), startDate: day(-40), endDate: day(-30), instructions: 'Reach the school by 8:30 am.\nBring this hall ticket to every paper.\nNo calculators or phones in the exam hall.' }
const CANDIDATE = { verifyCode: 'E4HX7N2Q', rollNo: '7' }

function reportCard() {
  const papers = [
    ...SUBJECTS.map(([subject, code], i) => ({ id: `p${i}`, subject, subjectCode: code, maxMarks: 100, passMarks: 33, gradeOnly: false })),
    ...ACTIVITIES.map(([subject], i) => ({ id: `a${i}`, subject, gradeOnly: true })),
  ]
  const entry = new Map([...SUBJECTS.map(([, , marks], i) => [`p${i}`, { marks }]), ...ACTIVITIES.map(([, grade], i) => [`a${i}`, { grade }])])
  const total = SUBJECTS.reduce((n, s) => n + s[2], 0)
  return model('REPORT_CARD', {
    candidate: { ...CANDIDATE, total, max: 700, pct: Math.round((total / 700) * 10000) / 100, grade: 'A2', rank: 4, result: 'PASS', failedSubjects: [], remark: 'Aarav is attentive and thorough. A little more reading in Social Science will lift his scores further.', remarkBy: 'Mrs. Kavita Srivastava' },
    exam: EXAM, year: { name: YEAR }, student: AARAV, place: PLACE.label, papers, entry, bands: { name: 'CBSE eight-point scale', bands: BANDS },
    attendance: { P: 98, L: 2, HD: 2, total: 104, pct: 97.12 }, showRank: true, examType: { name: 'Half-yearly', code: 'HY' }, classTeacher: 'Mrs. Kavita Srivastava',
  })
}

function yearReportCard() {
  const rows = [{ code: 'PT', name: 'Periodic tests', share: 20, exams: [{ name: 'Periodic Test 1' }, { name: 'Periodic Test 2' }] }, { code: 'HY', name: 'Half-yearly', share: 30, exams: [{ name: 'Half-yearly examination' }] }, { code: 'AN', name: 'Annual', share: 50, exams: [{ name: 'Annual examination' }] }]
  const gradeOf = (pct) => BANDS.find((b) => pct >= b.min && pct <= b.max + 0.01)?.grade ?? null
  const subjects = SUBJECTS.map(([subject, , hy]) => {
    const parts = [{ code: 'PT', pct: Math.min(100, hy + 3) }, { code: 'HY', pct: hy }, { code: 'AN', pct: Math.min(100, hy + 2) }]
    const pct = Math.round(parts.reduce((n, p, i) => n + (p.pct * rows[i].share) / 100, 0) * 100) / 100
    return { subject, parts, pct, grade: gradeOf(pct), pass: true }
  })
  const pct = Math.round((subjects.reduce((n, s) => n + s.pct, 0) / subjects.length) * 100) / 100
  return model('YEAR_REPORT_CARD', {
    year: { name: YEAR }, status: 'PUBLISHED', publishedAt: day(-3), student: AARAV, place: PLACE.label, sectionSize: 38,
    plan: { rows }, bands: BANDS,
    row: { subjects, pct, grade: gradeOf(pct), rank: 4, result: 'PASS', failed: [] },
    rules: { passPct: 33, compartmentMax: 2, combine: 'WEIGHTED' },
    attendance: { P: 196, L: 4, HD: 2, total: 206, pct: 97.57 },
    remark: 'A steady, hard-working year. Aarav is promoted to Class 9 with distinction in Mathematics and Computer Science.', remarkBy: 'Mrs. Kavita Srivastava',
    extras: { coExams: ['Half-yearly examination', 'Annual examination'], coRows: ACTIVITIES.map(([subject, grade]) => ({ subject, grades: [{ grade }, { grade }] })), nextClass: 'Class 9', classTeacher: 'Mrs. Kavita Srivastava' },
  })
}

const hallTicket = () => model('HALL_TICKET', {
  candidate: CANDIDATE, exam: { ...EXAM, name: 'Annual examination', term: 'Term 2', startDate: day(10), endDate: day(19) }, year: { name: YEAR }, student: AARAV, place: PLACE.label, classTeacher: 'Mrs. Kavita Srivastava',
  papers: [
    ...SUBJECTS.map(([subject, code], i) => ({ subject, subjectCode: code, date: day(10 + i + (i > 3 ? 2 : 0)), startTime: '09:00', endTime: '12:00', maxMarks: 80, gradeOnly: false, seat: { room: 'Room 204', seat: 'B-07' } })),
    { subject: 'Work education', date: day(20), startTime: '09:00', endTime: '10:00', gradeOnly: true },
  ],
})

const transferCertificate = () => model('TRANSFER_CERTIFICATE', {
  tc: {
    tcNo: 'TC2627000014', status: 'ISSUED', verifyCode: 'T9PL4KX2', issuedAt: day(), issuedBy: 'Dr. Anjali Mishra (Principal)', leavingDate: day(-1), reason: 'RELOCATION', reasonText: 'Father transferred to Pune',
    conduct: 'Good', lastClassLabel: 'Class 8 – A', promotedTo: 'Class 9', feesPaidUpTo: 'December 2026', remarks: '', bookNo: '3', applicationDate: day(-6),
    lastExam: 'Half-yearly examination, 2026-27', lastExamResult: 'Passed', failed: 'NO', subjects: SUBJECTS.map((s) => s[0]), concession: 'No',
    workingDays: 104, presentDays: 101, nccScoutGuide: 'Scouts', games: 'Cricket, chess',
    // what the TC states is copied onto it when issued
    snapshot: {
      name: AARAV_NAME, admissionNo: AARAV.admissionNo, dob: AARAV.dob, gender: 'MALE', nationality: 'Indian', category: 'GENERAL', religion: 'Hindu',
      admissionDate: '2021-04-05', firstClass: 'Class 3', father: 'Rajesh Sharma', mother: 'Sunita Sharma', guardian: null, apaarId: '512843079621', pen: '21090812345',
    },
  },
  student: { language: 'en' },
})

const certificate = () => model('CERTIFICATE', {
  certificate: {
    certificateNo: 'BC2627000027', kind: 'BONAFIDE', issueDate: day(), purpose: 'Opening a savings account at State Bank of India', remarks: '', status: 'ISSUED', issuedBy: 'Dr. Anjali Mishra (Principal)', prints: 0, verifyCode: 'C3VN8RW5',
    snapshot: { name: AARAV_NAME, firstName: 'Aarav', gender: 'MALE', admissionNo: AARAV.admissionNo, dob: AARAV.dob, rollNo: '7', father: 'Rajesh Sharma', mother: 'Sunita Sharma', admissionDate: '2021-04-05', status: 'ACTIVE', class: PLACE.label, yearName: YEAR, language: 'en' },
  },
  verifyUrl: null,
})

const admissionForm = () => model('ADMISSION_FORM', {
  student: {
    ...AARAV, middleName: '', admissionDate: '2021-04-05', bloodGroup: 'B+', nationality: 'Indian', religion: 'Hindu', category: 'GENERAL', motherTongue: 'Hindi',
    aadhaarLast4: '4417', apaarId: '512843079621', pen: '21090812345', mobile: '', email: '', photo: null, medical: { allergies: 'Peanuts', conditions: '' }, language: 'en',
    address: { line: 'B-14, Sector 21, Indira Nagar', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226016' },
    previousSchool: { name: 'Little Flowers Nursery School, Lucknow', board: 'State board', lastClass: 'UKG', tcNo: 'LF/2021/088' },
  },
  place: PLACE, admittedTo: 'Class 3', admittedYear: '2021-22',
  siblings: [{ name: 'Anaya Sharma', admissionNo: '20240203', class: 'Class 3 – B' }],
})

const studentIdCards = (institution) => model('STUDENT_ID_CARD', {
  institution: cardInstitution(institution), settings: {}, today: day(), validUntil: '2027-03-31', yearName: YEAR,
  students: [
    { id: 's1', status: 'ACTIVE', name: AARAV_NAME, admissionNo: AARAV.admissionNo, class: PLACE.label, rollNo: '7', dob: AARAV.dob, bloodGroup: 'B+', guardian: 'Rajesh Sharma', guardianRelation: 'Father', guardianPhone: '+91 94150 23456', address: 'B-14, Sector 21, Indira Nagar, Lucknow 226016', photo: null, cardCode: 'K7Q2M9XA' },
    { id: 's2', status: 'ACTIVE', name: 'Ishita Verma', admissionNo: '20210124', class: PLACE.label, rollNo: '12', dob: '2013-08-22', bloodGroup: 'O+', guardian: 'Alok Verma', guardianRelation: 'Father', guardianPhone: '+91 98390 11223', address: '7/112, Vikas Nagar, Lucknow 226022', photo: null, cardCode: 'P2WX8ND4' },
    { id: 's3', status: 'ACTIVE', name: 'Mohammad Faiz Khan', admissionNo: '20220311', class: PLACE.label, rollNo: '18', dob: '2013-02-03', bloodGroup: 'A+', guardian: 'Shabana Khan', guardianRelation: 'Mother', guardianPhone: '+91 99350 44781', address: '22, Aminabad, Lucknow 226018', photo: null, cardCode: 'M5RT3HJ9' },
  ],
})

const staffIdCards = (institution) => model('STAFF_ID_CARD', {
  institution: cardInstitution(institution), settings: {}, today: day(), validUntil: '2027-03-31', yearName: YEAR,
  staff: [
    { id: 'e1', code: 'EMP0042', name: 'Kavita Srivastava', designation: 'TGT — English', department: 'Middle school', bloodGroup: 'A+', mobile: '+91 94152 33410', status: 'ACTIVE', photo: null, emergency: { name: 'Amit Srivastava', relation: 'Husband', phone: '+91 94152 33411' } },
    { id: 'e2', code: 'EMP0057', name: 'Rohit Tiwari', designation: 'PGT — Mathematics', department: 'Senior secondary', bloodGroup: 'B+', mobile: '+91 98380 77120', status: 'ACTIVE', photo: null, emergency: { name: 'Meera Tiwari', relation: 'Wife', phone: '+91 98380 77121' } },
    { id: 'e3', code: 'EMP0103', name: 'Neha Verma', designation: 'Accountant', department: 'Accounts', bloodGroup: 'O+', mobile: '+91 99190 45512', status: 'ACTIVE', photo: null, emergency: { name: 'Suresh Verma', relation: 'Father', phone: '+91 99190 45513' } },
  ],
})

function payslip(institution) {
  const earnings = [['BASIC', 'Basic pay', 3800000], ['DA', 'Dearness allowance', 760000], ['HRA', 'House rent allowance', 1140000], ['CONV', 'Conveyance allowance', 160000]].map(([code, label, amount]) => ({ code, label, amount }))
  const deductions = [['PF', 'Provident fund', 180000], ['PT', 'Professional tax', 20000], ['TDS', 'Income tax (TDS)', 125000]].map(([code, label, amount]) => ({ code, label, amount }))
  const gross = earnings.reduce((n, x) => n + x.amount, 0)
  const less = deductions.reduce((n, x) => n + x.amount, 0)
  const month = day(-30).slice(0, 7)
  return model('PAYSLIP', {
    institution,
    payslip: {
      payslipNo: `PS${month.replace('-', '')}0042`, month, runNo: `PR${month.replace('-', '')}01`, status: 'PAID', paid: { date: day(-5), mode: 'BANK', reference: 'NEFT 26103145872' },
      employee: { name: 'Kavita Srivastava', code: 'EMP0042', designation: 'TGT — English', departmentName: 'Middle school', branchName: null, joiningDate: '2018-07-02', pan: '4521F', uan: '1045', esi: null, accountLast4: '7781', bankName: 'State Bank of India', paymentMode: 'BANK' },
      structureName: 'Teaching staff (7th CPC)',
      attendance: { daysInMonth: 31, baseDays: 31, payDays: 30, lop: 1, present: 27, leave: 3 },
      earnings, deductions, employer: [{ label: 'Employer PF', amount: 180000 }], loans: [],
      gross, totalDeductions: less, net: gross - less, employerCost: gross + 180000,
      ytd: { gross: gross * 7, pf: 180000 * 7, esi: 0, pt: 20000 * 7, tds: 125000 * 7, net: (gross - less) * 7 },
    },
  })
}

const libraryLabels = () => model('LIBRARY_LABEL', {
  labels: [
    { accessionNo: 'ACC004512', title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', callNo: '920 KAL', shelf: 'B-3' },
    { accessionNo: 'ACC004513', title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', callNo: '920 KAL', shelf: 'B-3' },
    { accessionNo: 'ACC004530', title: 'The Discovery of India', author: 'Jawaharlal Nehru', callNo: '954 NEH', shelf: 'C-1' },
  ],
})

const seatLabels = () => model('SEAT_LABEL', {
  labels: [
    { seat: 'A1', row: 1, bench: 1, section: '8-A', sectionLabel: PLACE.label, room: 'Room 204', classTeacher: 'Mrs. Kavita Srivastava', name: 'Aadya Gupta', rollNo: '1', admissionNo: '20210101', gender: 'FEMALE', free: false },
    { seat: 'A2', row: 1, bench: 1, section: '8-A', sectionLabel: PLACE.label, room: 'Room 204', classTeacher: 'Mrs. Kavita Srivastava', name: AARAV_NAME, rollNo: '7', admissionNo: AARAV.admissionNo, gender: 'MALE', free: false },
    { seat: 'A3', row: 1, bench: 2, section: '8-A', sectionLabel: PLACE.label, room: 'Room 204', classTeacher: 'Mrs. Kavita Srivastava', name: '', rollNo: '', admissionNo: '', gender: null, free: true },
  ],
})

// ── exam seating: one session of the annual exam, Class 8 – A and 8 – B sharing two rooms
function seating(institution, withDrawing = true) {
  // a room as an exam centre fills it: 3 columns of 3-seat benches, 10 benches deep, the middle seat of the first and
  // last column and the outer seats of the middle column left empty so no two from one class sit side by side
  const FILL = [[0, 2], [1], [0, 2]] // seats used in each column
  const room = (name, code, first, invigilators) => {
    const rows = Array.from({ length: 10 }, () => ({ benches: [0, 1, 2].map(() => ({ seats: [] })) }))
    let roll = first
    const last = first + 41
    FILL.forEach((used, c) => used.forEach((k) => rows.forEach((row, r) => {
      if (roll > last) return
      const section = roll % 2 ? '10-A' : '10-B'
      row.benches[c].seats[k] = { label: `${String.fromCharCode(65 + c)}${r + 1}-${k + 1}`, name: section === '10-A' ? AARAV_NAME : 'Ishita Verma', rollNo: String(roll++), section, tone: section === '10-A' ? 0 : 1 }
    })))
    for (const row of rows) for (const [c, bench] of row.benches.entries()) for (const k of [0, 1, 2]) bench.seats[k] ??= { label: `${String.fromCharCode(65 + c)}-${k + 1}`, empty: true }
    return {
      name, code, students: last - first + 1, invigilators, columns: 3, perBench: 3, compact: true,
      runs: [{ section: 'Class 10 – A', from: String(first), to: String(last), count: 21 }, { section: 'Class 10 – B', from: String(first + 1), to: String(last - 1), count: 21 }],
      ...(withDrawing ? { rows } : {}),
    }
  }
  return {
    institution, exam: { id: 'x1', name: 'Annual examination 2026-27' }, session: { key: 'k1', date: day(10), startTime: '09:00', endTime: '12:00' }, status: 'PUBLISHED',
    classes: [{ id: 'c1', name: 'Class 10 – A', code: '10-A', students: 38, subject: 'Mathematics', n: 0 }, { id: 'c2', name: 'Class 10 – B', code: '10-B', students: 36, subject: 'Mathematics', n: 1 }],
    rooms: [room('Room 5', 'R5', 209, ['Kavita Srivastava', 'Rohit Tiwari']), room('Room 6', 'R6', 251, ['Pooja Saxena'])],
  }
}

const duty = (institution) => model('INVIGILATION_DUTY', {
  institution, exam: { id: 'x1', name: 'Annual examination 2026-27' },
  sessions: [0, 1, 2].map((i) => ({ date: day(10 + i), startTime: '09:00', endTime: '12:00', status: 'PUBLISHED', rooms: [{ room: 'R204', students: 40, invigilators: i % 2 ? 'Rohit Tiwari, Pooja Saxena' : 'Kavita Srivastava, Rohit Tiwari' }, { room: 'R205', students: 34, invigilators: i % 2 ? 'Kavita Srivastava' : 'Pooja Saxena' }] })),
  teachers: [{ name: 'Rohit Tiwari', designation: 'PGT — Mathematics', duties: 3 }, { name: 'Kavita Srivastava', designation: 'TGT — English', duties: 3 }, { name: 'Pooja Saxena', designation: 'TGT — Science', duties: 3 }],
})

// ── a short Class 8 science paper: MCQs, true / false, and a long answer with an OR choice
function questionPaperRaw() {
  const mcq = (text, options, right, chapter) => ({ type: 'MCQ', text, options: options.map((o, i) => ({ text: o, correct: i === right })), chapter, difficulty: 'EASY', explanation: '1 mark for the right option.' })
  const paper = {
    durationMin: 120, maxMarks: 40, setCount: 1, status: 'APPROVED', setterName: 'Pooja Saxena', approvedBy: 'Dr. Anjali Mishra', approvedAt: day(-4),
    instructions: 'All questions are compulsory unless a choice is given.\nWrite neatly; draw diagrams with a pencil.',
    sections: [
      { id: 'A', title: 'Section A — Multiple choice', instructions: 'Choose the right option.', type: 'MCQ', count: 3, marks: 1 },
      { id: 'B', title: 'Section B — True or false', instructions: '', type: 'TRUE_FALSE', count: 2, marks: 1 },
      { id: 'C', title: 'Section C — Long answer', instructions: 'Attempt any one.', type: 'LONG', count: 2, marks: 5, attempt: 1, choice: true },
    ],
  }
  const tf = (text, yes, chapter) => ({ type: 'TRUE_FALSE', text, options: [{ text: 'True', correct: yes }, { text: 'False', correct: !yes }], chapter, difficulty: 'EASY', explanation: '' })
  const set = {
    letter: 'A',
    sections: [
      { sectionId: 'A', items: [mcq('Which part of the cell controls its activities?', ['Cell wall', 'Nucleus', 'Cytoplasm', 'Vacuole'], 1, 'Cell — structure and functions'), mcq('The SI unit of force is', ['Joule', 'Watt', 'Newton', 'Pascal'], 2, 'Force and pressure'), mcq('Which fibre is obtained from petroleum?', ['Cotton', 'Wool', 'Nylon', 'Jute'], 2, 'Synthetic fibres and plastics')] },
      { sectionId: 'B', items: [tf('Sound can travel through a vacuum.', false, 'Sound'), tf('Coal and petroleum are exhaustible natural resources.', true, 'Coal and petroleum')] },
      {
        sectionId: 'C',
        items: [
          { type: 'LONG', text: 'Explain how friction is both a friend and a foe, with two examples of each.', answers: ['Friend: lets us walk and write; foe: wears out shoe soles and machine parts.'], chapter: 'Friction', difficulty: 'MEDIUM', explanation: '1 mark for the idea, 1 mark for each example.', or: { type: 'LONG', text: 'Describe how a lightning conductor protects a building.', answers: ['A metal rod above the building carries the charge safely to the earth.'], chapter: 'Some natural phenomena', explanation: '2 marks for the diagram, 3 for the explanation.' } },
          { type: 'LONG', text: 'What is combustion? Name the three things needed for it.', answers: ['Burning of a substance in oxygen giving heat and light; fuel, air (oxygen), ignition temperature.'], chapter: 'Combustion and flame', difficulty: 'MEDIUM', explanation: '2 marks for the definition, 1 for each condition.' },
        ],
      },
    ],
  }
  return { paper, set, exam: { name: 'Annual examination', term: 'Term 2' }, year: { name: YEAR }, cls: { name: 'Class 8' }, subject: { name: 'Science', code: 'SCI' }, examPaper: { date: day(12), startTime: '09:00', endTime: '11:00' } }
}

export const SCHOOL_SAMPLES = {
  FEE_RECEIPT: feeReceipt,
  FEE_INVOICE: feeInvoice,
  REPORT_CARD: reportCard,
  YEAR_REPORT_CARD: yearReportCard,
  HALL_TICKET: hallTicket,
  TRANSFER_CERTIFICATE: transferCertificate,
  CERTIFICATE: certificate,
  ADMISSION_FORM: admissionForm,
  STUDENT_ID_CARD: studentIdCards,
  STAFF_ID_CARD: staffIdCards,
  PAYSLIP: payslip,
  LIBRARY_LABEL: libraryLabels,
  SEAT_LABEL: seatLabels,
  EXAM_SEATING_CHART: (institution) => model('EXAM_SEATING_CHART', seating(institution)),
  EXAM_DOOR_LIST: (institution) => model('EXAM_DOOR_LIST', seating(institution, false)),
  INVIGILATION_DUTY: duty,
  QUESTION_PAPER: () => model('QUESTION_PAPER', questionPaperRaw()),
  ANSWER_KEY: () => model('ANSWER_KEY', questionPaperRaw()),
}
