// Every server-rendered printable document: who may print it, where its data comes from, the
// model its template sees, and the variables listed in the template editor.
//
// SchoolGiant's documents (fee receipt, report card, TC, ID cards …) are listed in
// packages/shared/src/printing.js → PRINT_DOCS and register here as their module is built:
//
//   FEE_RECEIPT: {
//     perms: ['fees.invoices.view', 'fees.collect.view'],     // any one of these may print it
//     load: (id, auth) => receiptData(id, auth),             // the record, access-checked
//     model: (d) => ({ institution: d.institution, student: …, receipt: … }),
//     title: (m) => `${m.receipt.no} · ${m.student.name}`,
//     sample: () => latestId(Payment, {}, { at: -1 }),       // record shown in the editor preview
//     variables: ['institution.name …', 'student.name, student.admissionNo, student.class', …],
//   },
//
// with its default Handlebars template in ./defaults/<DOC>.hbs (see engine.js for helpers).

import { CATEGORY_LABEL_OF, LEAVING_REASON_LABEL_OF, dateInWords } from './words.js'
import { TransferCertificate } from '../models/students.js'
import { tcPrintData } from '../services/students.js'
import { FeePayment } from '../models/fees.js'
import { receiptPrintData } from '../services/fees.js'
import { PAYMENT_MODE_LABEL, RESULT_STATUS, gradeFor } from '@schoolgiant/shared'
import { hallTicketData, latestCandidate, reportCardData } from '../services/exams.js'

const latestId = async (Model, filter, sort) => (await Model.findOne(filter).sort(sort).select('_id').lean())?._id
const V = {
  institution: 'institution.name, institution.addressLine, institution.phone, institution.affiliationNo, institution.udiseCode …',
  layout: '{{#> letterhead}}corner{{/letterhead}} · {{> footer}} · $layout.showQr',
}

function tcModel({ tc, student }) {
  const sn = tc.snapshot ?? {}
  return {
    tc: {
      no: tc.tcNo, status: tc.status, issued: tc.status === 'ISSUED', cancelled: tc.status === 'CANCELLED', requested: tc.status === 'REQUESTED',
      issuedAt: tc.issuedAt, issuedBy: tc.issuedBy, leavingDate: tc.leavingDate, reason: LEAVING_REASON_LABEL_OF(tc.reason) ?? tc.reasonText,
      reasonText: tc.reasonText, conduct: tc.conduct, lastClass: tc.lastClassLabel, promotedTo: tc.promotedTo, feesPaidUpTo: tc.feesPaidUpTo,
      remarks: tc.remarks, cancelReason: tc.cancelReason,
    },
    student: {
      name: sn.name, admissionNo: sn.admissionNo, dob: sn.dob, dobWords: dateInWords(sn.dob), gender: sn.gender, nationality: sn.nationality,
      category: CATEGORY_LABEL_OF(sn.category), religion: sn.religion, admissionDate: sn.admissionDate, firstClass: sn.firstClass,
      father: sn.father, mother: sn.mother, guardian: sn.guardian, apaarId: sn.apaarId, pen: sn.pen, language: student?.language,
    },
  }
}

function receiptModel({ payment: p, student: s, place, invoices, balance }) {
  const paidFor = new Map(p.allocations.map((a) => [String(a.invoiceId), a.amount]))
  return {
    receipt: {
      no: p.receiptNo, date: p.date, at: p.at, mode: PAYMENT_MODE_LABEL[p.mode] ?? p.mode, reference: p.reference, amount: p.amount,
      collectedBy: p.collectedBy, cancelled: p.status === 'CANCELLED', cancelReason: p.cancelReason, refunded: p.refunded, note: p.note,
    },
    student: { name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, class: place?.label ?? '', rollNo: s.rollNo },
    items: invoices.map((i) => ({ installment: i.installment, invoiceNo: i.invoiceNo, dueDate: i.dueDate, paid: paidFor.get(String(i._id)) ?? 0, lines: i.lines.map((l) => ({ name: l.name, amount: l.amount, concession: l.concession })), lateFee: i.lateFee })),
    balance,
  }
}

