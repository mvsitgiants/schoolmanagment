// Reports: the standard report library. Each report is defined here — its inputs and columns — and
// run on the server (backend/src/services/reports.js). Saved reports (Report builder) keep a
// library report with its inputs and chosen columns; they can be shared with roles and sent on a
// schedule. Who may run a report: `reports.library.run`, the report's module switched on, and one of
// the report's `needs` permissions (so a report never shows what the role can't see in its module).

/** Column kinds decide formatting and alignment: text · number · money (paise) · pct · date. */
const col = (key, label, type = 'text') => ({ key, label, type })

export const REPORT_PARAM_TYPES = ['date', 'dateRange', 'section', 'class', 'exam', 'number', 'select']

export const REPORTS = [
  // ── students
  {
    id: 'students.strength', module: 'students', group: 'students', label: 'Class strength',
    desc: 'Students in each section, by gender.', needs: ['students.directory.view'],
    params: [],
    columns: [col('class', 'Class'), col('section', 'Section'), col('boys', 'Boys', 'number'), col('girls', 'Girls', 'number'), col('other', 'Other', 'number'), col('total', 'Total', 'number')],
    totals: ['boys', 'girls', 'other', 'total'],
  },
  {
    id: 'students.admissions', module: 'students', group: 'students', label: 'Admissions',
    desc: 'Students admitted between two dates.', needs: ['students.directory.view'],
    params: [{ key: 'range', type: 'dateRange', label: 'Admitted between', default: 'thisYear', required: true }],
    columns: [col('admissionDate', 'Admitted on', 'date'), col('admissionNo', 'Admission no.'), col('name', 'Student'), col('class', 'Class'), col('gender', 'Gender'), col('guardian', 'Guardian'), col('mobile', 'Mobile')],
  },
  {
    id: 'students.contacts', module: 'students', group: 'students', label: 'Guardian contact list',
    desc: 'Every student of a section with the primary guardian’s phone and email.', needs: ['students.guardians.view', 'students.directory.view'],
    params: [{ key: 'sectionId', type: 'section', label: 'Class', required: true }],
    columns: [col('rollNo', 'Roll'), col('name', 'Student'), col('admissionNo', 'Admission no.'), col('guardian', 'Guardian'), col('relation', 'Relation'), col('mobile', 'Mobile'), col('email', 'Email')],
  },
  {
    id: 'students.birthdays', module: 'students', group: 'students', label: 'Birthdays',
    desc: 'Students whose birthday falls in a month.', needs: ['students.directory.view'],
    params: [{ key: 'month', type: 'select', label: 'Month', options: 'months', default: 'thisMonth', required: true }],
    columns: [col('day', 'Day', 'number'), col('name', 'Student'), col('class', 'Class'), col('dob', 'Date of birth', 'date'), col('age', 'Turns', 'number')],
  },
  // ── attendance
  {
    id: 'attendance.daily', module: 'attendance', group: 'attendance', label: 'Daily attendance',
    desc: 'Each section on a day: present, absent, late, on leave — and which sections were not marked.', needs: ['attendance.reports.view', 'attendance.register.view'],
    params: [{ key: 'date', type: 'date', label: 'Date', default: 'today', required: true }],
    columns: [col('class', 'Class'), col('strength', 'Strength', 'number'), col('present', 'Present', 'number'), col('absent', 'Absent', 'number'), col('late', 'Late', 'number'), col('leave', 'On leave', 'number'), col('pct', 'Attendance', 'pct'), col('takenBy', 'Marked by')],
    totals: ['strength', 'present', 'absent', 'late', 'leave'],
  },
  {
    id: 'attendance.defaulters', module: 'attendance', group: 'attendance', label: 'Low attendance',
    desc: 'Students below a percentage over a period.', needs: ['attendance.reports.view'],
    params: [
      { key: 'range', type: 'dateRange', label: 'Period', default: 'thisMonth', required: true },
      { key: 'below', type: 'number', label: 'Below (%)', default: 75, min: 1, max: 100, required: true },
      { key: 'sectionId', type: 'section', label: 'Class' },
    ],
    columns: [col('class', 'Class'), col('rollNo', 'Roll'), col('name', 'Student'), col('days', 'Days marked', 'number'), col('attended', 'Attended', 'number'), col('absent', 'Absent', 'number'), col('pct', 'Attendance', 'pct'), col('guardian', 'Guardian'), col('mobile', 'Mobile')],
  },
  // ── fees
  {
    id: 'fees.collection', module: 'fees', group: 'fees', label: 'Fee collection',
    desc: 'Money received each day, by payment mode.', needs: ['fees.invoices.view', 'fees.day-end.view'],
    params: [{ key: 'range', type: 'dateRange', label: 'Period', default: 'thisMonth', required: true }],
    columns: [col('date', 'Date', 'date'), col('receipts', 'Receipts', 'number'), col('CASH', 'Cash', 'money'), col('UPI', 'UPI', 'money'), col('CARD', 'Card', 'money'), col('CHEQUE', 'Cheque / DD', 'money'), col('BANK_TRANSFER', 'Bank transfer', 'money'), col('ONLINE', 'Online', 'money'), col('refunds', 'Refunds', 'money'), col('net', 'Net', 'money')],
    totals: ['receipts', 'CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE', 'refunds', 'net'],
  },
  {
    id: 'fees.headwise', module: 'fees', group: 'fees', label: 'Collection by fee head',
    desc: 'What the money received was for — tuition, transport, lab … — over a period.', needs: ['fees.invoices.view'],
    params: [{ key: 'range', type: 'dateRange', label: 'Period', default: 'thisMonth', required: true }],
    columns: [col('head', 'Fee head'), col('amount', 'Collected', 'money'), col('share', 'Share', 'pct')],
    totals: ['amount'],
  },
  {
    id: 'fees.classDues', module: 'fees', group: 'fees', label: 'Dues by class',
    desc: 'Billed, collected and outstanding for each section this year.', needs: ['fees.dues.view', 'fees.invoices.view'],
    params: [],
    columns: [col('class', 'Class'), col('students', 'Students with dues', 'number'), col('billed', 'Billed', 'money'), col('paid', 'Collected', 'money'), col('due', 'Outstanding', 'money'), col('overdue', 'Overdue', 'money'), col('pct', 'Collected', 'pct')],
    totals: ['students', 'billed', 'paid', 'due', 'overdue'],
  },
  {
    id: 'fees.concessions', module: 'fees', group: 'fees', label: 'Concessions given',
    desc: 'Approved concessions and how much they took off this year’s invoices.', needs: ['fees.concessions.view'],
    params: [],
    columns: [col('name', 'Student'), col('class', 'Class'), col('reason', 'Reason'), col('value', 'Concession'), col('amount', 'Taken off', 'money'), col('approvedBy', 'Approved by')],
    totals: ['amount'],
  },
  // ── exams
  {
    id: 'exams.toppers', module: 'exams', group: 'exams', label: 'Toppers',
    desc: 'The top students of each section in an exam.', needs: ['exams.results.view'],
    params: [{ key: 'examId', type: 'exam', label: 'Exam', required: true }, { key: 'top', type: 'number', label: 'How many per class', default: 3, min: 1, max: 20, required: true }],
    columns: [col('class', 'Class'), col('rank', 'Rank', 'number'), col('name', 'Student'), col('total', 'Total', 'number'), col('max', 'Out of', 'number'), col('pct', 'Percentage', 'pct'), col('grade', 'Grade')],
  },
  {
    id: 'exams.subjects', module: 'exams', group: 'exams', label: 'Subject analysis',
    desc: 'For each section and subject of an exam: average, highest, lowest and pass rate.', needs: ['exams.results.view'],
    params: [{ key: 'examId', type: 'exam', label: 'Exam', required: true }],
    columns: [col('class', 'Class'), col('subject', 'Subject'), col('students', 'Students', 'number'), col('average', 'Average %', 'pct'), col('highest', 'Highest', 'number'), col('lowest', 'Lowest', 'number'), col('passPct', 'Passed', 'pct'), col('absent', 'Absent', 'number')],
  },
  // ── homework
  {
    id: 'homework.summary', module: 'homework', group: 'homework', label: 'Homework set',
    desc: 'Homework set over a period, by teacher and subject, and how much was handed in.', needs: ['homework.homework.view'],
    params: [{ key: 'range', type: 'dateRange', label: 'Set between', default: 'thisMonth', required: true }],
    columns: [col('teacher', 'Teacher'), col('subject', 'Subject'), col('class', 'Class'), col('count', 'Homework', 'number'), col('handedIn', 'Handed in', 'pct')],
    totals: ['count'],
  },
  // ── certificates
  {
    id: 'certificates.issued', module: 'certificates', group: 'certificates', label: 'Certificates issued',
    desc: 'Certificates issued over a period, by kind.', needs: ['certificates.register.view'],
    params: [{ key: 'range', type: 'dateRange', label: 'Issued between', default: 'thisMonth', required: true }],
    columns: [col('issueDate', 'Date', 'date'), col('certificateNo', 'Number'), col('kind', 'Kind'), col('name', 'Student'), col('class', 'Class'), col('purpose', 'Purpose'), col('status', 'Status')],
  },
]
export const REPORT_BY = Object.fromEntries(REPORTS.map((r) => [r.id, r]))

