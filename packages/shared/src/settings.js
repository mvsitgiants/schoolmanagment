// Settings engine (E3). Every setting is declared here once — with its type,
// default and help text. A tenant row only exists when an admin changes it;
// otherwise the default applies. Administration › Settings renders this list,
// grouped by module (a module's settings show once the module is switched on).
import { SUPPORTED_LANGUAGES } from './languages.js'

export const SETTING_TYPES = ['bool', 'text', 'number', 'select', 'multi']

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.code === 'en' ? 'English' : `${l.nativeName} (${l.name})` }))
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: i + 1, label }))

export const SETTINGS = [
  // ── Administration
  { module: 'core', key: 'institutionType', type: 'select', label: 'Type of institution', default: 'SCHOOL', options: [{ value: 'SCHOOL', label: 'School (K-12)' }, { value: 'COLLEGE', label: 'College / university' }, { value: 'COACHING', label: 'Coaching / tuition institute' }], help: 'Sets the words the app uses (class or semester, principal or dean) and the default report formats.' },
  { module: 'core', key: 'academicYearStartMonth', type: 'select', label: 'Academic year starts in', default: 4, options: MONTHS, help: 'April for most Indian schools, June or July for many colleges.' },
  { module: 'core', key: 'defaultAppLanguage', type: 'select', label: 'Default language', default: 'en', options: LANGUAGE_OPTIONS, help: 'Interface language for staff and the parent app, unless a user picks another.' },
  { module: 'core', key: 'enabledLanguages', type: 'multi', label: 'Languages offered', default: SUPPORTED_LANGUAGES.map((l) => l.code), options: LANGUAGE_OPTIONS, help: 'Which languages appear in the language picker.' },
  { module: 'core', key: 'sessionIdleMinutes', type: 'number', label: 'Default sign-out after inactivity (minutes)', default: 30, min: 5, max: 720, help: 'Roles can set their own value.' },
  { module: 'core', key: 'familyMessageLanguage', type: 'bool', label: 'Send family messages in their language', default: true, help: 'SMS, WhatsApp and email use the family’s preferred language for the standard texts; a text you have edited in Notification rules is sent as written.' },
  { module: 'core', key: 'familyLinkDays', type: 'number', label: 'Links sent to families work for (days)', default: 30, min: 1, max: 365, help: 'Report cards, receipts and notices sent by WhatsApp, SMS or email.' },
  { module: 'core', key: 'weekStartsOn', type: 'select', label: 'Week starts on', default: 'MONDAY', options: [{ value: 'MONDAY', label: 'Monday' }, { value: 'SUNDAY', label: 'Sunday' }] },
  { module: 'core', key: 'workingDays', type: 'multi', label: 'Working days', default: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], options: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => ({ value: d, label: d[0] + d.slice(1).toLowerCase() })), help: 'Attendance and timetables skip the other days.' },

  // ── Students
  { module: 'students', key: 'admissionNoPrefix', type: 'text', label: 'Admission number prefix', default: '', help: 'Shown before the running number, e.g. GV. The pattern itself is set in Number series.' },
  { module: 'students', key: 'requiredFields', type: 'multi', label: 'Required at admission', default: ['dob', 'gender', 'guardianMobile'], options: [{ value: 'dob', label: 'Date of birth' }, { value: 'gender', label: 'Gender' }, { value: 'guardianMobile', label: 'Guardian mobile' }, { value: 'guardianEmail', label: 'Guardian email' }, { value: 'address', label: 'Address' }, { value: 'aadhaar', label: 'Aadhaar' }, { value: 'apaar', label: 'APAAR ID' }, { value: 'photo', label: 'Photo' }], help: 'Name and class are always required.' },

  // ── Attendance
  { module: 'attendance', key: 'mode', type: 'select', label: 'Attendance is taken', default: 'DAILY', options: [{ value: 'DAILY', label: 'Once a day, by the class teacher' }, { value: 'PERIOD', label: 'Every period, by the subject teacher' }] },
  { module: 'attendance', key: 'absentAlert', type: 'bool', label: 'Tell parents when their child is absent', default: true, help: 'By the channels set for “Absence alert” in Notification rules.' },
  { module: 'attendance', key: 'markBefore', type: 'text', label: 'Attendance to be marked by (HH:MM)', default: '10:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', patternError: 'Use HH:MM', help: 'Classes not marked by then show on the principal’s dashboard.' },
  { module: 'attendance', key: 'minimumPct', type: 'number', label: 'Minimum attendance required (%)', default: 75, min: 0, max: 100, help: 'Students below it are flagged in reports.' },
  { module: 'attendance', key: 'editDays', type: 'number', label: 'Teachers can correct attendance up to (days back)', default: 2, min: 0, max: 30 },

  // ── Exams & report cards
  { module: 'exams', key: 'roundMarks', type: 'bool', label: 'Round totals to whole marks', default: true },
  { module: 'exams', key: 'showRank', type: 'bool', label: 'Show class rank on report cards', default: false },
  { module: 'exams', key: 'lockAfterDays', type: 'number', label: 'Lock marks entry this many days after the exam', default: 15, min: 0, max: 120, help: '0: marks stay open until someone locks them.' },

  // ── Fees
  { module: 'fees', key: 'lateFeePerDay', type: 'number', label: 'Late fee per day (₹)', default: 0, min: 0, max: 10000, help: '0 turns the late fee off. Fee structures can set their own.' },
  { module: 'fees', key: 'graceDays', type: 'number', label: 'Days after the due date before the late fee starts', default: 0, min: 0, max: 60 },
  { module: 'fees', key: 'remindDaysBefore', type: 'number', label: 'Remind parents this many days before the due date', default: 3, min: 0, max: 30, help: '0 turns the reminder off. Uses “Fee due reminder” in Notification rules.' },
  { module: 'fees', key: 'allowPartial', type: 'bool', label: 'Accept part payments', default: true },
  { module: 'fees', key: 'upiId', type: 'text', label: 'UPI ID for QR payments at the counter', default: '', help: 'e.g. greenvalley@okaxis — the counter shows a QR with the exact amount.' },
  { module: 'fees', key: 'receiptFormat', type: 'select', label: 'Receipt printer', default: 'A5', options: [{ value: 'A5', label: 'A5 sheet' }, { value: 'THERMAL', label: '80 mm thermal roll' }] },
  { module: 'fees', key: 'receiptFooter', type: 'text', label: 'Footer on receipts', default: 'This is a computer-generated receipt. Fees once paid are not refundable except as per policy.' },

  // ── Parent & student app
  { module: 'portal', key: 'enabled', type: 'bool', label: 'Parents and students can sign in to the app', default: false, help: 'With a one-time code to the mobile number on the student’s record.' },
  { module: 'portal', key: 'studentLogins', type: 'bool', label: 'Students get their own sign-in', default: false, help: 'Usually on for senior classes and colleges. Off: only parents sign in.' },
  { module: 'portal', key: 'showFees', type: 'bool', label: 'Show fees and online payment in the app', default: true },
  { module: 'portal', key: 'showMarks', type: 'bool', label: 'Show marks and report cards in the app', default: true, help: 'Only results that have been published.' },
]

