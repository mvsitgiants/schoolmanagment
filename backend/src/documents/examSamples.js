// Made-up models for the template editor's preview of the exam-controller, programme and accreditation documents
// (and the label sheets), used only while the institution has none of that record yet — a school with no college
// wing still sees what a grade card looks like. Each is exactly the model its template sees (coeDocs.js,
// programDocs.js, accreditationDocs.js, inventoryDocs.js). samples.js picks them up.
import { UGC_GRADE_SCALE } from '@schoolgiant/shared'

const scale = UGC_GRADE_SCALE.map((b) => ({
  grade: b.grade, min: b.min, max: b.max, points: b.points, label: b.label,
  range: b.min === 0 ? '< 40' : `${b.min}–${b.max % 1 > 0.9 ? Math.floor(b.max) : b.max}`,
}))
const course = (code, title, credits, grade, points, pass = true) => ({ code, title, credits, grade, points, pass, creditPoints: pass ? credits * points : 0 })
const sem1 = [
  course('BCA101', 'Programming in C', 4, 'A+', 9), course('BCA102', 'Digital Logic and Computer Organisation', 4, 'A', 8),
  course('BCA103', 'Discrete Mathematics', 4, 'B+', 7), course('AEC101', 'English Communication', 2, 'O', 10),
  course('BCA104L', 'C Programming Lab', 2, 'O', 10), course('VAC101', 'Environmental Studies', 2, 'A', 8),
]
const sem2 = [
  course('BCA201', 'Data Structures', 4, 'A', 8), course('BCA202', 'Database Management Systems', 4, 'A+', 9),
  course('BCA203', 'Probability and Statistics', 4, 'B', 6), course('BCA204L', 'Data Structures Lab', 2, 'O', 10),
  course('SEC201', 'Web Design', 2, 'A+', 9),
]
const total = (list, k) => list.reduce((n, c) => n + c[k], 0)
const student = { name: 'Aditi Kulkarni', registerNo: '24BCA0117', admissionNo: '20240117', dob: '2006-03-14', batch: '2024–2027' }
const program = { name: 'Bachelor of Computer Applications', code: 'BCA', level: 'UG', department: 'Department of Computer Science', regulation: 'R2024 (UGC CBCS)', years: 3 }

