// Exam seating documents (Exams › Seating & invigilation): the room-wise seating charts and the notice for one
// session (`?id=` the plan), and the invigilation duty chart of an exam (`?id=` the exam). Data from
// services/examSeating.js.
import { doorListPrint, dutyChartPrint, latestPlanExamId, latestPlanId, seatingChartModel, seatingChartPrint } from '../services/examSeating.js'

export const EXAM_SEATING_DOCS = {
  EXAM_SEATING_CHART: {
    perms: ['exams.seating.view', 'exams.seating.print'],
    load: (id, auth) => seatingChartPrint(id, auth),
    model: seatingChartModel,
    title: (m) => `Seating · ${m.exam.name} · ${m.session.date} ${m.session.startTime}`,
    sample: () => latestPlanId(),
    variables: ['institution.name …', 'exam.name · session {date, startTime, endTime} · status (DRAFT / PUBLISHED)', 'classes[] {name, code, subject, students, n}',
      'rooms[] {name, code, students, invigilators[], columns, perBench, runs[] {section, from, to, count}, rows[] {benches[] {seats[] {label, name, rollNo, section, tone, empty}}}}'],
  },
  EXAM_DOOR_LIST: {
    perms: ['exams.seating.view', 'exams.seating.print'],
    load: (id, auth) => doorListPrint(id, auth),
    model: seatingChartModel,
    title: (m) => `Exam seating notice · ${m.session.date} ${m.session.startTime}`,
    sample: () => latestPlanId(),
    variables: ['institution.name …', 'exam.name · session {date, startTime, endTime} · status', 'rooms[] {name, code, students, invigilators[], runs[] {section, from, to, count}}'],
  },
  INVIGILATION_DUTY: {
    perms: ['exams.seating.view', 'exams.seating.print'],
    load: (id) => dutyChartPrint(id),
    model: (raw) => raw,
    title: (m) => `Invigilation duties · ${m.exam.name}`,
    sample: () => latestPlanExamId(),
    variables: ['institution.name …', 'exam.name', 'sessions[] {date, startTime, endTime, status, rooms[] {room, students, invigilators}}', 'teachers[] {name, designation, duties}'],
  },
}
