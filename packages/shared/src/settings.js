// Settings engine (E3). Every setting is declared here once — with its type,
// default and help text. A tenant row only exists when an admin changes it;
// otherwise the default applies. Administration › Settings renders this list,
// grouped by module (a module's settings show once the module is switched on).
import { SUPPORTED_LANGUAGES } from './languages.js'
import { ID_CARD_ORIENTATIONS, STUDENT_ID_CARD_FIELDS } from './students.js'
import { GEOFENCE_MODES, STUDENT_SELF_CHECKIN } from './geofence.js'
import { PAGE_CODE_ESCALATION_TARGETS, PAGE_ESCALATION_TARGETS } from './comms.js'

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
  { module: 'admissions', key: 'onlineApplication', type: 'bool', label: 'Families can apply online', default: false, help: 'The application page at <app>/apply/<your school>; the mobile number is checked with a one-time code.' },
  { module: 'admissions', key: 'websiteEnquiry', type: 'bool', label: 'Take enquiries from the website', default: true, help: 'A short enquiry form on the same page, for families not ready to apply.' },
  { module: 'admissions', key: 'ageCutoff', type: 'text', label: 'Age is counted on (day-month)', default: '31-03', pattern: '^(0[1-9]|[12]\\d|3[01])-(0[1-9]|1[0-2])$', patternError: 'Use DD-MM, e.g. 31-03', help: 'The day of the admission year on which a child’s age is counted for eligibility.' },
  { module: 'admissions', key: 'followUpDays', type: 'number', label: 'Follow up a new enquiry within (days)', default: 1, min: 0, max: 14 },
  { module: 'admissions', key: 'offerDays', type: 'number', label: 'Days a family has to accept an offered seat', default: 7, min: 1, max: 60 },
  { module: 'hrms', key: 'weeklyOffDays', type: 'multi', label: 'Staff weekly off', default: ['SUN'], options: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => ({ value: d, label: d[0] + d.slice(1).toLowerCase() })), help: 'A staff record can have its own weekly off.' },
  { module: 'hrms', key: 'saturdaysOff', type: 'multi', label: 'Saturdays off', default: [], options: ['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: ['1st', '2nd', '3rd', '4th', '5th'][n - 1] })), help: 'For example the 2nd and 4th Saturday of every month.' },
  { module: 'hrms', key: 'leaveYearStartMonth', type: 'select', label: 'Leave year starts in', default: 4, options: MONTHS, help: 'Yearly leave is credited, and unused leave carried forward, at this month.' },
  { module: 'hrms', key: 'lateAfter', type: 'text', label: 'Late after (HH:MM)', default: '', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', patternError: 'Use HH:MM', help: 'Arriving after this is marked late. Leave empty to not track late arrival.' },
  { module: 'hrms', key: 'attendanceEditDays', type: 'number', label: 'Staff attendance can be corrected up to (days back)', default: 7, min: 0, max: 62 },
  { module: 'hrms', key: 'selfLeave', type: 'bool', label: 'Staff apply for leave themselves', default: true, help: 'In My workspace. Otherwise HR applies on their behalf.' },
  { module: 'hrms', key: 'selfAttendance', type: 'bool', label: 'Staff can mark themselves in and out from their phone (My workspace)', default: false, help: 'Off: HR, the biometric device or a gate scanner marks staff attendance. They can check in and out several times a day; the first in and last out make the day.' },
  { module: 'hrms', key: 'geofence', type: 'select', label: 'Where staff may mark themselves in and out', default: 'REQUIRED', options: GEOFENCE_MODES, help: 'Checks the phone’s location against the attendance sites of the person’s campus (Administration › Campuses). The location is read only at the moment they mark attendance — never tracked. HR can exempt field staff on their staff record.' },
  { module: 'hrms', key: 'geofenceMaxAccuracyM', type: 'number', label: 'Refuse a staff location rougher than (metres)', default: 100, min: 10, max: 2000, help: 'Phones indoors can be off by a few hundred metres; the punch is refused (or flagged) when the location is less accurate than this.' },
  { module: 'transport', key: 'alertNear', type: 'bool', label: 'Tell families when the bus is near their stop', default: true },
  { module: 'transport', key: 'nearMetres', type: 'number', label: 'Near means within (metres)', default: 1500, min: 300, max: 5000 },
  { module: 'transport', key: 'arriveMetres', type: 'number', label: 'At the stop means within (metres)', default: 150, min: 30, max: 500 },
  { module: 'transport', key: 'alertRide', type: 'bool', label: 'Tell families when their child gets on and off', default: true },
  { module: 'transport', key: 'docWarnDays', type: 'number', label: 'Warn about vehicle papers this many days before expiry', default: 30, min: 0, max: 120 },
  { module: 'library', key: 'studentLimit', type: 'number', label: 'Books a student can have at once', default: 2, min: 0, max: 20 },
  { module: 'library', key: 'staffLimit', type: 'number', label: 'Books a staff member can have at once', default: 5, min: 0, max: 50 },
  { module: 'library', key: 'studentDays', type: 'number', label: 'Loan period for students (days)', default: 14, min: 1, max: 120 },
  { module: 'library', key: 'staffDays', type: 'number', label: 'Loan period for staff (days)', default: 30, min: 1, max: 365 },
  { module: 'library', key: 'renewals', type: 'number', label: 'Times a loan can be renewed', default: 1, min: 0, max: 10 },
  { module: 'library', key: 'finePerDay', type: 'number', label: 'Late fine a day (₹)', default: 1, min: 0, max: 1000, help: '0: no late fines.' },
  { module: 'library', key: 'fineMax', type: 'number', label: 'Most a late fine can be for one book (₹)', default: 100, min: 0, max: 100000, help: '0: no limit.' },
  { module: 'library', key: 'graceDays', type: 'number', label: 'Days late before a fine starts', default: 0, min: 0, max: 30 },
  { module: 'library', key: 'staffFines', type: 'bool', label: 'Charge late fines to staff', default: false },
  { module: 'library', key: 'blockWithFines', type: 'bool', label: 'No new books while a fine is unpaid', default: true },
  { module: 'library', key: 'blockOverdue', type: 'bool', label: 'No new books while one is overdue', default: true },
  { module: 'library', key: 'remindDaysBefore', type: 'number', label: 'Remind families this many days before a book is due', default: 1, min: 0, max: 7, help: '0: no reminder before the due date.' },
  { module: 'library', key: 'overdueEveryDays', type: 'number', label: 'Remind about an overdue book every (days)', default: 3, min: 0, max: 30, help: '0: no overdue reminders.' },
  { module: 'canteen', key: 'lowBalanceRs', type: 'number', label: 'Tell the family when the wallet falls below (₹)', default: 100, min: 0, max: 5000 },
  { module: 'canteen', key: 'minTopUpRs', type: 'number', label: 'Smallest top-up (₹)', default: 50, min: 1, max: 5000 },
  { module: 'canteen', key: 'maxTopUpRs', type: 'number', label: 'Largest single top-up (₹)', default: 5000, min: 100, max: 50000 },
  { module: 'canteen', key: 'maxBalanceRs', type: 'number', label: 'Most a wallet can hold (₹)', default: 10000, min: 100, max: 100000 },
  { module: 'canteen', key: 'preorderDays', type: 'number', label: 'Families can pre-order this many days ahead', default: 7, min: 0, max: 30 },
  { module: 'canteen', key: 'preorderCutoff', type: 'text', label: 'Same-day pre-orders close at (HH:MM)', default: '09:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', patternError: 'Use HH:MM, e.g. 09:00' },
  { module: 'frontoffice', key: 'complaintSlaDays', type: 'number', label: 'Resolve a complaint within (days)', default: 3, min: 1, max: 60, help: 'Sets the due day of every new complaint (an urgent one is due the next day). Past it, the complaint shows as overdue.' },
  { module: 'frontoffice', key: 'gatePassApproval', type: 'bool', label: 'Gate passes need approval', default: true, help: 'The class teacher, or someone allowed to approve, approves before a student is handed over at the gate. Off: a pass is ready as soon as it is written.' },
  { module: 'placements', key: 'offerPolicy', type: 'select', label: 'Offers a student may hold', default: 'DREAM', options: [{ value: 'ONE', label: 'One offer — a placed student applies no more' }, { value: 'DREAM', label: 'Dream offer — once placed, only drives paying the dream CTC or more' }, { value: 'OPEN', label: 'No limit' }], help: 'Checked when students register for a drive and when an offer is accepted. Accepting a dream offer releases the earlier one.' },
  { module: 'placements', key: 'dreamCtcLakhs', type: 'number', label: 'Dream offer: CTC from (₹ lakh a year)', default: 10, min: 1, max: 500 },
  { module: 'placements', key: 'familyRegistration', type: 'bool', label: 'Students and parents register for drives in the app', default: true, help: 'Off: only the placement office registers students.' },
  { module: 'placements', key: 'notifyEligible', type: 'bool', label: 'Tell eligible students when a drive opens', default: true },
  { module: 'hostel', key: 'lateGraceMinutes', type: 'number', label: 'Minutes after the return time before an outpass counts as late', default: 30, min: 0, max: 240 },
  { module: 'hostel', key: 'familyOutpass', type: 'bool', label: 'Parents can ask for an outpass in the family app', default: true },
  { module: 'hostel', key: 'alertOutpass', type: 'bool', label: 'Tell the guardian when an outpass is approved or rejected, and when the student leaves and comes back', default: true },
  { module: 'events', key: 'remindDayBefore', type: 'bool', label: 'Remind families the day before an event', default: true, help: 'Only for events that ask for it (the box on the event).' },
  { module: 'events', key: 'calendarHolidays', type: 'bool', label: 'Show holidays from Staff & HR on the calendar', default: true },
  { module: 'events', key: 'calendarExams', type: 'bool', label: 'Show exam dates on the calendar', default: true },
  { module: 'events', key: 'weekStartsSunday', type: 'bool', label: 'Calendar weeks start on Sunday', default: false },
  { module: 'events', key: 'ptmSlotMinutes', type: 'number', label: 'Parent–teacher meeting slot (minutes)', default: 10, min: 3, max: 60 },
  { module: 'events', key: 'ptmReminder', type: 'bool', label: 'Remind families of their meeting slot the day before', default: true },
  { module: 'finance', key: 'autoPost', type: 'bool', label: 'Post fees, refunds and payroll to the books on their own', default: true, help: 'Fee receipts, refunds, cancelled receipts and paid payroll make their vouchers as they happen.' },
  { module: 'finance', key: 'onlineToGateway', type: 'bool', label: 'Online fee payments go to “Payment gateway in transit”', default: false, help: 'On: a contra voucher moves them to the bank when the gateway settles. Off: straight to the main bank account.' },
  { module: 'finance', key: 'expenseAutoApproveUpTo', type: 'number', label: 'Expenses up to this amount need no approval (₹)', default: 0, min: 0, max: 10000000, help: '0: every expense is approved before it is paid.' },
  { module: 'finance', key: 'matchWindowDays', type: 'number', label: 'Bank matching window (days)', default: 5, min: 0, max: 31, help: 'A statement line matches a book entry of the same amount this many days apart.' },
  { module: 'students', key: 'idCardOrientation', type: 'select', label: 'Student ID card layout', default: 'PORTRAIT', options: ID_CARD_ORIENTATIONS, help: 'Both are the standard bank-card size (CR80) that fits card holders, lanyards and card printers.' },
  { module: 'students', key: 'idCardTitle', type: 'text', label: 'Heading on the student ID card', default: 'Student ID card', help: 'Printed in the coloured band, e.g. Student ID card or Identity card.' },
  { module: 'students', key: 'idCardColor', type: 'text', label: 'Student ID card colour', default: '', pattern: '^#[0-9a-fA-F]{6}$', patternError: 'Use a colour like #0E7C86', help: 'A colour code like #0E7C86. Leave it blank to use the brand colour from the institution profile.' },
  { module: 'students', key: 'idCardFields', type: 'multi', label: 'Shown on the student ID card', default: ['PHOTO', 'ROLL', 'DOB', 'BLOOD_GROUP', 'GUARDIAN', 'GUARDIAN_PHONE', 'ADDRESS', 'VALID_UNTIL', 'QR'], options: STUDENT_ID_CARD_FIELDS, help: 'The name, class and admission number are always printed.' },
  { module: 'students', key: 'idCardBack', type: 'bool', label: 'Print a back side on student ID cards', default: true, help: 'Each card’s back follows its front, so double-sided printing lines up.' },
  { module: 'students', key: 'idCardBackText', type: 'text', label: 'Rules printed on the back of the card', default: 'This card is the property of the school. Carry it every day. Report a lost card to the office at once.' },
  { module: 'students', key: 'idCardReturnText', type: 'text', label: 'Return note on the back of the card', default: 'If found, please return to:', help: 'Followed by the institution’s name, address and phone number.' },
  { module: 'students', key: 'idCardSignatory', type: 'text', label: 'Caption under the signature line', default: 'Principal', help: 'e.g. Principal or Headmistress.' },

  // ── Attendance
  { module: 'attendance', key: 'mode', type: 'select', label: 'Attendance is taken', default: 'DAILY', options: [{ value: 'DAILY', label: 'Once a day, by the class teacher' }, { value: 'PERIOD', label: 'Every period, by the subject teacher' }, { value: 'BOTH', label: 'Both — once a day by the class teacher, and every period by the subject teacher' }], help: 'Every period: the day’s attendance is worked out from the periods (see below). Both: the class teacher’s daily register stays the day’s attendance; the periods give subject-wise attendance.' },
  { module: 'attendance', key: 'dayFrom', type: 'select', label: 'With every period: the day’s attendance comes from', default: 'FIRST', options: [{ value: 'FIRST', label: 'The first period marked that day' }, { value: 'SHARE', label: 'The share of periods attended' }] },
  { module: 'attendance', key: 'dayMinPct', type: 'number', label: 'Present for the day when at least this % of periods are attended', default: 50, min: 1, max: 100, help: 'Used when the day comes from the share of periods.' },
  { module: 'attendance', key: 'periodMarkers', type: 'select', label: 'Who marks a period', default: 'TIMETABLE', options: [{ value: 'TIMETABLE', label: 'Its teacher in the published timetable (or the substitute), and the class teacher' }, { value: 'ANYONE', label: 'Anyone who may mark attendance for the class' }], help: 'Staff who see attendance for the whole campus or institution (principal, coordinator, office) can always mark any period.' },
  { module: 'attendance', key: 'absentAlert', type: 'bool', label: 'Tell parents when their child is absent', default: true, help: 'By the channels set for “Absence alert” in Notification rules.' },
  { module: 'attendance', key: 'markBefore', type: 'text', label: 'Attendance to be marked by (HH:MM)', default: '10:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', patternError: 'Use HH:MM', help: 'Classes not marked by then show on the principal’s dashboard.' },
  { module: 'attendance', key: 'minimumPct', type: 'number', label: 'Minimum attendance required (%)', default: 75, min: 0, max: 100, help: 'Students below it are flagged in reports.' },
  { module: 'attendance', key: 'editDays', type: 'number', label: 'Teachers can correct attendance up to (days back)', default: 2, min: 0, max: 30 },
  { module: 'attendance', key: 'studentSelfCheckIn', type: 'select', label: 'Students check themselves in from the student app', default: 'OFF', options: STUDENT_SELF_CHECKIN, help: 'Only from a student’s own login (not a parent’s), and only inside an attendance site of their campus (Administration › Campuses). They can check in and out several times; teachers can always mark or correct the register by hand.' },
  { module: 'attendance', key: 'studentGeofenceMaxAccuracyM', type: 'number', label: 'Refuse a student location rougher than (metres)', default: 100, min: 10, max: 2000 },

  // ── Exams & report cards
  { module: 'exams', key: 'roundMarks', type: 'bool', label: 'Round totals to whole marks', default: true },
  { module: 'exams', key: 'showRank', type: 'bool', label: 'Show class rank on report cards', default: false },
  { module: 'exams', key: 'yearCombine', type: 'select', label: 'Several exams of one type in the year result', default: 'AVERAGE', options: [{ value: 'AVERAGE', label: 'Average them' }, { value: 'BEST', label: 'Take the best one' }], help: 'For example three unit tests: their average, or only the best, counts towards the unit-test share.' },
  { module: 'exams', key: 'yearPassPct', type: 'number', label: 'Pass mark for the year result (%)', default: 33, min: 0, max: 100, help: 'A subject whose final % is below this needs to improve.' },
  { module: 'exams', key: 'compartmentMax', type: 'number', label: 'Compartment: up to this many subjects below the pass mark', default: 2, min: 0, max: 5, help: '0: no compartment — any subject below the pass mark is "needs to improve".' },
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
  { module: 'portal', key: 'chat', type: 'bool', label: 'Families can message teachers in the app', default: true, help: 'The class teacher and the subject teachers of the child’s class. Needs the Communication hub.' },

  // ── Staff chat & call bell (calls & emergency alerts)
  { module: 'comms', key: 'reRingMinutes', type: 'number', label: 'Ring again when nobody has answered for (minutes)', default: 1, min: 1, max: 15 },
  { module: 'comms', key: 'maxRings', type: 'number', label: 'Ring each person at most (times)', default: 3, min: 1, max: 10, help: 'After that the call shows as missed for them.' },
  { module: 'comms', key: 'escalateMinutes', type: 'number', label: 'Escalate when nobody is on the way after (minutes)', default: 3, min: 1, max: 60, help: 'Counted from the call, then again from each escalation.' },
  { module: 'comms', key: 'escalateTo', type: 'select', label: 'Normal and urgent calls escalate to', default: 'DEPARTMENT_HEAD', options: PAGE_ESCALATION_TARGETS, help: 'The next step goes one level wider (head of department → whole department).' },
  { module: 'comms', key: 'maxEscalations', type: 'number', label: 'Escalation steps at most', default: 2, min: 0, max: 2, help: '0 turns escalation off.' },
  { module: 'comms', key: 'codeEscalateTo', type: 'select', label: 'Unanswered emergency alerts escalate to', default: 'EVERYONE', options: PAGE_CODE_ESCALATION_TARGETS },
  { module: 'comms', key: 'autoCloseMinutes', type: 'number', label: 'Close normal and urgent calls left open after (minutes)', default: 120, min: 15, max: 1440, help: 'Emergency alerts never close on their own — someone gives the all clear.' },
  // ── Staff chat & call bell (staff chat)
  { module: 'comms', key: 'chatAnnouncementsOnly', type: 'bool', label: 'Whole-staff chat is for announcements only', default: false, help: 'On: only people who can moderate chat post in the whole-staff and campus chats; everyone still reads them.' },
  { module: 'comms', key: 'chatRetentionDays', type: 'number', label: 'Keep staff chat messages for (days)', default: 0, min: 0, max: 3650, help: '0 keeps them. Older messages and their attachments are removed by an hourly job.' },
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
