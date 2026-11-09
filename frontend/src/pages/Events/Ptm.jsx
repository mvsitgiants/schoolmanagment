import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, Download, DoorOpen, Lock, MessageSquareText, Pencil, Plus, Trash2, UserPlus, UserX, Users, Video, X } from 'lucide-react'
import { BOOKING_STATUS, PTM_MODES, PTM_STATUS, ptmSlots } from '@schoolgiant/shared'
import { Drawer, FormField, HeaderButton, Input, LevelBar, Modal, Note, PageContainer, PageHeader, Panel, PhoneLink, SegmentedControl, Select, StatusPill, Tabs, Textarea, localIso, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import { bookSlot, deleteSession, exportSession, fetchClassTeachers, fetchMyMeetings, fetchSession, fetchSessions, openBooking, saveSession, setSessionStatus, updateBooking } from '../../api/events'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { AudienceFields, useAcademicLookup, useEventLabels } from '../../components/events/EventsKit'

let seq = 0
const blankHost = () => ({ key: `n${++seq}`, id: '', userId: '', name: '', role: '', room: '', sectionIds: [] })

function SessionForm({ session, onClose, onSaved }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const { showError, showSuccess } = useSnackbar()
  const { data: lookup } = useAcademicLookup()
  const [form, setForm] = useState({
    title: session?.title ?? '', date: session?.date ?? '', startTime: session?.startTime ?? '09:00', endTime: session?.endTime ?? '12:00',
    slotMinutes: session?.slotMinutes ?? 10, gapMinutes: session?.gapMinutes ?? 0, mode: session?.mode ?? 'IN_PERSON', bookingCloses: session?.bookingCloses ?? '', instructions: session?.instructions ?? '',
  })
  const [aud, setAud] = useState({ audience: session?.sectionIds?.length ? 'SECTIONS' : session?.classIds?.length ? 'CLASSES' : 'EVERYONE', classIds: session?.classIds ?? [], sectionIds: session?.sectionIds ?? [] })
  const [hosts, setHosts] = useState(session?.hosts?.map((h) => ({ ...h, key: h.id, userId: h.userId ?? '', role: h.role ?? '', room: h.room ?? '' })) ?? [])
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setHost = (i, k) => (e) => setHosts((list) => list.map((h, j) => (j === i ? { ...h, [k]: e.target.value } : h)))
  const toggleSection = (i, id) => setHosts((list) => list.map((h, j) => (j === i ? { ...h, sectionIds: h.sectionIds.includes(id) ? h.sectionIds.filter((x) => x !== id) : [...h.sectionIds, id] } : h)))
  const slots = ptmSlots(form.startTime, form.endTime, Number(form.slotMinutes), Number(form.gapMinutes))
  const teachers = useMutation({
    mutationFn: () => fetchClassTeachers(aud.audience === 'CLASSES' ? aud.classIds : [], aud.audience === 'SECTIONS' ? aud.sectionIds : []),
    onSuccess: (list) => {
      const have = new Set(hosts.map((h) => h.userId).filter(Boolean))
      const add = list.filter((h) => !have.has(h.userId)).map((h) => ({ ...blankHost(), ...h }))
      setHosts((l) => [...l, ...add])
      if (add.length) showSuccess(t('events.ptm.form.teachersAdded', { count: add.length })); else showError(t('events.ptm.form.noTeachers'))
    },
    onError: (e) => showError(e.message),
  })
  const save = useMutation({
    mutationFn: () => saveSession(session?.id, {
      ...form, slotMinutes: Number(form.slotMinutes), gapMinutes: Number(form.gapMinutes),
      classIds: aud.audience === 'CLASSES' ? aud.classIds : [], sectionIds: aud.audience === 'SECTIONS' ? aud.sectionIds : [],
      hosts: hosts.filter((h) => h.name.trim()).map((h) => ({ id: h.id || undefined, userId: h.userId || null, name: h.name, role: h.role, room: h.room, sectionIds: h.sectionIds, away: h.away ?? [] })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const sections = lookup?.sections ?? []
  return (
    <Modal open onClose={onClose} size="xl" title={session ? t('events.ptm.form.editTitle') : t('events.ptm.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2 || !form.date || !slots.length} onClick={() => save.mutate()}>{t('events.ptm.form.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_170px] gap-3">
          <FormField label={t('events.ptm.form.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} placeholder={t('events.ptm.form.titlePlaceholder')} /></FormField>
          <FormField label={t('events.ptm.form.date')} required error={errors.date}><Input type="date" value={form.date} onChange={set('date')} /></FormField>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <FormField label={t('events.ptm.form.from')}><Input type="time" value={form.startTime} onChange={set('startTime')} /></FormField>
          <FormField label={t('events.ptm.form.to')} error={errors.endTime}><Input type="time" value={form.endTime} onChange={set('endTime')} /></FormField>
          <FormField label={t('events.ptm.form.slot')}><Input type="number" min="3" max="60" value={form.slotMinutes} onChange={set('slotMinutes')} /></FormField>
          <FormField label={t('events.ptm.form.gap')}><Input type="number" min="0" max="30" value={form.gapMinutes} onChange={set('gapMinutes')} /></FormField>
          <FormField label={t('events.ptm.form.mode')}><Select value={form.mode} onChange={set('mode')}>{PTM_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select></FormField>
        </div>
        <p className="text-xs text-ink-faint">{slots.length ? t('events.ptm.form.slotsLine', { count: slots.length, first: slots[0], last: slots[slots.length - 1] }) : t('events.ptm.form.noSlots')}</p>
        <div className="grid sm:grid-cols-[170px_1fr] gap-3">
          <FormField label={t('events.ptm.form.bookBy')} hint={t('events.ptm.form.bookByHint')} error={errors.bookingCloses}><Input type="date" value={form.bookingCloses} max={form.date} onChange={set('bookingCloses')} /></FormField>
          <FormField label={t('events.ptm.form.instructions')}><Textarea rows={2} value={form.instructions} onChange={set('instructions')} /></FormField>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-sm font-semibold text-ink mb-2">{t('events.ptm.form.invited')}</p>
          <AudienceFields value={aud} onChange={setAud} staff={false} />
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-ink">{t('events.ptm.form.teachers')}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={Users} loading={teachers.isPending} onClick={() => teachers.mutate()}>{t('events.ptm.form.addClassTeachers')}</Button>
              <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setHosts((l) => [...l, blankHost()])}>{t('events.ptm.form.addTeacher')}</Button>
            </div>
          </div>
          {errors.hosts && <p className="mb-2 text-xs text-danger-600">{errors.hosts}</p>}
          {!hosts.length && <Note>{t('events.ptm.form.teachersHint')}</Note>}
          <div className="space-y-2">
            {hosts.map((h, i) => (
              <div key={h.key} className="rounded-xl border border-border p-3">
                <div className="grid sm:grid-cols-[1fr_1fr_160px_auto] gap-2 items-end">
                  <FormField label={t('events.ptm.form.teacherName')}><Input value={h.name} onChange={setHost(i, 'name')} /></FormField>
                  <FormField label={t('events.ptm.form.role')}><Input value={h.role} onChange={setHost(i, 'role')} placeholder={t('events.ptm.form.rolePlaceholder')} /></FormField>
                  <FormField label={form.mode === 'ONLINE' ? t('events.ptm.form.roomOnline') : t('events.ptm.form.room')}><Input value={h.room} disabled={form.mode === 'ONLINE'} onChange={setHost(i, 'room')} /></FormField>
                  <Button size="sm" variant="ghost" icon={X} aria-label={t('events.ptm.form.removeTeacher')} onClick={() => setHosts((l) => l.filter((_, j) => j !== i))} />
                </div>
                <p className="mt-2 text-xs text-ink-muted">{t('events.ptm.form.meets')}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {sections.filter((s) => (aud.audience !== 'SECTIONS' || aud.sectionIds.includes(s.id)) && (aud.audience !== 'CLASSES' || aud.classIds.includes(s.classId))).map((s) => (
                    <label key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                      <input type="checkbox" checked={h.sectionIds.includes(s.id)} onChange={() => toggleSection(i, s.id)} className="rounded border-border text-brand-500" />{s.short}
                    </label>
                  ))}
                </div>
                {!h.sectionIds.length && <p className="mt-1 text-[11px] text-ink-faint">{t('events.ptm.form.meetsAll')}</p>}
                {!h.userId && <p className="mt-1 text-[11px] text-ink-faint">{t('events.ptm.form.noLogin')}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SlotRow({ slot, onBook, onMark, onNote, onCancel, canManage }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const b = slot.booking
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="w-12 text-sm font-mono-num text-ink">{slot.time}</span>
      {b ? (
        <>
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm text-ink">{b.student}<span className="ml-1 text-xs text-ink-faint">{b.section}</span></p>
            <p className="text-xs text-ink-faint">{b.guardian}{b.mobile && <> · <PhoneLink number={b.mobile} /></>}{b.byFamily ? ` · ${t('events.ptm.byFamily')}` : ''}</p>
            {b.remarks && <p className="mt-0.5 text-xs text-ink-muted whitespace-pre-line">{b.remarks}</p>}
          </div>
          <StatusPill tone={BOOKING_STATUS[b.status]?.tone}>{L.booking(b.status)}</StatusPill>
          {canManage && (
            <div className="flex gap-1">
              <Button size="sm" variant={b.status === 'ATTENDED' ? 'primary' : 'ghost'} icon={Check} aria-label={L.booking('ATTENDED')} onClick={() => onMark(b, 'ATTENDED')} />
              <Button size="sm" variant={b.status === 'NO_SHOW' ? 'primary' : 'ghost'} icon={UserX} aria-label={L.booking('NO_SHOW')} onClick={() => onMark(b, 'NO_SHOW')} />
              <Button size="sm" variant="ghost" icon={MessageSquareText} aria-label={t('events.ptm.note')} onClick={() => onNote(b)} />
              {onCancel && b.status === 'BOOKED' && <Button size="sm" variant="ghost" icon={X} aria-label={t('events.ptm.cancelBooking')} onClick={() => onCancel({ ...b, time: slot.time })} />}
            </div>
          )}
        </>
      ) : slot.away ? <span className="text-xs text-ink-faint">{t('events.ptm.away')}</span> : (
        <>
          <span className="flex-1 text-xs text-ink-faint">{t('events.ptm.free')}</span>
          {onBook && <Button size="sm" variant="secondary" icon={Plus} onClick={() => onBook(slot.time)}>{t('events.ptm.book')}</Button>}
        </>
      )}
    </div>
  )
}

function useBookingActions(onDone) {
  const { t } = useTranslation('events')
  const prompt = usePrompt()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const m = useMutation({ mutationFn: ({ id, body }) => updateBooking(id, body), onSuccess: () => { onDone(); showSuccess(t('events.ptm.saved')) }, onError: (e) => showError(e.message) })
  return {
    mark: (b, status) => m.mutate({ id: b.id, body: { status: b.status === status ? 'BOOKED' : status } }),
    note: async (b) => { const v = await prompt({ title: t('events.ptm.noteTitle', { name: b.student }), label: t('events.ptm.noteLabel'), defaultValue: b.remarks ?? '' }); if (v !== null && v !== undefined) m.mutate({ id: b.id, body: { remarks: v } }) },
    cancel: async (b) => { if (await confirm({ title: t('events.ptm.cancelConfirm', { name: b.student, time: b.time }), confirmLabel: t('events.ptm.cancelBooking'), tone: 'danger' })) m.mutate({ id: b.id, body: { status: 'CANCELLED' } }) },
  }
}

function BookModal({ session, host, time, onClose, onDone }) {
  const { t } = useTranslation('events')
  const { showError } = useSnackbar()
  const [studentId, setStudentId] = useState('')
  const save = useMutation({ mutationFn: () => bookSlot(session.id, { hostId: host.id, time, studentId }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('events.ptm.bookTitle', { time, name: host.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!studentId} onClick={() => save.mutate()}>{t('events.ptm.book')}</Button>
    </>}>
      <StudentPicker value={studentId} onChange={(id) => setStudentId(id)} />
    </Modal>
  )
}

function SessionDrawer({ id, onClose, onEdit }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [booking, setBooking] = useState(null)
  const { data: p } = useQuery({ queryKey: ['events', 'ptm', id], queryFn: () => fetchSession(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['events'] })
  const actions = useBookingActions(refresh)
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(v.done(r)); if (v.close) onClose() }, onError: (e) => showError(e.message) })
  if (!p) return <Drawer open onClose={onClose} title={t('events.loading')}><span /></Drawer>
  const canEdit = hasPermission('events.ptm.edit')
  const booked = p.grid.reduce((n, g) => n + g.slots.filter((s) => s.booking).length, 0)
  return (
    <Drawer open onClose={onClose} size="2xl" title={p.title} subtitle={`${date(p.date)} · ${p.startTime}–${p.endTime} · ${L.mode(p.mode)}`}
      footer={canEdit && <div className="flex flex-wrap gap-2">
        {(p.status === 'DRAFT' || p.status === 'CLOSED') && <Button icon={DoorOpen} onClick={async () => { const notify = await confirm({ title: t('events.ptm.openTitle'), message: t('events.ptm.openHint', { count: p.invited }), confirmLabel: t('events.ptm.openTell'), cancelLabel: t('events.ptm.openQuiet') }); act.mutate({ fn: () => openBooking(p.id, !!notify), done: (r) => (r.told ? t('events.ptm.openedTold', { count: r.told }) : t('events.ptm.opened')) }) }}>{t('events.ptm.open')}</Button>}
        {p.status === 'OPEN' && <Button variant="secondary" icon={Lock} onClick={() => act.mutate({ fn: () => setSessionStatus(p.id, 'CLOSED'), done: () => t('events.ptm.closed') })}>{t('events.ptm.close')}</Button>}
        {p.status !== 'DONE' && p.date <= localIso(new Date()) && <Button variant="secondary" icon={Check} onClick={() => act.mutate({ fn: () => setSessionStatus(p.id, 'DONE'), done: () => t('events.ptm.held') })}>{t('events.ptm.markHeld')}</Button>}
        <Button variant="secondary" icon={Pencil} onClick={() => onEdit(p)}>{t('events.edit')}</Button>
        <Button variant="ghost" icon={Download} onClick={() => exportSession(p.id).catch((e) => showError(e.message))}>{t('events.ptm.export')}</Button>
        {!booked && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: t('events.ptm.deleteConfirm', { title: p.title }), confirmLabel: t('events.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteSession(p.id), done: () => t('events.ptm.deleted'), close: true }) }}>{t('events.delete')}</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <StatusPill tone={PTM_STATUS[p.status]?.tone}>{L.ptm(p.status)}</StatusPill>
          <span>{t('events.ptm.summary', { booked, invited: p.invited, teachers: p.hosts.length })}</span>
          {p.status === 'OPEN' && <span>{t('events.ptm.bookUntil', { date: date(p.lastBookingDay) })}</span>}
        </div>
        {!p.hosts.length && <Note tone="warning">{t('events.ptm.noHosts')}</Note>}
        <div className="grid md:grid-cols-2 gap-3 items-start">
          {p.hosts.map((h) => {
            const g = p.grid.find((x) => x.hostId === h.id)
            return (
              <Panel key={h.id} title={h.name} subtitle={[h.role, p.mode === 'ONLINE' ? L.mode('ONLINE') : h.room, (p.hostSections[h.id] ?? []).join(', ')].filter(Boolean).join(' · ')} icon={p.mode === 'ONLINE' ? Video : undefined} flush>
                <div className="divide-y divide-border">
                  {g.slots.map((s) => <SlotRow key={s.time} slot={s} canManage={canEdit} onBook={canEdit && p.status !== 'DONE' ? (time) => setBooking({ host: h, time }) : null} onMark={actions.mark} onNote={actions.note} onCancel={actions.cancel} />)}
                </div>
              </Panel>
            )
          })}
        </div>
      </div>
      {booking && <BookModal session={p} host={booking.host} time={booking.time} onClose={() => setBooking(null)} onDone={() => { setBooking(null); refresh(); showSuccess(t('events.ptm.booked')) }} />}
    </Drawer>
  )
}

function Sessions({ onOpen }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const { date } = useFormat()
  const [when, setWhen] = useState('UPCOMING')
  const { data = [], isLoading } = useQuery({ queryKey: ['events', 'ptm', 'list', when], queryFn: () => fetchSessions(when) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={when} onChange={setWhen} options={[{ value: 'UPCOMING', label: t('events.list.UPCOMING') }, { value: 'PAST', label: t('events.list.PAST') }]} />
      {isLoading ? <div className="h-32 rounded-xl bg-black/[0.04] animate-pulse" /> : !data.length ? <Note>{t('events.ptm.empty')}</Note> : (
        <div className="grid md:grid-cols-2 gap-3">
          {data.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="rounded-xl border border-border bg-surface p-4 text-left hover:border-brand-300">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{p.title}</p>
                  <p className="text-xs text-ink-muted">{date(p.date)} · {p.startTime}–{p.endTime} · {L.mode(p.mode)}</p>
                </div>
                <StatusPill tone={PTM_STATUS[p.status]?.tone}>{L.ptm(p.status)}</StatusPill>
              </div>
              {p.capacity > 0 && <LevelBar bare value={p.booked} max={p.capacity} width="w-full" className="mt-3" />}
              <p className="mt-2 text-xs text-ink-faint">{t('events.ptm.cardLine', { teachers: p.hosts.length, booked: p.booked, capacity: p.capacity, met: p.met })}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Mine() {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { data = [], isLoading } = useQuery({ queryKey: ['events', 'ptm', 'mine'], queryFn: fetchMyMeetings })
  const actions = useBookingActions(() => qc.invalidateQueries({ queryKey: ['events', 'ptm'] }))
  if (isLoading) return <div className="h-32 rounded-xl bg-black/[0.04] animate-pulse" />
  if (!data.length) return <Note>{t('events.ptm.mineEmpty')}</Note>
  return (
    <div className="space-y-3">
      {data.map((m) => (
        <Panel key={m.id} title={m.title} subtitle={`${date(m.date)} · ${m.startTime}–${m.endTime}`} actions={m.mode === 'ONLINE' && m.room ? <a href={m.room} target="_blank" rel="noreferrer"><Button size="sm" icon={Video}>{t('events.ptm.joinCall')}</Button></a> : m.room ? <span className="text-xs text-ink-muted">{m.room}</span> : null} flush>
          <div className="divide-y divide-border">
            {m.slots.filter((s) => s.booking).length === 0 ? <p className="px-4 py-3 text-sm text-ink-faint">{t('events.ptm.noneBooked')}</p>
              : m.slots.filter((s) => s.booking).map((s) => <SlotRow key={s.time} slot={s} canManage onMark={actions.mark} onNote={actions.note} />)}
          </div>
        </Panel>
      ))}
    </div>
  )
}

/** Events › Parent–teacher meetings: set up a meeting, open booking, see the slots; a teacher's own meetings. */
export default function Ptm() {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [tab, setTab] = useState(hasPermission('events.ptm.create') || hasPermission('events.ptm.edit') ? 'ALL' : 'MINE')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  return (
    <PageContainer>
      <PageHeader icon={CalendarClock} title={t('events.ptm.title')} subtitle={t('events.ptm.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="events.ptm.create" onClick={() => setEditing('new')}>{t('events.ptm.new')}</HeaderButton>} />
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ALL', label: t('events.ptm.tabAll') }, { value: 'MINE', label: t('events.ptm.tabMine') }]} />
        {tab === 'ALL' ? <Sessions onOpen={setOpen} /> : <Mine />}
      </div>
      {open && <SessionDrawer id={open} onClose={() => setOpen(null)} onEdit={(p) => { setOpen(null); setEditing(p) }} />}
      {editing && <SessionForm session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); qc.invalidateQueries({ queryKey: ['events'] }); showSuccess(t('events.ptm.form.saved')); setOpen(p.id) }} />}
    </PageContainer>
  )
}