export const EXAM_SAMPLES = {
  GRADE_CARD: () => ({
    session: { name: 'Odd semester examinations', month: 'November 2025', year: '2025-26', published: true, supplementary: false, publishedAt: '2026-01-12' },
    program,
    student: { ...student, semester: 1 },
    courses: sem1.map((c) => ({ ...c, internal: null, external: null, total: null, max: 100, attempt: 1, result: c.pass ? 'P' : 'RA', revalued: false })),
    totals: { credits: total(sem1, 'credits'), creditPoints: total(sem1, 'creditPoints') },
    result: { sgpa: 8.39, cgpa: 8.39, creditsRegistered: 18, creditsEarned: 18, cumulativeCredits: 18, arrears: 0, pass: true },
    scale,
  }),
  TRANSCRIPT: () => ({
    program, student,
    semesters: [
      { semester: 1, sgpa: 8.39, credits: 18, earned: 18, creditPoints: total(sem1, 'creditPoints'), courses: sem1.map((c) => ({ ...c, attempt: 1, session: 'NOV 2025' })) },
      { semester: 2, sgpa: 8.06, credits: 16, earned: 16, creditPoints: total(sem2, 'creditPoints'), courses: sem2.map((c) => ({ ...c, attempt: 1, session: 'MAY 2026' })) },
    ],
    result: { cgpa: 8.24, pct: 82.4, multiplier: 10, earned: 34, required: 132, arrears: 0, classification: null, complete: false },
    scale,
  }),
  SCRIPT_LABEL: () => ({
    session: { name: 'Odd semester examinations', month: 'NOV 2026' }, course: { code: 'BCA301', title: 'Operating Systems' },
    labels: Array.from({ length: 12 }, (_, i) => ({ dummyNo: `D${String(260301 + i * 7)}` })), count: 12,
  }),
  ASSET_LABEL: () => ({
    labels: [
      { tag: 'AST-000101', name: 'Dell OptiPlex 3000 desktop', category: 'Computers', place: 'Computer lab 1' },
      { tag: 'AST-000102', name: 'Epson EB-X51 projector', category: 'Electronics', place: 'Room 8-A' },
      { tag: 'AST-000103', name: 'Steel almirah (4 shelves)', category: 'Furniture', place: 'Staff room' },
      { tag: 'AST-000104', name: 'Microscope (compound)', category: 'Lab equipment', place: 'Biology lab' },
    ],
    count: 4,
  }),
  ATTAINMENT_REPORT: () => {
    const co = (code, statement, internalPct, internalLevel, externalPct, externalLevel, attainment) => ({ code, statement, bloom: null, internalPct, externalPct, internalLevel, externalLevel, attainment })
    return {
      program: { name: 'Bachelor of Computer Applications', code: 'BCA' }, session: 'Odd semester examinations, November 2025',
      rules: { targetPct: 60, internalWeight: 30, levels: [{ level: 3, min: 70 }, { level: 2, min: 60 }, { level: 1, min: 50 }] },
      outcomes: [
        { code: 'PO1', kind: 'PO', title: 'Apply knowledge of computing and mathematics to solve problems' },
        { code: 'PO2', kind: 'PO', title: 'Analyse problems and design computing solutions' },
        { code: 'PO3', kind: 'PO', title: 'Use modern tools and programming languages' },
        { code: 'PSO1', kind: 'PSO', title: 'Build and maintain software applications' },
      ],
      courses: [
        { code: 'BCA101', title: 'Programming in C', semester: 1, average: 2.4, cos: [co('CO1', 'Write simple C programs using control structures', 78, 3, 66, 2, 2.3), co('CO2', 'Use arrays, functions and pointers', 71, 3, 72, 3, 3), co('CO3', 'Handle files and structures', 58, 1, 61, 2, 1.9)], pos: [2.4, 2.2, 2.6, 2.5] },
        { code: 'BCA103', title: 'Discrete Mathematics', semester: 1, average: 2.1, cos: [co('CO1', 'Use sets, relations and functions', 66, 2, 63, 2, 2), co('CO2', 'Solve problems with graphs and trees', 69, 2, 70, 3, 2.7), co('CO3', 'Apply counting and recurrence relations', 52, 1, 58, 1, 1)], pos: [2.1, 1.9, null, 1.8] },
      ],
      po: [{ code: 'PO1', value: 2.25 }, { code: 'PO2', value: 2.05 }, { code: 'PO3', value: 2.6 }, { code: 'PSO1', value: 2.15 }],
      summary: { courses: 2, cos: 6, cosAttained: 4, poAverage: 2.26 },
    }
  },
  ACCREDITATION_SSR: () => {
    const m = (code, title, value, status, extra = {}) => ({ code, title, kind: 'QN', qualitative: false, value, computed: false, source: null, status, statusLabel: { COMPLETE: 'Complete', DRAFT: 'Draft', NOT_STARTED: 'Not started' }[status], complete: status === 'COMPLETE', note: null, narrative: null, words: null, evidence: 0, ...extra })
    return {
      framework: { code: 'NAAC', name: 'NAAC self-study report (SSR)' }, year: '2025-26', range: { from: '2021-04-01', to: '2026-03-31' },
      summary: { total: 6, complete: 4, draft: 1, pct: 67, computed: 2, narratives: 1, evidence: 3 },
      criteria: [
        { code: 'I', title: 'Curricular aspects', weight: 100, completion: { pct: 67, complete: 2, total: 3 }, metrics: [
          m('1.1.1', 'Curricula developed and implemented have relevance to local, national and global needs', null, 'COMPLETE', { kind: 'QL', qualitative: true, words: 92, narrative: 'The college follows the curriculum of the affiliating university. Every programme maps its course outcomes to the programme outcomes, and the department reviews them each year with employers and alumni.' }),
          m('1.2.1', 'Number of add-on / certificate programmes offered', '12', 'COMPLETE'),
          m('1.3.2', 'Percentage of students doing project work / internships', '64.5 %', 'DRAFT', { computed: true, source: 'Programs' }),
        ] },
        { code: 'II', title: 'Teaching-learning and evaluation', weight: 350, completion: { pct: 67, complete: 2, total: 3 }, metrics: [
          m('2.1.1', 'Enrolment percentage', '91.2 %', 'COMPLETE', { computed: true, source: 'Students' }),
          m('2.2.2', 'Student – full-time teacher ratio', '18 : 1', 'COMPLETE'),
          m('2.6.3', 'Pass percentage of students', null, 'NOT_STARTED'),
        ] },
      ],
    }
  },
}