export const SETTING_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [`${s.module}.${s.key}`, s]))

export const settingDefaults = (module) => Object.fromEntries(SETTINGS.filter((s) => s.module === module).map((s) => [s.key, s.default]))

/** Validate/coerce one value against its definition. Returns { value } or { error }. */
export function coerceSetting(def, raw) {
  if (raw === null || raw === undefined) return { value: def.default }
  switch (def.type) {
    case 'bool': return { value: raw === true || raw === 'true' }
    case 'text': {
      if (String(raw).length > 300) return { error: 'Too long' }
      const v = String(raw).trim()
      // `pattern` (a regex source) checks a filled-in value; blank stays allowed
      if (def.pattern && v && !new RegExp(def.pattern).test(v)) return { error: def.patternError ?? 'Not valid' }
      return { value: v }
    }
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: 'Enter a number' }
      if (def.min !== undefined && n < def.min) return { error: `At least ${def.min}` }
      if (def.max !== undefined && n > def.max) return { error: `At most ${def.max}` }
      return { value: n }
    }
    case 'select': return def.options.some((o) => o.value === raw) ? { value: raw } : { error: 'Pick one of the options' }
    case 'multi': {
      const arr = Array.isArray(raw) ? raw : []
      const ok = new Set(def.options.map((o) => o.value))
      return arr.every((v) => ok.has(v)) ? { value: [...new Set(arr)] } : { error: 'Unknown option' }
    }
    default: return { error: 'Unknown setting type' }
  }
}

// ── Custom fields (engine E5)

export const CUSTOM_FIELD_ENTITIES = [
  { value: 'student', label: 'Student', module: 'students' },
  { value: 'user', label: 'User', module: 'core' },
]

export const CUSTOM_FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'BOOL', label: 'Yes / no' },
  { value: 'SELECT', label: 'Pick one' },
  { value: 'MULTI', label: 'Pick several' },
]

/** Validate custom field values against active definitions. Returns { values, errors }. */
export function validateCustomValues(defs, input = {}) {
  const values = {}
  const errors = {}
  for (const d of defs.filter((x) => x.active !== false)) {
    const raw = input[d.code]
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length)
    if (empty) {
      if (d.required) errors[d.code] = `${d.label} is required`
      continue
    }
    if (d.type === 'TEXT') values[d.code] = String(raw).slice(0, 500)
    else if (d.type === 'NUMBER') {
      const n = Number(raw)
      if (!Number.isFinite(n)) errors[d.code] = 'Enter a number'
      else values[d.code] = n
    } else if (d.type === 'DATE') {
      const s = String(raw).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[d.code] = 'Enter a date'
      else values[d.code] = s
    } else if (d.type === 'BOOL') values[d.code] = raw === true || raw === 'true'
    else if (d.type === 'SELECT') {
      if (!d.options.includes(raw)) errors[d.code] = 'Pick one of the options'
      else values[d.code] = raw
    } else if (d.type === 'MULTI') {
      const arr = [].concat(raw)
      if (!arr.every((v) => d.options.includes(v))) errors[d.code] = 'Unknown option'
      else values[d.code] = arr
    }
  }
  return { values, errors }
}
