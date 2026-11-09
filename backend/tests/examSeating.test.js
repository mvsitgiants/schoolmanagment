import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assignInvigilators, planExamSeats, seatingRuns, suggestExamRooms } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// Exam seating & invigilation: the seating rules (shared) and the API end to end — two classes writing in the same
// session are mixed across rooms, seats can be moved by hand and stay put, invigilators avoid their own subject.

const group = (key, n) => ({ key, students: Array.from({ length: n }, (_, i) => ({ id: `${key}-${i + 1}` })) })

describe('seating rules', () => {
  it('mixes classes seat by seat: no neighbour beside or behind from the same class', () => {
    const rooms = [{ id: 'R1', capacity: 30 }, { id: 'R2', capacity: 30 }]
    const r = planExamSeats({ rooms, groups: [group('A', 20), group('B', 18), group('C', 15)], rules: { mix: 'SEAT' } })
    expect(r.seats).toHaveLength(53)
    expect(r.unseated).toHaveLength(0)
    expect(r.clashes).toHaveLength(0)
  })

  it('one class per column keeps side neighbours apart', () => {
    const r = planExamSeats({ rooms: [{ id: 'R1', capacity: 40 }], groups: [group('A', 20), group('B', 20)], rules: { mix: 'COLUMN' } })
    expect(r.clashes).toHaveLength(0)
    const first = r.seats.filter((s) => s.row === 0).map((s) => s.group)
    expect(new Set(first.slice(0, 2)).size).toBe(2)
  })

  it('leaves students without a seat when the rooms are full, and keeps locked seats', () => {
    const r = planExamSeats({ rooms: [{ id: 'R1', capacity: 10 }], groups: [group('A', 8), group('B', 8)], locked: [{ roomId: 'R1', seat: '1', studentId: 'B-8' }] })
    expect(r.seats).toHaveLength(10)
    expect(r.seats.find((s) => s.seat === '1').studentId).toBe('B-8')
    expect(r.unseated).toHaveLength(6)
  })

  it('suggests the fewest rooms that fit, and never a ground', () => {
    const rooms = [{ id: 'G', kind: 'GROUND', capacity: 500 }, { id: 'A', kind: 'CLASSROOM', capacity: 40 }, { id: 'B', kind: 'CLASSROOM', capacity: 40 }, { id: 'S', kind: 'CLASSROOM', capacity: 12 }]
    const s = suggestExamRooms(rooms, 45)
    expect(s.ids).toEqual(['A', 'S'])
    expect(s.short).toBe(0)
  })

  it('invigilators: never their own subject, never on leave, fewest duties first, no one twice', () => {
    const r = assignInvigilators({
      rooms: [{ id: 'R1', students: 45, avoid: ['t1'] }, { id: 'R2', students: 10 }],
      teachers: [{ id: 't1' }, { id: 't2', duties: 3 }, { id: 't3' }, { id: 't4' }], away: ['t4'],
    })
    expect(r.rooms.R1).toHaveLength(2)
    expect(r.rooms.R1).not.toContain('t1')
    expect([...r.rooms.R1, ...r.rooms.R2]).not.toContain('t4')
    expect(new Set([...r.rooms.R1, ...r.rooms.R2]).size).toBe(3)
  })

  it('the notice lists each section’s roll numbers per room', () => {
    const students = new Map([['a', { section: '8-A', rollNo: '3' }], ['b', { section: '8-A', rollNo: '1' }], ['c', { section: '9-B', rollNo: '7' }]])
    const runs = seatingRuns([{ roomId: 'R1', studentId: 'a' }, { roomId: 'R1', studentId: 'b' }, { roomId: 'R1', studentId: 'c' }], students)
    expect(runs[0].runs).toEqual([{ section: '8-A', from: 1, to: 3, count: 2 }, { section: '9-B', from: 7, to: 7, count: 1 }])
  })
})

