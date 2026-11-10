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

import { config } from '../config.js'
import { CATEGORY_LABEL_OF, LEAVING_REASON_LABEL_OF, classInWords, dateInWords, pronounsOf } from './words.js'
import { TransferCertificate } from '../models/students.js'
import { studentIdCards, tcPrintData } from '../services/students.js'
import { studentIdCardModel, withPaper } from './studentIdCard.js'
import { Student } from '../models/students.js'
import { AppError, notFound } from '../platform/errors.js'
import { FeePayment } from '../models/fees.js'
import { receiptPrintData } from '../services/fees.js'
import { FEE_DOCS, withReceiptExtras } from './feeDocs.js'
import { HR_DOCS } from './hrDocs.js'
import { PAYMENT_MODE_LABEL, RESULT_STATUS, gradeFor } from '@schoolgiant/shared'
import { hallTicketData, latestCandidate, reportCardData } from '../services/exams.js'
import { certificatePrintData, latestCertificate } from '../services/certificates.js'
import { CERTIFICATE_KIND_BY, TC_FAILED, TUITION_HEAD_CODES } from '@schoolgiant/shared'
import { translateDoc } from './engine.js'
import { latestPayslipId, payslipModel, payslipPrint } from '../services/payrollRuns.js'
import { labelsModel, labelsPrint, latestCopyId } from '../services/library.js'
import { latestSectionId, seatLabelsModel, seatLabelsPrint } from '../services/academics.js'
import { EXAM_SEATING_DOCS } from './examSeatingDocs.js'
import { YEAR_RESULT_DOCS } from './yearResultDocs.js'
import { bandRange, splitActivities, weekdayOf } from './examPrint.js'
import { INVENTORY_DOCS } from './inventoryDocs.js'
import { ALUMNI_DOCS } from './alumniDocs.js'
import { QUESTION_PAPER_DOCS } from './questionPaperDocs.js'
import { COE_DOCS } from './coeDocs.js'
import { PROGRAM_DOCS } from './programDocs.js'
import { ACCREDITATION_DOCS } from './accreditationDocs.js'
import { STUDENT_DOCS } from './studentDocs.js'
import { STAFF_DOCS } from './staffIdCard.js'

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
      verifyUrl: tc.verifyCode && tc.status === 'ISSUED' ? `${config.appUrl}/verify/tc/${tc.verifyCode}` : null,
      issuedAt: tc.issuedAt, issuedBy: tc.issuedBy, leavingDate: tc.leavingDate, reason: LEAVING_REASON_LABEL_OF(tc.reason) ?? tc.reasonText,
      reasonText: tc.reasonText, conduct: tc.conduct, lastClass: tc.lastClassLabel, promotedTo: tc.promotedTo, feesPaidUpTo: tc.feesPaidUpTo,
      remarks: tc.remarks, cancelReason: tc.cancelReason,
      // the rest of the CBSE-format TC (empty ones print as a blank line)
      lastClassWords: classInWords(tc.lastClassLabel), promotedToWords: classInWords(tc.promotedTo),
      bookNo: tc.bookNo, applicationDate: tc.applicationDate, lastExam: tc.lastExam, lastExamResult: tc.lastExamResult,
      failed: TC_FAILED.find((x) => x.value === tc.failed)?.label ?? null, subjects: tc.subjects ?? [], subjectsText: (tc.subjects ?? []).join(', '),
      concession: tc.concession, workingDays: tc.workingDays ?? null, presentDays: tc.presentDays ?? null, nccScoutGuide: tc.nccScoutGuide, games: tc.games,
    },
    student: {
      name: sn.name, admissionNo: sn.admissionNo, dob: sn.dob, dobWords: dateInWords(sn.dob), gender: sn.gender, nationality: sn.nationality,
      category: CATEGORY_LABEL_OF(sn.category), religion: sn.religion, admissionDate: sn.admissionDate, firstClass: sn.firstClass,
      father: sn.father, mother: sn.mother, guardian: sn.guardian, apaarId: sn.apaarId, pen: sn.pen, language: student?.language,
      // SC / ST / OBC row: the category, or "No" for General
      reserved: ['SC', 'ST', 'OBC'].includes(sn.category) ? CATEGORY_LABEL_OF(sn.category) : sn.category ? 'No' : null,
    },
  }
}

