// Print templates (engine E8): one institution letterhead and, per printed document, the
// paper, margins and what goes in the header and footer. The web printers read the
// effective template for their document; a document with none uses printDefaults().

/**
 * `ready`: the printout already reads its template. `server`: the whole document is a
 * Handlebars template rendered on the server (backend/src/documents/registry.js), so its
 * body can be edited too. A module's documents switch to ready / server as it is built;
 * until then the letterhead and paper can already be set up.
 */
export const PRINT_DOCS = [
  { value: 'FEE_RECEIPT', label: 'Fee receipt', module: 'fees', paper: 'A5', ready: true, server: true },
  { value: 'FEE_INVOICE', label: 'Fee invoice / challan', module: 'fees', paper: 'A4', ready: false, server: false },
  { value: 'REPORT_CARD', label: 'Report card', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'HALL_TICKET', label: 'Hall ticket', module: 'exams', paper: 'A5', ready: true, server: true },
  { value: 'TRANSFER_CERTIFICATE', label: 'Transfer certificate', module: 'students', paper: 'A4', ready: true, server: true },
  { value: 'CERTIFICATE', label: 'Certificates (bonafide, character, study, fee, merit)', module: 'certificates', paper: 'A4', ready: true, server: true },
  { value: 'ADMISSION_FORM', label: 'Admission form', module: 'students', paper: 'A4', ready: false, server: false },
  { value: 'STUDENT_ID_CARD', label: 'Student ID card', module: 'students', paper: 'CARD_PORTRAIT', ready: true, server: true, many: true },
  { value: 'PAYSLIP', label: 'Payslip', module: 'payroll', paper: 'A4', ready: true, server: true },
  { value: 'LIBRARY_LABEL', label: 'Library book labels', module: 'library', paper: 'A4', ready: true, server: true, many: true },
  { value: 'SEAT_LABEL', label: 'Seat labels (benches)', module: 'academics', paper: 'A4', ready: true, server: true, many: true },
  { value: 'EXAM_SEATING_CHART', label: 'Exam seating chart (room-wise)', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'EXAM_DOOR_LIST', label: 'Exam seating notice (roll number ranges per room)', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'INVIGILATION_DUTY', label: 'Invigilation duty chart', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'QUESTION_PAPER', label: 'Question paper', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'ANSWER_KEY', label: 'Answer key and marking scheme', module: 'exams', paper: 'A4', ready: true, server: true },
  { value: 'HR_OFFER_LETTER', label: 'Offer letter', module: 'hrms', paper: 'A4', ready: false, server: false },
  { value: 'STAFF_ID_CARD', label: 'Staff ID card', module: 'hrms', paper: 'CARD_PORTRAIT', ready: false, server: false, many: true },
  { value: 'PURCHASE_ORDER', label: 'Purchase order', module: 'inventory', paper: 'A4', ready: false, server: false },
]
export const PRINT_DOC_BY = Object.fromEntries(PRINT_DOCS.map((d) => [d.value, d]))

/**
 * Paper: CSS @page size and the width the on-screen preview draws, in mm. `card`: a CR80 ID card — printed edge to
 * edge (no margins), without the letterhead (the card draws its own header), always the way round its size says.
 */
export const PAPER_SIZES = [
  { value: 'A4', label: 'A4 (210 × 297 mm)', css: 'A4', width: 210, height: 297 },
  { value: 'A5', label: 'A5 (148 × 210 mm)', css: 'A5', width: 148, height: 210 },
  { value: 'LETTER', label: 'Letter (8.5 × 11 in)', css: 'letter', width: 216, height: 279 },
  { value: 'THERMAL_80', label: 'Receipt roll (80 mm)', css: '80mm 297mm', width: 80, height: 297 },
  { value: 'CARD_PORTRAIT', label: 'ID card, upright (54 × 85.6 mm)', css: '54mm 85.6mm', width: 54, height: 85.6, card: true },
  { value: 'CARD_LANDSCAPE', label: 'ID card, sideways (85.6 × 54 mm)', css: '85.6mm 54mm', width: 85.6, height: 54, card: true },
]
export const PAPER_BY = Object.fromEntries(PAPER_SIZES.map((p) => [p.value, p]))
/** A paper that is always printed the way round its size says (receipt roll, ID card): no landscape switch. */
export const fixedPaper = (paper) => paper === 'THERMAL_80' || !!PAPER_BY[paper]?.card

export const LETTERHEAD_MODES = [
  { value: 'FULL', label: 'Print our letterhead', hint: 'Logo, name, address and registrations at the top.' },
  { value: 'PREPRINTED', label: 'Pre-printed stationery', hint: 'Leave blank space at the top and bottom for paper that already has the letterhead.' },
  { value: 'NONE', label: 'No letterhead', hint: 'Just the institution name in one line, e.g. for receipt rolls.' },
]

/** Registration numbers the letterhead can show, from the institution profile. */
export const LETTERHEAD_IDS = [
  { value: 'registrationNo', label: 'Registration no.' },
  { value: 'affiliationNo', label: 'Board affiliation no.' },
  { value: 'gstin', label: 'GSTIN' },
  { value: 'udiseCode', label: 'UDISE code' },
]

export const LETTERHEAD_DEFAULTS = {
  align: 'LEFT', // LEFT · CENTER
  showLogo: true,
  showContacts: true,
  ids: ['registrationNo', 'affiliationNo'],
  tagline: '',
  accentColor: '', // '' = the institution's brand colour
  footerText: '',
}

/** What a document prints with when the institution has not saved a template for it. */
export function printDefaults(docType) {
  const doc = PRINT_DOC_BY[docType]
  const small = doc?.paper === 'A5'
  if (PAPER_BY[doc?.paper]?.card) {
    return {
      docType, name: 'Standard', isDefault: true, builtIn: true,
      paper: doc.paper, orientation: 'portrait', margins: { top: 0, right: 0, bottom: 0, left: 0 },
      letterhead: 'NONE', headerSpaceMm: 0, footerSpaceMm: 0, footerText: '', showQr: true, showPrintedOn: false, fontScale: 100,
    }
  }
  return {
    docType, name: 'Standard', isDefault: true, builtIn: true,
    paper: doc?.paper ?? 'A4', orientation: 'portrait',
    margins: small ? { top: 10, right: 10, bottom: 12, left: 10 } : { top: 12, right: 12, bottom: 16, left: 12 },
    letterhead: 'FULL', headerSpaceMm: 35, footerSpaceMm: 20,
    footerText: '', showQr: true, showPrintedOn: true, fontScale: 100,
  }
}

/** CSS for @page and the base font size of a template. */
export function pageCss(t) {
  if (PAPER_BY[t.paper]?.card) return `@page { size: ${PAPER_BY[t.paper].css}; margin: 0 }`
  const m = t.margins ?? {}
  const size = `${PAPER_BY[t.paper]?.css ?? 'A4'}${t.orientation === 'landscape' && !fixedPaper(t.paper) ? ' landscape' : ''}`
  const top = (m.top ?? 12) + (t.letterhead === 'PREPRINTED' ? t.headerSpaceMm ?? 0 : 0)
  const bottom = (m.bottom ?? 12) + (t.letterhead === 'PREPRINTED' ? t.footerSpaceMm ?? 0 : 0)
  return `@page { size: ${size}; margin: ${top}mm ${m.right ?? 12}mm ${bottom}mm ${m.left ?? 12}mm }`
}
