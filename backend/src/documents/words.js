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
