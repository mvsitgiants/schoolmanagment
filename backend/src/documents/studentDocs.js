// Student documents beyond the TC and the ID card: the admission form (ADMISSION_FORM), printed from a student's
// record — the standard Indian school admission form filled with what the office entered, with blank lines for the
// rest (qualification, income, signatures) and an "office use" box. Data from services/students.js admissionFormData.
import { GENDERS, PHOTO_DATA_URL } from '@schoolgiant/shared'
import { Student, studentName } from '../models/students.js'
import { admissionFormData } from '../services/students.js'
import { CATEGORY_LABEL_OF, dateInWords } from './words.js'

const parentOf = (s, rel) => {
  const g = s.guardians?.find((x) => x.relation === rel)
  return g ? { name: g.name, occupation: g.occupation ?? '', mobile: g.mobile ?? '', email: g.email ?? '', relation: g.relation } : null
}

function admissionFormModel({ student: s, place, admittedTo, admittedYear, siblings }) {
  const other = s.guardians?.find((g) => !['FATHER', 'MOTHER'].includes(g.relation))
  const address = s.address ?? {}
  return {
    form: { classSought: admittedTo ?? '', year: admittedYear ?? '', admissionNo: s.admissionNo, admissionDate: s.admissionDate ?? null, section: place?.label ?? '', rollNo: s.rollNo ?? '' },
    student: {
      name: studentName(s), firstName: s.firstName, middleName: s.middleName ?? '', lastName: s.lastName ?? '',
      dob: s.dob ?? null, dobWords: dateInWords(s.dob, s.language), gender: GENDERS.find((g) => g.value === s.gender)?.label ?? '', bloodGroup: s.bloodGroup ?? '',
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
}
