import { MODULES, permKey } from '@schoolgiant/shared'
import { PrintTemplate } from '../models/printing.js'
import { AcademicYear, ClassLevel, GradingScheme, Subject } from '../models/academics.js'
import { Branch, CustomFieldDef, Department, Role, User } from '../models/tenant.js'
import { can, moduleEnabled } from '../platform/access.js'

// Masters hub (core/masters): every set-up page the caller can open, grouped by area,
// with how many records each master holds. A page whose data lives elsewhere (profile,
// settings…) is listed without a count.

/** page key → the collection behind it. Add a line when a new master gets a screen. */
export const MASTER_SOURCES = {
  'core.branches': Branch,
  'core.departments': Department,
  'core.users': User,
  'core.roles': Role,
  'core.custom-fields': CustomFieldDef,
  'core.print-templates': PrintTemplate,
  'academics.years': AcademicYear,
  'academics.classes': ClassLevel,
  'academics.subjects': Subject,
  'academics.grading': GradingScheme,
  // module masters join as they are built: 'fees.structures': FeeStructure, …
}

async function countOf(Model) {
  const hasActive = !!Model.schema.path('active')
  const [total, active, last] = [
    await Model.countDocuments(),
    hasActive ? await Model.countDocuments({ active: { $ne: false } }) : null,
    await Model.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]
  return { total, active, updatedAt: last?.updatedAt ?? null }
}

export async function mastersHub(auth) {
  const pages = []
  for (const m of MODULES) {
    if (!moduleEnabled(auth, m.id)) continue
    for (const p of m.pages) {
      const key = `${m.id}.${p.id}`
      if (!p.setup || key === 'core.masters' || !can(auth, permKey(m.id, p.id, 'view'))) continue
      const Model = MASTER_SOURCES[key]
      pages.push({ key, moduleId: m.id, pageId: p.id, ...(Model ? await countOf(Model) : {}) })
    }
  }
  return pages
}
