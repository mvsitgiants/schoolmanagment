import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageLog, MessagingConfig } from '../src/models/engines.js'
import { Student } from '../src/models/students.js'
import { runAsTenant } from '../src/platform/context.js'
import { queueFamilyMessages } from '../src/services/notify.js'
import { newInstitution, startDb, stopDb } from './helpers.js'

let h
beforeAll(async () => {
  await startDb()
  h = await newInstitution('STARTER')
})
afterAll(stopDb)

const inTenant = (fn) => runAsTenant(h.tenant._id, fn)

describe('family messages', () => {
  it('go to the primary guardian, worded from the rule, with the student filled in', async () => {
    const rows = await inTenant(async () => {
      await MessagingConfig.updateOne({}, { $set: { sms: { provider: 'TEST' } } }, { upsert: true })
      const st = await Student.create({
        admissionNo: '20260001', firstName: 'Aarav', lastName: 'Sharma',
        guardians: [
          { name: 'Rohit Sharma', relation: 'FATHER', mobile: '9845011111' },
          { name: 'Neha Sharma', relation: 'MOTHER', mobile: '9845022222', isPrimary: true },
        ],
      })
      return queueFamilyMessages('attendance.absent', { studentId: st._id, data: { student: { class: '8-A' }, attendance: { date: 'Tue, 7 Oct' } } })
    })
    const sms = rows.find((r) => r.channel === 'SMS')
    expect(sms.status).toBe('QUEUED')
    expect(sms.to).toMatch(/9845022222$/)
    expect(sms.body).toContain('Aarav Sharma (8-A) is absent today, Tue, 7 Oct')
    expect(sms.body).toContain(h.tenant.name)
    // WhatsApp has no provider yet: recorded as not sent, with the reason
    const wa = rows.find((r) => r.channel === 'WHATSAPP')
    expect(wa).toMatchObject({ status: 'SKIPPED' })
    expect(wa.reason).toMatch(/isn’t set up/)
  })

  it('respect a family that opted out of a channel', async () => {
    const rows = await inTenant(async () => {
      const st = await Student.create({
        admissionNo: '20260002', firstName: 'Diya', guardians: [{ name: 'Mrs. Rao', mobile: '9845033333', isPrimary: true }],
        consents: { communication: { sms: false } },
      })
      return queueFamilyMessages('attendance.absent', { studentId: st._id, only: ['SMS'] })
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'SKIPPED', reason: 'The family doesn’t want SMS messages' })
    const logged = await inTenant(() => MessageLog.countDocuments({ studentId: rows[0].studentId }))
    expect(logged).toBe(1)
  })
})
