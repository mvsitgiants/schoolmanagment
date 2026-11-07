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

export const DOCS = {}
