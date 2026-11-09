import { addDaysYmd, weekdayCode } from '@schoolgiant/shared'
import { Student, studentName } from '../models/students.js'
import { Timetable } from '../models/timetable.js'
import { can, moduleEnabled } from '../platform/access.js'
import { escapeRegex, z } from '../platform/validate.js'
import { institutionNow } from '../platform/time.js'
import { lookup, yearOrCurrent } from './academics.js'

// The assistant's tools: each answers from the institution's own data through the existing services, with the
// caller's permissions and data scope. A tool the caller's role can't use answers { error: 'not_allowed' }.
// Results carry aggregates and names only — never phone numbers, addresses, ID numbers or guardians' details.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const text = (max = 80) => z.string().trim().max(max)
const rupees = (paise) => Math.round(Number(paise || 0)) / 100
const notAllowed = (what) => ({ error: 'not_allowed', message: `The user's role does not allow ${what}.` })
const moduleOff = (name) => ({ error: 'module_off', message: `${name} is not switched on for this institution.` })
const today = async () => (await institutionNow()).date

/** "8A", "class 8 - a", "VIII A" → "8a"-ish keys for matching class and section names. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\b(class|grade|std|standard|section|sec)\b\.?/g, '').replace(/[^a-z0-9]/g, '')

async function findSection(name, auth) {
  const look = await lookup(auth)
  const key = norm(name)
  const hit = look.sections.find((s) => norm(s.short) === key || norm(s.label) === key)
  return { section: hit ?? null, options: look.sections.map((s) => s.short) }
}

async function findClass(name, auth) {
  const look = await lookup(auth)
  const key = norm(name)
  const cls = look.classes.find((c) => norm(c.code) === key || norm(c.name) === key)
  return { cls: cls ?? null, options: look.classes.map((c) => c.name) }
}

const TOOLS = {
  attendance_summary: {
    description: 'Student attendance for a date range: per class section (percentage present, days taken, students under the minimum), or for one section the students under the minimum. Dates are YYYY-MM-DD; default is this month so far.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        section: { type: 'string', description: 'A class section such as "8-A" or "Class 8 A". Leave out for every section the user may see.' },
        from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        to: { type: 'string', description: 'End date, YYYY-MM-DD.' },
      },
    },
    schema: z.object({ section: text().optional(), from: ymd.optional(), to: ymd.optional() }),
    async run({ section, from, to }, auth) {
      if (!moduleEnabled(auth, 'attendance')) return moduleOff('Attendance')
      if (!can(auth, 'attendance.reports.view') && !can(auth, 'attendance.register.view')) return notAllowed('attendance reports')
      const t = await today()
      const range = { from: from ?? `${t.slice(0, 7)}-01`, to: to ?? t }
      if (range.from > range.to) return { error: 'bad_dates', message: 'The start date is after the end date.' }
      const { attendanceReport } = await import('./attendance.js')
      if (section) {
        const { section: sec, options } = await findSection(section, auth)
        if (!sec) return { error: 'not_found', message: `No class section matches "${section}" for this user.`, sections: options.slice(0, 60) }
        const rep = await attendanceReport({ ...range, sectionId: sec.id }, auth)
        const withPct = rep.students.filter((s) => s.pct !== null && s.pct !== undefined)
        return {
          ...range, section: sec.label, daysTaken: rep.daysTaken, minimumPct: rep.minimumPct, students: rep.students.length,
          averagePct: withPct.length ? Math.round((withPct.reduce((n, s) => n + s.pct, 0) / withPct.length) * 10) / 10 : null,
          underMinimum: rep.students.filter((s) => s.below).sort((a, b) => a.pct - b.pct).slice(0, 25).map((s) => ({ name: s.name, pct: s.pct })),
        }
      }
      const rep = await attendanceReport(range, auth)
      const all = rep.sections.reduce((m, s) => ({ P: m.P + (s.counts?.P ?? 0), total: m.total + (s.counts?.total ?? 0) }), { P: 0, total: 0 })
      return {
        ...range, minimumPct: rep.minimumPct,
        sections: rep.sections.filter((s) => s.daysTaken).map((s) => ({ section: s.short, pct: s.pct, daysTaken: s.daysTaken, studentsUnderMinimum: s.below })),
        sectionsWithNoAttendanceTaken: rep.sections.filter((s) => !s.daysTaken).map((s) => s.short),
        presentMarks: all.P, totalMarks: all.total,
      }
    },
  },

  fee_dues: {
    description: 'Unpaid fees: how many students owe, the total due and overdue (in rupees), by class, and the largest dues (student name, class, amounts). Optionally for one class.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { class: { type: 'string', description: 'A class such as "Class 8", "8" or a section such as "8-A". Leave out for the whole institution.' } },
    },
    schema: z.object({ class: text().optional() }),
    async run(input, auth) {
      if (!moduleEnabled(auth, 'fees')) return moduleOff('Fees')
      if (!can(auth, 'fees.dues.view')) return notAllowed('fee dues')
      const { allDues } = await import('./fees.js')
      let rows = await allDues({}, auth)
      let scope = 'the whole institution'
      if (input.class) {
        const { cls, options } = await findClass(input.class, auth)
        if (cls) {
          rows = rows.filter((r) => r.classId === String(cls.id))
          scope = cls.name
        } else {
          const { section } = await findSection(input.class, auth)
          if (!section) return { error: 'not_found', message: `No class matches "${input.class}".`, classes: options.slice(0, 40) }
          rows = rows.filter((r) => r.classShort === section.short)
          scope = section.label
        }
      }
      const byClass = new Map()
      for (const r of rows) {
        const k = r.classShort?.split('-')[0] ?? '—'
        const c = byClass.get(k) ?? { class: k, students: 0, dueRupees: 0, overdueRupees: 0 }
        c.students++; c.dueRupees += rupees(r.due); c.overdueRupees += rupees(r.overdue)
        byClass.set(k, c)
      }
      return {
        scope, studentsWithDues: rows.length,
        totalDueRupees: rupees(rows.reduce((n, r) => n + r.due, 0)), overdueRupees: rupees(rows.reduce((n, r) => n + r.overdue, 0)),
        byClass: [...byClass.values()].map((c) => ({ ...c, dueRupees: Math.round(c.dueRupees * 100) / 100, overdueRupees: Math.round(c.overdueRupees * 100) / 100 })),
        largestDues: rows.slice(0, 10).map((r) => ({ name: r.name, class: r.classShort, dueRupees: rupees(r.due), overdueRupees: rupees(r.overdue), oldestDueDate: r.oldestDue })),
      }
    },
  },

  exam_results: {
    description: 'Exam results: for an exam (by name; default the latest with results) the pass / fail counts and averages per section, or for one section the summary, the top students, students who failed, and subject averages.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        exam: { type: 'string', description: 'Exam name or part of it, e.g. "half yearly". Leave out for the latest exam.' },
        section: { type: 'string', description: 'A class section such as "8-A". Leave out for every section.' },
      },
    },
    schema: z.object({ exam: text().optional(), section: text().optional() }),
    async run({ exam: examName, section }, auth) {
      if (!moduleEnabled(auth, 'exams')) return moduleOff('Exams')
      if (!can(auth, 'exams.results.view')) return notAllowed('exam results')
      const { getExam, listExams, listResults } = await import('./exams.js')
      const { exams } = await listExams({}, auth)
      const ready = exams.filter((e) => e.status !== 'DRAFT')
      const exam = examName ? ready.find((e) => norm(e.name).includes(norm(examName))) : (ready.filter((e) => e.status === 'PUBLISHED').at(-1) ?? ready.at(-1))
      if (!exam) return { error: 'not_found', message: examName ? `No scheduled exam matches "${examName}".` : 'No exam has results yet.', exams: ready.map((e) => e.name) }
      const sections = (await getExam(exam.id, auth)).sections
      if (section) {
        const { section: sec } = await findSection(section, auth)
        const inExam = sec && sections.find((s) => s.id === sec.id)
        if (!inExam) return { error: 'not_found', message: `"${section}" is not a section of ${exam.name} this user can see.`, sections: sections.map((s) => s.short) }
        const r = await listResults(exam.id, inExam.id, auth)
        const done = r.rows.filter((x) => x.result !== 'INCOMPLETE')
        const subjects = r.papers.filter((p) => !p.gradeOnly).map((p) => {
          const marks = r.rows.map((x) => x.marks[p.id]).filter((m) => m && m.marks !== null && m.marks !== undefined)
          return { subject: p.subject, averagePct: marks.length && p.maxMarks ? Math.round((marks.reduce((n, m) => n + m.marks, 0) / marks.length / p.maxMarks) * 1000) / 10 : null }
        })
        return {
          exam: exam.name, status: exam.status, section: inExam.label, ...r.summary,
          top: [...done].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 5).map((x) => ({ name: x.name, pct: x.pct, grade: x.grade, rank: x.rank })),
          failed: done.filter((x) => x.result === 'FAIL').slice(0, 30).map((x) => ({ name: x.name, pct: x.pct })),
          subjects,
        }
      }
      const out = []
      for (const s of sections.slice(0, 40)) {
        try {
          const r = await listResults(exam.id, s.id, auth)
          out.push({ section: s.short, students: r.summary.students, passed: r.summary.passed, failed: r.summary.failed, incomplete: r.summary.incomplete, averagePct: r.summary.average, highestPct: r.summary.highest })
        } catch { /* a section without papers */ }
      }
      return { exam: exam.name, status: exam.status, sections: out }
    },
  },

  student_lookup: {
    description: 'Find students by name: returns id, full name, class section and roll number only (no contact details).',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['name'],
      properties: { name: { type: 'string', description: 'The name or part of it.' } },
    },
    schema: z.object({ name: text(60).min(2) }),
    async run({ name }, auth) {
      if (!moduleEnabled(auth, 'students')) return moduleOff('Students')
      if (!can(auth, 'students.directory.view')) return notAllowed('the student directory')
      const { scopeFilter } = await import('./students.js')
      const words = name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => new RegExp(`^${escapeRegex(w)}`, 'i'))
      const f = { status: 'ACTIVE', ...(await scopeFilter(auth)), $and: words.map((re) => ({ $or: [{ firstName: re }, { middleName: re }, { lastName: re }] })) }
      const rows = await Student.find(f).select('firstName middleName lastName rollNo sectionId').limit(10).lean()
      const look = await lookup(auth)
      const place = new Map(look.sections.map((s) => [s.id, s.short]))
      return { matches: rows.map((s) => ({ id: String(s._id), name: studentName(s), class: place.get(String(s.sectionId)) ?? null, rollNo: s.rollNo ?? null })), more: rows.length === 10 }
    },
  },

  staff_on_leave: {
    description: 'Staff on approved leave on a date (default today): names, leave type and whether full or half day.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { date: { type: 'string', description: 'YYYY-MM-DD; default today.' } },
    },
    schema: z.object({ date: ymd.optional() }),
    async run({ date }, auth) {
      if (!moduleEnabled(auth, 'hrms')) return moduleOff('Staff & HR')
      if (!can(auth, 'hrms.leave.view')) return notAllowed('staff leave')
      const { onLeaveOn } = await import('./hrmsLeave.js')
      const d = date ?? await today()
      const rows = await onLeaveOn(d)
      return { date: d, onLeave: rows.map((r) => ({ name: r.name, leaveType: r.leaveCode, portion: r.portion === 1 ? 'full day' : 'half day' })) }
    },
  },

  upcoming_events: {
    description: 'The school calendar between two dates (default the next 30 days): events, holidays, exams and parent–teacher meetings.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { from: { type: 'string', description: 'YYYY-MM-DD; default today.' }, to: { type: 'string', description: 'YYYY-MM-DD; default 30 days on.' } },
    },
    schema: z.object({ from: ymd.optional(), to: ymd.optional() }),
    async run({ from, to }, auth) {
      if (!moduleEnabled(auth, 'events')) return moduleOff('Events & calendar')
      if (!can(auth, 'events.calendar.view')) return notAllowed('the calendar')
      const { calendar } = await import('./events.js')
      const f = from ?? await today()
      const t = to ?? addDaysYmd(f, 30)
      if (f > t) return { error: 'bad_dates', message: 'The start date is after the end date.' }
      const { items } = await calendar({ from: f, to: t, includeDrafts: false }, auth)
      return { from: f, to: t, items: items.slice(0, 60).map((i) => ({ title: i.title, kind: i.kind, startDate: i.startDate, endDate: i.endDate, startTime: i.startTime ?? undefined, venue: i.venue ?? undefined })) }
    },
  },

  timetable_today: {
    description: 'A teacher\'s periods on a day from the published timetable (default: the user, today): period, time, subject, class section, room.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        teacher: { type: 'string', description: 'Teacher name; leave out for the user themselves.' },
        date: { type: 'string', description: 'YYYY-MM-DD; default today.' },
      },
    },
    schema: z.object({ teacher: text(60).optional(), date: ymd.optional() }),
    async run({ teacher, date }, auth) {
      if (!moduleEnabled(auth, 'timetable')) return moduleOff('Timetable')
      if (!can(auth, 'timetable.timetable.view')) return notAllowed('the timetable')
      const { grid, teachers } = await import('./timetable.js')
      const year = await yearOrCurrent()
      const pub = await Timetable.findOne({ academicYearId: year._id, status: 'PUBLISHED' }).select('_id').lean()
      if (!pub) return { error: 'no_timetable', message: 'No timetable is published yet.' }
      let who = { id: auth.userId, name: auth.user?.name ?? 'the user' }
      if (teacher) {
        const list = await teachers()
        const words = norm(teacher)
        const hit = list.find((x) => norm(x.name) === words) ?? list.find((x) => norm(x.name).includes(words))
        if (!hit) return { error: 'not_found', message: `No teacher matches "${teacher}".` }
        who = hit
      }
      const d = date ?? await today()
      let g
      try {
        g = await grid(String(pub._id), { view: 'teacher', of: String(who.id) }, auth)
      } catch {
        return notAllowed(`seeing ${who.name}'s timetable`)
      }
      const day = weekdayCode(d)
      const cells = g.cells[day] ?? {}
      const periods = g.slots.filter((s) => s.kind === 'PERIOD' && cells[s.no]).map((s) => ({ period: s.no, start: s.start, end: s.end, subject: cells[s.no].subject, section: cells[s.no].section, room: cells[s.no].room || undefined }))
      return { teacher: who.name, date: d, day, workingDay: g.days.includes(day), periods }
    },
  },
}

/** Tool definitions for the API (a fixed order, so the prompt prefix stays cacheable). */
export const toolDefinitions = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true }))

/** Run one tool call: validate the input (streamed tool input isn't checked by the API), then the tool. */
export async function runTool(name, input, auth) {
  const tool = TOOLS[name]
  if (!tool) return { isError: true, result: { error: 'unknown_tool' } }
  const parsed = tool.schema.safeParse(input ?? {})
  if (!parsed.success) return { isError: true, result: { error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, args: {} }
  try {
    const result = await tool.run(parsed.data, auth)
    return { isError: false, result, args: parsed.data, denied: result?.error === 'not_allowed' || result?.error === 'module_off' }
  } catch (err) {
    return { isError: true, result: { error: 'failed', message: err?.status && err.status < 500 ? err.message : 'The lookup failed.' }, args: parsed.data }
  }
}
