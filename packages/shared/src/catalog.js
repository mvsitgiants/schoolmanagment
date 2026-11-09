// The module → page → action catalog. Single source of truth for:
//   · the sidebar and route gate (web)
//   · the role designer's permission matrix (web)
//   · requirePermission() keys and the catalog endpoint (api)
//   · subscription plans (which modules a plan switches on)
//
// Permission key = `<module>.<page>.<action>`, e.g. `exams.marks.lock`.
// English names live here as fallbacks; the UI shows them through the `catalog` locale
// namespace (frontend/src/i18n/locales/<lang>/catalog.json), keyed by id.
//
// `phase` = the roadmap phase a module or page ships in (see the SchoolGiant product plan).

export const CATEGORIES = [
  { id: 'platform', label: 'Administration', color: '#5B616E' },
  { id: 'students', label: 'Students & admissions', color: '#0E7C86' },
  { id: 'academics', label: 'Academics', color: '#3358D6' },
  { id: 'higher', label: 'Higher education', color: '#8B5CF6' },
  { id: 'finance', label: 'Fees & finance', color: '#B9821F' },
  { id: 'people', label: 'Staff & HR', color: '#7A5CC8' },
  { id: 'campus', label: 'Campus operations', color: '#1F9D66' },
  { id: 'engage', label: 'Communication', color: '#0EA5E9' },
  { id: 'intel', label: 'Reports & AI', color: '#E2A63A' },
]

/** Standard action tokens used in the compact page definitions below. */
const STD = {
  V: 'view', C: 'create', E: 'edit', D: 'delete', X: 'export', I: 'import',
  P: 'print', Ap: 'approve', Ca: 'cancel', S: 'sign',
}

export const STANDARD_ACTIONS = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', export: 'Export',
  import: 'Import', print: 'Print', approve: 'Approve', cancel: 'Cancel', sign: 'Sign',
}

/** Labels for named actions whose id doesn't read well on its own. */
const ACTION_LABELS = {
  reset_password: 'Reset password', revoke_sessions: 'Sign out devices', assign: 'Assign to users',
  publish: 'Publish', manage: 'Change plan', view_sensitive: 'See unmasked IDs', merge: 'Merge',
  send: 'Send', discount: 'Give concession', refund: 'Refund', close: 'Close', approve_variance: 'Approve cash variance',
  lock: 'Lock marks', unlock: 'Unlock marks', promote: 'Promote', issue: 'Issue', receive: 'Return',
  generate: 'Generate', calculate: 'Calculate', pay: 'Pay', post: 'Post', reverse: 'Reverse', reconcile: 'Reconcile',
  terminate: 'Terminate', view_salary: 'See salary', apply_on_behalf: 'Apply on behalf', edit_lop: 'Edit LOP',
  evaluate: 'Evaluate', start: 'Start', configure: 'Configure', run: 'Run', schedule: 'Schedule', share: 'Share',
  resolve: 'Resolve', allot: 'Allot', checkin: 'Check in', checkout: 'Check out', track: 'Live tracking',
  verify: 'Verify', upload: 'Upload', ask: 'Ask', moderate: 'Moderate',
}

const titleCase = (id) => id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** 'V C E D refund!' → [{ id, label, sensitive, standard }] */
function parseActions(spec) {
  return spec.split(/\s+/).filter(Boolean).map((tok) => {
    const sensitive = tok.endsWith('!')
    const raw = sensitive ? tok.slice(0, -1) : tok
    const id = STD[raw] || raw
    const standard = !!STANDARD_ACTIONS[id]
    return { id, label: STANDARD_ACTIONS[id] || ACTION_LABELS[id] || titleCase(id), sensitive, standard }
  })
}

/** Page helper. `setup: true` marks master/config pages (left out of "work" template levels). */
const pg = (id, name, actions, opts = {}) => ({ id, name, actions: parseActions(actions), ...opts })

