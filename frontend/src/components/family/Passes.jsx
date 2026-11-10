import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, HandHelping, QrCode as QrIcon, X } from 'lucide-react'
import { FormField, Input, Modal } from '../system'
import Button from '../ui/Button'
import QrCode from '../scan/QrCode'
import { FCard, useFamily, useFamilyQuery } from './FamilyKit'
import { familyPasses, familyPickupCancel, familyPickupCreate, familySelfAttendance, familySelfCheckIn } from '../../api/family'
import SelfCheckIn from '../geo/SelfCheckIn'
import { useFormat } from '../../context/SettingsContext'

// Passes a family shows at school (the school scans them with the app's Scan button): an event pass for an RSVP "yes",
// a meeting pass for a parent–teacher slot, and the early-pickup pass naming who collects the child today.

export const usePasses = () => {
  const { slug, studentId } = useFamily()
  return useFamilyQuery(['passes'], () => familyPasses(slug, studentId), { staleTime: 30_000 })
}

/** The pass, big enough to scan from a phone held up at a gate. */
export function PassModal({ title, lines = [], code, done, onClose }) {
  const { t } = useTranslation('family')
  return (
    <Modal open onClose={onClose} size="sm" title={title}>
      <div className="flex flex-col items-center gap-3 text-center">
        <QrCode value={code} size={240} label={title} className="rounded-xl border border-border bg-white p-2" />
        {lines.filter(Boolean).map((l) => <p key={l} className="text-sm text-ink">{l}</p>)}
        {done ? <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success-600"><CheckCircle2 className="w-4 h-4" />{done}</p>
          : <p className="text-xs text-ink-muted">{t('family.passes.showAtGate')}</p>}
      </div>
    </Modal>
  )
}

/** Calendar: "Show pass" under an event the family said yes to. */
export function EventPassButton({ eventId }) {
  const { t } = useTranslation('family')
  const { date, time } = useFormat()
  const { data } = usePasses()
  const [open, setOpen] = useState(false)
  const pass = data?.events.find((e) => e.eventId === eventId)
  if (!pass) return null
  return (
    <>
      <Button size="sm" variant="secondary" icon={QrIcon} className="mt-2 min-h-[44px]" onClick={() => setOpen(true)}>{t('family.passes.show')}</Button>
      {open && <PassModal title={pass.title} code={pass.code} onClose={() => setOpen(false)} lines={[date(pass.startDate), pass.venue]}
        done={pass.checkedInAt && t('family.passes.checkedIn', { time: time(pass.checkedInAt) })} />}
    </>
  )
}

/** Meetings: "Show pass" next to a booked slot — scanned on arrival so the teacher knows you're waiting. */
export function MeetingPassButton({ bookingId }) {
  const { t } = useTranslation('family')
  const { date, time } = useFormat()
  const { data } = usePasses()
  const [open, setOpen] = useState(false)
  const pass = data?.meetings.find((m) => m.id === bookingId)
  if (!pass) return null
  return (
    <>
      <Button size="sm" variant="secondary" icon={QrIcon} className="min-h-[44px]" onClick={() => setOpen(true)}>{t('family.passes.show')}</Button>
      {open && <PassModal title={pass.title} code={pass.code} onClose={() => setOpen(false)} lines={[`${date(pass.date)} · ${pass.time}`, [pass.host, pass.room].filter(Boolean).join(' · ')]}
        done={pass.arrivedAt && t('family.passes.arrived', { time: time(pass.arrivedAt) })} />}
    </>
  )
}

/** Attendance: the early-pickup pass — name who collects the child today; the gate checks them against it. */
export function PickupCard() {
  const { t } = useTranslation('family')
  const { time } = useFormat()
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { data } = usePasses()
  const [making, setMaking] = useState(false)
  const [showing, setShowing] = useState(false)
  const [form, setForm] = useState({ name: '', relation: '', mobile: '', reason: '' })
  const refresh = () => qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'passes'] })
  const make = useMutation({ mutationFn: () => familyPickupCreate(slug, studentId, form), onSuccess: () => { refresh(); setMaking(false); setShowing(true) } })
  const cancel = useMutation({ mutationFn: (id) => familyPickupCancel(slug, studentId, id), onSuccess: refresh })
  if (!data) return null
  const active = data.pickups.find((p) => p.status === 'ACTIVE')
  const used = data.pickups.find((p) => p.status === 'USED')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <FCard title={t('family.passes.pickupTitle')}>
      {used && !active ? (
        <p className="flex items-center gap-2 text-sm text-success-700"><CheckCircle2 className="w-4 h-4 shrink-0" />{t('family.passes.pickedUp', { name: used.person.name, time: time(used.usedAt) })}</p>
      ) : active ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">{t('family.passes.pickupBy', { name: active.person.name })}{active.person.relation ? ` · ${active.person.relation}` : ''}</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={QrIcon} className="min-h-[44px]" onClick={() => setShowing(true)}>{t('family.passes.show')}</Button>
            <Button variant="ghost" icon={X} className="min-h-[44px]" loading={cancel.isPending} onClick={() => cancel.mutate(active.id)}>{t('family.passes.cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">{t('family.passes.pickupHint')}</p>
          <Button variant="secondary" icon={HandHelping} className="min-h-[44px]" onClick={() => setMaking(true)}>{t('family.passes.make')}</Button>
        </div>
      )}
      {making && (
        <Modal open onClose={() => setMaking(false)} size="sm" title={t('family.passes.makeTitle')} footer={<>
          <Button variant="secondary" onClick={() => setMaking(false)}>{t('family.passes.close')}</Button>
          <Button loading={make.isPending} disabled={form.name.trim().length < 2} onClick={() => make.mutate()}>{t('family.passes.create')}</Button>
        </>}>
          <div className="space-y-3">
            <FormField label={t('family.passes.name')} required><Input value={form.name} onChange={set('name')} autoComplete="name" /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('family.passes.relation')}><Input value={form.relation} onChange={set('relation')} placeholder={t('family.passes.relationPh')} /></FormField>
              <FormField label={t('family.passes.mobile')}><Input type="tel" inputMode="tel" value={form.mobile} onChange={set('mobile')} /></FormField>
            </div>
            <FormField label={t('family.passes.reason')}><Input value={form.reason} onChange={set('reason')} /></FormField>
            <p className="text-xs text-ink-muted">{t('family.passes.makeHint')}</p>
            {make.error && <p className="text-sm text-danger-600">{make.error.message}</p>}
          </div>
        </Modal>
      )}
      {showing && active && <PassModal title={t('family.passes.pickupTitle')} code={active.code} onClose={() => setShowing(false)} lines={[t('family.passes.pickupBy', { name: active.person.name }), active.person.relation]} />}
    </FCard>
  )
}

/** The student app: check in / out on the campus — the student's own login only, when the school switched it on. */
export function StudentCheckInCard() {
  const { t } = useTranslation('geo')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { data } = useFamilyQuery(['self-attendance'], () => familySelfAttendance(slug, studentId), { staleTime: 30_000 })
  if (!data?.enabled || !data.ownLogin) return null
  return (
    <FCard title={t('geo.self.studentTitle')}>
      <SelfCheckIn framed={false} status={data} punch={(body) => familySelfCheckIn(slug, studentId, body)}
        onDone={(r) => qc.setQueryData(['family', slug, studentId, 'self-attendance'], (d) => ({ ...d, today: r.today, next: r.direction === 'IN' ? 'OUT' : 'IN' }))} />
    </FCard>
  )
}
