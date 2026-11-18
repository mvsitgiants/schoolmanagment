import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Ban, CalendarClock, Car, CarFront, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { PARKING_OWNERS, PARKING_VEHICLE_KINDS, areaTakes } from '@schoolgiant/shared'
import {
  DataTable, DateInput, Drawer, EmptyState, FactGrid, FormField, Input, Modal, Note, PageContainer, PageHeader, SearchInput, SegmentedControl, Select,
  StatCardRow, StatusPill, Textarea, useConfirm, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { KindIcon, PeoplePicker, Plate, STATE_TONE, printParkingStickers, useParkingLabels, useStay } from '../../components/parking/ParkingKit'
import {
  deleteVehicle, fetchAllVehicles, fetchParkingAreas, fetchVehicle, fetchVehicles, renewVehicle, revokeVehicle, saveVehicle,
} from '../../api/parking'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
const fieldErrors = (e) => e?.response?.data?.details?.fields ?? {}

const blank = { ownerKind: 'STAFF', person: null, ownerName: '', ownerMobile: '', relation: '', plate: '', kind: 'TWO_WHEELER', model: '', colour: '', licenceNo: '', areaId: '', validTo: '', note: '' }
const fromVehicle = (v) => ({
  ownerKind: v.ownerKind,
  person: v.ownerKind === 'STAFF' ? { id: v.employeeId, name: v.ownerName } : { id: v.studentId, name: v.studentName, sub: v.classLabel },
  ownerName: v.ownerKind === 'GUARDIAN' ? v.ownerName : '', ownerMobile: v.ownerMobile ?? '', relation: v.relation ?? '',
  plate: v.plate, kind: v.kind, model: v.model ?? '', colour: v.colour ?? '', licenceNo: v.licenceNo ?? '', areaId: v.areaId ?? '', validTo: v.validTo ?? '', note: v.note ?? '',
})

/** Give a pass, or change one: whose (staff / student / a student's parent), the vehicle, and where it parks. */
function VehicleForm({ vehicle, onClose, onSaved }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const { showError } = useSnackbar()
  const [f, setF] = useState(() => (vehicle ? fromVehicle(vehicle) : blank))
  const [errors, setErrors] = useState({})
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const { data: areas = [] } = useQuery({ queryKey: ['parking', 'areas'], queryFn: () => fetchParkingAreas() })
  const fits = areas.filter((a) => areaTakes(a, f.ownerKind, f.kind))
  const save = useMutation({
    mutationFn: () => saveVehicle(vehicle?.id, {
      ownerKind: f.ownerKind, employeeId: f.ownerKind === 'STAFF' ? f.person?.id : '', studentId: f.ownerKind !== 'STAFF' ? f.person?.id : '',
      ownerName: f.ownerName, ownerMobile: f.ownerMobile, relation: f.relation, plate: f.plate, kind: f.kind, model: f.model, colour: f.colour,
      licenceNo: f.licenceNo, areaId: fits.some((a) => a.id === f.areaId) ? f.areaId : '', validTo: vehicle ? f.validTo : '', note: f.note,
    }),
    onSuccess: (v) => onSaved(v),
    onError: (e) => { setErrors(fieldErrors(e)); showError(e.message) },
  })
  const motor = PARKING_VEHICLE_KINDS.find((k) => k.value === f.kind)?.motor
  return (
    <Modal open onClose={onClose} size="lg" title={vehicle ? t('parking.form.editTitle', { plate: vehicle.plate }) : t('parking.form.newTitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('parking.common.cancel')}</Button><Button loading={save.isPending} disabled={!f.person || !f.plate.trim()} onClick={() => save.mutate()}>{vehicle ? t('parking.common.save') : t('parking.form.give')}</Button></>}>
      <div className="space-y-4">
        <FormField label={t('parking.form.whose')}>
          <SegmentedControl value={f.ownerKind} onChange={(ownerKind) => set({ ownerKind, person: null, ownerName: '', relation: '', ownerMobile: '' })}
            options={PARKING_OWNERS.map((o) => ({ value: o.value, label: L.owner(o.value) }))} />
        </FormField>
        <FormField label={f.ownerKind === 'STAFF' ? t('parking.form.staff') : f.ownerKind === 'STUDENT' ? t('parking.form.student') : t('parking.form.child')} required error={errors.employeeId || errors.studentId}>
          <PeoplePicker kind={f.ownerKind === 'STAFF' ? 'STAFF' : 'STUDENT'} value={f.person} onChange={(person) => set({ person })} autoFocus={!vehicle} />
        </FormField>
        {f.ownerKind === 'GUARDIAN' && (
          <>
            {!!f.person?.guardians?.length && (
              <div className="flex flex-wrap gap-2">
                {f.person.guardians.map((g) => (
                  <Button key={`${g.name}${g.mobile}`} size="sm" variant="secondary" onClick={() => set({ ownerName: g.name, relation: g.relation ?? '', ownerMobile: g.mobile ?? '' })}>{g.name}{g.relation ? ` · ${g.relation}` : ''}</Button>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label={t('parking.form.parentName')} required error={errors.ownerName}><Input value={f.ownerName} onChange={(e) => set({ ownerName: e.target.value })} /></FormField>
              <FormField label={t('parking.form.relation')}><Input value={f.relation} onChange={(e) => set({ relation: e.target.value })} /></FormField>
              <FormField label={t('parking.form.mobile')} error={errors.ownerMobile}><Input inputMode="tel" value={f.ownerMobile} onChange={(e) => set({ ownerMobile: e.target.value })} /></FormField>
            </div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('parking.form.plate')} required error={errors.plate} hint={t('parking.form.plateHint')}>
            <Input value={f.plate} onChange={(e) => set({ plate: e.target.value.toUpperCase() })} className="font-mono uppercase tracking-wider" data-typein="off" autoComplete="off" />
          </FormField>
          <FormField label={t('parking.form.kind')} error={errors.kind}>
            <SegmentedControl value={f.kind} onChange={(kind) => set({ kind })} options={PARKING_VEHICLE_KINDS.map((k) => ({ value: k.value, label: L.kind(k.value) }))} />
          </FormField>
          <FormField label={t('parking.form.model')}><Input value={f.model} onChange={(e) => set({ model: e.target.value })} placeholder={t('parking.form.modelHint')} /></FormField>
          <FormField label={t('parking.form.colour')}><Input value={f.colour} onChange={(e) => set({ colour: e.target.value })} /></FormField>
          <FormField label={t('parking.form.licence')} required={motor} error={errors.licenceNo} hint={motor ? t('parking.form.licenceHint') : undefined}>
            <Input value={f.licenceNo} onChange={(e) => set({ licenceNo: e.target.value.toUpperCase() })} className="font-mono" data-typein="off" />
          </FormField>
          <FormField label={t('parking.form.area')} error={errors.areaId} hint={!fits.length ? t('parking.form.noArea') : undefined}>
            <Select value={fits.some((a) => a.id === f.areaId) ? f.areaId : ''} onChange={(e) => set({ areaId: e.target.value })}>
              <option value="">{t('parking.form.anyArea')}</option>
              {fits.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </FormField>
          {f.ownerKind === 'STAFF' && <FormField label={t('parking.form.mobile')} error={errors.ownerMobile}><Input inputMode="tel" value={f.ownerMobile} onChange={(e) => set({ ownerMobile: e.target.value })} /></FormField>}
          {vehicle && <FormField label={t('parking.form.validTo')} error={errors.validTo}><DateInput value={f.validTo} onChange={(e) => set({ validTo: e.target.value })} /></FormField>}
        </div>
        <FormField label={t('parking.form.note')}><Textarea rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} /></FormField>
        {!vehicle && <Note tone="info">{t('parking.form.passNote')}</Note>}
      </div>
    </Modal>
  )
}

/** One pass: whose, the vehicle, valid till, its last trips through the gate — and renew, cancel, print. */
function VehicleDrawer({ id, onClose, onEdit, onChanged }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const { date, dateTime } = useFormat()
  const stay = useStay()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const user = useAuthUser()
  const { showError, showSuccess } = useSnackbar()
  const { data: v } = useQuery({ queryKey: ['parking', 'vehicle', id], queryFn: () => fetchVehicle(id), enabled: !!id })
  const run = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (r, { done }) => { onChanged(); showSuccess(done) },
    onError: (e) => showError(e.message),
  })
  const revoke = async () => {
    const reason = String(await prompt({ title: t('parking.pass.revokeTitle', { plate: v.plate }), label: t('parking.pass.revokeReason'), required: true }) ?? '').trim()
    if (reason) run.mutate({ fn: () => revokeVehicle(v.id, reason), done: t('parking.pass.revoked') })
  }
  const remove = async () => {
    if (await confirm({ title: t('parking.pass.deleteTitle', { plate: v.plate }), message: t('parking.pass.deleteHint'), tone: 'danger', confirmLabel: t('parking.common.delete') })) {
      run.mutate({ fn: () => deleteVehicle(v.id), done: t('parking.pass.deleted') }, { onSuccess: onClose })
    }
  }
  const live = v && v.state !== 'REVOKED'
  return (
    <Drawer open={!!id} onClose={onClose} title={v?.plate ?? ''} subtitle={v ? `${L.owner(v.ownerKind)} · ${v.passNo}` : ''}
      footer={v && <>
        {hasPermission('parking.vehicles.delete') && !v.visits?.length && <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" onClick={remove}>{t('parking.common.delete')}</Button>}
        {live && hasPermission('parking.vehicles.edit') && <Button variant="secondary" icon={Ban} onClick={revoke}>{t('parking.pass.revoke')}</Button>}
        {live && hasPermission('parking.vehicles.edit') && <Button variant="secondary" icon={CalendarClock} loading={run.isPending} onClick={() => run.mutate({ fn: () => renewVehicle(v.id), done: t('parking.pass.renewed') })}>{t('parking.pass.renew')}</Button>}
        {live && hasPermission('parking.vehicles.edit') && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(v)}>{t('parking.common.edit')}</Button>}
        {live && <Button icon={Printer} onClick={() => printParkingStickers([v], { t, institution: user?.tenant?.name, date })}>{t('parking.pass.sticker')}</Button>}
      </>}>
      {v && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Plate plate={v.plate} size="lg" />
            <StatusPill tone={STATE_TONE[v.state]}>{L.state(v.state)}</StatusPill>
            {v.inside && <StatusPill tone="info">{t('parking.pass.parkedNow')}</StatusPill>}
          </div>
          {v.state === 'EXPIRED' && <Note tone="warning">{t('parking.pass.expiredNote', { date: date(v.validTo) })}</Note>}
          {v.state === 'REVOKED' && <Note tone="neutral">{t('parking.pass.revokedNote', { reason: v.revokeReason ?? '', by: v.revokedBy ?? '' })}</Note>}
          <FactGrid cols={2} items={[
            { label: t('parking.pass.owner'), value: v.ownerName },
            { label: v.ownerKind === 'GUARDIAN' ? t('parking.pass.parentOf') : t('parking.pass.class'), value: v.ownerKind === 'GUARDIAN' ? [v.studentName, v.classLabel].filter(Boolean).join(' · ') : v.classLabel },
            { label: t('parking.form.mobile'), value: v.ownerMobile },
            { label: t('parking.form.relation'), value: v.relation },
            { label: t('parking.form.kind'), value: L.kind(v.kind) },
            { label: t('parking.form.model'), value: [v.model, v.colour].filter(Boolean).join(' · ') || null },
            { label: t('parking.form.licence'), value: v.licenceNo, mono: true },
            { label: t('parking.form.area'), value: v.areaName ?? t('parking.form.anyArea') },
            { label: t('parking.pass.valid'), value: `${date(v.validFrom)} – ${date(v.validTo)}` },
            { label: t('parking.pass.given'), value: [v.createdBy, dateTime(v.createdAt)].filter(Boolean).join(' · ') },
            { label: t('parking.form.note'), value: v.note, span: 'full', text: true },
          ]} />
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">{t('parking.pass.visits')}</p>
            {!v.visits?.length ? <p className="text-sm text-ink-muted">{t('parking.pass.noVisits')}</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {v.visits.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="tabular-nums text-ink">{dateTime(e.inAt)}</span>
                    <span className="text-ink-muted">{e.outAt ? t('parking.gate.stayed', { length: stay(e.minutes) }) : t('parking.gate.insideNow')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** Parking › Vehicles & passes: who may park, their passes and stickers. */
export default function ParkingVehicles() {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const qc = useQueryClient()
  const user = useAuthUser()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState('ACTIVE')
  const [ownerKind, setOwnerKind] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(null) // { vehicle } — null: closed; { vehicle: null }: a new pass
  const [open, setOpen] = useState(params.get('open'))
  useEffect(() => { if (params.get('open')) { setOpen(params.get('open')); setParams({}, { replace: true }) } }, [params, setParams])
  const q = useDebouncedValue(search.trim(), 300)
  const filter = { state, ownerKind, search: q }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['parking', 'vehicles', filter, page], queryFn: () => fetchVehicles({ ...filter, page, pageSize: PAGE }), placeholderData: (p) => p })
  const refresh = () => qc.invalidateQueries({ queryKey: ['parking'] })
  const paged = (set) => (v) => { set(v); setPage(1) }
  const c = data?.counts
  const pages = data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined
  const stickers = async () => {
    const rows = (await fetchAllVehicles({ ...filter, state: 'ACTIVE' }))
    if (rows.length) printParkingStickers(rows, { t, institution: user?.tenant?.name, date })
  }
  return (
    <PageContainer>
      <PageHeader icon={Car} title={t('parking.vehicles.title')} subtitle={t('parking.vehicles.subtitle')}
        actions={<>
          <Button variant="secondary" icon={Printer} disabled={!c?.ACTIVE} onClick={stickers}>{t('parking.vehicles.stickers')}</Button>
          {hasPermission('parking.vehicles.create') && <Button icon={Plus} onClick={() => setForm({ vehicle: null })}>{t('parking.vehicles.give')}</Button>}
        </>} />
      {error && <EmptyState error={error} onRetry={refetch} />}
      {c && <StatCardRow items={[
        { icon: Car, tone: 'success', label: t('parking.vehicles.statValid'), value: c.ACTIVE },
        { icon: CalendarClock, tone: c.EXPIRED ? 'warning' : 'neutral', label: t('parking.vehicles.statExpired'), value: c.EXPIRED, sub: c.EXPIRED ? t('parking.vehicles.statExpiredSub') : undefined },
        { icon: Ban, tone: 'neutral', label: t('parking.vehicles.statRevoked'), value: c.REVOKED },
      ]} />}
      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={state} onChange={paged(setState)} options={['ACTIVE', 'EXPIRED', 'REVOKED', ''].map((s) => ({ value: s, label: s ? L.state(s) : t('parking.common.all') }))} />
          <Select value={ownerKind} onChange={(e) => { setOwnerKind(e.target.value); setPage(1) }} className="w-44">
            <option value="">{t('parking.vehicles.everyone')}</option>
            {PARKING_OWNERS.map((o) => <option key={o.value} value={o.value}>{L.owner(o.value)}</option>)}
          </Select>
          <div className="w-full sm:w-72"><SearchInput value={search} onChange={paged(setSearch)} placeholder={t('parking.vehicles.search')} /></div>
        </div>
        <DataTable rows={data?.rows ?? []} loading={isLoading} onRowClick={(v) => setOpen(v.id)} pagination={pages} exportable={hasPermission('parking.vehicles.export')} exportName="parking-passes"
          exportAll={() => fetchAllVehicles(filter)} emptyIcon={CarFront} emptyTitle={t('parking.vehicles.empty')}
          columns={[
            { key: 'plate', header: t('parking.form.plate'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2"><KindIcon kind={r.kind} /><Plate plate={v} /></span> },
            { key: 'ownerName', header: t('parking.pass.owner'), render: (v, r) => <span><span className="block font-medium text-ink">{v}</span><span className="block text-xs text-ink-muted">{[L.owner(r.ownerKind), r.ownerKind === 'GUARDIAN' ? r.studentName : null, r.classLabel].filter(Boolean).join(' · ')}</span></span> },
            { key: 'model', header: t('parking.form.model'), mobileHidden: true, render: (v, r) => [v, r.colour].filter(Boolean).join(' · ') || '—' },
            { key: 'areaName', header: t('parking.form.area'), mobileHidden: true, render: (v) => v ?? '—' },
            { key: 'passNo', header: t('parking.pass.no'), mobileHidden: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
            { key: 'validTo', header: t('parking.pass.validTo'), render: (v, r) => <span className="flex items-center gap-2"><span className="tabular-nums">{date(v)}</span>{r.state !== 'ACTIVE' && <StatusPill tone={STATE_TONE[r.state]}>{L.state(r.state)}</StatusPill>}{r.inside && <StatusPill tone="info">{t('parking.pass.parkedNow')}</StatusPill>}</span> },
          ]} />
      </div>
      {form && <VehicleForm vehicle={form.vehicle} onClose={() => setForm(null)} onSaved={(v) => { setForm(null); refresh(); setOpen(v.id); showSuccess(form.vehicle ? t('parking.form.saved') : t('parking.form.given', { no: v.passNo })) }} />}
      <VehicleDrawer id={open} onClose={() => setOpen(null)} onEdit={(v) => setForm({ vehicle: v })} onChanged={refresh} />
    </PageContainer>
  )
}
