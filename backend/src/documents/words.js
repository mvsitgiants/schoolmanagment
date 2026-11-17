// Words printed on documents — amounts, dates and classes written out in words — and labels by code.
//
// The words themselves live in each language's printWords.json (frontend/src/i18n/locales/<lang>/printWords.json):
// numbers 0–99, hundred / thousand / lakh / crore, months, days, class ordinals, division names and how an amount
// reads. One rule below (Indian grouping) puts them together for every language, so a new language needs only its
// printWords.json — no code. English below is the built-in fallback when a file can't be read.
import { LEAVING_REASONS, STUDENT_CATEGORIES } from '@schoolgiant/shared'
import { getBundle } from './locales.js'

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth']
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const ordinal = (n) => (n <= 20 ? ORD[n] : n === 30 ? 'Thirtieth' : `${TENS[Math.floor(n / 10)]} ${ORD[n % 10]}`)

const ENGLISH = {
  numbers: Array.from({ length: 100 }, (_, n) => two(n)),
  zero: 'Zero', hundred: 'Hundred', thousand: 'Thousand', lakh: 'Lakh', crore: 'Crore',
  rupee: 'Rupees', rupees: 'Rupees',
  amount: '{{unit}} {{rupees}} Only', amountWithPaise: '{{unit}} {{rupees}} and {{paise}} Paise Only', negative: 'Minus {{amount}}',
  days: Array.from({ length: 32 }, (_, n) => (n ? ordinal(n) : '')),
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  date: '{{day}} {{month}} {{year}}', yearsBefore2000: 'thousands',
  classOrdinals: ORD,
  divisions: ['First division', 'Second division', 'Third division', 'Fail'],
}

/** The words of one language: its printWords.json over English (anything it leaves out prints in English). */
export function wordsFor(lang = 'en') {
  const en = getBundle('en', 'printWords')
  const own = lang && lang !== 'en' ? getBundle(lang, 'printWords') : null
  return { ...ENGLISH, ...(en ?? {}), ...(own ?? {}) }
}

const fill = (text, vars) => String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] ?? '' : m)).replace(/\s+/g, ' ').trim()
const word = (W, n) => W.numbers?.[n] ?? ''
/** 0–999: 'Four Hundred Fifty' / 'चार सौ पचास'. */
const upTo999 = (W, x) => [x >= 100 ? `${word(W, Math.floor(x / 100))} ${W.hundred}` : '', word(W, x % 100)].filter(Boolean).join(' ')

/** A whole number in words, Indian grouping: 24500 → 'Twenty Four Thousand Five Hundred' / 'चौबीस हज़ार पाँच सौ'; '' for 0. */
export function numberInWords(n, lang = 'en') {
  const W = wordsFor(lang)
  const parts = []
  if (n >= 1e7) { parts.push(`${upTo999(W, Math.floor(n / 1e7))} ${W.crore}`); n %= 1e7 }
  if (n >= 1e5) { parts.push(`${word(W, Math.floor(n / 1e5))} ${W.lakh}`); n %= 1e5 }
  if (n >= 1e3) { parts.push(`${word(W, Math.floor(n / 1e3))} ${W.thousand}`); n %= 1e3 }
  if (n) parts.push(upTo999(W, n))
  return parts.join(' ')
}

/** An amount as receipts write it: 2450000 paise → 'Rupees Twenty Four Thousand Five Hundred Only' / 'चौबीस हज़ार पाँच सौ रुपये मात्र'. */
export function amountInWordsFor(paise, lang = 'en') {
  const W = wordsFor(lang)
  const rupees = Math.floor(Math.abs(paise) / 100)
  const p = Math.abs(paise) % 100
  const vars = { unit: rupees === 1 ? W.rupee : W.rupees, rupees: numberInWords(rupees, lang) || W.zero, paise: word(W, p) }
  const text = fill(p ? W.amountWithPaise : W.amount, vars)
  return paise < 0 ? fill(W.negative, { amount: text }) : text
}

/** A year as it is said: 2013 → 'Two Thousand Thirteen'; 1998 → 'उन्नीस सौ अट्ठानवे' where yearsBefore2000 is 'hundreds'. */
function yearInWords(W, y) {
  if (y < 2000 && W.yearsBefore2000 === 'hundreds') return [`${word(W, Math.floor(y / 100))} ${W.hundred}`, word(W, y % 100)].filter(Boolean).join(' ')
  const h = Math.floor((y % 1000) / 100)
  return [`${word(W, Math.floor(y / 1000))} ${W.thousand}`, h ? `${word(W, h)} ${W.hundred}` : '', word(W, y % 100)].filter(Boolean).join(' ')
}

/** '2013-05-10' → 'Tenth May Two Thousand Thirteen' — in Hindi 'दस मई दो हज़ार तेरह' ('' when not a date). */
export function dateInWords(ymd, lang = 'en') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '')
  if (!m) return ''
  const W = wordsFor(lang)
  return fill(W.date, { day: W.days?.[Number(m[3])] ?? '', month: W.months?.[Number(m[2]) - 1] ?? '', year: yearInWords(W, Number(m[1])) })
}

export const CATEGORY_LABEL_OF = (v) => STUDENT_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? null
export const LEAVING_REASON_LABEL_OF = (v) => LEAVING_REASONS.find((r) => r.value === v)?.label ?? null

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 }
/** 'Class 8 – A' → 'Eighth' (Hindi 'आठवीं'), 'Class IX' → 'Ninth' (TCs give the class in words too); '' when the label has no number. */
export function classInWords(label, lang = 'en') {
  const s = String(label ?? '')
  const n = Number(/\b(\d{1,2})\b/.exec(s)?.[1] ?? ROMAN[/\b(XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\b/.exec(s)?.[1]] ?? 0)
  return n > 0 && n <= 20 ? wordsFor(lang).classOrdinals?.[n] ?? '' : ''
}

/** 'MALE' → he / his / him, 'FEMALE' → she / her; anyone else 'he/she'. Master / Kumari as Indian certificates write it. */
export function pronounsOf(gender) {
  if (gender === 'MALE') return { kid: 'm', he: 'he', He: 'He', his: 'his', His: 'His', him: 'him', title: 'Master', rel: 'S/o', child: 'son', pupil: 'student' }
  if (gender === 'FEMALE') return { kid: 'f', he: 'she', He: 'She', his: 'her', His: 'Her', him: 'her', title: 'Kumari', rel: 'D/o', child: 'daughter', pupil: 'student' }
  return { kid: 'x', he: 'he/she', He: 'He/She', his: 'his/her', His: 'His/Her', him: 'him/her', title: '', rel: 'S/o / D/o', child: 'ward', pupil: 'student' }
}
