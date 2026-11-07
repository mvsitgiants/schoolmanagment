// Notification engine (E12). Each event below can send the family (the student's primary
// guardian, or the student) a message on SMS, WhatsApp and email. The wording here is only
// the default: an institution edits it, and switches channels on or off, in
// Administration › Notification rules. Like settings, a stored rule exists only for what
// the institution changed.
//
// Templates use {{path}} placeholders, e.g. {{student.name}}. Every event lists the
// variables it fills; the rule editor refuses any other. Events fire from their module, so
// an event shows in the rule editor only once its module is switched on.

export const MESSAGE_CHANNELS = [
  { value: 'SMS', label: 'SMS' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
]
export const CHANNEL_LABEL = Object.fromEntries(MESSAGE_CHANNELS.map((c) => [c.value, c.label]))

export const MESSAGE_STATUSES = {
  QUEUED: { label: 'Queued', tone: 'info' },
  SENDING: { label: 'Sending', tone: 'info' },
  SENT: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Not sent', tone: 'neutral' },
}

/** How each channel can be delivered. TEST logs the message without sending it. */
export const MESSAGE_PROVIDERS = {
  SMS: [
    { value: 'NONE', label: 'Off' },
    { value: 'TEST', label: 'Test mode (log only)' },
    { value: 'HTTP', label: 'SMS gateway (HTTP API)' },
    { value: 'MSG91', label: 'MSG91' },
  ],
  WHATSAPP: [
    { value: 'NONE', label: 'Off' },
    { value: 'TEST', label: 'Test mode (log only)' },
    { value: 'META', label: 'WhatsApp Cloud API (Meta)' },
    { value: 'HTTP', label: 'WhatsApp provider (HTTP API)' },
  ],
  EMAIL: [
    { value: 'NONE', label: 'Off' },
    { value: 'TEST', label: 'Test mode (log only)' },
    { value: 'SMTP', label: 'SMTP server' },
  ],
}

/** Placeholders an HTTP gateway URL, header or body may use. */
export const GATEWAY_VARS = ['to', 'to10', 'message', 'subject', 'templateId', 'apiKey']

const VAR_HELP = {
  'student.name': 'Student’s full name',
  'student.firstName': 'Student’s first name',
  'student.admissionNo': 'Admission number',
  'student.class': 'Class and section, e.g. 8-A',
  'guardian.name': 'Parent or guardian the message goes to',
  'institution.name': 'Institution name',
  'institution.phone': 'Institution phone',
  'attendance.date': 'Date of the absence, e.g. Tue, 7 Oct',
  'receipt.no': 'Receipt number',
  'receipt.amount': 'Amount paid, e.g. ₹12,500',
  'receipt.date': 'Date paid',
  'fees.due': 'Fee still due, e.g. ₹8,000',
  'fees.dueDate': 'Last date to pay',
  'pay.link': 'Link to pay online',
  'exam.name': 'Exam name, e.g. Half-yearly 2026',
  'result.link': 'Link to the report card',
  'notice.title': 'Title of the notice',
  'notice.link': 'Link to read the notice',
  'otp.code': 'The one-time code',
  'otp.minutes': 'Minutes the code stays valid',
}
export const templateVarHelp = (v) => VAR_HELP[v] ?? v

const STUDENT = ['student.name', 'student.firstName', 'student.admissionNo', 'student.class', 'guardian.name']
const INSTITUTION = ['institution.name', 'institution.phone']

export const NOTIFY_EVENTS = [
  {
    event: 'portal.otp', module: 'portal', label: 'One-time code',
    when: 'When a parent or student signs in to the app with their mobile number.',
    vars: ['otp.code', 'otp.minutes', ...INSTITUTION],
    fixed: ['SMS'], // app sign-in depends on it
    defaults: {
      SMS: { enabled: true, body: '{{otp.code}} is your code for {{institution.name}}. It is valid for {{otp.minutes}} minutes. Do not share it.' },
      WHATSAPP: { enabled: false, body: '{{otp.code}} is your code for {{institution.name}}. It is valid for {{otp.minutes}} minutes. Do not share it.' },
      EMAIL: { enabled: false, subject: 'Your code for {{institution.name}}', body: '{{otp.code}} is your code. It is valid for {{otp.minutes}} minutes.' },
    },
  },
  {
    event: 'attendance.absent', module: 'attendance', label: 'Absence alert',
    when: 'When a student is marked absent for the day.',
    vars: [...STUDENT, 'attendance.date', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Dear Parent, {{student.name}} ({{student.class}}) is absent today, {{attendance.date}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} ({{student.class}}) was marked absent today, {{attendance.date}}.\n\nIf this is unexpected, please call {{institution.phone}}.\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} is absent today', body: 'Dear {{guardian.name}},\n\n{{student.name}} ({{student.class}}) was marked absent today, {{attendance.date}}.\nIf this is unexpected, please call {{institution.phone}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'fees.receipt', module: 'fees', label: 'Fee receipt',
    when: 'When a fee payment is received, at the counter or online.',
    vars: [...STUDENT, 'receipt.no', 'receipt.amount', 'receipt.date', 'fees.due', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Received {{receipt.amount}} for {{student.name}} ({{student.admissionNo}}), receipt {{receipt.no}}. Balance {{fees.due}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nThank you. We received {{receipt.amount}} for {{student.name}} on {{receipt.date}}.\n\nReceipt: {{receipt.no}}\nBalance due: {{fees.due}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Fee receipt {{receipt.no}} — {{student.name}}', body: 'Dear {{guardian.name}},\n\nWe received {{receipt.amount}} for {{student.name}} ({{student.admissionNo}}) on {{receipt.date}}.\nReceipt: {{receipt.no}}\nBalance due: {{fees.due}}\n\nThank you,\n{{institution.name}}' },
    },
  },
  {
    event: 'fees.due_reminder', module: 'fees', label: 'Fee due reminder',
    when: 'Before and after an installment’s last date, while fees are unpaid.',
    vars: [...STUDENT, 'fees.due', 'fees.dueDate', 'pay.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Dear Parent, fees of {{fees.due}} for {{student.name}} are due by {{fees.dueDate}}. Pay online: {{pay.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nA gentle reminder: fees of {{fees.due}} for {{student.firstName}} ({{student.class}}) are due by {{fees.dueDate}}.\n\nPay online: {{pay.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Fees due by {{fees.dueDate}} — {{student.name}}', body: 'Dear {{guardian.name}},\n\nFees of {{fees.due}} for {{student.name}} ({{student.class}}) are due by {{fees.dueDate}}.\nYou can pay online here: {{pay.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'exams.results_published', module: 'exams', label: 'Results published',
    when: 'When the results and report cards of an exam are published.',
    vars: [...STUDENT, 'exam.name', 'result.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'Results of {{exam.name}} for {{student.name}} are out: {{result.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nThe {{exam.name}} report card of {{student.firstName}} is ready.\n\nView it: {{result.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: '{{exam.name}} report card — {{student.name}}', body: 'Dear {{guardian.name}},\n\nThe {{exam.name}} report card of {{student.name}} ({{student.class}}) is ready.\nView and download it here: {{result.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'communication.notice', module: 'communication', label: 'Notice or circular',
    when: 'When a notice is published to families.',
    vars: [...STUDENT, 'notice.title', 'notice.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'New notice from {{institution.name}}: {{notice.title}}. Read: {{notice.link}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nNew notice: {{notice.title}}\n\nRead it here: {{notice.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: '{{notice.title}} — {{institution.name}}', body: 'Dear {{guardian.name}},\n\nA new notice has been published: {{notice.title}}\nRead it here: {{notice.link}}\n\n{{institution.name}}' },
    },
  },
]

export const NOTIFY_EVENT_BY = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.event, e]))

/** Example values for previews in the rule editor. */
export const TEMPLATE_SAMPLE = {
  student: { name: 'Aarav Sharma', firstName: 'Aarav', admissionNo: 'GV-2026-0142', class: '8-A' },
  guardian: { name: 'Neha Sharma' },
  institution: { name: 'Green Valley Public School', phone: '080 4000 1234' },
  attendance: { date: 'Tue, 7 Oct' },
  receipt: { no: 'RC26-000045', amount: '₹12,500', date: 'Tue, 7 Oct' },
  fees: { due: '₹8,000', dueDate: 'Fri, 10 Oct' },
  pay: { link: 'https://pay.example.in/p/k3Xb9QmT' },
  exam: { name: 'Half-yearly 2026' },
  result: { link: 'https://app.example.in/r/Hq7Zt4Wn' },
  notice: { title: 'Annual Day on 20 December', link: 'https://app.example.in/n/Vb3kQ9xT' },
  otp: { code: '482913', minutes: 10 },
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g

/** Fill {{a.b}} placeholders from `data`. Missing values become ''. `escape` transforms each value. */
export function renderTemplate(text, data = {}, escape = (v) => v) {
  return String(text ?? '').replace(PLACEHOLDER, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), data)
    return v === undefined || v === null ? '' : escape(String(v))
  })
}

/** Placeholders used in `text` that aren't in `allowed`. */
export function unknownTemplateVars(text, allowed) {
  const ok = new Set(allowed)
  return [...String(text ?? '').matchAll(PLACEHOLDER)].map((m) => m[1]).filter((v) => !ok.has(v))
}

/** SMS length check: GSM-7 messages split every 153 characters, Unicode (Hindi, ₹…) every 67. */
export function smsParts(text) {
  const s = String(text ?? '')
  // eslint-disable-next-line no-control-regex
  const unicode = /[^\x00-\x7F£¥èéùìòÇØøÅå_ÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]/.test(s)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return { length: s.length, unicode, parts: s.length <= single ? 1 : Math.ceil(s.length / multi) }
}
