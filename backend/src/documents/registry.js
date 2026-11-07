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

export const DOCS = {
  TRANSFER_CERTIFICATE: {
    perms: ['students.transfer.view', 'students.transfer.print'],
    load: (id, auth) => tcPrintData(id, auth),
    model: tcModel,
    title: (m) => `TC ${m.tc.no ?? '(draft)'} · ${m.student.name}`,
    sample: () => latestId(TransferCertificate, {}, { createdAt: -1 }),
    variables: [V.institution, 'student.name, student.admissionNo, student.dob, student.dobWords, student.gender, student.nationality, student.category, student.religion', 'student.father, student.mother, student.guardian, student.admissionDate, student.firstClass, student.apaarId, student.pen', 'tc.no, tc.issued, tc.requested, tc.cancelled, tc.issuedAt, tc.issuedBy, tc.leavingDate, tc.reason, tc.conduct, tc.lastClass, tc.promotedTo, tc.feesPaidUpTo, tc.remarks', V.layout],
  },
}
