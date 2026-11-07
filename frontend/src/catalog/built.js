// Catalog pages that already have a real screen. Every other page opens the
// module placeholder (pages/ModulePage.jsx) until its phase is built.
export const BUILT_PAGES = new Set([
  'core.setup', 'core.profile', 'core.branches', 'core.departments', 'core.users',
  'core.roles', 'core.modules', 'core.subscription', 'core.audit',
  'core.numbering', 'core.settings', 'core.custom-fields', 'core.workflows', 'core.notifications-setup', 'core.forms',
  'core.masters', 'core.print-templates', 'core.api-keys',
])

export const isBuilt = (moduleId, pageId) => BUILT_PAGES.has(`${moduleId}.${pageId}`)
export const moduleHasScreens = (m) => m.pages.some((p) => isBuilt(m.id, p.id))
