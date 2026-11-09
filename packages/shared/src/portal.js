// Parent & student app ("family app"): constants shared by the API and the web app.
// Families open <app>/app/<school slug>, sign in with the mobile number on the student's record
// and a one-time code, and see only their own children — never anything staff see.

export const PORTAL_OTP = { digits: 6, validMinutes: 5, maxTries: 5, perMobile: 3, perIp: 20, windowMinutes: 15 }
export const PORTAL_SESSION_DAYS = 30 // families stay signed in on their own phone

/** The address families open: <app>/app/<school slug>. */
export const familyPath = (slug) => `/app/${slug}`

/** What the app can show; each needs its module on (and, for fees and marks, the school's setting). */
export const FAMILY_FEATURES = [
  { value: 'ATTENDANCE', module: 'attendance', label: 'Attendance and leave' },
  { value: 'HOMEWORK', module: 'homework', label: 'Homework' },
  { value: 'TIMETABLE', module: 'timetable', label: 'Class timetable' },
  { value: 'LEARNING', module: 'lms', label: 'Study material and live classes' },
  { value: 'TESTS', module: 'online-tests', label: 'Online tests' },
  { value: 'BUS', module: 'transport', label: 'School bus' },
  { value: 'LIBRARY', module: 'library', label: 'Library books and e-library' },
  { value: 'HOSTEL', module: 'hostel', label: 'Hostel room, outpasses and mess menu' },
  { value: 'HEALTH', module: 'health', label: 'Health card: allergies, vaccinations, sick-room visits' },
  { value: 'PLACEMENTS', module: 'placements', label: 'Placement drives and offers' },
  { value: 'COMPLAINTS', module: 'frontoffice', label: 'Complaints and concerns' },
  { value: 'SURVEYS', module: 'surveys', label: 'Surveys and feedback' },
  { value: 'CANTEEN', module: 'canteen', label: 'Canteen wallet and pre-orders' },
  { value: 'EVENTS', module: 'events', label: 'Calendar, parent–teacher meetings and photos' },
  { value: 'FEES', module: 'fees', label: 'Fees and receipts', setting: 'showFees' },
  { value: 'RESULTS', module: 'exams', label: 'Results and report cards', setting: 'showMarks' },
  { value: 'CERTIFICATES', module: 'certificates', label: 'Certificates' },
  { value: 'NOTICES', module: 'communication', label: 'Notices and circulars' },
  { value: 'CHAT', module: 'communication', label: 'Messages with teachers', setting: 'chat' },
]

/** The features live for a school: module on and, where there is one, its setting on. */
export function liveFamilyFeatures(settings = {}, enabledModules = []) {
  return FAMILY_FEATURES.filter((f) => enabledModules.includes(f.module) && (!f.setting || settings[f.setting] !== false)).map((f) => f.value)
}

/** The last 10 digits of an Indian mobile number, or null. */
export function mobile10(raw) {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  const last = d.slice(-10)
  return /^[6-9]\d{9}$/.test(last) ? last : null
}

/** The ways the same number may be written on a record: 98450…, 9198450…, +9198450…, 098450… */
export const mobileVariants = (ten) => (ten ? [ten, `91${ten}`, `+91${ten}`, `0${ten}`, `+91 ${ten}`] : [])

/** "•••••• 3210" for the screen and the audit log. */
export const maskMobile = (m) => `•••••• ${String(m ?? '').slice(-4)}`
