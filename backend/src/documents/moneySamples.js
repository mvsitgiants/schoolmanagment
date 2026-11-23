// Made-up records for the template editor's preview of the money and HR documents (store bill, purchase order,
// donation receipt, offer letter), used only while the institution has none of that record yet. Each is built with
// the document's own model function, so it is exactly what its template sees. samples.js picks them up.
import { donationReceiptModel } from './alumniDocs.js'
import { purchaseOrderModel, storeSaleModel } from './inventoryDocs.js'
import { offerLetterModel } from './hrDocs.js'
import { canteenTokenModel } from './canteenDocs.js'

const today = () => new Date().toISOString().slice(0, 10)
const tax = { i1: { hsn: '6203', rate: 5 }, i2: { hsn: '6205', rate: 5 }, i3: { hsn: '4901', rate: 0 }, i4: { hsn: '4820', rate: 12 } }

export const MONEY_SAMPLES = {
  CANTEEN_TOKEN: () => canteenTokenModel({
    campus: null, payLabel: 'Wallet',
    order: {
      token: 23, orderNo: 'CN26000123', date: today(), at: new Date(), total: 9000, payMode: 'WALLET', source: 'COUNTER', studentName: 'Aarav Sharma', admissionNo: '20260118',
      lines: [{ name: 'Veg sandwich', qty: 1, price: 4000 }, { name: 'Masala chaas', qty: 2, price: 2500 }],
    },
  }),
  STORE_SALE_RECEIPT: (institution) => storeSaleModel({
    institution, itemTax: tax, branch: null,
    sale: {
      saleNo: 'SS2627000042', date: today(), at: new Date(), mode: 'UPI', reference: '431278905512', total: 214000, by: 'Store counter', status: 'PAID',
      student: { name: 'Aarav Sharma', admissionNo: '20260118', class: 'Class 6 – A' },
      lines: [
        { itemId: 'i1', name: 'Uniform trousers (grey)', size: '28', qty: 2, rate: 45000, amount: 90000 },
        { itemId: 'i2', name: 'Uniform shirt (white)', size: '30', qty: 2, rate: 32000, amount: 64000 },
        { itemId: 'i3', name: 'NCERT textbook set — Class 6', size: '', qty: 1, rate: 48000, amount: 48000 },
        { itemId: 'i4', name: 'Notebook, 200 pages', size: '', qty: 4, rate: 3000, amount: 12000 },
      ],
    },
  }),
  PURCHASE_ORDER: (institution) => purchaseOrderModel({
    institution, itemTax: tax,
    branch: { name: institution?.name, addressLine: institution?.addressLine, city: institution?.city, pincode: institution?.pincode },
    vendor: { name: 'Sri Lakshmi Uniforms & Garments', contactPerson: 'K. Ramesh', phone: '+91 98450 12345', email: 'orders@srilakshmiuniforms.example', gstin: '29ABCPR1234K1Z5', address: '45, 2nd Cross, Chickpet, Bengaluru 560053' },
    po: {
      poNo: 'PO2627000017', date: today(), expectedOn: null, status: 'APPROVED', subtotal: 1840000, tax: 92000, total: 1932000,
      terms: '', created: { by: 'Meena Iyer (Store)' }, approved: { by: 'Dr. S. Rao (Principal)', at: new Date() },
      lines: [
        { itemId: 'i1', name: 'Uniform trousers (grey)', size: '28', unit: 'PCS', qty: 120, rate: 9500, amount: 1140000 },
        { itemId: 'i2', name: 'Uniform shirt (white)', size: '30', unit: 'PCS', qty: 100, rate: 7000, amount: 700000 },
      ],
    },
  }),
  DONATION_RECEIPT: () => donationReceiptModel({
    institutionPan: null, registrationNo: null,
    donation: {
      receiptNo: 'DN2627000008', date: today(), amount: 2500000, mode: 'CHEQUE', reference: 'Cheque 004512, HDFC Bank', fund: 'SCHOLARSHIP',
      purpose: 'Merit scholarships for Class 11 students', is80G: true, status: 'RECEIVED', receivedBy: 'Accounts office',
      donor: { kind: 'ALUMNUS', name: 'Priya Venkatesh', batch: 2008, pan: 'ABCPV1234D', address: '22, 4th Main, Jayanagar 4th Block, Bengaluru 560011' },
    },
  }),
  HR_OFFER_LETTER: () => offerLetterModel({
    kind: 'CANDIDATE',
    person: { name: 'Ananya Krishnan', gender: 'FEMALE', mobile: '+91 98860 45678', email: 'ananya.k@example.com', address: null },
    offer: { designation: 'PGT — Physics', joiningDate: today(), salary: 5500000, note: '', at: new Date(), by: 'HR office' },
    requisition: { title: 'PGT Physics', category: 'TEACHING', employmentType: 'PERMANENT', requisitionNo: 'REQ2627000004' },
    department: { name: 'Science' }, branch: null, refNo: 'HR/OFFER/2026-27/0004',
  }),
  HR_RELIEVING_LETTER: () => exitSample('RELIEVING'),
  HR_EXPERIENCE_LETTER: () => exitSample('EXPERIENCE'),
  HR_EXIT_INTERVIEW: () => {
    const s = exitSample('RELIEVING')
    const pick = (list, v) => list.map(([value, label]) => ({ label, on: value === v, chosen: value === v }))
    return {
      date: today(), refNo: 'HR/EXI/T0042', staff: s.staff,
      interview: {
        recorded: true, by: 'Office HR', on: today(),
        reasons: pick([['PAY', 'Better pay elsewhere'], ['GROWTH', 'Higher post or promotion'], ['GOVT_JOB', 'Government job'], ['STUDIES', 'Higher studies (B.Ed., M.Ed., PhD)'], ['RELOCATION', 'Moving to another city'], ['FAMILY', 'Family reasons'], ['WORKLOAD', 'Workload or timetable'], ['MANAGEMENT', 'Management or head of department'], ['ENVIRONMENT', 'Working conditions'], ['HEALTH', 'Health'], ['RETIREMENT', 'Retirement'], ['OTHER', 'Other']], 'RELOCATION'),
        reasonLabel: 'Moving to another city', otherReason: 'Spouse transferred to Pune',
        ratings: [['The work itself', 5], ['Principal and head of department', 4], ['Pay and benefits', 3], ['Workload and timetable', 3], ['Colleagues', 5], ['Classrooms, labs and resources', 4]]
          .map(([aspect, score]) => ({ aspect, score, boxes: [1, 2, 3, 4, 5].map((n) => ({ n, on: n === score })) })),
        liked: 'Supportive colleagues and freedom to run the maths club.', improve: 'Fewer substitution periods; smart boards in the senior classes.',
        rejoinOptions: pick([['YES', 'Yes'], ['MAYBE', 'Maybe'], ['NO', 'No']], 'YES'),
        rehireOptions: pick([['YES', 'Can be taken back'], ['CONDITIONAL', 'Only on conditions'], ['NO', 'Not to be taken back']], 'YES'), rehireNote: null,
      },
    }
  },
  HR_NO_DUES: () => {
    const s = exitSample('RELIEVING')
    const items = [
      ['Handover of classes, syllabus status, marks and registers', 'Head of department', 'DONE', 'Mrs. Rao'], ['Exam duties, question papers and answer scripts handed over', 'Examinations', 'DONE', 'Exam cell'],
      ['Library books returned, fines paid', 'Library', 'DONE', 'Librarian'], ['ID card, keys, lab and store items returned', 'Admin office', 'DONE', 'Office'],
      ['Login, email and app access switched off', 'IT', 'DONE', 'IT desk'], ['Advances and loans settled', 'Accounts', 'NA', ''],
      ['Full and final settlement', 'Accounts', 'DONE', 'Accounts'], ['Relieving letter and experience certificate', 'HR', 'DONE', 'HR office'],
    ].map(([title, ownerLabel, status, by]) => ({ title, ownerLabel, status, statusLabel: status === 'DONE' ? 'Cleared' : 'Not needed', cleared: status === 'DONE', notNeeded: status === 'NA', pending: false, done: { by }, on: by ? today() : null }))
    return {
      date: today(), refNo: 'HR/NOD/T0042', staff: s.staff,
      clearance: { items, pending: 0, dues: 0, complete: true, completedOn: today() },
      library: { key: 'library', ok: true, booksOut: [], fines: 0, fineTotal: 0 }, advances: { key: 'advances', ok: true, loans: [], total: 0 },
    }
  },
  HR_FNF_STATEMENT: () => {
    const salaryLines = [{ code: 'BASIC', label: 'Basic', amount: 1500000, basis: '15 of 30 days' }, { code: 'DA', label: 'Dearness allowance', amount: 300000, basis: '15 of 30 days' }]
    const settlementLines = [{ code: 'LEAVE_ENCASHMENT', label: 'Leave encashment', amount: 1200000, basis: '12 day(s)' }]
    const deductions = [{ code: 'PF', label: 'Provident fund', amount: 216000 }, { code: 'NOTICE_RECOVERY', label: 'Notice-period recovery', amount: 600000, basis: '6 day(s) short of 30' }]
    return {
      institution: { name: 'St. Thomas School' },
      payslip: { no: 'PS2627000057', monthLabel: 'November 2026', draft: false, paid: true, paidOn: today(), paidMode: 'Bank transfer', reference: 'UTR 4471 2290' },
      employee: { name: 'Meera Iyer', code: 'T0042', designation: 'TGT — Mathematics', departmentName: 'Mathematics', joiningDate: '2022-06-01' },
      fnf: { lastWorkingDate: today(), serviceYears: 4.47, countedYears: 0, leaveDays: 12, noticeDays: 30, noticeServed: 24, note: 'No gratuity: 4 year(s) 5 month(s) of service (needs 5).' },
      earnings: [...salaryLines, ...settlementLines], deductions,
      totals: { gross: 3000000, deductions: 816000, net: 2184000 },
      settlement: { leaveEncashment: 1200000, gratuity: 0, noticePay: 0, noticeRecovery: 600000, salaryLines, settlementLines, payable: 2184000, payableIsRecovery: false },
      refNo: 'HR/FNF/T0042', today: today(),
    }
  },
}

// a teacher who resigned after four years, for the relieving letter and experience certificate previews
function exitSample(kind) {
  return {
    kind, date: today(), refNo: `HR/${kind === 'EXPERIENCE' ? 'EXP' : 'REL'}/2026-27/T0042`,
    staff: {
      name: 'Meera Iyer', code: 'T0042', salutation: 'Ms.', designation: 'TGT — Mathematics', category: 'Teaching', teachingStaff: true,
      department: 'Mathematics', campus: null, qualifications: 'M.Sc. Mathematics, B.Ed.', address: '14, 2nd Cross, Jayanagar, Bengaluru 560041',
      joiningDate: '2022-06-01', lastWorkingDate: today(), noticeDate: '2026-09-30', exitType: 'Resigned',
    },
    certificate: {
      conduct: 'GOOD', good: true, satisfactory: false, omit: false, duties: 'class teacher of 8 B and the school maths club',
      subjects: ['Mathematics'], classes: ['Class 6', 'Class 7', 'Class 8'], years: ['2022-23', '2026-27'], taught: true,
      subjectList: 'Mathematics', classList: 'Class 6, Class 7 and Class 8', yearRange: '2022-23 to 2026-27',
    },
  }
}
