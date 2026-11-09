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
  'attendance.date': 'Date of the absence (or arrival), e.g. Tue, 7 Oct',
  'attendance.time': 'Time the card was scanned at the gate, e.g. 07:52',
  'pickup.person': 'Who collected the child (from the pickup pass)',
  'pickup.time': 'Time the child was handed over, e.g. 12:40',
  'receipt.no': 'Receipt number',
  'receipt.amount': 'Amount paid, e.g. ₹12,500',
  'receipt.date': 'Date paid',
  'fees.due': 'Fee still due, e.g. ₹8,000',
  'fees.dueDate': 'Last date to pay',
  'pay.link': 'Link to pay online',
  'exam.name': 'Exam name, e.g. Half-yearly 2026',
  'result.link': 'Link to the report card',
  'homework.subject': 'Subject of the homework',
  'homework.title': 'What the homework is',
  'homework.dueDate': 'When it is due, e.g. Thu, 9 Oct',
  'message.subject': 'Subject of the message (email)',
  'message.text': 'The message itself',
  'chat.teacher': 'The teacher who wrote',
  'chat.link': 'Link to the conversation in the app',
  'applicant.name': 'The child applying',
  'applicant.class': 'The class applied for',
  'application.no': 'Application number',
  'application.link': 'Link to check the application',
  'test.name': 'Entrance test name',
  'test.when': 'Test date and time',
  'test.venue': 'Where the test is',
  'offer.until': 'Last day to accept the seat',
  'notice.title': 'Title of the notice',
  'notice.link': 'Link to read the notice',
  'bus.route': 'The bus route',
  'bus.stop': 'The student’s stop',
  'bus.minutes': 'Minutes until the bus reaches the stop',
  'bus.vehicle': 'The vehicle number',
  'bus.trip': 'morning pickup or afternoon drop',
  'bus.event': 'got on / got off / was not at the stop for',
  'bus.time': 'When it happened',
  'library.title': 'The book',
  'library.dueDate': 'When it is due back',
  'library.days': 'Days overdue',
  'library.fine': 'The late fine so far',
  'event.title': 'The event',
  'event.date': 'When it is, e.g. Sat, 14 Dec (or 14–16 Dec)',
  'event.time': 'Its time, if it has one',
  'event.venue': 'Where it is',
  'event.question': 'What families are asked (going? permission?)',
  'event.replyBy': 'Last day to reply',
  'event.link': 'Link to the event in the app',
  'ptm.title': 'The meeting, e.g. Term 1 PTM',
  'ptm.date': 'The meeting day',
  'ptm.bookBy': 'Last day to book a slot',
  'ptm.time': 'The family’s slot',
  'ptm.teacher': 'The teacher they meet',
  'ptm.room': 'Where (room), or the video link',
  'ptm.link': 'Link to book in the app',
  'otp.code': 'The one-time code',
  'otp.minutes': 'Minutes the code stays valid',
  'drive.company': 'The company',
  'drive.title': 'The drive, e.g. Campus hiring 2027',
  'drive.ctc': 'The package, e.g. 6 – 8 LPA',
  'drive.date': 'The day of the drive',
  'drive.lastDate': 'Last day to register',
  'drive.role': 'The role offered',
  'gatepass.no': 'Gate pass number',
  'gatepass.time': 'When the student left, e.g. Mon, 9 Nov, 11:40',
  'gatepass.collector': 'Who collected the student',
  'gatepass.relation': 'Their relation to the student',
  'gatepass.reason': 'Why the student left early',
  'complaint.no': 'Complaint number',
  'complaint.subject': 'What the complaint is about',
  'complaint.name': 'The person who complained',
  'complaint.dueDate': 'The day it should be resolved by',
  'complaint.resolution': 'How it was resolved',
  'survey.title': 'The survey',
  'survey.closes': 'Last day to answer, e.g. Fri, 20 Nov (empty when the survey has no closing day)',
  'survey.link': 'Link to answer in the app',
  'canteen.balance': 'What is left in the canteen wallet',
  'canteen.threshold': 'The school’s low-balance mark',
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
    event: 'attendance.arrived', module: 'attendance', label: 'Reached school',
    when: 'When a child’s card is first scanned at the school gate in the morning (a gate scanner, card reader or biometric device).',
    vars: [...STUDENT, 'attendance.date', 'attendance.time', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}} ({{student.class}}) reached school at {{attendance.time}}, {{attendance.date}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} ({{student.class}}) reached school at {{attendance.time}} today.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} reached school', body: 'Dear {{guardian.name}},\n\n{{student.name}} ({{student.class}}) reached school at {{attendance.time}} on {{attendance.date}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'attendance.pickedUp', module: 'attendance', label: 'Picked up early',
    when: 'When the gate hands a child over on the family’s early-pickup pass.',
    vars: [...STUDENT, 'pickup.person', 'pickup.time', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{student.firstName}} ({{student.class}}) was picked up by {{pickup.person}} at {{pickup.time}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} ({{student.class}}) was handed over to {{pickup.person}} at {{pickup.time}} on your early-pickup pass.\n\nIf you didn’t send them, call {{institution.phone}} at once.\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} was picked up early', body: 'Dear {{guardian.name}},\n\n{{student.name}} ({{student.class}}) was handed over to {{pickup.person}} at {{pickup.time}} on your early-pickup pass.\nIf you didn’t send them, call {{institution.phone}} at once.\n\n{{institution.name}}' },
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
    event: 'homework.assigned', module: 'homework', label: 'Homework set',
    when: 'When a teacher sets homework for a class and chooses to tell families.',
    vars: [...STUDENT, 'homework.subject', 'homework.title', 'homework.dueDate', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{homework.subject}} homework for {{student.firstName}}: {{homework.title}}, due {{homework.dueDate}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{homework.subject}} homework for {{student.firstName}} ({{student.class}}):\n{{homework.title}}\n\nDue: {{homework.dueDate}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{homework.subject}} homework — {{student.name}}', body: 'Dear {{guardian.name}},\n\n{{homework.subject}} homework has been set for {{student.name}} ({{student.class}}):\n{{homework.title}}\n\nDue: {{homework.dueDate}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'lms.live_class', module: 'lms', label: 'Live class scheduled',
    when: 'When a teacher schedules a live class and chooses to tell families (and when one is cancelled).',
    vars: [...STUDENT, 'live.subject', 'live.title', 'live.date', 'live.time', 'live.status', 'live.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{live.subject}} live class for {{student.firstName}} {{live.status}}: {{live.date}} {{live.time}}. Join in the app. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{live.subject}} live class for {{student.firstName}} ({{student.class}}) {{live.status}}:\n{{live.title}}\n\n{{live.date}} at {{live.time}}\nJoin from the app: {{live.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{live.subject}} live class — {{live.date}}', body: 'Dear {{guardian.name}},\n\nA {{live.subject}} live class for {{student.name}} ({{student.class}}) {{live.status}}:\n{{live.title}}\n{{live.date}} at {{live.time}}\n\nJoin from the app: {{live.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'tests.published', module: 'online-tests', label: 'Online test announced',
    when: 'When a teacher publishes an online test and chooses to tell families.',
    vars: [...STUDENT, 'test.subject', 'test.title', 'test.opens', 'test.closes', 'test.minutes', 'test.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{test.subject}} online test for {{student.firstName}}: {{test.title}}, {{test.opens}} to {{test.closes}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nAn online {{test.subject}} test for {{student.firstName}} ({{student.class}}):\n{{test.title}} — {{test.minutes}} minutes\n\nOpen from {{test.opens}} to {{test.closes}}\nIn the app: {{test.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Online test: {{test.title}}', body: 'Dear {{guardian.name}},\n\nAn online {{test.subject}} test for {{student.name}} ({{student.class}}): {{test.title}}, {{test.minutes}} minutes.\nIt can be taken from {{test.opens}} to {{test.closes}} in the app: {{test.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'transport.near', module: 'transport', label: 'Bus near the stop',
    when: 'When the bus is about to reach a student’s stop (Settings › Transport sets how near).',
    vars: [...STUDENT, 'bus.route', 'bus.stop', 'bus.minutes', 'bus.vehicle', 'bus.trip', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'School bus ({{bus.route}}) is about {{bus.minutes}} min from {{bus.stop}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nThe school bus ({{bus.route}}, {{bus.vehicle}}) is about {{bus.minutes}} minutes from {{bus.stop}} for the {{bus.trip}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'School bus near {{bus.stop}}', body: 'Dear {{guardian.name}},\n\nThe school bus ({{bus.route}}) is about {{bus.minutes}} minutes from {{bus.stop}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'transport.ride', module: 'transport', label: 'Got on / off the bus',
    when: 'When the bus attendant marks a student on or off the bus (or not at the stop).',
    vars: [...STUDENT, 'bus.route', 'bus.stop', 'bus.event', 'bus.time', 'bus.vehicle', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}} {{bus.event}} the school bus at {{bus.stop}}, {{bus.time}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} {{bus.event}} the school bus ({{bus.route}}) at {{bus.stop}}, {{bus.time}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} — school bus', body: 'Dear {{guardian.name}},\n\n{{student.name}} {{bus.event}} the school bus ({{bus.route}}) at {{bus.stop}}, {{bus.time}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'library.due', module: 'library', label: 'Library book due soon',
    when: 'A day or so before a borrowed book is due back (Settings › Library sets how early).',
    vars: [...STUDENT, 'library.title', 'library.dueDate', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}}: library book "{{library.title}}" is due back on {{library.dueDate}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}}’s library book “{{library.title}}” is due back on {{library.dueDate}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Library book due — {{library.title}}', body: 'Dear {{guardian.name}},\n\n{{student.name}}’s library book “{{library.title}}” is due back on {{library.dueDate}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'library.overdue', module: 'library', label: 'Library book overdue',
    when: 'When a borrowed book is past its due date, and again every few days until it comes back.',
    vars: [...STUDENT, 'library.title', 'library.dueDate', 'library.days', 'library.fine', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}}: library book "{{library.title}}" was due on {{library.dueDate}} ({{library.days}} days late, fine {{library.fine}}). - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}}’s library book “{{library.title}}” was due back on {{library.dueDate}} and is {{library.days}} days late. Fine so far: {{library.fine}}.\n\nPlease return it to the library.\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Library book overdue — {{library.title}}', body: 'Dear {{guardian.name}},\n\n{{student.name}}’s library book “{{library.title}}” was due back on {{library.dueDate}} and is {{library.days}} days late. Fine so far: {{library.fine}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'events.announced', module: 'events', label: 'New event on the calendar',
    when: 'When an event is put on the calendar and “tell families” is ticked.',
    vars: [...STUDENT, 'event.title', 'event.date', 'event.time', 'event.venue', 'event.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{event.title}} on {{event.date}} {{event.time}} at {{event.venue}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{event.title}}: {{event.date}} {{event.time}}, {{event.venue}}.\n\nDetails: {{event.link}}\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: '{{event.title}} — {{event.date}}', body: 'Dear {{guardian.name}},\n\n{{event.title}}\nWhen: {{event.date}} {{event.time}}\nWhere: {{event.venue}}\n\nDetails: {{event.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'events.reply', module: 'events', label: 'Reply asked for (RSVP / consent)',
    when: 'When an event asks families to reply — going or not, or permission for a trip.',
    vars: [...STUDENT, 'event.title', 'event.date', 'event.question', 'event.replyBy', 'event.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{event.title}} ({{event.date}}): {{event.question}} Reply in the app by {{event.replyBy}}: {{event.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{event.title}} on {{event.date}}.\n\n{{event.question}}\nPlease reply in the app by {{event.replyBy}}: {{event.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Please reply — {{event.title}}', body: 'Dear {{guardian.name}},\n\n{{event.title}} on {{event.date}}.\n{{event.question}}\nPlease reply in the app by {{event.replyBy}}: {{event.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'events.reminder', module: 'events', label: 'Event tomorrow',
    when: 'The day before an event that asks for a reminder.',
    vars: [...STUDENT, 'event.title', 'event.date', 'event.time', 'event.venue', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'Reminder: {{event.title}} tomorrow {{event.time}} at {{event.venue}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nA reminder: {{event.title}} is tomorrow, {{event.date}} {{event.time}}, {{event.venue}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Tomorrow: {{event.title}}', body: 'Dear {{guardian.name}},\n\nA reminder: {{event.title}} is tomorrow, {{event.date}} {{event.time}}, {{event.venue}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'events.ptm_open', module: 'events', label: 'Parent–teacher meeting: book a slot',
    when: 'When booking opens for a parent–teacher meeting.',
    vars: [...STUDENT, 'ptm.title', 'ptm.date', 'ptm.bookBy', 'ptm.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{ptm.title}} on {{ptm.date}}. Book a slot in the app by {{ptm.bookBy}}: {{ptm.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{ptm.title}} is on {{ptm.date}}. Please book a time to meet {{student.firstName}}’s teachers by {{ptm.bookBy}}:\n{{ptm.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{ptm.title}} — book a slot', body: 'Dear {{guardian.name}},\n\n{{ptm.title}} is on {{ptm.date}}. Please book a time by {{ptm.bookBy}}: {{ptm.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'events.ptm_booked', module: 'events', label: 'Parent–teacher meeting: slot booked',
    when: 'When a slot is booked (by the family or the school), and the day before the meeting.',
    vars: [...STUDENT, 'ptm.title', 'ptm.date', 'ptm.time', 'ptm.teacher', 'ptm.room', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{ptm.title}}: meet {{ptm.teacher}} on {{ptm.date}} at {{ptm.time}}, {{ptm.room}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nYour meeting with {{ptm.teacher}} about {{student.firstName}}: {{ptm.date}} at {{ptm.time}}, {{ptm.room}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{ptm.title}} — {{ptm.date}} {{ptm.time}}', body: 'Dear {{guardian.name}},\n\nYour meeting with {{ptm.teacher}} about {{student.name}}: {{ptm.date}} at {{ptm.time}}, {{ptm.room}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'communication.message', module: 'communication', label: 'Message to families',
    when: 'When staff send a message from Communication › Send messages (the channels they tick).',
    vars: [...STUDENT, 'message.subject', 'message.text', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{message.text}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{message.text}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: '{{message.subject}} — {{institution.name}}', body: 'Dear {{guardian.name}},\n\n{{message.text}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'communication.chat', module: 'communication', label: 'Teacher replied in chat',
    when: 'When a teacher replies to a family in the app’s messages.',
    vars: [...STUDENT, 'chat.teacher', 'chat.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{chat.teacher}} replied about {{student.firstName}}. Read: {{chat.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{chat.teacher}} has replied to your message about {{student.firstName}}.\n\nRead it in the app: {{chat.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'A reply from {{chat.teacher}} — {{student.name}}', body: 'Dear {{guardian.name}},\n\n{{chat.teacher}} has replied to your message about {{student.name}}.\nRead it in the app: {{chat.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'admissions.enquiry', module: 'admissions', label: 'Enquiry received',
    when: 'When an admission enquiry is taken (desk, phone or website).',
    vars: ['guardian.name', 'applicant.name', 'applicant.class', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Thank you for your enquiry about {{applicant.class}} admission for {{applicant.name}}. We will call you soon. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nThank you for your interest in {{institution.name}}. We have your enquiry for {{applicant.name}} ({{applicant.class}}) and will call you soon.\n\nFor questions: {{institution.phone}}' },
      EMAIL: { enabled: false, subject: 'Your admission enquiry — {{institution.name}}', body: 'Dear {{guardian.name}},\n\nThank you for your enquiry about {{applicant.class}} admission for {{applicant.name}}. We will contact you soon.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'admissions.application', module: 'admissions', label: 'Application received',
    when: 'When an application is submitted, online or at the desk.',
    vars: ['guardian.name', 'applicant.name', 'applicant.class', 'application.no', 'application.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Application {{application.no}} for {{applicant.name}} ({{applicant.class}}) received. Track it: {{application.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nWe have received the application for {{applicant.name}} ({{applicant.class}}).\n\nApplication no.: {{application.no}}\nTrack it here: {{application.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Application {{application.no}} received — {{institution.name}}', body: 'Dear {{guardian.name}},\n\nWe have received the application for {{applicant.name}} ({{applicant.class}}).\nApplication number: {{application.no}}\nYou can check it here: {{application.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'admissions.test', module: 'admissions', label: 'Entrance test scheduled',
    when: 'When an applicant is put down for an entrance test or interaction.',
    vars: ['guardian.name', 'applicant.name', 'applicant.class', 'application.no', 'test.name', 'test.when', 'test.venue', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{test.name}} for {{applicant.name}} ({{application.no}}): {{test.when}} at {{test.venue}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{applicant.name}} is invited for the {{test.name}}.\n\nWhen: {{test.when}}\nWhere: {{test.venue}}\nApplication no.: {{application.no}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: '{{test.name}} — {{applicant.name}}', body: 'Dear {{guardian.name}},\n\n{{applicant.name}} is invited for the {{test.name}} on {{test.when}} at {{test.venue}}.\nApplication number: {{application.no}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'admissions.offer', module: 'admissions', label: 'Seat offered',
    when: 'When an applicant is offered a seat from the merit list.',
    vars: ['guardian.name', 'applicant.name', 'applicant.class', 'application.no', 'offer.until', 'application.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Congratulations! {{applicant.name}} is offered a seat in {{applicant.class}}. Please confirm by {{offer.until}}: {{application.link}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nCongratulations! {{applicant.name}} is offered a seat in {{applicant.class}} at {{institution.name}}.\n\nPlease confirm by {{offer.until}}: {{application.link}}\nApplication no.: {{application.no}}' },
      EMAIL: { enabled: true, subject: 'Seat offered — {{applicant.name}}, {{applicant.class}}', body: 'Dear {{guardian.name}},\n\nCongratulations! {{applicant.name}} is offered a seat in {{applicant.class}}.\nPlease confirm by {{offer.until}}: {{application.link}}\nApplication number: {{application.no}}\n\n{{institution.name}}' },
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
  {
    event: 'hostel.outpass_decided', module: 'hostel', label: 'Outpass approved / rejected',
    when: 'When the warden approves or rejects an outpass (also when the warden makes one already approved).',
    vars: [...STUDENT, 'outpass.no', 'outpass.status', 'outpass.leave', 'outpass.return', 'outpass.reason', 'outpass.note', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Outpass {{outpass.no}} for {{student.firstName}} ({{outpass.leave}} to {{outpass.return}}) is {{outpass.status}}. {{outpass.note}} - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\nThe outpass for {{student.firstName}} ({{student.class}}) — {{outpass.leave}} to {{outpass.return}}, “{{outpass.reason}}” — is {{outpass.status}}.\n{{outpass.note}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Outpass {{outpass.no}}: {{outpass.status}}', body: 'Dear {{guardian.name}},\n\nThe outpass for {{student.name}} ({{outpass.leave}} to {{outpass.return}}, {{outpass.reason}}) is {{outpass.status}}.\n{{outpass.note}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'hostel.outpass_out', module: 'hostel', label: 'Left the hostel on an outpass',
    when: 'When the student is marked out at the hostel gate.',
    vars: [...STUDENT, 'outpass.no', 'outpass.time', 'outpass.return', 'outpass.reason', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{student.firstName}} left the hostel at {{outpass.time}} (outpass {{outpass.no}}), due back {{outpass.return}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} left the hostel at {{outpass.time}} on outpass {{outpass.no}}. Due back by {{outpass.return}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} left the hostel', body: 'Dear {{guardian.name}},\n\n{{student.name}} left the hostel at {{outpass.time}} (outpass {{outpass.no}}), due back by {{outpass.return}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'hostel.outpass_in', module: 'hostel', label: 'Back in the hostel',
    when: 'When the student is marked back in at the hostel gate (on time or late).',
    vars: [...STUDENT, 'outpass.no', 'outpass.time', 'outpass.late', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{student.firstName}} is back in the hostel at {{outpass.time}} ({{outpass.late}}). - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} is back in the hostel at {{outpass.time}} ({{outpass.late}}).\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} is back in the hostel', body: 'Dear {{guardian.name}},\n\n{{student.name}} came back to the hostel at {{outpass.time}} ({{outpass.late}}).\n\n{{institution.name}}' },
    },
  },
  {
    event: 'health.sent_home', module: 'health', label: 'Sent home from the sick room',
    when: 'When the school nurse sends a student home from the sick room.',
    vars: [...STUDENT, 'health.complaint', 'health.time', 'health.note', 'health.pickedUpBy', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Dear Parent, {{student.firstName}} ({{student.class}}) was seen in the sick room for {{health.complaint}} and is being sent home ({{health.time}}). - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} ({{student.class}}) was seen in the school sick room for {{health.complaint}} and is being sent home at {{health.time}}.\n{{health.note}}\n\nPlease call {{institution.phone}} if you need to.\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} sent home from school', body: 'Dear {{guardian.name}},\n\n{{student.name}} ({{student.class}}) was seen in the school sick room for {{health.complaint}} and is being sent home at {{health.time}}.\n{{health.note}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'health.incident', module: 'health', label: 'Incident report',
    when: 'When staff report an incident or injury and choose to message the guardian.',
    vars: [...STUDENT, 'incident.kind', 'incident.date', 'incident.time', 'incident.place', 'incident.severity', 'incident.firstAid', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Dear Parent, {{student.firstName}} had a {{incident.severity}} {{incident.kind}} at school ({{incident.place}}, {{incident.time}}). First aid was given. Please call {{institution.phone}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} ({{student.class}}) had a {{incident.severity}} {{incident.kind}} at school today — {{incident.place}}, {{incident.time}}.\nFirst aid: {{incident.firstAid}}\n\nPlease call {{institution.phone}} for details.\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Incident at school — {{student.firstName}}', body: 'Dear {{guardian.name}},\n\n{{student.name}} ({{student.class}}) had a {{incident.severity}} {{incident.kind}} at school on {{incident.date}} ({{incident.place}}, {{incident.time}}).\nFirst aid: {{incident.firstAid}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'placements.drive_open', module: 'placements', label: 'Placement drive open',
    when: 'When a placement drive opens for registration — to each eligible student (Settings › Placements can turn it off).',
    vars: [...STUDENT, 'drive.company', 'drive.title', 'drive.ctc', 'drive.date', 'drive.lastDate', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}}: {{drive.company}} placement drive ({{drive.ctc}}) is open. Register by {{drive.lastDate}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{student.firstName}},\n{{drive.company}} — {{drive.title}} is open for registration. Package: {{drive.ctc}}.\nRegister in the app by {{drive.lastDate}}.\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Placement drive open — {{drive.company}}', body: 'Dear {{student.firstName}},\n\n{{drive.company}} — {{drive.title}} is open for registration (package {{drive.ctc}}, drive on {{drive.date}}). Register in the app by {{drive.lastDate}}.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'placements.selected', module: 'placements', label: 'Selected in a placement drive',
    when: 'When a student is selected in a drive and an offer is made.',
    vars: [...STUDENT, 'drive.company', 'drive.title', 'drive.ctc', 'drive.role', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'Congratulations {{student.firstName}}! Selected by {{drive.company}} ({{drive.ctc}}). - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Congratulations {{student.firstName}}!\nYou have been selected by {{drive.company}} as {{drive.role}} ({{drive.ctc}}). The placement office will share the offer letter.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Selected — {{drive.company}}', body: 'Dear {{student.firstName}},\n\nCongratulations! You have been selected by {{drive.company}} as {{drive.role}} ({{drive.ctc}}).\n\n{{institution.name}}' },
    },
  },
  {
    event: 'frontoffice.gate_pass', module: 'frontoffice', label: 'Child left school early',
    when: 'When a student on a gate pass is handed over at the gate (Front office › Gate passes).',
    vars: [...STUDENT, 'gatepass.no', 'gatepass.time', 'gatepass.collector', 'gatepass.relation', 'gatepass.reason', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: '{{student.firstName}} left school at {{gatepass.time}} with {{gatepass.collector}} ({{gatepass.relation}}). Gate pass {{gatepass.no}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}} left school at {{gatepass.time}} with {{gatepass.collector}} ({{gatepass.relation}}).\nReason: {{gatepass.reason}}\nGate pass: {{gatepass.no}}\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: '{{student.firstName}} left school early — {{gatepass.no}}', body: 'Dear {{guardian.name}},\n\n{{student.name}} left school at {{gatepass.time}} with {{gatepass.collector}} ({{gatepass.relation}}).\nReason: {{gatepass.reason}}\nGate pass: {{gatepass.no}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'frontoffice.complaint_received', module: 'frontoffice', label: 'Complaint received',
    when: 'When a complaint is raised at the front office or in the family app.',
    vars: [...STUDENT, 'complaint.no', 'complaint.subject', 'complaint.name', 'complaint.dueDate', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: 'Your complaint {{complaint.no}} ({{complaint.subject}}) has been received. We aim to resolve it by {{complaint.dueDate}}. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{complaint.name}},\nWe have received your complaint {{complaint.no}}: {{complaint.subject}}.\nWe aim to resolve it by {{complaint.dueDate}} and will let you know.\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Complaint {{complaint.no}} received — {{institution.name}}', body: 'Dear {{complaint.name}},\n\nWe have received your complaint {{complaint.no}}: {{complaint.subject}}.\nWe aim to resolve it by {{complaint.dueDate}} and will let you know.\n\n{{institution.name}}' },
    },
  },
  {
    event: 'frontoffice.complaint_resolved', module: 'frontoffice', label: 'Complaint resolved',
    when: 'When a complaint is marked resolved (Front office › Complaints).',
    vars: [...STUDENT, 'complaint.no', 'complaint.subject', 'complaint.name', 'complaint.resolution', ...INSTITUTION],
    defaults: {
      SMS: { enabled: true, body: 'Your complaint {{complaint.no}} ({{complaint.subject}}) has been resolved. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{complaint.name}},\nYour complaint {{complaint.no}} ({{complaint.subject}}) has been resolved:\n{{complaint.resolution}}\n\nThank you for telling us.\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Complaint {{complaint.no}} resolved — {{institution.name}}', body: 'Dear {{complaint.name}},\n\nYour complaint {{complaint.no}} ({{complaint.subject}}) has been resolved:\n{{complaint.resolution}}\n\nThank you for telling us.\n{{institution.name}}' },
    },
  },
  {
    event: 'surveys.request', module: 'surveys', label: 'Survey to answer',
    when: 'When a survey for parents or students is published with “ask now”, and when a reminder is sent to those who haven’t answered.',
    vars: [...STUDENT, 'survey.title', 'survey.closes', 'survey.link', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{institution.name}} would like your feedback: {{survey.title}}. Answer in the app: {{survey.link}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{institution.name}} would like your feedback: {{survey.title}}.\n\nIt takes a few minutes — answer in the app: {{survey.link}}\n\n{{institution.name}}' },
      EMAIL: { enabled: true, subject: 'Your feedback: {{survey.title}}', body: 'Dear {{guardian.name}},\n\n{{institution.name}} would like your feedback: {{survey.title}}.\nAnswer in the app: {{survey.link}}\n\n{{institution.name}}' },
    },
  },
  {
    event: 'canteen.low_balance', module: 'canteen', label: 'Canteen wallet running low',
    when: 'Once, when a student’s canteen wallet falls below the low-balance mark (Settings › Canteen); again after the next top-up.',
    vars: [...STUDENT, 'canteen.balance', 'canteen.threshold', ...INSTITUTION],
    defaults: {
      SMS: { enabled: false, body: '{{student.firstName}}’s canteen wallet is low: {{canteen.balance}} left. Please top up. - {{institution.name}}' },
      WHATSAPP: { enabled: true, body: 'Dear {{guardian.name}},\n{{student.firstName}}’s canteen wallet has {{canteen.balance}} left (below {{canteen.threshold}}). You can top it up in the school app or at the canteen counter.\n\n{{institution.name}}' },
      EMAIL: { enabled: false, subject: 'Canteen wallet low — {{student.firstName}}', body: 'Dear {{guardian.name}},\n\n{{student.name}}’s canteen wallet has {{canteen.balance}} left (below {{canteen.threshold}}). Top it up in the school app or at the canteen counter.\n\n{{institution.name}}' },
    },
  },
]

export const NOTIFY_EVENT_BY = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.event, e]))

/** Example values for previews in the rule editor. */
export const TEMPLATE_SAMPLE = {
  student: { name: 'Aarav Sharma', firstName: 'Aarav', admissionNo: 'GV-2026-0142', class: '8-A' },
  guardian: { name: 'Neha Sharma' },
  institution: { name: 'Green Valley Public School', phone: '080 4000 1234' },
  attendance: { date: 'Tue, 7 Oct', time: '07:52' },
  pickup: { person: 'Rakesh Sharma (uncle)', time: '12:40' },
  receipt: { no: 'RC26-000045', amount: '₹12,500', date: 'Tue, 7 Oct' },
  fees: { due: '₹8,000', dueDate: 'Fri, 10 Oct' },
  pay: { link: 'https://pay.example.in/p/k3Xb9QmT' },
  exam: { name: 'Half-yearly 2026' },
  result: { link: 'https://app.example.in/r/Hq7Zt4Wn' },
  homework: { subject: 'Mathematics', title: 'Exercise 4.2, questions 1–10', dueDate: 'Thu, 9 Oct' },
  message: { subject: 'School closed tomorrow', text: 'School stays closed tomorrow, Thursday, because of heavy rain.' },
  chat: { teacher: 'Ms Kavita Rao', link: 'https://app.example.in/app/green-valley/chat' },
  applicant: { name: 'Riya Sharma', class: 'Class 1' },
  application: { no: 'APP2700042', link: 'https://app.example.in/apply/green-valley/status' },
  test: { name: 'Entrance interaction', when: 'Sat, 14 Dec, 10:00', venue: 'Main block, room 4' },
  offer: { until: 'Fri, 20 Dec' },
  notice: { title: 'Annual Day on 20 December', link: 'https://app.example.in/n/Vb3kQ9xT' },
  otp: { code: '482913', minutes: 10 },
  bus: { route: 'Route 3 — Lake side', stop: 'Market Road', minutes: 5, vehicle: 'KA01AB1234', trip: 'morning pickup', event: 'got on', time: '07:22' },
  library: { title: 'The Jungle Book', dueDate: 'Fri, 10 Oct', days: 4, fine: '₹4' },
  event: { title: 'Annual Day', date: 'Sat, 20 Dec', time: '17:00', venue: 'School auditorium', question: 'May your child join the trip to the science centre?', replyBy: 'Wed, 17 Dec', link: 'https://app.example.in/app/green-valley/calendar' },
  ptm: { title: 'Term 1 parent–teacher meeting', date: 'Sat, 18 Oct', bookBy: 'Thu, 16 Oct', time: '10:20', teacher: 'Ms Kavita Rao', room: 'Room 8-A', link: 'https://app.example.in/app/green-valley/meetings' },
  outpass: { no: 'OP26110042', status: 'approved', leave: 'Sat, 14 Nov 16:00', return: 'Sun, 15 Nov 18:00', reason: 'Cousin’s wedding', note: '', time: '16:05', late: 'on time' },
  health: { complaint: 'fever', time: '11:40', note: 'Temperature 38.4 °C, paracetamol given.', pickedUpBy: 'Mother' },
  incident: { kind: 'fall', date: '2026-11-09', time: '11:20', place: 'Playground', severity: 'minor', firstAid: 'Knee cleaned and dressed' },
  canteen: { balance: '₹45', threshold: '₹100', amount: '₹500' },
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
