// Accreditation (module `accreditation`): NAAC, NIRF and AISHE returns of a college, metric by metric, with the
// evidence (files) behind each value. Constants and pure helpers shared by the API and the web app.
//
// A framework → criteria (NAAC criteria, NIRF parameters, AISHE sections) → metrics. Each metric:
//   code     the framework's own number (NAAC SSR metric "3.3.2", NIRF sub-parameter "FSR")
//   title    its short name
//   kind     QN — quantitative (a value: a count, a %, a ratio, ₹ lakh) · QL — qualitative (a narrative)
//   source   where SchoolGiant reads its data (programs, students, coe, hrms, research, placements, library) or 'manual'
//   auto     the key of the server's calculation (services/accreditationMetrics.js) when the value can be computed
//   unit     how the value reads: count · pct · ratio · lakh · years · perTeacher · days
//   dvv      the documents data validation (NAAC DVV) asks for — the evidence checklist of the metric
//
// NAAC codes follow the revised SSR manual for affiliated / constituent colleges (UG).

export const ACCR_FRAMEWORKS = [
  { value: 'NAAC', label: 'NAAC', name: 'NAAC self-study report (SSR)', tone: 'brand' },
  { value: 'NIRF', label: 'NIRF', name: 'NIRF data capture (college)', tone: 'violet' },
  { value: 'AISHE', label: 'AISHE', name: 'AISHE data capture format (college)', tone: 'teal' },
]
export const ACCR_FRAMEWORK_BY = Object.fromEntries(ACCR_FRAMEWORKS.map((f) => [f.value, f]))

export const ACCR_METRIC_STATUS = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  DRAFT: { label: 'Draft', tone: 'warning' },
  COMPLETE: { label: 'Complete', tone: 'success' },
}

