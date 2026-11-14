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

// Hindi numbers 0–99 are each their own word, so they are listed whole
const HI = ['', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे']
const HI_MONTHS = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर']
/** 2013 → 'दो हज़ार तेरह', 1998 → 'उन्नीस सौ अट्ठानवे' (as years are said in Hindi). */
function yearHi(n) {
  if (n >= 2000) return [`${HI[Math.floor(n / 1000)]} हज़ार`, n % 1000 >= 100 ? `${HI[Math.floor((n % 1000) / 100)]} सौ` : '', HI[n % 100]].filter(Boolean).join(' ')
  return [`${HI[Math.floor(n / 100)]} सौ`, HI[n % 100]].filter(Boolean).join(' ')
}

/** 0–99 999 in Hindi words: 24500 → 'चौबीस हज़ार पाँच सौ'. */
function hiNumber(n) {
  const parts = []
  const hundred = (x) => [x >= 100 ? `${HI[Math.floor(x / 100)]} सौ` : '', HI[x % 100]].filter(Boolean).join(' ')
  if (n >= 1e7) { parts.push(`${hundred(Math.floor(n / 1e7))} करोड़`); n %= 1e7 }
  if (n >= 1e5) { parts.push(`${HI[Math.floor(n / 1e5)]} लाख`); n %= 1e5 }
  if (n >= 1e3) { parts.push(`${HI[Math.floor(n / 1e3)]} हज़ार`); n %= 1e3 }
  if (n) parts.push(hundred(n))
  return parts.join(' ')
}

/** An amount in Hindi words, as receipts write it: 2450000 paise → 'चौबीस हज़ार पाँच सौ रुपये मात्र'. */
export function amountInWordsHi(paise) {
  const rupees = Math.floor(Math.abs(paise) / 100)
  const p = Math.abs(paise) % 100
  return `${paise < 0 ? 'ऋण ' : ''}${hiNumber(rupees) || 'शून्य'} ${rupees === 1 ? 'रुपया' : 'रुपये'}${p ? ` और ${HI[p]} पैसे` : ''} मात्र`
}

/** '2013-05-10' → 'Tenth May Two Thousand Thirteen' — in Hindi 'दस मई दो हज़ार तेरह' ('' when not a date). */
export function dateInWords(ymd, lang = 'en') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '')
  if (!m) return ''
  if (lang === 'hi') return `${HI[Number(m[3])]} ${HI_MONTHS[Number(m[2]) - 1]} ${yearHi(Number(m[1]))}`
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${year(Number(m[1]))}`
}

export const CATEGORY_LABEL_OF = (v) => STUDENT_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? null
export const LEAVING_REASON_LABEL_OF = (v) => LEAVING_REASONS.find((r) => r.value === v)?.label ?? null

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 }
// कक्षा is feminine: पहली, दूसरी … आठवीं
const HI_ORD = ['', 'पहली', 'दूसरी', 'तीसरी', 'चौथी', 'पाँचवीं', 'छठी', 'सातवीं', 'आठवीं', 'नौवीं', 'दसवीं', 'ग्यारहवीं', 'बारहवीं', 'तेरहवीं', 'चौदहवीं', 'पंद्रहवीं', 'सोलहवीं', 'सत्रहवीं', 'अठारहवीं', 'उन्नीसवीं', 'बीसवीं']
/** 'Class 8 – A' → 'Eighth' (Hindi 'आठवीं'), 'Class IX' → 'Ninth' (TCs give the class in words too); '' when the label has no number. */
export function classInWords(label, lang = 'en') {
  const s = String(label ?? '')
  const n = Number(/\b(\d{1,2})\b/.exec(s)?.[1] ?? ROMAN[/\b(XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\b/.exec(s)?.[1]] ?? 0)
  return n > 0 && n <= 20 ? (lang === 'hi' ? HI_ORD[n] : ORD[n]) : ''
}

/** 'MALE' → he / his / him, 'FEMALE' → she / her; anyone else 'he/she'. Master / Kumari as Indian certificates write it. */
export function pronounsOf(gender) {
  if (gender === 'MALE') return { kid: 'm', he: 'he', He: 'He', his: 'his', His: 'His', him: 'him', title: 'Master', rel: 'S/o', child: 'son', pupil: 'student' }
  if (gender === 'FEMALE') return { kid: 'f', he: 'she', He: 'She', his: 'her', His: 'Her', him: 'her', title: 'Kumari', rel: 'D/o', child: 'daughter', pupil: 'student' }
  return { kid: 'x', he: 'he/she', He: 'He/She', his: 'his/her', His: 'His/Her', him: 'him/her', title: '', rel: 'S/o / D/o', child: 'ward', pupil: 'student' }
}