function receiptModel({ payment: p, student: s, place, invoices, balance }) {
  const paidFor = new Map(p.allocations.map((a) => [String(a.invoiceId), a.amount]))
  return {
    receipt: {
      no: p.receiptNo, date: p.date, at: p.at, mode: PAYMENT_MODE_LABEL[p.mode] ?? p.mode, reference: p.reference, amount: p.amount,
      verifyUrl: p.verifyCode ? `${config.appUrl}/verify/receipt/${p.verifyCode}` : null,
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

function hallTicketModel({ candidate, exam, year, student, place, papers, classTeacher }) {
  // one room and seat for every paper: printed once in the student block instead of on each row
  const seats = [...new Set(papers.filter((p) => p.seat).map((p) => `${p.seat.room}|${p.seat.seat}`))]
  const sameSeat = seats.length === 1 && papers.every((p) => p.seat || p.gradeOnly) ? papers.find((p) => p.seat).seat : null
  return {
    exam: {
      name: exam.name, year: year?.name, term: exam.term, instructions: exam.instructions, startDate: exam.startDate, endDate: exam.endDate, verifyUrl: candidate.verifyCode ? `${config.appUrl}/verify/exam/${candidate.verifyCode}` : null,
      instructionLines: String(exam.instructions ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
    },
    student: { ...studentBlock(student, place, candidate.rollNo), photo: student?.photo || null },
    papers: papers.map((p) => ({ subject: p.subject, code: p.subjectCode ?? null, date: p.date, ...weekdayOf(p.date), startTime: p.startTime, endTime: p.endTime, maxMarks: p.maxMarks, gradeOnly: !!p.gradeOnly, room: p.seat?.room ?? null, seat: p.seat?.seat ?? null })),
    seated: papers.some((p) => p.seat),
    seat: sameSeat ? { room: sameSeat.room, seat: sameSeat.seat } : null,
    classTeacher: classTeacher ?? null,
  }
}

function reportCardModel({ candidate: c, exam, year, student, place, papers, entry, bands, attendance, showRank, examType, classTeacher }) {
  const bandList = bands?.bands ?? []
  const subjects = papers.filter((p) => !p.gradeOnly).map((p) => {
    const x = entry.get(p.id)
    const marks = x?.marks ?? null
    return {
      subject: p.subject, code: p.subjectCode ?? null, maxMarks: p.maxMarks, passMarks: p.passMarks, marks, absent: !!x?.absent, exempt: !!x?.exempt, counts: p.countsInTotal !== false,
      pct: marks !== null && p.maxMarks ? Math.round((marks / p.maxMarks) * 10000) / 100 : null,
      grade: marks !== null && p.maxMarks ? gradeFor(bandList, (marks / p.maxMarks) * 100)?.grade ?? null : null,
      below: !x?.exempt && (x?.absent || (marks !== null && marks < p.passMarks)),
    }
  })
  const activities = papers.filter((p) => p.gradeOnly).map((p) => ({ subject: p.subject, grade: entry.get(p.id)?.grade ?? null, exempt: !!entry.get(p.id)?.exempt }))
  const { coScholastic, discipline } = splitActivities(activities) // CBSE Part 2 / Part 3
  return {
    exam: { name: exam.name, year: year?.name, term: exam.term, published: exam.status === 'PUBLISHED', publishedAt: exam.publishedAt, verifyUrl: c.verifyCode ? `${config.appUrl}/verify/exam/${c.verifyCode}` : null, typeName: examType?.name ?? null, typeCode: examType?.code ?? null },
    student: studentBlock(student, place, c.rollNo),
    subjects, activities, hasActivities: activities.length > 0, coScholastic, discipline,
    classTeacher: classTeacher ?? null,
    result: {
      total: c.total, max: c.max, pct: c.pct, grade: c.grade, rank: showRank ? c.rank : null, showRank, date: exam.status === 'PUBLISHED' ? exam.publishedAt ?? null : null,
      status: c.result, label: RESULT_STATUS[c.result]?.label ?? '', pass: c.result === 'PASS', incomplete: c.result === 'INCOMPLETE', failed: c.failedSubjects ?? [],
    },
    attendance: { present: (attendance.P ?? 0) + (attendance.L ?? 0) + 0.5 * (attendance.HD ?? 0), working: attendance.total, pct: attendance.pct },
    remark: c.remark, remarkBy: c.remarkBy,
    scheme: bands?.name ?? null, bands: bandList.map((b) => ({ grade: b.grade, min: b.min, max: b.max, remark: b.remark, range: bandRange(b) })),
  }
}

function certificateModel({ certificate: c, verifyUrl }) {
  const sn = c.snapshot ?? {}
  const kid = sn.gender === 'MALE' ? 'm' : sn.gender === 'FEMALE' ? 'f' : 'x'
  return {
    certificate: {
      no: c.certificateNo, kind: c.kind, kindLabel: CERTIFICATE_KIND_BY[c.kind]?.label ?? c.kind, issueDate: c.issueDate, purpose: c.purpose, remarks: c.remarks,
      cancelled: c.status === 'CANCELLED', cancelReason: c.cancelReason, issuedBy: c.issuedBy, reprint: (c.prints ?? 0) > 0,
      bonafide: c.kind === 'BONAFIDE', character: c.kind === 'CHARACTER', study: c.kind === 'STUDY', fee: c.kind === 'FEE', merit: c.kind === 'MERIT',
    },
    student: {
      ...sn, kid, parent: sn.father || sn.mother || null, studying: sn.studying ?? sn.status === 'ACTIVE',
      // ", son of Rajesh Sharma" — the relation word is translated in the template's language
      parentPhrase: sn.father || sn.mother ? `, ${translateDoc(sn.language || 'en', `certificates.print.childOf.${kid}`, kid === 'm' ? 'son of' : kid === 'f' ? 'daughter of' : 'ward of')} ${sn.father || sn.mother}` : '',
      // he / she, his / her, Master / Kumari, S/o / D/o — from the gender, "he/she" when it isn't recorded
      p: Object.fromEntries(Object.entries(pronounsOf(sn.gender)).map(([k, v]) => [k, k === 'kid' ? v : translateDoc(sn.language || 'en', `certificates.print.words.${k}.${kid}`, v)])),
      dobWords: dateInWords(sn.dob), years: sn.years ?? [], hasYears: (sn.years ?? []).length > 0,
      // "Master Aditya Iyer" and ", S/o Suresh Iyer" as Indian certificates write them
      titleName: [translateDoc(sn.language || 'en', `certificates.print.words.title.${kid}`, pronounsOf(sn.gender).title), sn.name].filter(Boolean).join(' '),
      relPhrase: sn.father || sn.mother ? `, ${translateDoc(sn.language || 'en', `certificates.print.words.rel.${kid}`, pronounsOf(sn.gender).rel)} ${sn.father || sn.mother}` : '',
    },
    fees: sn.fees ? { ...sn.fees, heads: (sn.fees.heads ?? []).map((h, i) => ({ ...h, sl: i + 1, tuition: TUITION_HEAD_CODES.includes(h.code) })) } : null,
    verify: { url: verifyUrl, code: c.verifyCode },
  }
}

export const DOCS = {
  ...ALUMNI_DOCS, // donation receipts (documents/alumniDocs.js)
  ...FEE_DOCS, // the fee invoice / bank challan (documents/feeDocs.js)
  ...HR_DOCS, // the offer / appointment letter (documents/hrDocs.js)
  ...INVENTORY_DOCS, // purchase order, store sale receipt (documents/inventoryDocs.js)
  ...YEAR_RESULT_DOCS, // the year-end report card (documents/yearResultDocs.js)
  ...EXAM_SEATING_DOCS, // seating charts, door lists, invigilation duties (documents/examSeatingDocs.js)
  ...QUESTION_PAPER_DOCS, // question papers and answer keys (documents/questionPaperDocs.js)
  ...COE_DOCS, // documents/coeDocs.js
  ...PROGRAM_DOCS, // documents/programDocs.js
  ...ACCREDITATION_DOCS, // documents/accreditationDocs.js
  ...STUDENT_DOCS, // the admission form (documents/studentDocs.js)
  ...STAFF_DOCS, // staff ID cards (documents/staffIdCard.js)
  FEE_RECEIPT: {
    perms: ['fees.invoices.print', 'fees.collect.view'],
    load: (id, auth) => receiptPrintData(id, auth),
    model: (d) => withReceiptExtras(receiptModel(d), d), // + the Indian-format extras (documents/feeDocs.js)
    title: (m) => `Receipt ${m.receipt.no} · ${m.student.name}`,
    sample: () => latestId(FeePayment, {}, { at: -1 }),
    variables: [V.institution, 'student.name, student.admissionNo, student.class, student.rollNo', 'receipt.no, receipt.date, receipt.mode, receipt.reference, receipt.amount, receipt.collectedBy, receipt.cancelled, receipt.refunded', 'items[] {installment, invoiceNo, dueDate, paid, lateFee, lines[] {name, amount, concession}} · balance · {{money x}} · {{words receipt.amount}}', 'student.relation (S/o · D/o · Ward of), student.parent, student.father, student.mother, student.className, student.section, student.year · receipt.modeCode, receipt.cheque, receipt.chequeBank, receipt.chequeDate', 'rows[] {sl, name, period, amount, concession} · summary {subtotal, concession, lateFee, total, paidEarlier, paid, balance}', V.layout],
  },
  TRANSFER_CERTIFICATE: {
    perms: ['students.transfer.view', 'students.transfer.print'],
    load: (id, auth) => tcPrintData(id, auth),
    model: tcModel,
    title: (m) => `TC ${m.tc.no ?? '(draft)'} · ${m.student.name}`,
    sample: () => latestId(TransferCertificate, {}, { createdAt: -1 }),
    variables: [V.institution, 'student.name, student.admissionNo, student.dob, student.dobWords, student.gender, student.nationality, student.category, student.religion', 'student.father, student.mother, student.guardian, student.admissionDate, student.firstClass, student.apaarId, student.pen', 'tc.no, tc.issued, tc.requested, tc.cancelled, tc.issuedAt, tc.issuedBy, tc.leavingDate, tc.reason, tc.conduct, tc.lastClass, tc.promotedTo, tc.feesPaidUpTo, tc.remarks', 'tc.bookNo, tc.applicationDate, tc.lastClassWords, tc.promotedToWords, tc.lastExam, tc.lastExamResult, tc.failed, tc.subjects[], tc.subjectsText, tc.concession, tc.workingDays, tc.presentDays, tc.nccScoutGuide, tc.games · student.reserved', V.layout],
  },
  HALL_TICKET: {
    perms: ['exams.hall-tickets.view', 'exams.hall-tickets.print'],
    load: (id, auth) => hallTicketData(id, auth),
    model: hallTicketModel,
    title: (m) => `Hall ticket · ${m.exam.name} · ${m.student.name}`,
    sample: () => latestCandidate(),
    variables: [V.institution, 'exam.name, exam.year, exam.term, exam.instructions, exam.startDate, exam.endDate', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother', 'papers[] {subject, code, date, day, dayLabel, startTime, endTime, maxMarks, gradeOnly, room, seat} · seated (any paper has a published seat) · seat {room, seat} (the same for every paper)', 'student.photo · classTeacher · exam.instructionLines[]', V.layout],
  },
  REPORT_CARD: {
    perms: ['exams.report-cards.view', 'exams.report-cards.print'],
    load: (id, auth) => reportCardData(id, auth),
    model: reportCardModel,
    title: (m) => `Report card · ${m.exam.name} · ${m.student.name}`,
    sample: () => latestCandidate({ computedAt: { $ne: null } }),
    variables: [V.institution, 'exam.name, exam.year, exam.term, exam.published', 'student.name, student.admissionNo, student.rollNo, student.class, student.dob, student.father, student.mother', 'subjects[] {subject, code, maxMarks, passMarks, marks, pct, absent, exempt, grade, below} · activities[] {subject, grade} · coScholastic[] / discipline[] {subject, grade, exempt}', 'exam.typeName, exam.typeCode · classTeacher', 'result.total, result.max, result.pct, result.grade, result.rank, result.label, result.pass, result.failed[], result.date (published on)', 'attendance.present, attendance.working, attendance.pct · remark, remarkBy · scheme, bands[] {grade, min, max, remark, range ("81–90")}', V.layout],
  },
  CERTIFICATE: {
    perms: ['certificates.issue.print', 'certificates.register.view'],
    load: (id, auth) => certificatePrintData(id, auth),
    model: certificateModel,
    title: (m) => `${m.certificate.kindLabel} ${m.certificate.no} · ${m.student.name}`,
    sample: () => latestCertificate(),
    variables: [V.institution, 'certificate.no, certificate.kind, certificate.kindLabel, certificate.issueDate, certificate.purpose, certificate.remarks, certificate.cancelled, certificate.bonafide / character / study / fee / merit', 'student.name, student.admissionNo, student.class, student.yearName, student.dob, student.dobWords, student.father, student.mother, student.parent, student.kid (m / f / x), student.p {he, He, his, His, him, title (Master / Kumari), rel (S/o / D/o), child}, student.titleName, student.relPhrase, student.years[] {year, class}, student.admissionDate, student.conduct, student.from, student.to, student.fromClass, student.toClass, student.event, student.achievement, student.eventDate', 'fees.fy, fees.total, fees.tuition, fees.refunded, fees.heads[] {sl, name, amount, tuition}', 'verify.url, verify.code · {{qr verify.url 22}}', V.layout],
  },
  // ── Student ID cards: many students at once (GET /documents/STUDENT_ID_CARD?ids=…), a front page and — with the back
  // side switched on — a back page each, so double-sided printing lines up. Data from services/students.js studentIdCards.
  STUDENT_ID_CARD: {
    perms: ['students.id-cards.view', 'students.id-cards.print'],
    many: true,
    load: async (ids, auth) => {
      const d = await studentIdCards((Array.isArray(ids) ? ids : [ids]).map(String), auth)
      if (!d.students.length) throw notFound('Student')
      if (d.students.every((x) => x.status !== 'ACTIVE')) throw new AppError(409, 'No ID cards to print — every student picked has left.', { code: 'NO_CARDS' })
      return d
    },
    model: studentIdCardModel,
    // no saved template: the card setting (Settings › Students) turns the card sideways
    paper: (raw) => (raw.settings?.orientation === 'LANDSCAPE' ? 'CARD_LANDSCAPE' : null),
    forPaper: withPaper,
    title: (m) => (m.students.length === 1 ? `ID card · ${m.students[0].name}` : `Student ID cards (${m.students.length})`),
    sample: () => latestId(Student, { status: 'ACTIVE' }, { updatedAt: -1 }),
    variables: [
      'institution.name, institution.logoUrl, institution.color, institution.address, institution.phone, institution.email, institution.website',
      'settings.orientation, settings.landscape · settings.title (empty: the standard heading) · settings.color · settings.fields[] · settings.year',
      'settings.show {photo, roll, dob, bloodGroup, guardian, guardianPhone, address, validUntil, qr} — the fields switched on',
      'settings.back · settings.backText, settings.backTextStandard · settings.returnText, settings.returnTextStandard · settings.signatory · settings.issued, settings.validUntil',
      'theme {color, dark, deep, tint, soft, ink, light}',
      'students[] {name, admissionNo, class, rollNo, dob, bloodGroup, guardian, guardianRelation, guardianPhone, address, photo, initials, verifyUrl, qrImage, barcodeImage}',
    ],
  },
  // ── Library book labels: many copies at once (GET /documents/LIBRARY_LABEL?ids=… — copy ids, or title ids for all
  // their copies). Data from services/library.js labelsPrint.
  LIBRARY_LABEL: {
    perms: ['library.catalogue.view'],
    many: true,
    load: (ids) => labelsPrint(ids),
    model: labelsModel,
    title: (m) => `Library labels (${m.count})`,
    sample: () => latestCopyId(),
    variables: ['institution.name', 'labels[] {accessionNo, title, author, callNo, shelf} · count · {{barcode accessionNo 10}}'],
  },
  // ── Seat labels for the benches: every seat of each section's room with who sits there (GET /documents/SEAT_LABEL?ids=…
  // — section ids). Data from services/academics.js seatLabelsPrint; the class board's seating sheet prints them.
  SEAT_LABEL: {
    perms: ['academics.classes.view'],
    many: true,
    load: (ids, auth) => seatLabelsPrint(ids, auth),
    model: seatLabelsModel,
    title: (m) => `Seat labels (${m.count})`,
    sample: () => latestSectionId(),
    variables: ['institution.name', 'labels[] {seat, row, bench, section, sectionLabel, room, classTeacher, name, rollNo, admissionNo, gender, free, noSeat} · count · taken · {{barcode admissionNo 7}}'],
  },
  // ── Payslip (data from services/payrollRuns.js). Staff print their own from My workspace (/payroll/me/payslips/:id/print).
  PAYSLIP: {
    perms: ['payroll.payslips.view'],
    load: (id, auth) => payslipPrint(id, auth),
    model: payslipModel,
    title: (m) => `${m.payslip.no} · ${m.employee.name}`,
    sample: () => latestPayslipId(),
    variables: [V.institution, 'payslip.no, payslip.monthLabel, payslip.runNo, payslip.status, payslip.draft, payslip.paid, payslip.paidOn, payslip.paidMode, payslip.reference', 'employee.name, employee.code, employee.designation, employee.departmentName, employee.branchName, employee.joiningDate, employee.lastWorkingDate, employee.panMasked, employee.uanMasked, employee.esiMasked, employee.bankName, employee.accountMasked, employee.paymentModeLabel · structureName', 'attendance.daysInMonth, attendance.baseDays, attendance.payDays, attendance.lop, attendance.lopEdited, attendance.lopReason, attendance.present, attendance.leave', 'earnings[] / deductions[] {code, label, amount, basis} · rows[] {earning, deduction} · employer[] {label, amount} · loans[] {label, amount}', 'totals.gross, totals.deductions, totals.net, totals.employerContributions · ytd {label, gross, pf, esi, pt, tds, net} · {{words totals.net}}', 'fnf {lastWorkingDate, leaveDays, leaveEncashment, gratuity, serviceYears, countedYears, noticeDays, noticeServed, noticeRecovery, note}', V.layout],
  },
}
