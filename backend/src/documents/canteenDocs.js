// Canteen documents: the token slip handed over at the counter (`?id=` the order), on the 80 mm receipt roll.
// Data from services/canteen.js (tokenPrintData).
import { latestTokenOrderId, tokenPrintData } from '../services/canteen.js'

export function canteenTokenModel({ order: o, campus, payLabel, scanCode }) {
  return {
    token: {
      no: o.token ?? null, orderNo: o.orderNo, date: o.date, at: o.at, total: o.total, payMode: payLabel ?? o.payMode,
      preorder: o.source === 'PREORDER', campus: campus ?? null, student: o.studentName ?? null, admissionNo: o.admissionNo ?? null,
      scanCode: scanCode ?? null, // SGT1.<order>.<signature>: scanned at the counter to hand the order over
    },
    lines: (o.lines ?? []).map((l) => ({ name: l.name, qty: l.qty, price: l.price, amount: l.price * l.qty })),
  }
}

export const CANTEEN_DOCS = {
  CANTEEN_TOKEN: {
    perms: ['canteen.orders.view'],
    load: (id) => tokenPrintData(id),
    model: canteenTokenModel,
    // the built-in template always prints on the 80 mm roll (a saved template picks its own paper)
    thermal: () => true,
    title: (m) => `Token ${m.token.no ?? '—'} · ${m.token.orderNo}`,
    sample: () => latestTokenOrderId(),
    variables: ['institution.name …', 'token.no, token.orderNo, token.date, token.at, token.total, token.payMode, token.preorder, token.campus, token.student, token.admissionNo, token.scanCode',
      'lines[] {name, qty, price, amount} · {{money x}} · {{time token.at}} · {{qr token.scanCode 16}}'],
  },
}
