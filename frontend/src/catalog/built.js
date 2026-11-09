// Catalog pages that already have a real screen. Every other page opens the
// module placeholder (pages/ModulePage.jsx) until its phase is built.
export const BUILT_PAGES = new Set([
  'core.setup', 'core.profile', 'core.branches', 'core.departments', 'core.users',
  'core.roles', 'core.modules', 'core.subscription', 'core.audit',
  'core.numbering', 'core.settings', 'core.custom-fields', 'core.workflows', 'core.notifications-setup', 'core.forms',
  'core.masters', 'core.print-templates', 'core.api-keys',
  'academics.years', 'academics.classes', 'academics.subjects', 'academics.grading', 'academics.allocation',
  'students.admit', 'students.directory', 'students.profile', 'students.guardians', 'students.promotion', 'students.transfer', 'students.id-cards',
  'admissions.enquiries', 'admissions.applications', 'admissions.tests', 'admissions.merit', 'admissions.settings',
  'timetable.timetable', 'timetable.substitutions', 'timetable.rooms',
  'hrms.employees', 'hrms.attendance', 'hrms.leave', 'hrms.holidays', 'hrms.hiring', 'hrms.performance',
  'payroll.structures', 'payroll.statutory', 'payroll.loans', 'payroll.runs', 'payroll.payslips', 'payroll.exports',
  'finance.accounts', 'finance.journals', 'finance.expenses', 'finance.bank', 'finance.reports',
  'lms.courses', 'lms.live-classes', 'lms.question-bank',
  'online-tests.tests', 'online-tests.attempts',
  'transport.routes', 'transport.vehicles', 'transport.assignments', 'transport.tracking',
  'library.catalogue', 'library.circulation', 'library.fines',
  'events.calendar', 'events.ptm', 'events.gallery',
  'attendance.mark', 'attendance.register', 'attendance.leave', 'attendance.reports',
  'fees.structures', 'fees.collect', 'fees.invoices', 'fees.dues', 'fees.concessions', 'fees.refunds', 'fees.day-end', 'fees.online',
  'analytics.academics', 'analytics.fees', 'analytics.campuses', 'ai.assistant', 'ai.question-papers', 'ai.remarks', 'integrations.payments', 'integrations.messaging', 'integrations.devices', 'integrations.logs', 'programs.programs', 'programs.outcomes', 'programs.attainment', 'registration.windows', 'registration.requests', 'coe.marks', 'coe.revaluation', 'coe.grade-cards',
  'exams.schedule', 'exams.hall-tickets', 'exams.seating', 'exams.question-papers', 'exams.marks', 'exams.results', 'exams.report-cards', 'exams.setup',
  'homework.homework', 'homework.lesson-plans', 'homework.syllabus',
  'certificates.issue', 'certificates.register',
  'dashboard.command', 'reports.library', 'reports.builder',
  'portal.settings', 'portal.content',
  'communication.notices', 'communication.messages', 'communication.chat', 'communication.log',
])

export const isBuilt = (moduleId, pageId) => BUILT_PAGES.has(`${moduleId}.${pageId}`)
export const moduleHasScreens = (m) => m.pages.some((p) => isBuilt(m.id, p.id))
