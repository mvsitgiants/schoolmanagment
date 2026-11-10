// Alumni documents: the donation receipt (`id`: the donation). Data from services/alumniDonations.js donationPrintData.
import { PAYMENT_MODE_LABEL, donationFundLabel } from '@schoolgiant/shared'
import { donationPrintData, latestDonationId } from '../services/alumniDonations.js'

export function donationReceiptModel({ donation: d, institutionPan, registrationNo }) {
  return {
    receipt: {
      no: d.receiptNo, date: d.date, amount: d.amount, mode: PAYMENT_MODE_LABEL[d.mode] ?? d.mode, modeCode: d.mode, cash: d.mode === 'CASH', reference: d.reference ?? null,
      fund: donationFundLabel(d.fund), purpose: d.purpose ?? null, is80G: !!d.is80G, cancelled: d.status === 'CANCELLED', receivedBy: d.receivedBy ?? null,
    },
    donor: { name: d.donor?.name, alumnus: d.donor?.kind === 'ALUMNUS', batch: d.donor?.batch ?? null, pan: d.donor?.pan ?? null, address: d.donor?.address ?? null, email: d.donor?.email ?? null, mobile: d.donor?.mobile ?? null },
    tax: { pan: institutionPan, registrationNo },
  }
}

export const ALUMNI_DOCS = {
  DONATION_RECEIPT: {
    perms: ['alumni.donations.view'],
    load: (id) => donationPrintData(id),
    model: donationReceiptModel,
    title: (m) => `${m.receipt.no} · ${m.donor.name}`,
    sample: () => latestDonationId(),
    variables: [
      'institution.name …',
      'receipt.no, receipt.date, receipt.amount, receipt.mode, receipt.reference, receipt.fund, receipt.purpose, receipt.is80G, receipt.cancelled, receipt.receivedBy · {{money receipt.amount}} · {{words receipt.amount}}',
      'donor.name, donor.alumnus, donor.batch, donor.pan, donor.address, donor.email, donor.mobile',
      'tax.pan, tax.registrationNo (the institution’s PAN and registration, printed on 80G receipts)',
      'institution.trustName, institution.legalName, institution.pan, institution.reg80G (80G registration no. and validity — Institution profile) · receipt.modeCode, receipt.cash',
    ],
  },
}