/**
 * Data scopes, narrowest first. A role's scope per module decides which records it sees:
 * a class teacher marks attendance for OWN / CLASS, a principal sees ALL campuses.
 * (`BRANCH` is the internal id of a campus.)
 */
export const DATA_SCOPES = ['OWN', 'CLASS', 'DEPARTMENT', 'BRANCH', 'ALL']
const CLASS_SCOPES = ['OWN', 'CLASS', 'BRANCH', 'ALL']
const ORG_SCOPES = ['OWN', 'DEPARTMENT', 'BRANCH', 'ALL']
const SITE_SCOPES = ['BRANCH', 'ALL']

export const SCOPE_LABELS = {
  OWN: 'Own records',
  CLASS: 'My classes',
  DEPARTMENT: 'My departments',
  BRANCH: 'My campus',
  ALL: 'All campuses',
}

// prettier-ignore
export const MODULES = [
  // ───────────────────────────────── Administration
  { id: 'dashboard', name: 'Dashboard', category: 'platform', icon: 'LayoutDashboard', mandatory: true, phase: 1,
    desc: 'Role home and the principal’s command centre.',
    pages: [pg('command', 'Command centre', 'V')] },
  { id: 'core', name: 'Administration', category: 'platform', icon: 'Settings2', mandatory: true, phase: 0,
    desc: 'Institution profile, campuses, users, roles, subscription and every setting.',
    pages: [
      pg('setup', 'Setup hub', 'V'),
      pg('profile', 'Institution profile', 'V E', { setup: true }),
      pg('branches', 'Campuses', 'V C E D', { setup: true }),
      pg('departments', 'Departments', 'V C E D X I', { setup: true }),
      pg('users', 'Users', 'V C E D X I reset_password! revoke_sessions', { setup: true }),
      pg('roles', 'Roles & permissions', 'V C E D assign!', { setup: true }),
      pg('modules', 'Modules', 'V E', { setup: true }),
      pg('subscription', 'Subscription & billing', 'V manage!', { setup: true }),
      pg('masters', 'Masters hub', 'V', { setup: true }),
      pg('custom-fields', 'Custom fields', 'V C E D', { setup: true }),
      pg('forms', 'Form builder', 'V C E D publish', { setup: true }),
      pg('workflows', 'Workflows & approvals', 'V E', { setup: true }),
      pg('numbering', 'Number series', 'V E', { setup: true }),
      pg('print-templates', 'Print templates', 'V C E D', { setup: true }),
      pg('notifications-setup', 'Notification rules', 'V E', { setup: true }),
      pg('audit', 'Audit log', 'V X', { setup: true }),
      pg('api-keys', 'API keys & webhooks', 'V C E D', { setup: true }),
      pg('settings', 'Settings', 'V E', { setup: true }),
    ] },

  // ───────────────────────────────── Students & admissions
  { id: 'students', name: 'Students', category: 'students', icon: 'GraduationCap', deps: ['academics'], phase: 1, scopes: CLASS_SCOPES,
    desc: 'Student information system: admission, profile, guardians, documents, promotion and transfer.',
    pages: [
      pg('admit', 'New admission', 'V C'),
      pg('directory', 'Student directory', 'V X I'),
      pg('profile', 'Student 360', 'V E P view_sensitive!'),
      pg('guardians', 'Parents & guardians', 'V C E'),
      pg('promotion', 'Promotion', 'V promote!'),
      pg('transfer', 'Transfer & leaving', 'V C Ap P'),
      pg('id-cards', 'ID cards', 'V P'),
    ] },
  { id: 'admissions', name: 'Admissions', category: 'students', icon: 'UserPlus', deps: ['students'], phase: 2, scopes: SITE_SCOPES,
    desc: 'Enquiry CRM, online application, entrance test, merit list and seat allotment.',
    pages: [
      pg('enquiries', 'Enquiries', 'V C E X I'),
      pg('applications', 'Applications', 'V C E Ap'),
      pg('tests', 'Entrance tests', 'V C E'),
      pg('merit', 'Merit lists', 'V publish allot'),
      pg('settings', 'Admission settings', 'V E', { setup: true }),
    ] },
  { id: 'certificates', name: 'Certificates', category: 'students', icon: 'FileBadge', deps: ['students'], phase: 1, scopes: SITE_SCOPES,
    desc: 'Bonafide, character, leaving and transfer certificates with QR verification.',
    pages: [
      pg('issue', 'Issue certificates', 'V C P'),
      pg('register', 'Certificate register', 'V X Ca!'),
    ] },
  { id: 'frontoffice', name: 'Front office', category: 'students', icon: 'ConciergeBell', deps: [], phase: 3, scopes: SITE_SCOPES,
    desc: 'Visitor log, gate passes, call log and complaints.',
    pages: [
      pg('visitors', 'Visitor log', 'V C checkout'),
      pg('gate-pass', 'Gate passes', 'V C Ap'),
      pg('complaints', 'Complaints', 'V C assign resolve'),
    ] },

  // ───────────────────────────────── Academics
  { id: 'academics', name: 'Academic setup', category: 'academics', icon: 'School', deps: [], phase: 1,
    desc: 'Academic years, terms, classes and sections, subjects and grading schemes.',
    pages: [
      pg('years', 'Academic years & terms', 'V C E D', { setup: true }),
      pg('classes', 'Classes & sections', 'V C E D I', { setup: true }),
      pg('subjects', 'Subjects', 'V C E D I', { setup: true }),
      pg('grading', 'Grading schemes', 'V C E D', { setup: true }),
      pg('allocation', 'Teacher allocation', 'V E'),
    ] },
  { id: 'attendance', name: 'Attendance', category: 'academics', icon: 'CalendarCheck', deps: ['students'], phase: 1, scopes: CLASS_SCOPES,
    desc: 'Daily or period-wise attendance, absence alerts to parents and student leave.',
    pages: [
      pg('mark', 'Mark attendance', 'V C E'),
      pg('register', 'Attendance register', 'V X'),
      pg('leave', 'Student leave', 'V Ap'),
      pg('reports', 'Attendance reports', 'V X'),
    ] },
  { id: 'homework', name: 'Homework & lessons', category: 'academics', icon: 'NotebookPen', deps: ['students'], phase: 1, scopes: CLASS_SCOPES,
    desc: 'Lesson plans, syllabus tracking, homework and submissions.',
    pages: [
      pg('lesson-plans', 'Lesson plans', 'V C E D'),
      pg('syllabus', 'Syllabus tracker', 'V E'),
      pg('homework', 'Homework', 'V C E D'),
    ] },
  { id: 'exams', name: 'Exams & report cards', category: 'academics', icon: 'ClipboardCheck', deps: ['students'], phase: 1, scopes: CLASS_SCOPES,
    desc: 'Exam schedule, seating and invigilation, question papers, hall tickets, marks entry, results and report cards.',
    pages: [
      pg('schedule', 'Exam schedule', 'V C E D'),
      pg('hall-tickets', 'Hall tickets', 'V P'),
      pg('seating', 'Seating & invigilation', 'V C E D P publish!'),
      pg('question-papers', 'Question papers', 'V C E D P Ap!'),
      pg('marks', 'Marks entry', 'V C E lock unlock!'),
      pg('results', 'Results', 'V X publish!'),
      pg('report-cards', 'Report cards', 'V P publish!'),
      pg('setup', 'Exam setup', 'V C E D', { setup: true }),
    ] },
  { id: 'timetable', name: 'Timetable', category: 'academics', icon: 'CalendarDays', deps: ['academics'], phase: 2, scopes: CLASS_SCOPES,
    desc: 'Timetable generator, substitutions and room allocation.',
    pages: [
      pg('timetable', 'Timetable', 'V E publish'),
      pg('substitutions', 'Substitutions', 'V C'),
      pg('rooms', 'Rooms', 'V C E D', { setup: true }),
    ] },
  { id: 'lms', name: 'Learning (LMS)', category: 'academics', icon: 'MonitorPlay', deps: ['students'], phase: 2, scopes: CLASS_SCOPES,
    desc: 'Courses, study material, live classes and assignments.',
    pages: [
      pg('courses', 'Courses & material', 'V C E D'),
      pg('live-classes', 'Live classes', 'V C start'),
      pg('question-bank', 'Question bank', 'V C E D I'),
    ] },
  { id: 'online-tests', name: 'Online tests', category: 'academics', icon: 'FileQuestion', deps: ['lms'], phase: 2, scopes: CLASS_SCOPES,
    desc: 'MCQ and written tests with timer, proctoring and auto-evaluation.',
    pages: [
      pg('tests', 'Tests', 'V C E D publish'),
      pg('attempts', 'Attempts & results', 'V X evaluate'),
    ] },

  // ───────────────────────────────── Higher education (colleges and universities)
  { id: 'programs', name: 'Programs & OBE', category: 'higher', icon: 'BookMarked', deps: ['academics'], phase: 2,
    desc: 'Programs, regulations, CBCS credits, course and program outcomes (CO–PO mapping).',
    pages: [
      pg('programs', 'Programs & regulations', 'V C E D', { setup: true }),
      pg('outcomes', 'Outcomes & CO–PO mapping', 'V E'),
      pg('attainment', 'Attainment', 'V X'),
    ] },
  { id: 'registration', name: 'Semester registration', category: 'higher', icon: 'ListChecks', deps: ['programs', 'students'], phase: 2, scopes: ORG_SCOPES,
    desc: 'Course and elective registration, prerequisites, credit limits and add/drop.',
    pages: [
      pg('windows', 'Registration windows', 'V C E', { setup: true }),
      pg('requests', 'Registrations', 'V Ap X'),
    ] },
  { id: 'coe', name: 'Exam controller', category: 'higher', icon: 'ScrollText', deps: ['exams', 'programs'], phase: 2, scopes: ORG_SCOPES,
    desc: 'Internal and external marks, moderation, revaluation, SGPA/CGPA, grade cards and transcripts.',
    pages: [
      pg('marks', 'Internal & external marks', 'V C E lock'),
      pg('revaluation', 'Revaluation', 'V C Ap'),
      pg('grade-cards', 'Grade cards & transcripts', 'V P publish!'),
    ] },
  { id: 'accreditation', name: 'Accreditation', category: 'higher', icon: 'BadgeCheck', deps: ['programs'], phase: 3,
    desc: 'NAAC, NBA, NIRF and AISHE reports with an evidence repository per criterion.',
    pages: [
      pg('reports', 'Accreditation reports', 'V E X'),
      pg('evidence', 'Evidence repository', 'V C E D'),
    ] },
  { id: 'placements', name: 'Training & placements', category: 'higher', icon: 'Briefcase', deps: ['students'], phase: 3,
    desc: 'Companies, drives, eligibility, interview rounds, offers and placement statistics.',
    pages: [
      pg('companies', 'Companies', 'V C E D'),
      pg('drives', 'Placement drives', 'V C E'),
      pg('offers', 'Offers', 'V C X'),
    ] },
  { id: 'research', name: 'Research', category: 'higher', icon: 'FlaskConical', deps: [], phase: 4,
    desc: 'Publications, projects, grants, patents and PhD scholars.',
    pages: [
      pg('publications', 'Publications', 'V C E D X'),
      pg('projects', 'Projects & grants', 'V C E D'),
    ] },
  { id: 'alumni', name: 'Alumni', category: 'higher', icon: 'HandHeart', deps: ['students'], phase: 4,
    desc: 'Alumni directory, events, donations and job board.',
    pages: [
      pg('directory', 'Alumni directory', 'V C E X'),
      pg('donations', 'Donations', 'V C X'),
    ] },

  // ───────────────────────────────── Fees & finance
  { id: 'fees', name: 'Fees', category: 'finance', icon: 'IndianRupee', deps: ['students'], phase: 1, scopes: ['OWN', 'BRANCH', 'ALL'],
    desc: 'Fee structures, installments, concessions, online payment, receipts, dues and refunds.',
    pages: [
      pg('structures', 'Fee structures', 'V C E D', { setup: true }),
      pg('concessions', 'Concessions & scholarships', 'V C E Ap'),
      pg('collect', 'Collect fees', 'V C Ca discount'),
      pg('invoices', 'Fee invoices & receipts', 'V X P Ca!'),
      pg('dues', 'Dues & reminders', 'V X send'),
      pg('refunds', 'Refunds', 'V C refund!'),
      pg('day-end', 'Day-end closing', 'V close approve_variance!'),
      pg('online', 'Online payments', 'V configure refund!'),
    ] },
  { id: 'finance', name: 'Accounts', category: 'finance', icon: 'Landmark', deps: ['fees'], phase: 2, scopes: SITE_SCOPES,
    desc: 'Ledgers, income and expense, bank reconciliation, GST and Tally export.',
    pages: [
      pg('accounts', 'Chart of accounts', 'V C E D', { setup: true }),
      pg('journals', 'Journals', 'V C post reverse!'),
      pg('expenses', 'Expenses', 'V C Ap pay!'),
      pg('bank', 'Bank', 'V reconcile'),
      pg('reports', 'Financial reports', 'V X'),
    ] },

  // ───────────────────────────────── Staff & HR
  { id: 'hrms', name: 'Staff & HR', category: 'people', icon: 'UsersRound', deps: [], phase: 2, scopes: ORG_SCOPES,
    desc: 'Staff records, staff attendance, leave, recruitment and appraisal.',
    pages: [
      pg('employees', 'Staff', 'V C E D I X terminate! view_salary! view_sensitive!'),
      pg('attendance', 'Staff attendance', 'V E I X'),
      pg('leave', 'Leave', 'V E Ap Ca apply_on_behalf'),
      pg('holidays', 'Holidays', 'V C E D', { setup: true }),
      pg('hiring', 'Recruitment', 'V C E D'),
      pg('performance', 'Appraisal', 'V C E D'),
    ] },
  { id: 'payroll', name: 'Payroll', category: 'people', icon: 'Wallet', deps: ['hrms'], phase: 2,
    desc: 'Salary structures, payroll runs, payslips, PF/ESI/TDS and bank exports.',
    pages: [
      pg('structures', 'Salary structures', 'V C E D', { setup: true }),
      pg('statutory', 'Statutory rules', 'V E', { setup: true }),
      pg('loans', 'Loans & advances', 'V C E'),
      pg('runs', 'Payroll runs', 'V C calculate Ap! pay!'),
      pg('payslips', 'Payslips', 'V edit_lop'),
      pg('exports', 'Bank & statutory exports', 'V X'),
    ] },

  // ───────────────────────────────── Campus operations
  { id: 'transport', name: 'Transport', category: 'campus', icon: 'Bus', deps: ['students'], phase: 2, scopes: SITE_SCOPES,
    desc: 'Routes, stops, vehicles, student assignment, GPS tracking and pickup alerts.',
    pages: [
      pg('routes', 'Routes & stops', 'V C E D', { setup: true }),
      pg('vehicles', 'Vehicles & drivers', 'V C E D', { setup: true }),
      pg('assignments', 'Student assignment', 'V C E X'),
      pg('tracking', 'Live tracking', 'V track'),
    ] },
  { id: 'library', name: 'Library', category: 'campus', icon: 'Library', deps: [], phase: 2, scopes: SITE_SCOPES,
    desc: 'Catalogue, barcode issue and return, fines and e-library.',
    pages: [
      pg('catalogue', 'Catalogue', 'V C E D I X'),
      pg('circulation', 'Issue & return', 'V issue receive'),
      pg('fines', 'Fines', 'V C Ca'),
    ] },
  { id: 'hostel', name: 'Hostel', category: 'campus', icon: 'BedDouble', deps: ['students'], phase: 3, scopes: SITE_SCOPES,
    desc: 'Rooms and beds, allotment, mess, hostel attendance and outpasses.',
    pages: [
      pg('rooms', 'Rooms & beds', 'V C E D', { setup: true }),
      pg('allotment', 'Allotment', 'V allot checkout'),
      pg('outpass', 'Outpasses', 'V C Ap'),
      pg('mess', 'Mess', 'V E'),
    ] },
  { id: 'inventory', name: 'Store & assets', category: 'campus', icon: 'Boxes', deps: [], phase: 3, scopes: SITE_SCOPES,
    desc: 'Items, stock, vendors, purchase orders, uniform and book sales, asset register.',
    pages: [
      pg('items', 'Items', 'V C E D I X', { setup: true }),
      pg('stock', 'Stock', 'V X I'),
      pg('purchase-orders', 'Purchase orders', 'V C E Ap Ca P'),
      pg('sales', 'Uniform & book sales', 'V C Ca'),
      pg('assets', 'Asset register', 'V C E D'),
    ] },
  { id: 'health', name: 'Health & infirmary', category: 'campus', icon: 'HeartPulse', deps: ['students'], phase: 3, scopes: SITE_SCOPES,
    desc: 'Health records, vaccinations, sick-room visits and incident reports.',
    pages: [
      pg('records', 'Health records', 'V E view_sensitive!'),
      pg('visits', 'Sick-room visits', 'V C'),
      pg('incidents', 'Incidents', 'V C resolve'),
    ] },
  { id: 'canteen', name: 'Canteen & wallet', category: 'campus', icon: 'Utensils', deps: ['students'], phase: 4,
    desc: 'Menu, pre-orders and a cashless RFID wallet that parents top up.',
    pages: [
      pg('menu', 'Menu', 'V C E D', { setup: true }),
      pg('orders', 'Orders', 'V C'),
      pg('wallet', 'Wallets', 'V refund!'),
    ] },

  // ───────────────────────────────── Communication
  { id: 'communication', name: 'Communication hub', category: 'engage', icon: 'Megaphone', deps: [], phase: 1,
    desc: 'Notices and circulars, SMS, WhatsApp, email and push, parent–teacher chat.',
    pages: [
      pg('notices', 'Notices & circulars', 'V C E D publish'),
      pg('messages', 'Send messages', 'V C send'),
      pg('chat', 'Parent–teacher chat', 'V C moderate'),
      pg('log', 'Delivery log', 'V X'),
    ] },
  { id: 'portal', name: 'Parent & student app', category: 'engage', icon: 'Smartphone', deps: ['students'], phase: 1,
    desc: 'The parent and student app: what it shows and how families sign in.',
    pages: [
      pg('settings', 'App settings', 'V E', { setup: true }),
      pg('content', 'App content', 'V E'),
    ] },
  { id: 'events', name: 'Events & calendar', category: 'engage', icon: 'PartyPopper', deps: [], phase: 2,
    desc: 'School calendar, events, parent–teacher meeting slots and photo gallery.',
    pages: [
      pg('calendar', 'Calendar', 'V C E D'),
      pg('ptm', 'Parent–teacher meetings', 'V C E'),
      pg('gallery', 'Gallery', 'V C D'),
    ] },
  { id: 'surveys', name: 'Surveys & feedback', category: 'engage', icon: 'MessageSquareHeart', deps: [], phase: 3,
    desc: 'Parent and student feedback, teacher evaluation and polls.',
    pages: [
      pg('forms', 'Surveys', 'V C E D publish'),
      pg('responses', 'Responses', 'V X'),
    ] },
  { id: 'website', name: 'Website', category: 'engage', icon: 'Globe', deps: [], phase: 3,
    desc: 'The institution’s website with notice board and online admission form.',
    pages: [
      pg('pages', 'Pages', 'V C E D publish'),
    ] },

  // ───────────────────────────────── Reports & AI
  { id: 'reports', name: 'Reports', category: 'intel', icon: 'FileText', deps: [], phase: 1,
    desc: 'Standard reports, report builder and scheduled exports.',
    pages: [
      pg('library', 'Report library', 'V X run'),
      pg('builder', 'Report builder', 'V C E D schedule share'),
    ] },
  { id: 'analytics', name: 'Analytics', category: 'intel', icon: 'BarChart3', deps: ['reports'], phase: 2,
    desc: 'Attendance, results, fee collection and campus comparison dashboards.',
    pages: [
      pg('academics', 'Academic performance', 'V'),
      pg('fees', 'Fee collection', 'V'),
      pg('campuses', 'Campus comparison', 'V'),
    ] },
  { id: 'ai', name: 'AI assistant', category: 'intel', icon: 'Sparkles', deps: [], phase: 2,
    desc: 'Question papers, report card remarks and an assistant that answers from your own data.',
    pages: [
      pg('assistant', 'Assistant', 'V ask'),
      pg('question-papers', 'Question paper generator', 'V C'),
      pg('remarks', 'Report card remarks', 'V C'),
    ] },
  { id: 'integrations', name: 'Integrations', category: 'intel', icon: 'Plug', deps: [], phase: 2,
    desc: 'Payment gateway, SMS and WhatsApp, biometric and RFID devices, GPS and their logs.',
    pages: [
      pg('payments', 'Payment gateway', 'V configure'),
      pg('messaging', 'SMS & WhatsApp', 'V configure'),
      pg('devices', 'Devices', 'V C E D'),
      pg('logs', 'Integration logs', 'V'),
    ] },
]

