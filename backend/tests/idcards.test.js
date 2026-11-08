import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { newInstitution, signIn, startDb, stopDb } from './helpers.js'

// a 1×1 PNG, as the browser sends a shrunk photo
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let app
let admin
let section
let aarav
let diya
beforeAll(async () => {
  app = await startDb()
  const h = await newInstitution('STARTER')
  admin = await signIn(app, h.email, h.password)
  await admin.post('/api/v1/academics/classes/quick-setup').send({ preset: 'SENIOR', sectionsPerClass: 1, addSubjects: false }).expect(201)
  section = (await admin.get('/api/v1/academics/classes')).body.data.classes.find((c) => c.code === '11').sections[0]
  const add = async (firstName, bloodGroup) => (await admin.post('/api/v1/students').send({ firstName, bloodGroup, sectionId: section.id, guardians: [{ name: `Parent of ${firstName}`, relation: 'FATHER', mobile: '9845000091', isPrimary: true }] })).body.data
  aarav = await add('Aarav', 'B+')
  diya = await add('Diya', 'O+')
})
afterAll(stopDb)

describe('student photos', () => {
  it('takes a small image and refuses anything else', async () => {
    expect((await admin.put(`/api/v1/students/${aarav.id}/photo`).send({ photo: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400)
    await admin.put(`/api/v1/students/${aarav.id}/photo`).send({ photo: PNG }).expect(200)
    expect((await admin.get(`/api/v1/students/${aarav.id}/photo`)).body.data.photo).toBe(PNG)
    const list = (await admin.get(`/api/v1/students/id-cards?sectionId=${section.id}`)).body.data
    expect(list.find((s) => s.name === 'Aarav')).toMatchObject({ hasPhoto: true, printed: false })
    expect(list.find((s) => s.name === 'Diya').hasPhoto).toBe(false)
    expect((await admin.get('/api/v1/students')).body.data[0].photo).toBeUndefined() // lists never carry photos
  })
})

describe('ID cards', () => {
  it('prints a card per student with photo, class and a QR that checks the card', async () => {
    const res = await admin.get(`/api/v1/documents/STUDENT_ID_CARD?ids=${aarav.id},${diya.id}&print=0`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Aarav')
    expect(res.text).toContain('Diya')
    expect(res.text).toContain(PNG.slice(0, 40))
    expect(res.text).toContain('B+')
    const list = (await admin.get(`/api/v1/students/id-cards?sectionId=${section.id}`)).body.data
    expect(list.every((s) => s.printed)).toBe(true)
  })

  it('anyone can check a card; a student who left shows as not valid', async () => {
    const html = (await admin.get(`/api/v1/documents/STUDENT_ID_CARD?ids=${diya.id}&print=0`)).text
    const code = html.match(/verify\/student\/([A-Z0-9]{10})/)?.[1]
    expect(code).toBeTruthy()
    const ok = (await request(app).get(`/api/v1/public/verify/student/${code}`)).body.data
    expect(ok).toMatchObject({ found: true, valid: true, name: 'Diya' })
    await admin.post(`/api/v1/students/${diya.id}/status`).send({ status: 'LEFT' }).expect(200)
    const gone = (await request(app).get(`/api/v1/public/verify/student/${code}`)).body.data
    expect(gone).toMatchObject({ found: true, valid: false, class: null })
    // the same code on a reprint for a student still here
    const again = (await admin.get(`/api/v1/documents/STUDENT_ID_CARD?ids=${aarav.id}&print=0`)).text
    const first = (await admin.get(`/api/v1/documents/STUDENT_ID_CARD?ids=${aarav.id}&print=0`)).text
    expect(again.match(/verify\/student\/([A-Z0-9]{10})/)[1]).toBe(first.match(/verify\/student\/([A-Z0-9]{10})/)[1])
  })
})
