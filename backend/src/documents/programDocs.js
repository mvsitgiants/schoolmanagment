// Programs & OBE documents: the attainment report of a program (`id`: the program) for its latest exam session with
// marks — CO attainment per course and the PO attainment. Data from services/programs.js programAttainment.
import { Program } from '../models/programs.js'
import { programAttainment } from '../services/programs.js'

function attainmentModel(a) {
  const pos = a.outcomes.map((o) => o.code)
  return {
    program: a.program,
    session: a.sessions.find((s) => s.id === a.sessionId)?.name ?? null,
    rules: a.rules,
    outcomes: a.outcomes,
    courses: a.courses.map((c) => ({ ...c, pos: pos.map((po) => c.poAttainment[po]) })),
    po: pos.map((code) => ({ code, value: a.po[code] })),
    summary: a.summary,
  }
}

export const PROGRAM_DOCS = {
  ATTAINMENT_REPORT: {
    perms: ['programs.attainment.view'],
    load: (id) => programAttainment(id),
    model: attainmentModel,
    title: (m) => `CO–PO attainment · ${m.program.code}${m.session ? ` · ${m.session}` : ''}`,
    sample: async () => (await Program.findOne().sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name …',
      'program.name, program.code · session · rules.targetPct, rules.internalWeight, rules.levels[] {level, min}',
      'outcomes[] {code, kind, title}',
      'courses[] {code, title, semester, average, cos[] {code, statement, bloom, internalPct, externalPct, internalLevel, externalLevel, attainment}, pos[]}',
      'po[] {code, value} · summary.courses, summary.cos, summary.cosAttained, summary.poAverage',
    ],
  },
}
