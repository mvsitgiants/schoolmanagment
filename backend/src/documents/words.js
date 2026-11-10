// Words printed on documents: a date of birth in words (as TCs need it) and labels by code.
import { LEAVING_REASONS, STUDENT_CATEGORIES } from '@schoolgiant/shared'

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const ordinal = (n) => (n <= 20 ? ORD[n] : n === 30 ? 'Thirtieth' : `${TENS[Math.floor(n / 10)]} ${ORD[n % 10]}`)
function year(n) {
  const th = Math.floor(n / 1000)
  const rest = n % 1000
  const h = Math.floor(rest / 100)
  return [th ? `${ONES[th]} Thousand` : '', h ? `${ONES[h]} Hundred` : '', two(rest % 100)].filter(Boolean).join(' ')
}

/** '2013-05-10' → 'Tenth May Two Thousand Thirteen' ('' when not a date). */
export function dateInWords(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '')
  if (!m) return ''
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${year(Number(m[1]))}`
}

export const CATEGORY_LABEL_OF = (v) => STUDENT_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? null
export const LEAVING_REASON_LABEL_OF = (v) => LEAVING_REASONS.find((r) => r.value === v)?.label ?? null

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 }
/** 'Class 8 – A' → 'Eighth', 'Class IX' → 'Ninth' (TCs give the class in words too); '' when the label has no number. */
export function classInWords(label) {
  const s = String(label ?? '')
  const n = Number(/\b(\d{1,2})\b/.exec(s)?.[1] ?? ROMAN[/\b(XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\b/.exec(s)?.[1]] ?? 0)
  return n > 0 && n <= 20 ? ORD[n] : ''
}

/** 'MALE' → he / his / him, 'FEMALE' → she / her; anyone else 'he/she'. Master / Kumari as Indian certificates write it. */
export function pronounsOf(gender) {
  if (gender === 'MALE') return { kid: 'm', he: 'he', He: 'He', his: 'his', His: 'His', him: 'him', title: 'Master', rel: 'S/o', child: 'son' }
  if (gender === 'FEMALE') return { kid: 'f', he: 'she', He: 'She', his: 'her', His: 'Her', him: 'her', title: 'Kumari', rel: 'D/o', child: 'daughter' }
  return { kid: 'x', he: 'he/she', He: 'He/She', his: 'his/her', His: 'His/Her', him: 'him/her', title: '', rel: 'S/o / D/o', child: 'ward' }
}
