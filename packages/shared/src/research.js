// Research (module `research`): publications, patents, funded projects and grants, PhD scholars.
// Constants and pure helpers shared by the API and the web app. Money in paise.

/** What a publication is. Patents live with publications (they count as research output, carry a number and a year). */
export const RESEARCH_PUB_TYPES = [
  { value: 'JOURNAL', label: 'Journal article', tone: 'brand' },
  { value: 'CONFERENCE', label: 'Conference paper', tone: 'sky' },
  { value: 'BOOK', label: 'Book', tone: 'violet' },
  { value: 'CHAPTER', label: 'Book chapter', tone: 'teal' },
  { value: 'PATENT', label: 'Patent', tone: 'orange' },
]
export const RESEARCH_PUB_TYPE_BY = Object.fromEntries(RESEARCH_PUB_TYPES.map((t) => [t.value, t]))

/** Where a publication is indexed (NAAC 3.3.2 counts UGC-CARE journals; NIRF counts Scopus / Web of Science). */
export const RESEARCH_INDEXING = [
  { value: 'SCOPUS', label: 'Scopus', tone: 'orange' },
  { value: 'WOS', label: 'Web of Science', tone: 'violet' },
  { value: 'UGC_CARE', label: 'UGC-CARE', tone: 'brand' },
  { value: 'PUBMED', label: 'PubMed', tone: 'sky' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]
export const RESEARCH_INDEXING_BY = Object.fromEntries(RESEARCH_INDEXING.map((t) => [t.value, t]))

/** Funding agencies of sponsored projects. */
export const RESEARCH_AGENCIES = [
  { value: 'DST', label: 'DST', kind: 'GOVT' },
  { value: 'SERB', label: 'SERB / ANRF', kind: 'GOVT' },
  { value: 'UGC', label: 'UGC', kind: 'GOVT' },
  { value: 'AICTE', label: 'AICTE', kind: 'GOVT' },
  { value: 'DBT', label: 'DBT', kind: 'GOVT' },
  { value: 'CSIR', label: 'CSIR', kind: 'GOVT' },
  { value: 'ICSSR', label: 'ICSSR', kind: 'GOVT' },
  { value: 'ICMR', label: 'ICMR', kind: 'GOVT' },
  { value: 'STATE', label: 'State government', kind: 'GOVT' },
  { value: 'INDUSTRY', label: 'Industry', kind: 'NON_GOVT' },
  { value: 'FOUNDATION', label: 'Foundation / trust', kind: 'NON_GOVT' },
  { value: 'INTERNATIONAL', label: 'International agency', kind: 'NON_GOVT' },
  { value: 'INSTITUTION', label: 'Institution seed grant', kind: 'NON_GOVT' },
  { value: 'OTHER', label: 'Other', kind: 'NON_GOVT' },
]
export const RESEARCH_AGENCY_BY = Object.fromEntries(RESEARCH_AGENCIES.map((a) => [a.value, a]))

export const RESEARCH_PROJECT_STATUS = {
  APPLIED: { label: 'Applied', tone: 'info' },
  SANCTIONED: { label: 'Sanctioned', tone: 'violet' },
  ONGOING: { label: 'Ongoing', tone: 'brand' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  REJECTED: { label: 'Not sanctioned', tone: 'neutral' },
}
/** Statuses whose money is real (sanctioned): counted in grants received. */
export const RESEARCH_FUNDED_STATUSES = ['SANCTIONED', 'ONGOING', 'COMPLETED']

export const RESEARCH_SCHOLAR_STATUS = {
  REGISTERED: { label: 'Registered', tone: 'info' },
  COURSEWORK: { label: 'Coursework', tone: 'sky' },
  SYNOPSIS: { label: 'Synopsis approved', tone: 'violet' },
  SUBMITTED: { label: 'Thesis submitted', tone: 'warning' },
  AWARDED: { label: 'Awarded', tone: 'success' },
  DISCONTINUED: { label: 'Discontinued', tone: 'neutral' },
}
export const RESEARCH_SCHOLAR_MODES = [
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'PART_TIME', label: 'Part-time' },
]

/** The columns of the publications import / export file. */
export const RESEARCH_PUB_COLUMNS = ['title', 'type', 'authors', 'venue', 'year', 'volume', 'issue', 'pages', 'doi', 'issn', 'isbn', 'indexing', 'impactFactor', 'citations', 'department']

/** "https://doi.org/10.1016/J.X.2020" or "doi:10.1016/…" → "10.1016/…" (lower-case); null when it isn't a DOI. */
export function normDoi(raw) {
  const s = String(raw ?? '').trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s.toLowerCase() : null
}
export const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : null)

/** ISSN: NNNN-NNNC with the mod-11 check digit (C may be X). */
export function isValidIssn(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '')
  if (!/^\d{7}[\dX]$/.test(s)) return false
  const sum = [...s.slice(0, 7)].reduce((n, d, i) => n + Number(d) * (8 - i), 0)
  const check = (11 - (sum % 11)) % 11
  return (check === 10 ? 'X' : String(check)) === s[7]
}
export const normIssn = (raw) => { const s = String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : String(raw ?? '').trim() }

/** h-index of a set of publications: the largest h with h papers cited at least h times each. */
export function researchHIndex(citations = []) {
  const sorted = citations.map((c) => Number(c) || 0).sort((a, b) => b - a)
  let h = 0
  while (h < sorted.length && sorted[h] >= h + 1) h++
  return h
}

/** A project's money: received and utilised as a share of what was sanctioned, and what is still to come / unspent. */
export function projectUtilisation({ sanctioned = 0, received = 0, utilised = 0 } = {}) {
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
  return {
    receivedPct: pct(received, sanctioned),
    utilisedPct: pct(utilised, received || sanctioned),
    pending: Math.max(0, sanctioned - received),
    unspent: Math.max(0, received - utilised),
  }
}

/** "Rao, K.; Mehta P" or ["Rao K", …] → clean names. */
export const researchSplitNames = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/;|\band\b|\n/)).map((x) => String(x).trim()).filter(Boolean)
