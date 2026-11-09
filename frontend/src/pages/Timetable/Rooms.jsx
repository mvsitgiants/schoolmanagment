import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BellRing, DoorOpen, FlaskConical, Library, Monitor, Pencil, Plus, School, Shapes, Star, Theater, Trash2, Trophy, X } from 'lucide-react'
import { DEFAULT_BELL, ROOM_KINDS, SLOT_KINDS, checkBell, teachingPeriods } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, StatusPill, Tabs, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { createBell, createRoom, deleteBell, deleteRoom, fetchBells, fetchRooms, updateBell, updateRoom } from '../../api/timetable'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// each room kind's icon in the rooms table
const KIND_ICON = { CLASSROOM: School, LAB: FlaskConical, COMPUTER: Monitor, HALL: Theater, LIBRARY: Library, GROUND: Trophy, OTHER: Shapes }
const kindLabel = (t, k) => t(`timetable.roomKinds.${k}`, ROOM_KINDS.find((x) => x.value === k)?.label ?? k)

function RoomForm({ room, onClose, onSaved }) {
  const { t } = useTranslation('timetable')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [form, setForm] = useState({ name: room?.name ?? '', code: room?.code ?? '', kind: room?.kind ?? 'CLASSROOM', capacity: room?.capacity ? String(room.capacity) : '', sectionId: room?.sectionId ?? '', active: room?.active !== false })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value }))
  const body = { ...form, capacity: form.capacity ? Number(form.capacity) : '', sectionId: form.kind === 'CLASSROOM' ? form.sectionId : '' }
  const save = useMutation({
    mutationFn: () => (room ? updateRoom(room.id, body) : createRoom(body)),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={room ? t('timetable.rooms.editTitle') : t('timetable.rooms.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{t('timetable.rooms.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('timetable.rooms.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('timetable.rooms.namePlaceholder')} /></FormField>
        <FormField label={t('timetable.rooms.code')} hint={t('timetable.rooms.codeHint')} error={errors.code}><Input value={form.code} onChange={set('code')} /></FormField>
        <FormField label={t('timetable.rooms.kind')}>
          <Select value={form.kind} onChange={set('kind')}>{ROOM_KINDS.map((k) => <option key={k.value} value={k.value}>{kindLabel(t, k.value)}</option>)}</Select>
        </FormField>
        <FormField label={t('timetable.rooms.capacity')} error={errors.capacity}><Input type="number" min="0" value={form.capacity} onChange={set('capacity')} /></FormField>
        {form.kind === 'CLASSROOM' && (
          <div className="col-span-2">
            <FormField label={t('timetable.rooms.homeOf')} hint={t('timetable.rooms.homeOfHint')} error={errors.sectionId}>
              <Select value={form.sectionId} onChange={set('sectionId')}>
                <option value="">{t('timetable.rooms.noSection')}</option>
                {(lookup?.sections ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </FormField>
          </div>
        )}
        {room && (
          <label className="col-span-2 inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
            {t('timetable.rooms.inUse')}
          </label>
        )}
      </div>
    </Modal>
  )
}

function RoomsTab() {
  const { t } = useTranslation('timetable')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['rooms'], queryFn: fetchRooms })
  const canEdit = hasPermission('timetable.rooms.edit')
  const canDelete = hasPermission('timetable.rooms.delete')
  const remove = useMutation({
    mutationFn: deleteRoom,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['rooms'] }); showSuccess(r.deactivated ? t('timetable.rooms.deactivated') : t('timetable.rooms.deleted')) },
    onError: (e) => showError(e.message),
  })
  const labs = rows.filter((r) => r.active && ['LAB', 'COMPUTER'].includes(r.kind)).length
  return (
    <>
      <div className="flex justify-end mb-3"><HeaderButton icon={Plus} variant="primary" requires="timetable.rooms.create" onClick={() => setEditing('new')}>{t('timetable.rooms.new')}</HeaderButton></div>
      {!isLoading && !labs && <Note className="mb-3">{t('timetable.rooms.noLabsHint')}</Note>}
      <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} columns={[
        { key: 'name', header: t('timetable.rooms.name'), mobilePrimary: true, render: (v, r) => <span className={r.active ? 'font-medium text-ink' : 'text-ink-faint line-through'}>{v}</span> },
        { key: 'code', header: t('timetable.rooms.code'), render: (v) => <CodeBadge>{v}</CodeBadge> },
        { key: 'kind', header: t('timetable.rooms.kind'), render: (v) => <ColorChip label={kindLabel(t, v)} seed={`room-${v}`} icon={KIND_ICON[v] ?? DoorOpen} /> },
        { key: 'capacity', header: t('timetable.rooms.capacity'), align: 'right', render: (v) => v ?? '—' },
        { key: 'section', header: t('timetable.rooms.homeOf'), render: (v) => <ColorChip label={v} /> },
        { key: 'active', header: t('timetable.rooms.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('timetable.rooms.inUse') : t('timetable.rooms.notInUse')}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 100, render: (_, r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('timetable.rooms.edit')} onClick={() => setEditing(r)} />}
            {canDelete && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('timetable.rooms.delete')}
              onClick={async () => { if (await confirm({ title: t('timetable.rooms.deleteConfirm', { name: r.name }), message: t('timetable.rooms.deleteHint'), confirmLabel: t('timetable.rooms.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} emptyIcon={DoorOpen} emptyTitle={t('timetable.rooms.empty')} />
      {editing && <RoomForm room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['rooms'] }); setEditing(null); showSuccess(t('timetable.rooms.saved')) }} />}
    </>
  )
}

/** A bell schedule: the day's periods and breaks, and which classes follow it. */
function BellForm({ bell, onClose, onSaved }) {
  const { t } = useTranslation('timetable')
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [name, setName] = useState(bell?.name ?? '')
  const [slots, setSlots] = useState(() => (bell?.slots ?? DEFAULT_BELL).map((s) => ({ ...s, label: s.label ?? '' })))
  const [isDefault, setIsDefault] = useState(!!bell?.isDefault)
  const [classIds, setClassIds] = useState(bell?.classIds ?? [])
  const [errors, setErrors] = useState({})
  const setSlot = (i, k, v) => setSlots((x) => x.map((s, j) => (j === i ? { ...s, [k]: v } : s)))
  const renumber = (list) => { let n = 0; return list.map((s) => (s.kind === 'PERIOD' ? { ...s, no: ++n } : { ...s, no: 0 })) }
  const addSlot = (kind) => setSlots((x) => renumber([...x, { kind, no: 0, label: '', start: x.at(-1)?.end ?? '08:00', end: '' }]))
  const live = checkBell(slots)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, isDefault, classIds, slots: slots.map((s) => ({ ...s, no: Number(s.no) || 0, label: s.label || '' })) }
      return bell ? updateBell(bell.id, body) : createBell(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const err = (i, k) => errors[`slots.${i}.${k}`] ?? live[`slots.${i}.${k}`]
  return (
    <Modal open onClose={onClose} size="xl" title={bell ? t('timetable.bells.editTitle') : t('timetable.bells.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={name.trim().length < 2 || Object.keys(live).length > 0} onClick={() => save.mutate()}>{t('timetable.bells.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('timetable.bells.name')} required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('timetable.bells.namePlaceholder')} /></FormField>
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] gap-2 items-start">
              <Select value={s.kind} onChange={(e) => setSlots((x) => renumber(x.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y))))} aria-label={t('timetable.bells.kind')}>
                {Object.keys(SLOT_KINDS).map((k) => <option key={k} value={k}>{t(`timetable.slotKinds.${k}`)}</option>)}
              </Select>
              {s.kind === 'PERIOD'
                ? <p className="text-sm text-ink h-9 flex items-center">{t('timetable.grid.period', { no: s.no })}</p>
                : <Input value={s.label} onChange={(e) => setSlot(i, 'label', e.target.value)} placeholder={t(`timetable.slotKinds.${s.kind}`)} aria-label={t('timetable.bells.label')} />}
              <FormField error={err(i, 'start')}><Input type="time" value={s.start} onChange={(e) => setSlot(i, 'start', e.target.value)} aria-label={t('timetable.bells.start')} /></FormField>
              <FormField error={err(i, 'end')}><Input type="time" value={s.end} onChange={(e) => setSlot(i, 'end', e.target.value)} aria-label={t('timetable.bells.end')} /></FormField>
              <Button size="sm" variant="ghost" icon={X} aria-label={t('timetable.bells.remove')} onClick={() => setSlots((x) => renumber(x.filter((_, j) => j !== i)))} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => addSlot('PERIOD')}>{t('timetable.bells.addPeriod')}</Button>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => addSlot('BREAK')}>{t('timetable.bells.addBreak')}</Button>
          </div>
          {live.slots && <Note tone="warning">{t('timetable.bells.needPeriod')}</Note>}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={isDefault} disabled={bell?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {t('timetable.bells.isDefault')}
        </label>
        {!isDefault && (
          <div>
            <p className="text-xs font-medium text-ink-muted mb-2">{t('timetable.bells.classes')}</p>
            <div className="flex flex-wrap gap-2">
              {(lookup?.classes ?? []).map((c) => (
                <label key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => setClassIds((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                  {c.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1">{t('timetable.bells.classesHint')}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function BellsTab() {
  const { t } = useTranslation('timetable')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: bells = [], isLoading } = useQuery({ queryKey: ['bells'], queryFn: fetchBells })
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const canEdit = hasPermission('timetable.timetable.edit')
  const className = new Map((lookup?.classes ?? []).map((c) => [c.id, c.name]))
  const remove = useMutation({ mutationFn: deleteBell, onSuccess: () => { qc.invalidateQueries({ queryKey: ['bells'] }); showSuccess(t('timetable.bells.deleted')) }, onError: (e) => showError(e.message) })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('timetable.loading')}</p>
  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><HeaderButton icon={Plus} variant="primary" onClick={() => setEditing('new')}>{t('timetable.bells.new')}</HeaderButton></div>}
      {bells.map((b) => (
        <Panel key={b.id} title={<span className="inline-flex items-center gap-2">{b.name}{b.isDefault && <StatusPill tone="brand"><Star className="h-3 w-3 inline" /> {t('timetable.bells.default')}</StatusPill>}</span>}
          subtitle={b.isDefault ? t('timetable.bells.forOthers') : b.classIds.map((c) => className.get(c)).filter(Boolean).join(', ') || t('timetable.bells.forNone')}
          actions={canEdit && <div className="flex gap-1">
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(b)}>{t('timetable.bells.edit')}</Button>
            {!b.isDefault && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('timetable.bells.delete')}
              onClick={async () => { if (await confirm({ title: t('timetable.bells.deleteConfirm', { name: b.name }), confirmLabel: t('timetable.bells.delete'), tone: 'danger' })) remove.mutate(b.id) }} />}
          </div>}>
          <div className="flex flex-wrap gap-1.5">
            {b.slots.map((s, i) => (
              <span key={i} className={`rounded-md px-2 py-1 text-xs ${s.kind === 'PERIOD' ? 'bg-brand-50 text-brand-700' : 'bg-bg text-ink-muted'}`}>
                {s.kind === 'PERIOD' ? t('timetable.grid.period', { no: s.no }) : s.label || t(`timetable.slotKinds.${s.kind}`)} <span className="font-mono-num opacity-70">{s.start}–{s.end}</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2">{t('timetable.bells.periodCount', { count: teachingPeriods(b.slots).length })}</p>
        </Panel>
      ))}
      {editing && <BellForm bell={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['bells'] }); setEditing(null); showSuccess(t('timetable.bells.saved')) }} />}
    </div>
  )
}

/** Rooms and bell schedules: what the timetable is built on. */
export default function Rooms() {
  const { t } = useTranslation('timetable')
  const [tab, setTab] = useState('rooms')
  return (
    <PageContainer>
      <PageHeader icon={tab === 'rooms' ? DoorOpen : BellRing} title={t('timetable.rooms.title')} subtitle={t('timetable.rooms.subtitle')} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'rooms', label: t('timetable.rooms.tab') }, { value: 'bells', label: t('timetable.bells.tab') }]} />
      {tab === 'rooms' ? <RoomsTab /> : <BellsTab />}
    </PageContainer>
  )
}
