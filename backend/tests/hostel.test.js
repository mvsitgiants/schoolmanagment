import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bedLabels, lateMinutes, occupancyPct, weekDayOf } from '@schoolgiant/shared'
import { Outpass } from '../src/models/hostel.js'
import { runAsTenant } from '../src/platform/context.js'
import { familyCancelOutpass, familyHostel, familyRequestOutpass } from '../src/services/hostel.js'
import { Student } from '../src/models/students.js'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

let app
let h
let admin
let section
let asha
let ravi
const api = '/api/v1/hostel'
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const todayIso = new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  app = await startDb()
  h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'PRIMARY', sectionsPerClass: 1 }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes[0].sections[0]
  const add = async (firstName, gender, mobile) => (await admin.post('/api/v1/students').send({ firstName, gender, sectionId: section.id, guardians: [{ name: `Parent ${firstName}`, relation: 'MOTHER', mobile, isPrimary: true }] })).body.data
  asha = await add('Asha', 'FEMALE', '9845000701')
  ravi = await add('Ravi', 'MALE', '9845000702')
})
afterAll(stopDb)

describe('helpers', () => {
  it('labels beds, counts occupancy, lateness and week days', () => {
    expect(bedLabels(3)).toEqual(['A', 'B', 'C'])
    expect(bedLabels(28).slice(-2)).toEqual(['AA', 'AB'])
    expect(occupancyPct({ occupied: 3, total: 5, blocked: 1 })).toBe(75)
    expect(lateMinutes('2026-11-09T10:00:00Z', '2026-11-09T10:20:00Z', 30)).toBe(0)
    expect(lateMinutes('2026-11-09T10:00:00Z', '2026-11-09T10:45:00Z', 30)).toBe(45)
    expect(weekDayOf('2026-11-09')).toBe('MON')
  })
})

