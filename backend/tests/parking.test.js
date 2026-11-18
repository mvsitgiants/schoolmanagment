import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { areaTakes, classNumber, formatPlate, passState, plateKey } from '@schoolgiant/shared'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// Parking: areas, passes for staff / student / parent vehicles, the gate (in, out, visitors, a full area), and the scan.
let app
let admin
let teacher
let senior // class 11
let junior // class 8
let staffLot
let cycleStand
let visitorLot
beforeAll(async () => {
  app = await startDb()
  const h = await newInstitution('ENTERPRISE')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'K12', sectionsPerClass: 1, addSubjects: false }).expect(201)
  const classes = (await admin.get('/api/v1/academics/classes')).body.data.classes
  const add = async (firstName, code, mobile) => (await admin.post('/api/v1/students').send({ firstName, sectionId: classes.find((c) => c.code === code).sections[0].id, guardians: [{ name: `Parent ${firstName}`, relation: 'FATHER', mobile }] })).body.data
  senior = await add('Kabir', '11', '9845000801')
  junior = await add('Ira', '8', '9845000802')
  teacher = (await admin.post('/api/v1/hrms/employees').send({ name: 'Meera Teacher', category: 'TEACHING', employmentType: 'PERMANENT', joiningDate: '2020-06-01', gender: 'FEMALE', mobile: '9845000803' }).expect(201)).body.data
})
afterAll(stopDb)

const api = '/api/v1/parking'

describe('the rules', () => {
  it('matches plates whatever the spacing, and reads a class number', () => {
    expect(plateKey('up 32-ab 1234')).toBe('UP32AB1234')
    expect(formatPlate('up32ab1234')).toBe('UP 32 AB 1234')
    expect(formatPlate('22bh1234aa')).toBe('22 BH 1234 AA')
    expect(classNumber({ code: '11' })).toBe(11)
    expect(classNumber({ code: 'LKG', name: 'LKG' })).toBe(0)
    expect(passState({ status: 'ACTIVE', validTo: '2026-01-01' }, '2026-02-01')).toBe('EXPIRED')
    expect(areaTakes({ for: 'STAFF', kinds: ['CAR'] }, 'STAFF', 'TWO_WHEELER')).toBe(false)
    expect(areaTakes({ for: 'ANY', kinds: [] }, 'VISITOR', 'CAR')).toBe(true)
  })
})

