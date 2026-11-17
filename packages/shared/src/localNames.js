// Names in other languages (Administration › Names in other languages).
//
// The English as saved stays on every record. Beside it, each language keeps a glossary of the institution's own
// texts — a student's or parent's name, a subject, a class, an exam, a fee head, the school's name and address,
// any word a document prints ("Outstanding", "Term 2") — keyed by the exact English. A print template in that language
// (Print language) then shows the local text wherever the English appears, or both (NAMES_IN).
import { SUPPORTED_LANGUAGES } from './languages.js'

/** Where the English texts on the page come from. `people` = names, written out in the language's script (transliterated). */
export const LOCAL_NAME_KINDS = [
  { value: 'students', label: 'Students', people: true },
  { value: 'parents', label: 'Parents & guardians', people: true },
  { value: 'staff', label: 'Staff', people: true },
  { value: 'school', label: 'School & campuses' },
  { value: 'classes', label: 'Classes' },
  { value: 'subjects', label: 'Subjects' },
  { value: 'exams', label: 'Exams' },
  { value: 'fees', label: 'Fee heads' },
  { value: 'phrases', label: 'Words & phrases' },
]
export const LOCAL_NAME_KIND_BY = Object.fromEntries(LOCAL_NAME_KINDS.map((k) => [k.value, k]))

/** How a template in another language prints the institution's own names (PrintTemplate.namesIn; empty = LOCAL). */
export const NAMES_IN = [
  { value: 'LOCAL', label: 'In the language, where saved' }, // गरिमा मौर्य
  { value: 'BOTH', label: 'In the language, with the English' }, // गरिमा मौर्य (Garima Maurya)
  { value: 'SAVED', label: 'As saved (English)' },
]

/** Languages a glossary can be kept in: every app language but English. */
export const localNameLanguages = () => SUPPORTED_LANGUAGES.filter((l) => l.code !== 'en')

/** The glossary key of an English text: trimmed, single spaces, lower case ("  GARIMA  maurya" → "garima maurya"). */
export const localKey = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Most a glossary entry holds, and how many go to the AI in one call. */
export const LOCAL_TEXT_MAX = 300
export const LOCAL_SUGGEST_BATCH = 60
