// Accreditation documents (Accreditation › Reports): the summary of a framework's return for an assessment year — NAAC
// SSR, NIRF or AISHE — criterion by criterion: each metric's value (computed or entered), status and note, and the
// narratives of the qualitative metrics. `id`: the AccrAssessment. Data from services/accreditation.js getReport.
import { ACCR_FRAMEWORK_BY, ACCR_METRIC_STATUS, ACCR_SOURCES } from '@schoolgiant/shared'
import { latestAssessmentId, reportPrintData } from '../services/accreditation.js'

const UNIT_TEXT = { pct: ' %', ratio: ' : 1', lakh: ' lakh', years: ' years', perTeacher: ' per teacher', days: ' days', perDay: ' a day', count: '' }
const valueText = (v, unit) => (v === null || v === undefined ? null : `${unit === 'lakh' ? '₹ ' : ''}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v)}${UNIT_TEXT[unit] ?? ''}`)
const plain = (md) => String(md ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()

function ssrModel(r) {
  const fw = ACCR_FRAMEWORK_BY[r.framework]
  return {
    framework: { code: r.framework, name: fw?.name ?? r.framework },
    year: r.year, range: r.range,
    summary: r.summary,
    criteria: r.criteria.map((c) => ({
      code: c.code, title: c.title, weight: c.weight, completion: c.completion,
      metrics: c.metrics.map((m) => ({
        code: m.code, title: m.title, kind: m.kind, qualitative: m.kind === 'QL',
        value: valueText(m.value, m.unit), computed: m.valueFrom === 'AUTO', source: ACCR_SOURCES[m.source]?.label ?? m.source,
        status: m.status, statusLabel: ACCR_METRIC_STATUS[m.status]?.label ?? m.status, complete: m.status === 'COMPLETE',
        note: m.note || null, narrative: plain(m.narrative) || null, words: m.words, evidence: m.evidence,
      })),
    })),
  }
}

export const ACCREDITATION_DOCS = {
  ACCREDITATION_SSR: {
    perms: ['accreditation.reports.export', 'accreditation.reports.view'],
    load: (id) => reportPrintData(id),
    model: ssrModel,
    title: (m) => `${m.framework.code} ${m.year} · summary`,
    sample: () => latestAssessmentId(),
    variables: [
      'institution.name …',
      'framework.code, framework.name · year · range.from, range.to',
      'summary.total, summary.complete, summary.draft, summary.pct, summary.computed, summary.narratives, summary.evidence',
      'criteria[] {code, title, weight, completion.pct, completion.complete, completion.total, metrics[] {code, title, kind, qualitative, value, computed, source, statusLabel, complete, note, narrative, words, evidence}}',
    ],
  },
}
