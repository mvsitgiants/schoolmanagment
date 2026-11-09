import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { BLOCK_KINDS, ROOM_TYPES } from '@schoolgiant/shared'
import { FormField, Input, Modal, Select, Textarea, useConfirm } from '../system'
import Button from '../ui/Button'
import { addHostelRooms, deleteHostelBlock, deleteHostelRoom, fetchHostelStaff, saveHostelBlock, saveHostelRoom } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useHostelLabels } from './HostelKit'

const rupees = (paise) => (paise == null ? '' : String(paise / 100))
const paise = (r) => (r === '' || r == null ? null : Math.round(Number(r) * 100))
const bedsOf = (type) => ROOM_TYPES.find((r) => r.value === type)?.beds ?? 2

/** Add or change a block: name, code, boys / girls / staff, floors, the warden. */
export function BlockModal({ block, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const confirm = useConfirm()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    name: block?.name ?? '', code: block?.code ?? '', kind: block?.kind ?? 'BOYS', floors: block?.floors ?? 1, notes: block?.notes ?? '',
    warden: { name: block?.warden?.name ?? '', mobile: block?.warden?.mobile ?? '', userId: block?.warden?.userId ?? '' },
  })
  const [errors, setErrors] = useState({})
  const { data: staff = [] } = useQuery({ queryKey: ['hostel', 'staff'], queryFn: fetchHostelStaff })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setW = (k) => (e) => setForm((f) => ({ ...f, warden: { ...f.warden, [k]: e.target.value } }))
  const pickStaff = (e) => {
    const u = staff.find((s) => s.id === e.target.value)
    setForm((f) => ({ ...f, warden: { ...f.warden, userId: e.target.value, name: u?.name ?? f.warden.name } }))
  }
  const save = useMutation({ mutationFn: () => saveHostelBlock(block?.id, { ...form, floors: Number(form.floors) || 1 }), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  const remove = useMutation({ mutationFn: () => deleteHostelBlock(block.id), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={block ? t('hostel.block.editTitle', { name: block.name }) : t('hostel.block.newTitle')} footer={<>
      {block && hasPermission('hostel.rooms.delete') && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" loading={remove.isPending}
        onClick={async () => { if (await confirm({ title: t('hostel.block.deleteConfirm', { name: block.name }), message: t('hostel.block.deleteHint'), confirmLabel: t('actions.delete'), tone: 'danger' })) remove.mutate() }}>{t('actions.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('hostel.block.name')} required error={errors.name} className="sm:col-span-2"><Input value={form.name} onChange={set('name')} placeholder={t('hostel.block.namePlaceholder')} /></FormField>
          <FormField label={t('hostel.block.code')} hint={t('hostel.block.codeHint')}><Input value={form.code} maxLength={10} onChange={set('code')} /></FormField>
          <FormField label={t('hostel.block.kind')}><Select value={form.kind} onChange={set('kind')}>{BLOCK_KINDS.map((k) => <option key={k.value} value={k.value}>{L.kind(k.value)}</option>)}</Select></FormField>
          <FormField label={t('hostel.block.floors')}><Input type="number" min={1} max={40} value={form.floors} onChange={set('floors')} /></FormField>
        </div>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hostel.block.warden')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('hostel.block.wardenLogin')} hint={t('hostel.block.wardenLoginHint')}>
            <Select value={form.warden.userId ?? ''} onChange={pickStaff}>
              <option value="">{t('hostel.block.noLogin')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{[s.name, s.designation].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hostel.block.wardenName')}><Input value={form.warden.name} onChange={setW('name')} /></FormField>
          <FormField label={t('hostel.block.wardenMobile')}><Input type="tel" value={form.warden.mobile} onChange={setW('mobile')} /></FormField>
        </div>
        <FormField label={t('hostel.block.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
      </div>
    </Modal>
  )
}

/** Add or change one room: block, floor, number, type, AC, beds, yearly fee. */
export function RoomModal({ room, blocks, blockId, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const confirm = useConfirm()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    blockId: room?.blockId ?? blockId ?? blocks[0]?.id ?? '', floor: room?.floor ?? 0, number: room?.number ?? '', type: room?.type ?? 'DOUBLE',
    ac: room?.ac ?? false, capacity: room?.beds?.length ?? 2, fee: rupees(room?.fee), notes: room?.notes ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'type' && !room && { capacity: bedsOf(e.target.value) }) }))
  const save = useMutation({
    mutationFn: () => saveHostelRoom(room?.id, { ...form, floor: Number(form.floor) || 0, capacity: Number(form.capacity) || 1, fee: paise(form.fee) }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const remove = useMutation({ mutationFn: () => deleteHostelRoom(room.id), onSuccess: onSaved, onError: (e) => showError(e.message) })
  const block = blocks.find((b) => b.id === form.blockId)
  return (
    <Modal open onClose={onClose} title={room ? t('hostel.room.editTitle', { number: room.number }) : t('hostel.room.newTitle')} footer={<>
      {room && hasPermission('hostel.rooms.delete') && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" loading={remove.isPending}
        onClick={async () => { if (await confirm({ title: t('hostel.room.deleteConfirm', { number: room.number }), confirmLabel: t('actions.delete'), tone: 'danger' })) remove.mutate() }}>{t('actions.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.blockId || !form.number.trim()} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('hostel.room.block')} required error={errors.blockId}>
          <Select value={form.blockId} onChange={set('blockId')} disabled={!!room}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </FormField>
        <FormField label={t('hostel.room.floor')}>
          <Select value={String(form.floor)} onChange={set('floor')}>
            {Array.from({ length: Math.max(1, block?.floors ?? 1) }, (_, i) => <option key={i} value={String(i)}>{L.floor(i)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('hostel.room.number')} required error={errors.number}><Input value={form.number} onChange={set('number')} placeholder="101" /></FormField>
        <FormField label={t('hostel.room.type')}><Select value={form.type} onChange={set('type')}>{ROOM_TYPES.map((r) => <option key={r.value} value={r.value}>{L.roomType(r.value)}</option>)}</Select></FormField>
        <FormField label={t('hostel.room.beds')} hint={room ? t('hostel.room.bedsHint') : undefined}><Input type="number" min={1} max={40} value={form.capacity} onChange={set('capacity')} /></FormField>
        <FormField label={t('hostel.room.fee')} hint={t('hostel.room.feeHint')}><Input type="number" min={0} value={form.fee} onChange={set('fee')} /></FormField>
        <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={form.ac} onChange={(e) => setForm((f) => ({ ...f, ac: e.target.checked }))} className="rounded border-border text-brand-500" />{t('hostel.room.ac')}
        </label>
        <FormField label={t('hostel.room.notes')} className="sm:col-span-2"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
      </div>
    </Modal>
  )
}

/** Add a run of rooms on one floor (101–110), all alike. */
export function BulkRoomsModal({ blocks, blockId, onClose, onSaved }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ blockId: blockId || blocks[0]?.id || '', floor: 1, from: 101, to: 110, prefix: '', type: 'DOUBLE', capacity: 2, ac: false, fee: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'type' && { capacity: bedsOf(e.target.value) }), ...(k === 'floor' && { from: Number(e.target.value) * 100 + 1, to: Number(e.target.value) * 100 + 10 }) }))
  const block = blocks.find((b) => b.id === form.blockId)
  const n = Math.max(0, Number(form.to) - Number(form.from) + 1)
  const save = useMutation({
    mutationFn: () => addHostelRooms({ ...form, floor: Number(form.floor), from: Number(form.from), to: Number(form.to), capacity: Number(form.capacity), fee: paise(form.fee) }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('hostel.bulk.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.blockId || n < 1} onClick={() => save.mutate()}>{t('hostel.bulk.add', { count: n })}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('hostel.room.block')} required><Select value={form.blockId} onChange={set('blockId')}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
        <FormField label={t('hostel.room.floor')}>
          <Select value={String(form.floor)} onChange={set('floor')}>{Array.from({ length: Math.max(1, block?.floors ?? 1) }, (_, i) => <option key={i} value={String(i)}>{L.floor(i)}</option>)}</Select>
        </FormField>
        <FormField label={t('hostel.bulk.from')} error={errors.from}><Input type="number" min={0} value={form.from} onChange={set('from')} /></FormField>
        <FormField label={t('hostel.bulk.to')} error={errors.to}><Input type="number" min={0} value={form.to} onChange={set('to')} /></FormField>
        <FormField label={t('hostel.bulk.prefix')} hint={t('hostel.bulk.prefixHint')}><Input value={form.prefix} maxLength={6} onChange={set('prefix')} /></FormField>
        <FormField label={t('hostel.room.type')}><Select value={form.type} onChange={set('type')}>{ROOM_TYPES.map((r) => <option key={r.value} value={r.value}>{L.roomType(r.value)}</option>)}</Select></FormField>
        <FormField label={t('hostel.room.beds')}><Input type="number" min={1} max={40} value={form.capacity} onChange={set('capacity')} /></FormField>
        <FormField label={t('hostel.room.fee')} hint={t('hostel.room.feeHint')}><Input type="number" min={0} value={form.fee} onChange={set('fee')} /></FormField>
        <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={form.ac} onChange={(e) => setForm((f) => ({ ...f, ac: e.target.checked }))} className="rounded border-border text-brand-500" />{t('hostel.room.ac')}
        </label>
        <p className="text-xs text-ink-muted sm:col-span-2">{t('hostel.bulk.preview', { first: `${form.prefix}${form.from}`, last: `${form.prefix}${form.to}`, count: n, beds: n * (Number(form.capacity) || 0) })}</p>
      </div>
    </Modal>
  )
}