describe('seating an exam session', () => {
  let app
  let admin
  let exam
  let session
  let plan
  beforeAll(async () => {
    app = await startDb()
    const h = await newInstitution('GROWTH') // rooms belong to the Timetable module (not on Starter)
    admin = await signIn(app, h.email, h.password)
    await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: true }).expect(201)
    const data = (await admin.get('/api/v1/academics/classes')).body.data
    const c11 = data.classes.find((c) => c.code === '11')
    const c12 = data.classes.find((c) => c.code === '12')
    let mobile = 9845100000
    for (const [cls, n] of [[c11, 12], [c12, 10]]) {
      for (let i = 1; i <= n; i++) await admin.post('/api/v1/students').send({ firstName: `S${cls.code}x${i}`, rollNo: String(i), sectionId: cls.sections[0].id, guardians: [{ name: 'Parent', mobile: String(mobile++) }] }).expect(201)
    }
    await admin.post('/api/v1/timetable/rooms').send({ name: 'Room 1', code: 'R1', kind: 'CLASSROOM', capacity: 14 }).expect(201)
    await admin.post('/api/v1/timetable/rooms').send({ name: 'Room 2', code: 'R2', kind: 'CLASSROOM', capacity: 14 }).expect(201)
    const types = (await admin.get('/api/v1/exams/types')).body.data
    exam = (await admin.post('/api/v1/exams').send({ name: 'Unit test', examTypeId: types[0].id, classIds: [c11.id, c12.id] })).body.data
    for (const cls of [c11, c12]) {
      const sug = (await admin.get(`/api/v1/exams/${exam.id}/classes/${cls.id}/suggest`)).body.data
      const eng = sug.find((s) => s.subject === 'English')
      await admin.put(`/api/v1/exams/${exam.id}/classes/${cls.id}/papers`).send({ papers: [{ subjectId: eng.subjectId, date: data.year.startDate, startTime: '09:00', endTime: '10:00', maxMarks: 50, passMarks: 17 }] }).expect(200)
    }
  })
  afterAll(stopDb)

  it('lists the session with both classes', async () => {
    const list = (await admin.get(`/api/v1/exams/seating/exams/${exam.id}`)).body.data
    expect(list.sessions).toHaveLength(1)
    session = list.sessions[0]
    expect(session.students).toBe(22)
    expect(session.plan).toBeNull()
  })

  it('seats everyone in the suggested rooms with no same-class neighbours', async () => {
    const res = await admin.post(`/api/v1/exams/seating/exams/${exam.id}/generate`).send({ date: session.date, startTime: session.startTime })
    expect(res.status).toBe(200)
    plan = res.body.data.plan
    expect(plan.seats).toHaveLength(22)
    expect(plan.unseated).toHaveLength(0)
    expect(plan.clashes).toHaveLength(0)
    expect(plan.rooms).toHaveLength(2)
  })

  it('moves a student by hand (swap) and keeps them there when made again', async () => {
    const [a, b] = plan.seats
    const moved = (await admin.post(`/api/v1/exams/seating/plans/${plan.id}/moves`).send({ moves: [{ studentId: a.studentId, roomId: b.roomId, seat: b.seat }] })).body.data.plan
    expect(moved.seats.find((s) => s.studentId === a.studentId).seat).toBe(b.seat)
    expect(moved.seats.find((s) => s.studentId === b.studentId).seat).toBe(a.seat)
    const again = (await admin.post(`/api/v1/exams/seating/exams/${exam.id}/generate`).send({ date: session.date, startTime: session.startTime })).body.data.plan
    expect(again.seats.find((s) => s.studentId === a.studentId)).toMatchObject({ seat: b.seat, locked: true })
  })

  it('takes exam-hall attendance; marks entry starts the absent ones as absent', async () => {
    const view = (await admin.get(`/api/v1/exams/seating/exams/${exam.id}/session?date=${session.date}&startTime=${session.startTime}`)).body.data
    const seat = view.plan.seats[0]
    const res = await admin.put(`/api/v1/exams/seating/plans/${plan.id}/attendance`).send({ roomId: seat.roomId, absent: [seat.studentId] })
    expect(res.status).toBe(200)
    expect(res.body.data.plan.absentIds).toEqual([seat.studentId])
    const ex = (await admin.get(`/api/v1/exams/${exam.id}`)).body.data
    const sec = ex.sections.find((x) => x.id === seat.sectionId)
    const paper = ex.classes.find((c) => c.id === sec.classId).papers[0]
    const sheet = (await admin.get(`/api/v1/exams/marks/${paper.id}/${sec.id}`)).body.data
    expect(sheet.students.find((x) => x.id === seat.studentId)).toMatchObject({ absent: true, hallAbsent: true })
    // a student seated in another room can't be marked from this one
    const other = view.plan.seats.find((x) => x.roomId !== seat.roomId)
    if (other) expect((await admin.put(`/api/v1/exams/seating/plans/${plan.id}/attendance`).send({ roomId: seat.roomId, absent: [other.studentId] })).status).toBe(400)
  })

  it('publishes, then refuses changes until taken back to draft; prints the chart and the notice', async () => {
    expect((await admin.post(`/api/v1/exams/seating/plans/${plan.id}/publish`)).body.data.plan.status).toBe('PUBLISHED')
    expect((await admin.post(`/api/v1/exams/seating/exams/${exam.id}/generate`).send({ date: session.date, startTime: session.startTime })).status).toBe(409)
    const chart = await admin.get(`/api/v1/documents/EXAM_SEATING_CHART/${plan.id}`).query({ print: '0' })
    expect(chart.status).toBe(200)
    expect(chart.text).toMatch(/R1/)
    expect((await admin.get(`/api/v1/documents/EXAM_DOOR_LIST/${plan.id}`).query({ print: '0' })).status).toBe(200)
    expect((await admin.get(`/api/v1/documents/INVIGILATION_DUTY/${exam.id}`).query({ print: '0' })).status).toBe(200)
    // the published seat shows on the hall ticket
    await admin.post(`/api/v1/exams/${exam.id}/schedule`).expect(200)
    const seat = (await admin.get(`/api/v1/exams/seating/exams/${exam.id}/session?date=${session.date}&startTime=${session.startTime}`)).body.data.plan.seats[0]
    const cands = (await admin.get(`/api/v1/exams/${exam.id}/candidates?sectionId=${seat.sectionId}`)).body.data
    const ticket = await admin.get(`/api/v1/documents/HALL_TICKET/${cands.find((c) => c.studentId === seat.studentId)?.id ?? cands[0].id}`).query({ print: '0' })
    expect(ticket.status).toBe(200)
    expect(ticket.text).toMatch(/Room · Seat/)
    expect((await admin.post(`/api/v1/exams/seating/plans/${plan.id}/unpublish`)).body.data.plan.status).toBe('DRAFT')
  })
})