/** DVV (data validation and verification) state of one piece of evidence. */
export const ACCR_DVV_STATUS = {
  PENDING: { label: 'To verify', tone: 'neutral' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  CLARIFY: { label: 'Needs clarification', tone: 'warning' },
}

export const ACCR_SOURCES = {
  programs: { label: 'Programs', tone: 'brand' },
  students: { label: 'Students', tone: 'sky' },
  coe: { label: 'Exam results', tone: 'violet' },
  hrms: { label: 'Staff', tone: 'teal' },
  research: { label: 'Research', tone: 'orange' },
  placements: { label: 'Placements', tone: 'pink' },
  library: { label: 'Library', tone: 'info' },
  manual: { label: 'Entered', tone: 'neutral' },
}

export const ACCR_UNITS = ['count', 'pct', 'ratio', 'lakh', 'years', 'perTeacher', 'days', 'perDay']

/** NAAC's word limit for a qualitative metric's description. */
export const ACCR_NARRATIVE_WORDS = 500

const QN = (code, title, source = 'manual', extra = {}) => ({ code, title, kind: 'QN', source, unit: 'count', ...extra })
const QL = (code, title, extra = {}) => ({ code, title, kind: 'QL', source: 'manual', ...extra })

// ───────────────────────────────────────────────────────── NAAC (affiliated college, UG)

const NAAC = [
  {
    id: 'C1', code: 'I', title: 'Curricular aspects', weight: 100, metrics: [
      QL('1.1.1', 'Effective curriculum planning and delivery'),
      QN('1.1.3', 'Teachers participating in curriculum development and assessment', 'manual', { dvv: ['Letters of nomination to BoS / academic council', 'Minutes of the meetings'] }),
      QN('1.2.1', 'Programmes with CBCS / elective course system', 'programs', { auto: 'cbcsPct', unit: 'pct', dvv: ['Minutes of the academic council approving CBCS', 'Course structure of each programme'] }),
      QN('1.2.2', 'Add-on / certificate programmes offered', 'manual', { dvv: ['Brochure or notice of each programme', 'List of students enrolled'] }),
      QN('1.2.3', 'Students enrolled in add-on / certificate programmes', 'manual', { unit: 'pct', dvv: ['List of students with programme', 'Certificates issued (sample)'] }),
      QL('1.3.1', 'Cross-cutting issues: gender, environment, human values, professional ethics'),
      QN('1.3.2', 'Courses with experiential learning (project, field work, internship)', 'programs', { auto: 'projectCoursesPct', unit: 'pct', dvv: ['Syllabus marking the experiential courses'] }),
      QN('1.3.3', 'Students undertaking project work / field work / internships', 'manual', { unit: 'pct', dvv: ['List of students with project / internship', 'Completion certificates (sample)'] }),
      QN('1.4.1', 'Feedback on the syllabus from stakeholders', 'manual', { dvv: ['Feedback forms', 'Action taken report'] }),
      QN('1.4.2', 'Feedback process (collected, analysed, action taken, on website)', 'manual', { dvv: ['Feedback analysis report', 'Website link of the feedback'] }),
    ],
  },
  {
    id: 'C2', code: 'II', title: 'Teaching–learning and evaluation', weight: 350, metrics: [
      QN('2.1.1', 'Enrolment percentage (admitted against sanctioned intake)', 'programs', { auto: 'enrolmentPct', unit: 'pct', dvv: ['Sanctioned intake letter from the university / regulator', 'List of students admitted, programme-wise'] }),
      QN('2.1.2', 'Seats filled against reserved categories', 'students', { auto: 'reservedPct', unit: 'pct', dvv: ['Reservation policy letter', 'Category-wise admission list'] }),
      QL('2.2.1', 'Assessing learning levels; programmes for advanced and slow learners'),
      QN('2.2.2', 'Student – full-time teacher ratio', 'hrms', { auto: 'studentTeacherRatio', unit: 'ratio', dvv: ['List of full-time teachers with appointment letters', 'Students on roll, programme-wise'] }),
      QL('2.3.1', 'Student-centric methods: experiential, participative, problem-solving'),
      QL('2.3.2', 'Teachers using ICT-enabled tools'),
      QN('2.3.3', 'Ratio of students to mentor', 'programs', { auto: 'mentorRatio', unit: 'ratio', dvv: ['Mentor allotment list', 'Mentoring records (sample)'] }),
      QN('2.4.1', 'Full-time teachers against sanctioned posts', 'hrms', { auto: 'fullTimeTeachers', dvv: ['Sanctioned posts letter', 'List of full-time teachers'] }),
      QN('2.4.2', 'Full-time teachers with Ph.D.', 'hrms', { auto: 'teachersPhdPct', unit: 'pct', dvv: ['Ph.D. degree certificates of the teachers'] }),
      QN('2.4.3', 'Average teaching experience of full-time teachers', 'hrms', { auto: 'teachingExperience', unit: 'years', dvv: ['List of teachers with date of joining and experience'] }),
      QN('2.5.1', 'Days from the last semester-end exam to the declaration of results', 'coe', { unit: 'days', dvv: ['Exam timetable', 'Result notification with date'] }),
      QN('2.5.2', 'Student complaints / grievances about evaluation', 'coe', { auto: 'revaluationPct', unit: 'pct', dvv: ['Revaluation applications and outcomes'] }),
      QL('2.6.1', 'Programme and course outcomes stated and communicated'),
      QL('2.6.2', 'Attainment of programme and course outcomes'),
      QN('2.6.3', 'Pass percentage of final-year students', 'coe', { auto: 'passPct', unit: 'pct', dvv: ['Result sheets of the final-year students', 'Annual report of the controller of examinations'] }),
      QN('2.7.1', 'Online student satisfaction survey (SSS)', 'manual', { dvv: ['Database of all currently enrolled students'] }),
    ],
  },
  {
    id: 'C3', code: 'III', title: 'Research, innovations and extension', weight: 110, metrics: [
      QN('3.1.1', 'Grants received for research projects (₹ lakh)', 'research', { auto: 'grantsLakh', unit: 'lakh', dvv: ['Sanction letters from the funding agencies', 'Utilisation certificates', 'Audited statements of the grants'] }),
      QN('3.1.2', 'Teachers recognised as research guides', 'research', { auto: 'guidesPct', unit: 'pct', dvv: ['Recognition letters of the guides from the university'] }),
      QN('3.1.3', 'Departments with funded research projects', 'research', { auto: 'deptsWithProjectsPct', unit: 'pct', dvv: ['List of departments with project sanction letters'] }),
      QL('3.2.1', 'Ecosystem for innovations, incubation and knowledge transfer'),
      QN('3.2.2', 'Workshops / seminars on research methodology, IPR and entrepreneurship', 'manual', { dvv: ['Brochures and reports of each event', 'Geo-tagged photos'] }),
      QN('3.3.1', 'Ph.D.s registered per eligible teacher', 'research', { auto: 'phdPerGuide', unit: 'perTeacher', dvv: ['Ph.D. registration letters', 'List of scholars with guides'] }),
      QN('3.3.2', 'Research papers per teacher in UGC-CARE journals', 'research', { auto: 'papersPerTeacher', unit: 'perTeacher', dvv: ['First page of each paper with the journal’s name', 'UGC-CARE list entry of the journals'] }),
      QN('3.3.3', 'Books, chapters and conference papers per teacher', 'research', { auto: 'booksPerTeacher', unit: 'perTeacher', dvv: ['Cover page, contents and ISBN page of each book', 'First page of each conference paper'] }),
      QL('3.4.1', 'Extension activities in the neighbourhood community'),
      QN('3.4.2', 'Awards and recognition for extension activities', 'manual', { dvv: ['Award letters'] }),
      QN('3.4.3', 'Extension and outreach programmes conducted', 'manual', { dvv: ['Reports of each programme', 'Geo-tagged photos'] }),
      QN('3.4.4', 'Students participating in extension activities', 'manual', { unit: 'pct', dvv: ['Attendance of students in each activity'] }),
      QN('3.5.1', 'Collaborative activities (research, internship, exchange)', 'manual', { dvv: ['Collaboration documents', 'Activity reports'] }),
      QN('3.5.2', 'Functional MoUs with institutions and industries', 'manual', { dvv: ['Copies of the MoUs', 'Activities under each MoU'] }),
    ],
  },
  {
    id: 'C4', code: 'IV', title: 'Infrastructure and learning resources', weight: 100, metrics: [
      QL('4.1.1', 'Adequate facilities for teaching–learning'),
      QL('4.1.2', 'Facilities for cultural activities, sports and games'),
      QN('4.1.3', 'Classrooms and seminar halls with ICT facilities', 'manual', { unit: 'pct', dvv: ['List of ICT rooms with geo-tagged photos'] }),
      QN('4.1.4', 'Expenditure on infrastructure augmentation, excluding salary (₹ lakh)', 'manual', { unit: 'lakh', dvv: ['Audited income and expenditure statement'] }),
      QL('4.2.1', 'Library automated with an integrated library management system'),
      QN('4.2.2', 'E-resources subscribed / e-books in the library', 'library', { auto: 'ebooks', dvv: ['Subscription receipts of the e-resources'] }),
      QN('4.2.3', 'Expenditure on books and journals (₹ lakh)', 'library', { auto: 'libraryBooksLakh', unit: 'lakh', dvv: ['Audited statement of library purchases', 'Accession register (extract)'] }),
      QN('4.2.4', 'Library usage per day (loans)', 'library', { auto: 'libraryUsePerDay', unit: 'perDay', dvv: ['Library footfall / issue register (extract)'] }),
      QL('4.3.1', 'IT facilities and Wi-Fi, updated regularly'),
      QN('4.3.2', 'Student – computer ratio', 'manual', { unit: 'ratio', dvv: ['Stock register of computers', 'Purchase bills'] }),
      QN('4.3.3', 'Bandwidth of the internet connection (Mbps)', 'manual', { dvv: ['Bill of the internet provider'] }),
      QN('4.4.1', 'Expenditure on maintenance of infrastructure (₹ lakh)', 'manual', { unit: 'lakh', dvv: ['Audited income and expenditure statement'] }),
    ],
  },
  {
    id: 'C5', code: 'V', title: 'Student support and progression', weight: 140, metrics: [
      QN('5.1.1', 'Students benefited by government scholarships and freeships', 'manual', { unit: 'pct', dvv: ['Sanction letters of the scholarships', 'List of beneficiaries'] }),
      QN('5.1.2', 'Students benefited by institution / non-government scholarships', 'manual', { unit: 'pct', dvv: ['List of beneficiaries with amounts'] }),
      QN('5.1.3', 'Capacity building and skills enhancement initiatives', 'manual', { dvv: ['Reports of each initiative'] }),
      QN('5.1.4', 'Students benefited by guidance for competitive exams and career counselling', 'manual', { unit: 'pct', dvv: ['Attendance and reports of the sessions'] }),
      QN('5.1.5', 'Grievance redressal (sexual harassment, ragging) mechanism', 'manual', { dvv: ['Committee constitution orders', 'Minutes of meetings'] }),
      QN('5.2.1', 'Placement of outgoing students', 'placements', { auto: 'placementPct', unit: 'pct', dvv: ['Offer letters of the placed students', 'List of students placed with employer and package'] }),
      QN('5.2.2', 'Outgoing students progressing to higher education', 'manual', { unit: 'pct', dvv: ['Admission proof of each student'] }),
      QN('5.2.3', 'Students qualifying state / national exams (NET, SLET, GATE, CAT …)', 'manual', { unit: 'pct', dvv: ['Score cards / qualifying certificates'] }),
      QN('5.3.1', 'Awards / medals in sports and cultural activities', 'manual', { dvv: ['Award certificates'] }),
      QL('5.3.2', 'Active student council and student representation'),
      QN('5.3.3', 'Sports and cultural events organised', 'manual', { dvv: ['Reports of the events'] }),
      QL('5.4.1', 'Registered alumni association and its contribution'),
    ],
  },
  {
    id: 'C6', code: 'VI', title: 'Governance, leadership and management', weight: 100, metrics: [
      QL('6.1.1', 'Governance reflecting the vision and mission'),
      QL('6.2.1', 'Perspective / strategic plan deployed; functioning of institutional bodies'),
      QN('6.2.2', 'E-governance in administration, finance, admissions and examinations', 'manual', { dvv: ['ERP document and screenshots', 'Annual e-governance report'] }),
      QL('6.3.1', 'Welfare measures for teaching and non-teaching staff'),
      QN('6.3.2', 'Teachers given financial support for conferences / workshops', 'manual', { unit: 'pct', dvv: ['Policy document', 'Receipts of the support given'] }),
      QN('6.3.3', 'Professional development / administrative training programmes organised', 'manual', { dvv: ['Reports and attendance of each programme'] }),
      QN('6.3.4', 'Teachers undergoing faculty development programmes (FDP)', 'manual', { unit: 'pct', dvv: ['FDP certificates'] }),
      QL('6.4.1', 'Internal and external financial audits'),
      QN('6.4.2', 'Funds received from non-government bodies and philanthropists (₹ lakh)', 'manual', { unit: 'lakh', dvv: ['Audited statements of the grants'] }),
      QL('6.5.1', 'IQAC’s contribution to institutionalising quality assurance'),
      QN('6.5.3', 'Quality assurance initiatives (AQAR, audits, NIRF, ISO)', 'manual', { dvv: ['AQARs submitted', 'Minutes of IQAC meetings'] }),
    ],
  },
  {
    id: 'C7', code: 'VII', title: 'Institutional values and best practices', weight: 100, metrics: [
      QL('7.1.1', 'Measures for the promotion of gender equity'),
      QN('7.1.2', 'Facilities for alternate sources of energy and energy conservation', 'manual', { dvv: ['Geo-tagged photos', 'Purchase bills'] }),
      QL('7.1.3', 'Facilities for the management of degradable and non-degradable waste'),
      QN('7.1.4', 'Water conservation facilities', 'manual', { dvv: ['Geo-tagged photos'] }),
      QN('7.1.6', 'Quality audits on environment and energy', 'manual', { dvv: ['Audit reports', 'Certificates'] }),
      QN('7.1.7', 'Disabled-friendly, barrier-free environment', 'manual', { dvv: ['Geo-tagged photos', 'Bills of the facilities'] }),
      QL('7.1.8', 'Inclusive environment: tolerance and harmony'),
      QL('7.1.9', 'Sensitisation to constitutional obligations'),
      QL('7.2.1', 'Two best practices of the institution'),
      QL('7.3.1', 'Institutional distinctiveness'),
    ],
  },
]

// ───────────────────────────────────────────────────────── NIRF (college ranking)

const NIRF = [
  {
    id: 'TLR', code: 'TLR', title: 'Teaching, learning and resources', weight: 40, metrics: [
      QN('SS', 'Student strength including doctoral students', 'students', { auto: 'studentStrength' }),
      QN('FSR', 'Faculty–student ratio (students per faculty)', 'hrms', { auto: 'studentTeacherRatio', unit: 'ratio' }),
      QN('FQE', 'Faculty with Ph.D. and experience', 'hrms', { auto: 'teachersPhdPct', unit: 'pct' }),
      QN('FRU', 'Financial resources and their utilisation (₹ lakh)', 'manual', { unit: 'lakh', dvv: ['Audited capital and operational expenditure'] }),
    ],
  },
  {
    id: 'RP', code: 'RP', title: 'Research and professional practice', weight: 15, metrics: [
      QN('PU', 'Publications (last three years)', 'research', { auto: 'publications3y' }),
      QN('QP', 'Quality of publications (citations)', 'research', { auto: 'citations3y' }),
      QN('IPR', 'Patents published and granted', 'research', { auto: 'patents' }),
      QN('FPPP', 'Sponsored research and consultancy (₹ lakh)', 'research', { auto: 'grantsLakh', unit: 'lakh', dvv: ['Sanction letters', 'Audited statements'] }),
    ],
  },
  {
    id: 'GO', code: 'GO', title: 'Graduation outcomes', weight: 25, metrics: [
      QN('GPH', 'Placement and higher studies', 'placements', { auto: 'placementPct', unit: 'pct', dvv: ['Offer letters', 'Higher-studies admission proofs'] }),
      QN('GUE', 'Students graduating in the stipulated time', 'coe', { auto: 'passPct', unit: 'pct' }),
      QN('MS', 'Median salary of placed graduates (₹ lakh a year)', 'placements', { auto: 'medianSalaryLakh', unit: 'lakh' }),
      QN('GPHD', 'Ph.D. students graduated', 'research', { auto: 'phdAwarded' }),
    ],
  },
  {
    id: 'OI', code: 'OI', title: 'Outreach and inclusivity', weight: 10, metrics: [
      QN('RD', 'Students from other states and countries', 'manual', { unit: 'pct' }),
      QN('WD', 'Women students and faculty', 'students', { auto: 'womenPct', unit: 'pct' }),
      QN('ESCS', 'Economically and socially challenged students', 'manual', { unit: 'pct' }),
      QL('PCS', 'Facilities for physically challenged students'),
    ],
  },
  {
    id: 'PR', code: 'PR', title: 'Perception', weight: 10, metrics: [
      QL('PR', 'Peer and employer perception'),
    ],
  },
]

// ───────────────────────────────────────────────────────── AISHE (college DCF, basic)

const AISHE = [
  {
    id: 'A1', code: '1', title: 'Basic details and programmes', weight: null, metrics: [
      QL('1.1', 'Institution details (AISHE code, address, affiliation, type, management)'),
      QN('1.2', 'Programmes offered', 'programs', { auto: 'programmes' }),
    ],
  },
  {
    id: 'A2', code: '2', title: 'Students', weight: null, metrics: [
      QN('2.1', 'Students enrolled', 'students', { auto: 'studentStrength' }),
      QN('2.2', 'Women students enrolled', 'students', { auto: 'femaleStudents' }),
      QN('2.3', 'Ph.D. scholars', 'research', { auto: 'phdScholars' }),
      QN('2.4', 'Students passed out (final year)', 'coe', { auto: 'passedOut' }),
    ],
  },
  {
    id: 'A3', code: '3', title: 'Staff', weight: null, metrics: [
      QN('3.1', 'Teaching staff', 'hrms', { auto: 'teachers' }),
      QN('3.2', 'Non-teaching staff', 'hrms', { auto: 'nonTeaching' }),
    ],
  },
  {
    id: 'A4', code: '4', title: 'Infrastructure and finance', weight: null, metrics: [
      QL('4.1', 'Infrastructure (classrooms, labs, hostels, library)'),
      QN('4.2', 'Scholarships awarded', 'manual'),
      QN('4.3', 'Income and expenditure (₹ lakh)', 'manual', { unit: 'lakh' }),
    ],
  },
]

const CRITERIA = { NAAC, NIRF, AISHE }

/** The criteria (with their metrics) of a framework. */
export const accrCriteria = (framework) => CRITERIA[framework] ?? []

/** Every metric of a framework, each with its criterion id. */
export const accrMetrics = (framework) => accrCriteria(framework).flatMap((c) => c.metrics.map((m) => ({ ...m, criterion: c.id })))

export function accrMetric(framework, code) {
  return accrMetrics(framework).find((m) => m.code === code) ?? null
}

/** Words in a narrative (NAAC limits a qualitative answer to 500). */
export const accrWordCount = (text) => String(text ?? '').replace(/[*#>_-]+/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** How far a set of metrics is: { total, complete, draft, pct } from their saved states ({ code → { status } }). */
export function accrCompletion(metrics, states = {}) {
  let complete = 0
  let draft = 0
  for (const m of metrics) {
    const s = states[m.code]?.status
    if (s === 'COMPLETE') complete++
    else if (s === 'DRAFT') draft++
  }
  const total = metrics.length
  return { total, complete, draft, pct: total ? Math.round((complete / total) * 100) : 0 }
}

/** The dates an assessment year covers: "2025-26" → 2025-06-01 … 2026-05-31 unless the institution's own year says otherwise. */
export function accrYearRange(name) {
  const y = Number(String(name ?? '').slice(0, 4))
  if (!Number.isInteger(y) || y < 1990) return null
  return { from: `${y}-06-01`, to: `${y + 1}-05-31`, startYear: y }
}

/** A value for display: 12.5 % · 18.2 : 1 · ₹ 4.25 lakh … (unit labels are the screen's). */
export function accrRound(v, unit) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null
  const d = unit === 'count' ? 0 : 2
  return Math.round(Number(v) * 10 ** d) / 10 ** d
}

/** Last few assessment years ending with the one containing `today` ('YYYY-MM-DD'): ['2026-27', '2025-26', …]. */
export function accrRecentYears(today, n = 6) {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const start = m >= 6 ? y : y - 1
  return Array.from({ length: n }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, '0')}`)
}