export const REPORT_GROUPS = [
  { id: 'students', label: 'Students' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'fees', label: 'Fees' },
  { id: 'exams', label: 'Exams' },
  { id: 'homework', label: 'Homework' },
  { id: 'certificates', label: 'Certificates' },
]

/** How often a saved report is sent. */
export const REPORT_FREQUENCIES = [
  { value: 'DAILY', label: 'Every day' },
  { value: 'WEEKLY', label: 'Every week (Monday)' },
  { value: 'MONTHLY', label: 'Every month (1st)' },
]

/**
 * A date-range shortcut to real dates, in the institution's `today` (YYYY-MM-DD): today, yesterday,
 * thisWeek (Mon–today), lastWeek, thisMonth, lastMonth, thisYear (the financial year from April).
 */
export function resolveRange(preset, today) {
  const d = (s) => new Date(`${s}T12:00:00Z`)
  const iso = (x) => x.toISOString().slice(0, 10)
  const t = d(today)
  const add = (x, n) => { const y = new Date(x); y.setUTCDate(y.getUTCDate() + n); return y }
  const monday = add(t, -((t.getUTCDay() + 6) % 7))
  const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1, 12))
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = iso(add(t, -1)); return { from: y, to: y } }
    case 'thisWeek': return { from: iso(monday), to: today }
    case 'lastWeek': return { from: iso(add(monday, -7)), to: iso(add(monday, -1)) }
    case 'lastMonth': { const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1, 12)); return { from: iso(s), to: iso(add(monthStart, -1)) } }
    case 'thisYear': { const y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1; return { from: `${y}-04-01`, to: today } }
    case 'thisMonth':
    default: return { from: iso(monthStart), to: today }
  }
}

export const RANGE_PRESETS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear']

/** The next time a schedule fires after `from` (a Date), at `hour` o'clock institution time (`tzOffsetMin` east of UTC). */
export function nextRunAt(frequency, hour, from = new Date(), tzOffsetMin = 330) {
  const local = new Date(from.getTime() + tzOffsetMin * 60_000)
  const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0))
  const step = () => {
    if (frequency === 'DAILY') at.setUTCDate(at.getUTCDate() + 1)
    else if (frequency === 'WEEKLY') at.setUTCDate(at.getUTCDate() + 7)
    else at.setUTCMonth(at.getUTCMonth() + 1)
  }
  if (frequency === 'WEEKLY') { const back = (at.getUTCDay() + 6) % 7; at.setUTCDate(at.getUTCDate() - back) } // Monday
  if (frequency === 'MONTHLY') at.setUTCDate(1)
  while (at <= local) step()
  return new Date(at.getTime() - tzOffsetMin * 60_000)
}
