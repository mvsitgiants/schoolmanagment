// Money is stored as integer paise everywhere (docs/02_DATA_MODEL.md §1.2).

export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100)
export const toRupees = (paise) => Number(paise || 0) / 100

/** ₹ 14,999 — Indian digit grouping, no decimals when whole. */
export function formatINR(paise, { decimals } = {}) {
  const rupees = toRupees(paise)
  const d = decimals ?? (Number.isInteger(rupees) ? 0 : 2)
  return (rupees < 0 ? '−₹' : '₹') + Math.abs(rupees).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** Short form for KPI tiles and chart axes: ₹950 · ₹62.2K · ₹7.46L · ₹1.2Cr (Indian units). */
export function formatINRCompact(paise) {
  const r = toRupees(paise)
  const a = Math.abs(r)
  const fmt = (v, unit, digits) => `₹${Number(v.toFixed(digits))}${unit}`
  if (a >= 1e7) return fmt(r / 1e7, 'Cr', a >= 1e8 ? 1 : 2)
  if (a >= 1e5) return fmt(r / 1e5, 'L', a >= 1e6 ? 1 : 2)
  if (a >= 1e3) return fmt(r / 1e3, 'K', a >= 1e4 ? 1 : 2)
  return `₹${Math.round(r)}`
}

// ───────────────────────────────────────────────────────── amounts in words (receipts, invoices)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const three = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ')

/** "Rupees One Thousand Two Hundred Fifty Only" — Indian grouping (lakh, crore). */
export function amountInWords(paise) {
  const rupees = Math.floor(Math.abs(paise) / 100)
  const p = Math.abs(paise) % 100
  if (!rupees && !p) return 'Rupees Zero Only'
  const parts = []
  const crore = Math.floor(rupees / 1e7)
  const lakh = Math.floor((rupees % 1e7) / 1e5)
  const thousand = Math.floor((rupees % 1e5) / 1e3)
  const rest = rupees % 1e3
  if (crore) parts.push(`${three(crore)} Crore`)
  if (lakh) parts.push(`${two(lakh)} Lakh`)
  if (thousand) parts.push(`${two(thousand)} Thousand`)
  if (rest) parts.push(three(rest))
  return `${paise < 0 ? 'Minus ' : ''}Rupees ${parts.join(' ') || 'Zero'}${p ? ` and ${two(p)} Paise` : ''} Only`
}

// ───────────────────────────────────────────────────────── GST and Indian states

/** The two-digit state code a GSTIN starts with, or null when it isn't a GSTIN. */
export const gstStateOf = (gstin) => (/^\d{2}[0-9A-Z]{13}$/.test(String(gstin ?? '').trim().toUpperCase()) ? String(gstin).trim().slice(0, 2) : null)

export const INDIAN_STATES = [
  ['AN', 'Andaman and Nicobar Islands'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'], ['CH', 'Chandigarh'],
  ['CT', 'Chhattisgarh'], ['DL', 'Delhi'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'], ['JK', 'Jammu and Kashmir'],
  ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'],
  ['ML', 'Meghalaya'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OR', 'Odisha'], ['PY', 'Puducherry'], ['PB', 'Punjab'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal'],
].map(([code, name]) => ({ code, name }))

/** 'Karnataka' / 'karnataka' / 'KA' → 'KA' (null when unknown). */
export function stateCodeOf(text) {
  const s = String(text ?? '').trim().toLowerCase()
  if (!s) return null
  const hit = INDIAN_STATES.find((x) => x.code.toLowerCase() === s || x.name.toLowerCase() === s)
  if (hit) return hit.code
  if (s === 'ts' || s === 'telangana state') return 'TG'
  if (s === 'orissa') return 'OR'
  return null
}