describe('blocks, rooms and the bed board', () => {
  let block
  let room
  it('adds a block and rooms, and draws the board', async () => {
    block = (await admin.post(`${api}/blocks`).send({ name: 'Ganga (boys)', code: 'G', kind: 'BOYS', floors: 2, warden: { name: 'Mr Rao', mobile: '9845000799' } }).expect(201)).body.data
    await admin.post(`${api}/blocks`).send({ name: 'Ganga (boys)' }).expect(400)
    room = (await admin.post(`${api}/rooms`).send({ blockId: block.id, floor: 1, number: '101', type: 'DOUBLE', capacity: 2, ac: true }).expect(201)).body.data
    expect(room.beds.map((b) => b.label)).toEqual(['A', 'B'])
    const bulk = (await admin.post(`${api}/rooms/bulk`).send({ blockId: block.id, floor: 1, from: 101, to: 104, type: 'TRIPLE', capacity: 3 }).expect(201)).body.data
    expect(bulk).toEqual({ created: 3, skipped: 1 })
    const b = (await admin.get(`${api}/board`).expect(200)).body.data
    expect(b.counts.total).toBe(2 + 9)
    expect(b.blocks[0].rooms.map((r) => r.number)).toEqual(['101', '102', '103', '104'])
    expect(b.blocks[0].rooms[0].beds[0].code).toBe('G-101-A')
  })

  it('blocks and frees a bed, and grows a room', async () => {
    const bed = room.beds[1]
    await admin.post(`${api}/rooms/${room.id}/beds/${bed.id}/state`).send({ state: 'BLOCKED' }).expect(400) // needs a reason
    await admin.post(`${api}/rooms/${room.id}/beds/${bed.id}/state`).send({ state: 'BLOCKED', note: 'Broken frame' }).expect(200)
    let b = (await admin.get(`${api}/board`)).body.data
    expect(b.counts.BLOCKED).toBe(1)
    await admin.post(`${api}/rooms/${room.id}/beds/${bed.id}/state`).send({ state: 'FREE' }).expect(200)
    const grown = (await admin.patch(`${api}/rooms/${room.id}`).send({ number: '101', floor: 1, type: 'TRIPLE', capacity: 3 }).expect(200)).body.data
    expect(grown.beds.map((x) => x.label)).toEqual(['A', 'B', 'C'])
    expect(grown.beds[0].id).toBe(room.beds[0].id)
    room = grown
    b = (await admin.get(`${api}/board`)).body.data
    expect(b.counts.FREE).toBe(12)
  })

  describe('allotment', () => {
    let allotment
    it('allots one bed per student and per bed, and warns on the wrong block', async () => {
      const res = (await admin.post(`${api}/allotments`).send({ studentId: ravi.id, bedId: room.beds[0].id }).expect(201)).body.data
      expect(res.warning).toBeNull()
      allotment = res
      await admin.post(`${api}/allotments`).send({ studentId: ravi.id, bedId: room.beds[1].id }).expect(409) // already has a bed
      await admin.post(`${api}/allotments`).send({ studentId: asha.id, bedId: room.beds[0].id }).expect(400) // bed taken
      const girl = (await admin.post(`${api}/allotments`).send({ studentId: asha.id, bedId: room.beds[1].id }).expect(201)).body.data
      expect(girl.warning).toMatch(/boys/)
      const b = (await admin.get(`${api}/board`)).body.data
      expect(b.counts.OCCUPIED).toBe(2)
      const bed = b.blocks[0].rooms[0].beds[0]
      expect(bed.state).toBe('OCCUPIED')
      expect(bed.allotment.student.name).toBe('Ravi')
      // the room can't shrink under its students
      await admin.patch(`${api}/rooms/${room.id}`).send({ number: '101', capacity: 1 }).expect(409)
    })

    it('moves a student and keeps the history', async () => {
      const target = (await admin.get(`${api}/board`)).body.data.blocks[0].rooms[1].beds[0]
      const moved = (await admin.post(`${api}/allotments/${allotment.id}/move`).send({ bedId: target.id, from: addDays(todayIso, 1) }).expect(200)).body.data
      expect(moved.bedId).toBe(target.id)
      const hist = (await admin.get(`${api}/students/${ravi.id}/history`).expect(200)).body.data
      expect(hist.allotments).toHaveLength(2)
      expect(hist.allotments.find((a) => !a.active).endReason).toBe('MOVED')
      allotment = moved
    })

    it('lists who lives where', async () => {
      const rows = (await admin.get(`${api}/allotments`).query({ search: 'ravi' }).expect(200)).body.data
      expect(rows).toHaveLength(1)
      expect(rows[0].bedCode).toBe('G-102-A')
    })

    describe('outpasses', () => {
      let pass
      it('asks, approves, marks out and back in (late)', async () => {
        const leaveDate = todayIso
        pass = (await admin.post(`${api}/outpasses`).send({ studentId: ravi.id, kind: 'DAY', leaveDate, leaveTime: '00:00', returnDate: leaveDate, returnTime: '00:01', reason: 'Dentist appointment', escort: { name: 'Parent Ravi', relation: 'MOTHER' } }).expect(201)).body.data
        expect(pass.status).toBe('REQUESTED')
        expect(pass.outpassNo).toMatch(/^OP/)
        await admin.post(`${api}/outpasses`).send({ studentId: ravi.id, leaveDate, leaveTime: '10:00', returnDate: leaveDate, returnTime: '12:00', reason: 'Another one' }).expect(409)
        await admin.post(`${api}/outpasses/${pass.id}/out`).expect(409) // not approved yet
        await admin.post(`${api}/outpasses/${pass.id}/decide`).send({ approve: true }).expect(200)
        const out = (await admin.post(`${api}/outpasses/${pass.id}/out`).expect(200)).body.data
        expect(out.status).toBe('OUT')
        const list = (await admin.get(`${api}/outpasses`).expect(200)).body.data
        expect(list.counts.OUT).toBe(1)
        expect((await admin.get(`${api}/board`)).body.data.outNow).toBe(1)
        await admin.post(`${api}/allotments/${allotment.id}/checkout`).send({ reason: 'LEFT_HOSTEL' }).expect(409) // out on a pass
        // back well after the return time (01 minute past midnight, institution clock) → late unless it is that minute
        await runAsTenant(h.tenant._id, () => Outpass.updateOne({ _id: pass.id }, { $set: { returnBy: new Date(Date.now() - 3 * 3600e3) } }))
        const back = (await admin.post(`${api}/outpasses/${pass.id}/in`).expect(200)).body.data
        expect(back.status).toBe('RETURNED')
        expect(back.late).toBe(true)
        expect(back.lateMinutes).toBeGreaterThanOrEqual(179)
      })

      it('refuses a rejection without a reason, and refuses a pass for someone with no bed', async () => {
        const p = (await admin.post(`${api}/outpasses`).send({ studentId: ravi.id, leaveDate: addDays(todayIso, 2), leaveTime: '09:00', returnDate: addDays(todayIso, 3), returnTime: '18:00', reason: 'Home for the weekend', kind: 'HOME' }).expect(201)).body.data
        await admin.post(`${api}/outpasses/${p.id}/decide`).send({ approve: false }).expect(400)
        const r = (await admin.post(`${api}/outpasses/${p.id}/decide`).send({ approve: false, note: 'Exams on Monday' }).expect(200)).body.data
        expect(r.status).toBe('REJECTED')
      })

      it('lets a family ask for and withdraw an outpass', async () => {
        await runAsTenant(h.tenant._id, async () => {
          const s = await Student.findById(asha.id).lean()
          const f = { features: ['HOSTEL'], students: [s], session: { kind: 'PARENT', mobile: '9845000701' } }
          const before = await familyHostel(f, asha.id)
          expect(before.resident).toBe(true)
          expect(before.stay.code).toBe('G-101-B')
          expect(before.canRequest).toBe(true)
          const after = await familyRequestOutpass(f, asha.id, { kind: 'HOME', leaveDate: addDays(todayIso, 5), leaveTime: '16:00', returnDate: addDays(todayIso, 7), returnTime: '18:00', reason: 'Cousin’s wedding' })
          expect(after.outpasses[0].status).toBe('REQUESTED')
          expect(after.outpasses[0].escort.name).toBe('Parent Asha')
          expect(after.canRequest).toBe(false)
          const withdrawn = await familyCancelOutpass(f, asha.id, after.outpasses[0].id)
          expect(withdrawn.outpasses[0].status).toBe('CANCELLED')
          await expect(familyHostel({ ...f, features: [] }, asha.id)).rejects.toThrow()
        })
      })
    })

    it('checks a student out', async () => {
      await admin.post(`${api}/allotments/${allotment.id}/checkout`).send({ reason: 'YEAR_END', to: addDays(todayIso, 2) }).expect(200)
      const rows = (await admin.get(`${api}/allotments`)).body.data
      expect(rows.map((r) => r.student.name)).toEqual(['Asha'])
      await admin.post(`${api}/outpasses`).send({ studentId: ravi.id, leaveDate: addDays(todayIso, 1), leaveTime: '10:00', returnDate: addDays(todayIso, 1), returnTime: '12:00', reason: 'Market' }).expect(409)
    })
  })

  it('refuses to delete a block with students in it', async () => {
    await admin.delete(`${api}/blocks/${block.id}`).expect(409)
  })
})