const nameOf = (s) => [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(' ')
const guardianOf = (s, rel) => s?.guardians?.find((g) => g.relation === rel)?.name ?? null
const studentBlock = (s, place, rollNo) => ({
  name: nameOf(s), admissionNo: s?.admissionNo, rollNo: rollNo ?? s?.rollNo ?? null, class: place ?? '', dob: s?.dob ?? null,
  father: guardianOf(s, 'FATHER'), mother: guardianOf(s, 'MOTHER'),
})

function hallTicketModel({ candidate, exam, year, student, place, papers }) {
  return {
    exam: { name: exam.name, year: year?.name, term: exam.term, instructions: exam.instructions, startDate: exam.startDate, endDate: exam.endDate },
    student: studentBlock(student, place, candidate.rollNo),
    papers: papers.map((p) => ({ subject: p.subject, date: p.date, startTime: p.startTime, endTime: p.endTime, maxMarks: p.maxMarks, gradeOnly: !!p.gradeOnly })),
  }
}

function reportCardModel({ candidate: c, exam, year, student, place, papers, entry, bands, attendance, showRank }) {
  const bandList = bands?.bands ?? []
  const subjects = papers.filter((p) => !p.gradeOnly).map((p) => {
    const x = entry.get(p.id)
    const marks = x?.marks ?? null
    return {
      subject: p.subject, maxMarks: p.maxMarks, passMarks: p.passMarks, marks, absent: !!x?.absent, exempt: !!x?.exempt, counts: p.countsInTotal !== false,
      grade: marks !== null && p.maxMarks ? gradeFor(bandList, (marks / p.maxMarks) * 100)?.grade ?? null : null,
      below: !x?.exempt && (x?.absent || (marks !== null && marks < p.passMarks)),
    }
  })
  const activities = papers.filter((p) => p.gradeOnly).map((p) => ({ subject: p.subject, grade: entry.get(p.id)?.grade ?? null, exempt: !!entry.get(p.id)?.exempt }))
  return {
    exam: { name: exam.name, year: year?.name, term: exam.term, published: exam.status === 'PUBLISHED', publishedAt: exam.publishedAt },
    student: studentBlock(student, place, c.rollNo),
    subjects, activities, hasActivities: activities.length > 0,
    result: {
      total: c.total, max: c.max, pct: c.pct, grade: c.grade, rank: showRank ? c.rank : null, showRank,
      status: c.result, label: RESULT_STATUS[c.result]?.label ?? '', pass: c.result === 'PASS', incomplete: c.result === 'INCOMPLETE', failed: c.failedSubjects ?? [],
    },
    attendance: { present: (attendance.P ?? 0) + (attendance.L ?? 0) + 0.5 * (attendance.HD ?? 0), working: attendance.total, pct: attendance.pct },
    remark: c.remark, remarkBy: c.remarkBy,
    scheme: bands?.name ?? null, bands: bandList.map((b) => ({ grade: b.grade, min: b.min, max: b.max, remark: b.remark })),
  }
}

export const DOCS = {
  FEE_RECEIPT: {
    perms: ['fees.invoices.print', 'fees.collect.view'],
    load: (id, auth) => receiptPrintData(id, auth),
    model: receiptModel,
    title: (m) => `Receipt ${m.receipt.no} · ${m.student.name}`,
    sample: () => latestId(FeePayment, {}, { at: -1 }),
    variables: [V.institution, 'student.name, student.admissionNo, student.class, student.rollNo', 'receipt.no, receipt.date, receipt.mode, receipt.reference, receipt.amount, receipt.collectedBy, receipt.cancelled, receipt.refunded', 'items[] {installment, invoiceNo, dueDate, paid, lateFee, lines[] {name, amount, concession}} · balance · {{money x}} · {{words receipt.amount}}', V.layout],
  },
  TRANSFER_CERTIFICATE: {
    perms: ['students.transfer.view', 'students.transfer.print'],
    load: (id, auth) => tcPrintData(id, auth),
    model: tcModel,
    title: (m) => `TC ${m.tc.no ?? '(draft)'} · ${m.student.name}`,
    sample: () => latestId(TransferCertificate, {}, { createdAt: -1 }),
    variables: [V.institution, 'student.name, student.admissionNo, student.dob, student.dobWords, student.gender, student.nationality, student.category, student.religion', 'student.father, student.mother, student.guardian, student.admissionDate, student.firstClass, student.apaarId, student.pen', 'tc.no, tc.issued, tc.requested, tc.cancelled, tc.issuedAt, tc.issuedBy, tc.leavingDate, tc.reason, tc.conduct, tc.lastClass, tc.promotedTo, tc.feesPaidUpTo, tc.remarks', V.layout],
  },
  HALL_TICKET: {
    perms: ['exams.hall-tickets.view', 'exams.hall-tickets.print'],
    load: (id, auth) => hallTicketData(id, auth),
    model: hallTicketModel,
    title: (m) => `Hall ticket · ${m.exam.name} · ${m.student.name}`,
    sample: () => latestCandidate(),
    variables: [V.institution, 'exam.name, exam.year, exam.term, exam.instructions, exam.startDate, exam.endDate', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother', 'papers[] {subject, date, startTime, endTime, maxMarks, gradeOnly}', V.layout],
  },
  REPORT_CARD: {
    perms: ['exams.report-cards.view', 'exams.report-cards.print'],
    load: (id, auth) => reportCardData(id, auth),
    model: reportCardModel,
    title: (m) => `Report card · ${m.exam.name} · ${m.student.name}`,
    sample: () => latestCandidate({ computedAt: { $ne: null } }),
    variables: [V.institution, 'exam.name, exam.year, exam.term, exam.published', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother', 'subjects[] {subject, maxMarks, passMarks, marks, absent, exempt, grade, below} · activities[] {subject, grade}', 'result.total, result.max, result.pct, result.grade, result.rank, result.label, result.pass, result.failed[]', 'attendance.present, attendance.working, attendance.pct · remark, remarkBy · scheme, bands[] {grade, min, max, remark}', V.layout],
  },
}