// ─────────────────────────────────────────────────────────────── derived lookups

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m]))
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))

/** URL of a page. Pages of a module live under `/<module>/<page>`. */
export const pagePath = (moduleId, pageId) => `/${moduleId}/${pageId}`

/** Limits a role can carry. Above the limit the action goes to an approval workflow. */
export const ROLE_LIMITS = [
  { key: 'fees.discountMaxPct', label: 'Max fee concession at the counter', unit: '%', module: 'fees' },
  { key: 'fees.refundMax', label: 'Max refund without approval', unit: '₹', module: 'fees' },
  { key: 'inventory.poApproveMax', label: 'Max purchase order to approve', unit: '₹', module: 'inventory' },
  { key: 'finance.expenseApproveMax', label: 'Max expense to approve', unit: '₹', module: 'finance' },
]

/** Separation-of-duty pairs: holding both is allowed but flagged in the role designer. */
export const SOD_RULES = [
  ['fees.collect.create', 'fees.invoices.cancel', 'Collects fees and can cancel receipts'],
  ['fees.collect.create', 'fees.refunds.refund', 'Collects fees and refunds them'],
  ['exams.marks.create', 'exams.results.publish', 'Enters marks and publishes the results'],
  ['exams.marks.lock', 'exams.marks.unlock', 'Locks marks and can unlock them again'],
  ['payroll.runs.calculate', 'payroll.runs.pay', 'Calculates and pays payroll'],
  ['payroll.runs.approve', 'payroll.runs.pay', 'Approves and pays payroll'],
  ['inventory.purchase-orders.create', 'inventory.purchase-orders.approve', 'Creates and approves purchase orders'],
  ['finance.expenses.create', 'finance.expenses.approve', 'Records and approves the same expense'],
]