describe('areas, passes and the gate', () => {
  it('adds areas', async () => {
    staffLot = (await admin.post(`${api}/areas`).send({ name: 'Staff parking', for: 'STAFF', capacity: 1 }).expect(201)).body.data
    cycleStand = (await admin.post(`${api}/areas`).send({ name: 'Cycle stand', for: 'STUDENT', kinds: ['CYCLE', 'TWO_WHEELER'], capacity: 50 }).expect(201)).body.data
    visitorLot = (await admin.post(`${api}/areas`).send({ name: 'Visitor parking', for: 'VISITOR', capacity: 10 }).expect(201)).body.data
    await admin.post(`${api}/areas`).send({ name: 'staff parking', for: 'ANY' }).expect(400) // same name
  })

  it('gives passes, with the student rules', async () => {
    const car = (await admin.post(`${api}/vehicles`).send({ ownerKind: 'STAFF', employeeId: teacher.id, plate: 'up32ab1234', kind: 'CAR', model: 'Maruti Swift', licenceNo: 'UP3220200001', areaId: staffLot.id }).expect(201)).body.data
    expect(car).toMatchObject({ plate: 'UP 32 AB 1234', ownerName: 'Meera Teacher', state: 'ACTIVE' })
    expect(car.passNo).toMatch(/^PK/)
    // the same plate twice
    await admin.post(`${api}/vehicles`).send({ ownerKind: 'STAFF', employeeId: teacher.id, plate: 'UP 32 AB-1234', kind: 'CAR', licenceNo: 'X1' }).expect(409)
    // class 8: a cycle yes, a scooter no; class 11: a scooter, with a licence
    await admin.post(`${api}/vehicles`).send({ ownerKind: 'STUDENT', studentId: junior.id, plate: 'CYC-0042', kind: 'TWO_WHEELER', licenceNo: 'L1' }).expect(400)
    await admin.post(`${api}/vehicles`).send({ ownerKind: 'STUDENT', studentId: junior.id, plate: 'CYC-0042', kind: 'CYCLE', areaId: cycleStand.id }).expect(201)
    await admin.post(`${api}/vehicles`).send({ ownerKind: 'STUDENT', studentId: senior.id, plate: 'UP32CD5678', kind: 'TWO_WHEELER' }).expect(400) // no licence
    await admin.post(`${api}/vehicles`).send({ ownerKind: 'STUDENT', studentId: senior.id, plate: 'UP32CD5678', kind: 'TWO_WHEELER', licenceNo: 'UP3220260009', areaId: staffLot.id }).expect(400) // a staff area
    const scooter = (await admin.post(`${api}/vehicles`).send({ ownerKind: 'STUDENT', studentId: senior.id, plate: 'UP32CD5678', kind: 'TWO_WHEELER', licenceNo: 'UP3220260009', areaId: cycleStand.id }).expect(201)).body.data
    expect(scooter.classLabel).toBeTruthy()
    // a parent's car names the child
    const parent = (await admin.post(`${api}/vehicles`).send({ ownerKind: 'GUARDIAN', studentId: junior.id, ownerName: 'Parent Ira', relation: 'FATHER', plate: 'UP32EF9999', kind: 'CAR', licenceNo: 'P1' }).expect(201)).body.data
    expect(parent.studentName).toBe('Ira')
    const list = (await admin.get(`${api}/vehicles`).query({ search: '5678' })).body.data
    expect(list.rows.map((r) => r.plate)).toEqual(['UP 32 CD 5678'])
    expect(list.counts.ACTIVE).toBe(4)
  })

  it('lets pass holders and visitors in and out, and holds a full area', async () => {
    const found = (await admin.get(`${api}/gate/lookup`).query({ q: '1234' })).body.data
    expect(found.vehicle.plate).toBe('UP 32 AB 1234')
    const e = (await admin.post(`${api}/gate/in`).send({ vehicleId: found.vehicle.id }).expect(201)).body.data
    expect(e).toMatchObject({ parker: 'STAFF', areaName: 'Staff parking' })
    await admin.post(`${api}/gate/in`).send({ vehicleId: found.vehicle.id }).expect(409) // already inside
    // a visitor car into the full staff lot: refused, then let in on purpose
    const full = await admin.post(`${api}/gate/in`).send({ plate: 'DL 01 ZZ 0001', kind: 'CAR', name: 'Mr Gupta', areaId: visitorLot.id })
    expect(full.status).toBe(201)
    const staffFull = await admin.post(`${api}/gate/in`).send({ plate: 'DL 01 ZZ 0002', kind: 'CAR', name: 'Inspector', areaId: staffLot.id })
    expect(staffFull.status).toBe(400) // a visitor can't use the staff area
    const desk = (await admin.get(`${api}/gate`)).body.data
    expect(desk.stats).toMatchObject({ inside: 2, visitorsInside: 1, fullAreas: 1 })
    expect(desk.areas.find((a) => a.id === staffLot.id)).toMatchObject({ inside: 1, full: true })
    await admin.post(`${api}/gate/${e.id}/out`).expect(200)
    await admin.post(`${api}/gate/${e.id}/out`).expect(409)
    const log = (await admin.get(`${api}/gate/log`)).body.data
    expect(log.total).toBe(2)
  })

  it('refuses a full area unless asked', async () => {
    await admin.put(`${api}/areas/${visitorLot.id}`).send({ name: 'Visitor parking', for: 'VISITOR', capacity: 1 }).expect(200)
    const r = await admin.post(`${api}/gate/in`).send({ plate: 'DL01ZZ0003', kind: 'CAR', name: 'Courier', areaId: visitorLot.id })
    expect(r.status).toBe(409)
    expect(r.body.details.code).toBe('AREA_FULL')
    const ok = (await admin.post(`${api}/gate/in`).send({ plate: 'DL01ZZ0003', kind: 'CAR', name: 'Courier', areaId: visitorLot.id, overFull: true }).expect(201)).body.data
    expect(ok.overFull).toBe(true)
  })

  it('scans a sticker to mark in and out', async () => {
    const v = (await admin.get(`${api}/vehicles`).query({ search: 'UP32CD5678' })).body.data.rows[0]
    const hit = (await admin.post('/api/v1/scan/resolve').send({ code: v.passNo }).expect(200)).body.data
    expect(hit).toMatchObject({ kind: 'VEHICLE', title: 'UP 32 CD 5678' })
    expect(hit.actions.map((a) => a.key)).toContain('parkingIn')
    const inNow = (await admin.post(`/api${hit.actions.find((a) => a.key === 'parkingIn').post}`).expect(200)).body.data
    expect(inNow.parking.inside).toBe(true)
    const out = inNow.actions.find((a) => a.key === 'parkingOut')
    expect((await admin.post(`/api${out.post}`).expect(200)).body.data.parking.inside).toBe(false)
  })

  it('the gate scanner records entry and exit at once, and says why a vehicle can’t pass', async () => {
    const scan = async (code, direction) => (await admin.post(`${api}/gate/scan`).send({ code, direction }).expect(200)).body.data
    const v = (await admin.get(`${api}/vehicles`).query({ search: 'CYC-0042' })).body.data.rows[0]
    expect(await scan(v.passNo, 'OUT')).toMatchObject({ result: 'NOT_INSIDE' })
    expect(await scan(v.passNo, 'IN')).toMatchObject({ result: 'IN', plate: 'CYC-0042' })
    expect(await scan(v.passNo, 'IN')).toMatchObject({ result: 'ALREADY_IN' })
    expect(await scan('cyc 0042', 'AUTO')).toMatchObject({ result: 'OUT' }) // one gate: parked → out, by plate
    expect(await scan(v.passNo, 'AUTO')).toMatchObject({ result: 'IN' })
    expect(await scan('MH12XY0001', 'IN')).toMatchObject({ result: 'NO_PASS', vehicle: null })
  })

  it('renews, cancels and deletes passes the right way', async () => {
    const v = (await admin.get(`${api}/vehicles`).query({ search: 'UP32EF9999' })).body.data.rows[0]
    const renewed = (await admin.post(`${api}/vehicles/${v.id}/renew`).expect(200)).body.data
    expect(renewed.validTo > v.validTo).toBe(true)
    await admin.delete(`${api}/vehicles/${v.id}`).expect(200) // never came through the gate
    const car = (await admin.get(`${api}/vehicles`).query({ search: 'UP32AB1234' })).body.data.rows[0]
    await admin.delete(`${api}/vehicles/${car.id}`).expect(409) // has a gate history
    await admin.post(`${api}/vehicles/${car.id}/revoke`).send({ reason: 'Left the school' }).expect(200)
    await admin.post(`${api}/gate/in`).send({ vehicleId: car.id }).expect(409)
    expect((await admin.post(`${api}/gate/scan`).send({ code: car.passNo, direction: 'IN' })).body.data.result).toBe('REVOKED')
    await admin.delete(`${api}/areas/${staffLot.id}`).expect(409) // has a history
  })
})
