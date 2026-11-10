// Made-up records for the template editor's preview, used only while the institution has no
// real record of a document yet (a new school has no report card or TC). Each is the model its
// template sees (see registry.js), keyed by document type; added with each document.

import { EXAM_SAMPLES } from './examSamples.js' // grade card, transcript, attainment, accreditation, label sheets
import { MONEY_SAMPLES } from './moneySamples.js' // store bill, purchase order, donation receipt, offer letter

const SAMPLES = { ...EXAM_SAMPLES, ...MONEY_SAMPLES }

/** `institution`: the profile (some samples print its state or GSTIN the way a real record would). */
export function sampleModel(docType, institution) {
  return SAMPLES[docType]?.(institution) ?? null
}
