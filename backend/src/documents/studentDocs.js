// Student documents beyond the TC and the ID card: the admission form (ADMISSION_FORM), printed from a student's
// record — the standard Indian school admission form filled with what the office entered, with blank lines for the
// rest (qualification, income, signatures) and an "office use" box. Data from services/students.js admissionFormData.
import { GENDERS, PHOTO_DATA_URL, formatINR } from '@schoolgiant/shared'
import { Student, studentName } from '../models/students.js'
import { admissionFormData, noDuesSlipData } from '../services/students.js'
import { CATEGORY_LABEL_OF, dateInWords } from './words.js'

const parentOf = (s, rel) => {
  const g = s.guardians?.find((x) => x.relation === rel)
  return g ? { name: g.name, occupation: g.occupation ?? '', mobile: g.mobile ?? '', email: g.email ?? '', relation: g.relation } : null
}

function admissionFormModel({ student: s, place, admittedTo, admittedYear, siblings }, { lang } = {}) {
  const other = s.guardians?.find((g) => !['FATHER', 'MOTHER'].includes(g.relation))
  const address = s.address ?? {}
  return {
    form: { classSought: admittedTo ?? '', year: admittedYear ?? '', admissionNo: s.admissionNo, admissionDate: s.admissionDate ?? null, section: place?.label ?? '', rollNo: s.rollNo ?? '' },
    student: {
      name: studentName(s), firstName: s.firstName, middleName: s.middleName ?? '', lastName: s.lastName ?? '',
      dob: s.dob ?? null, dobWords: dateInWords(s.dob, lang || s.language), gender: GENDERS.find((g) => g.value === s.gender)?.label ?? '', bloodGroup: s.bloodGroup ?? '',
      nationality: s.nationality ?? '', religion: s.religion ?? '', category: CATEGORY_LABEL_OF(s.category) ?? '', motherTongue: s.motherTongue ?? '',
      aadhaar: s.aadhaarLast4 ? `XXXX XXXX ${s.aadhaarLast4}` : '', apaarId: s.apaarId ?? '', pen: s.pen ?? '', mobile: s.mobile ?? '', email: s.email ?? '',
      photo: typeof s.photo === 'string' && PHOTO_DATA_URL.test(s.photo) ? s.photo : null,
      medical: [s.medical?.allergies, s.medical?.conditions].filter(Boolean).join('; '),
      language: s.language,
    },
    father: parentOf(s, 'FATHER') ?? {}, mother: parentOf(s, 'MOTHER') ?? {},
    guardian: other ? { name: other.name, occupation: other.occupation ?? '', mobile: other.mobile ?? '', email: other.email ?? '', relation: other.relation } : {},
    address: { line: address.line ?? '', city: address.city ?? '', state: address.state ?? '', pincode: address.pincode ?? '', full: [address.line, address.city, address.state, address.pincode].filter(Boolean).join(', ') },
    previousSchool: { name: s.previousSchool?.name ?? '', board: s.previousSchool?.board ?? '', lastClass: s.previousSchool?.lastClass ?? '', tcNo: s.previousSchool?.tcNo ?? '' },
    siblings, hasSiblings: siblings.length > 0,
  }
}

/**
 * The no-dues slip's rows, one per desk: what its records show on the leaving date. `due` — the family owes
 * something (fees, library); `tidy` — the school has something to wind up (bed, bus seat, wallet, later bills).
 * The class teacher's row has no record behind it: the teacher checks and signs.
 */
export function noDuesSlipModel(d) {
  const by = Object.fromEntries((d.checks ?? []).map((c) => [c.key, c]))
  const money = (p) => formatINR(p ?? 0)
  const rows = [{ desk: 'Class teacher', shows: 'Text books, ID card and class items returned', manual: true }]
  if (by.fees) {
    const f = by.fees
    rows.push({ desk: 'Accounts / fee office', due: !f.ok, shows: f.ok ? 'No fees due' : `${money(f.total)} due — ${f.bills.map((b) => b.installment).join(', ')}` })
    if (by.laterBills) rows.push({ desk: '', tidy: true, shows: `${by.laterBills.bills.length} bill(s) due after the leaving date (${money(by.laterBills.total)}) — to be cancelled` })
  }
  if (by.library) {
    const l = by.library
    rows.push({ desk: 'Library', due: !l.ok, shows: l.ok ? 'No books out, no fines' : [l.booksOut.length && `Books out: ${l.booksOut.map((b) => `${b.title} (${b.accessionNo})`).join('; ')}`, l.fineTotal && `fines ${money(l.fineTotal)}`].filter(Boolean).join(' · ') })
  }
  if (by.hostel) rows.push({ desk: 'Hostel warden', tidy: !by.hostel.ok, shows: by.hostel.ok ? 'No hostel bed' : `${[by.hostel.block, by.hostel.room && `room ${by.hostel.room}`, by.hostel.bed && `bed ${by.hostel.bed}`].filter(Boolean).join(', ')} — to vacate` })
  if (by.transport) rows.push({ desk: 'Transport', tidy: !by.transport.ok, shows: by.transport.ok ? 'Not on a bus route' : `${by.transport.route ?? ''}${by.transport.stop ? `, ${by.transport.stop} stop` : ''} — to take off the route` })
  if (by.canteen) rows.push({ desk: 'Canteen', tidy: !by.canteen.ok, shows: by.canteen.ok ? 'No balance left' : `${money(by.canteen.balance)} left in the wallet — to pay back` })
  return { ...d, rows, clear: !d.dues }
}

export const STUDENT_DOCS = {
  ADMISSION_FORM: {
    perms: ['students.profile.print', 'students.admit.create'],
    load: (id, auth) => admissionFormData(id, auth),
    model: admissionFormModel,
    title: (m) => `Admission form · ${m.student.name} (${m.form.admissionNo})`,
    sample: async () => (await Student.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name, institution.addressLine, institution.affiliationNo, institution.schoolCode …',
      'form.classSought, form.year, form.admissionNo, form.admissionDate, form.section, form.rollNo',
      'student.name, firstName, middleName, lastName, dob, dobWords, gender, bloodGroup, nationality, religion, category, motherTongue, aadhaar (masked), apaarId, pen, mobile, email, photo, medical',
      'father / mother / guardian {name, occupation, mobile, email} · address {line, city, state, pincode, full}',
      'previousSchool {name, board, lastClass, tcNo} · siblings[] {name, admissionNo, class} · hasSiblings',
      '{{#> letterhead}}corner{{/letterhead}} · {{> footer}}',
    ],
  },
  STUDENT_NO_DUES: {
    perms: ['students.transfer.view', 'students.transfer.create', 'students.transfer.approve'],
    load: (id, auth) => noDuesSlipData(id, auth),
    model: noDuesSlipModel,
    title: (m) => `No-dues slip · ${m.student.name} (${m.student.admissionNo})`,
    sample: async () => (await Student.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name …', 'refNo, date, leavingDate, tcNo (once issued)',
      'student.name, student.admissionNo, student.className, student.rollNo, student.guardian, student.mobile',
      'rows[] (desk, shows, due, tidy, manual) — one per desk, from the records on the leaving date',
      'clear (no fees or library dues), dues (how many desks show dues), tidy (things to wind up)',
      'checks[] (the raw checks: fees, laterBills, library, hostel, transport, canteen)',
    ],
  },
}
