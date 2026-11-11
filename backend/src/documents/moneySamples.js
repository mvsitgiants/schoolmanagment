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
}