describe('mess', () => {
  it('keeps a common weekly menu and a block’s own, and meal counts', async () => {
    const common = (await admin.put(`${api}/mess/menu`).send({ items: [{ day: 'MON', meal: 'BREAKFAST', dishes: 'Idli, sambar' }, { day: 'MON', meal: 'DINNER', dishes: 'Chapati, dal' }] }).expect(200)).body.data
    expect(common.items).toHaveLength(28)
    expect(common.items.find((x) => x.day === 'MON' && x.meal === 'BREAKFAST').dishes).toBe('Idli, sambar')
    const block = (await admin.get(`${api}/blocks`)).body.data[0]
    let view = (await admin.get(`${api}/mess`).query({ blockId: block.id }).expect(200)).body.data
    expect(view.inherited).toBe(true)
    view = (await admin.put(`${api}/mess/menu`).send({ blockId: block.id, items: [{ day: 'TUE', meal: 'LUNCH', dishes: 'Rice, rasam' }] }).expect(200)).body.data
    expect(view.own).toBe(true)
    expect(view.residents).toBe(1)
    view = (await admin.delete(`${api}/mess/menu/${block.id}`).expect(200)).body.data
    expect(view.inherited).toBe(true)
    await admin.put(`${api}/mess/counts`).send({ date: todayIso, meal: 'LUNCH', count: 48 }).expect(200)
    await admin.put(`${api}/mess/counts`).send({ date: addDays(todayIso, 3), meal: 'LUNCH', count: 48 }).expect(400)
    const again = (await admin.get(`${api}/mess`).query({ date: todayIso })).body.data
    expect(again.counts.find((c) => c.meal === 'LUNCH').count).toBe(48)
  })
})

describe('permissions', () => {
  it('a mess-only role cannot allot or approve', async () => {
    const role = (await admin.post('/api/v1/core/roles').send({ name: 'Mess manager', permissions: ['hostel.mess.view', 'hostel.mess.edit'] })).body.data
    await admin.post('/api/v1/core/users').send({ name: 'Mess Manager', email: 'mess@hostel.test', roleIds: [role.id], password: 'Mess@1234' }).expect(201)
    const mess = await signIn(app, 'mess@hostel.test', 'Mess@1234')
    await mess.get(`${api}/mess`).expect(200)
    await mess.get(`${api}/board`).expect(403)
    await mess.post(`${api}/allotments`).send({ studentId: ravi.id, bedId: ravi.id }).expect(403)
  })
})
