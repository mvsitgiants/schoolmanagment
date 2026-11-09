import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Armchair, Bike, Bus, BusFront, CarFront, Copy, FileWarning, Pencil, Plus, Radio, Route as RouteIcon, Trash2 } from 'lucide-react'
import { VEHICLE_DOCS, VEHICLE_STATUS, VEHICLE_TYPES } from '@schoolgiant/shared'
import { CodeBadge, ColorChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, PersonCell, PhoneLink, Select, StatCardRow, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteVehicle, fetchGpsHook, fetchStaffLogins, fetchVehicles, saveVehicle } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { DocStatePill, VehicleStatusPill, useTransportLabels } from '../../components/transport/TransportKit'

// each vehicle type's icon in the fleet table
const TYPE_ICON = { BUS: Bus, MINI_BUS: BusFront, VAN: BusFront, CAR: CarFront, AUTO: Bike }
const blankPerson = { name: '', mobile: '', licenceNo: '', licenceExpiry: '', userId: '' }
const personOf = (p) => ({ ...blankPerson, ...Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, v ?? ''])) })

function PersonFields({ value, onChange, logins, licence }) {
  const { t } = useTranslation('transport')
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <FormField label={t('transport.vehicles.personName')}><Input value={value.name} onChange={set('name')} /></FormField>
      <FormField label={t('transport.vehicles.mobile')}><Input type="tel" value={value.mobile} onChange={set('mobile')} /></FormField>
      {licence && <FormField label={t('transport.vehicles.licenceNo')}><Input value={value.licenceNo} onChange={set('licenceNo')} /></FormField>}
      {licence && <FormField label={t('transport.vehicles.licenceExpiry')}><Input type="date" value={value.licenceExpiry} onChange={set('licenceExpiry')} /></FormField>}
      <FormField label={t('transport.vehicles.login')} hint={t('transport.vehicles.loginHint')} className="sm:col-span-2">
        <Select value={value.userId} onChange={set('userId')}>
          <option value="">{t('transport.vehicles.noLogin')}</option>
          {logins.map((u) => <option key={u.id} value={u.id}>{u.designation ? `${u.name} · ${u.designation}` : u.name}</option>)}
        </Select>
      </FormField>
    </div>
  )
}

function VehicleForm({ vehicle, onClose, onSaved }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const { showError } = useSnackbar()
  const { data: logins = [] } = useQuery({ queryKey: ['transport', 'staff'], queryFn: fetchStaffLogins })
  const [form, setForm] = useState({
    regNo: vehicle?.regNo ?? '', type: vehicle?.type ?? 'BUS', capacity: vehicle?.capacity ?? 40, make: vehicle?.make ?? '', status: vehicle?.status ?? 'ACTIVE',
    gpsDeviceId: vehicle?.gpsDeviceId ?? '', notes: vehicle?.notes ?? '', driver: personOf(vehicle?.driver), attendant: personOf(vehicle?.attendant),
    docs: Object.fromEntries(VEHICLE_DOCS.map((d) => { const x = vehicle?.docs?.find((r) => r.kind === d.value); return [d.value, { number: x?.number ?? '', expiry: x?.expiry ?? '' }] })),
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setDoc = (kind, k) => (e) => setForm((f) => ({ ...f, docs: { ...f.docs, [kind]: { ...f.docs[kind], [k]: e.target.value } } }))
  const person = (p) => ({ ...p, userId: p.userId || null })
  const save = useMutation({
    mutationFn: () => saveVehicle(vehicle?.id, {
      ...form, capacity: Number(form.capacity), driver: person(form.driver), attendant: person(form.attendant),
      docs: Object.entries(form.docs).filter(([, d]) => d.number || d.expiry).map(([kind, d]) => ({ kind, ...d })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={vehicle ? t('transport.vehicles.editTitle', { reg: vehicle.regNo }) : t('transport.vehicles.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.regNo.trim().length < 4} onClick={() => save.mutate()}>{t('transport.vehicles.save')}</Button>
    </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label={t('transport.vehicles.regNo')} required error={errors.regNo}><Input value={form.regNo} onChange={set('regNo')} placeholder={t('transport.vehicles.regNoPlaceholder')} /></FormField>
          <FormField label={t('transport.vehicles.type')}><Select value={form.type} onChange={set('type')}>{VEHICLE_TYPES.map((x) => <option key={x.value} value={x.value}>{L.type(x.value)}</option>)}</Select></FormField>
          <FormField label={t('transport.vehicles.capacity')}><Input type="number" min="1" max="120" value={form.capacity} onChange={set('capacity')} /></FormField>
          <FormField label={t('transport.vehicles.make')}><Input value={form.make} onChange={set('make')} /></FormField>
          <FormField label={t('transport.vehicles.status')}><Select value={form.status} onChange={set('status')}>{Object.keys(VEHICLE_STATUS).map((s) => <option key={s} value={s}>{L.status(s)}</option>)}</Select></FormField>
          <FormField label={t('transport.vehicles.gpsDevice')} hint={t('transport.vehicles.gpsDeviceHint')} error={errors.gpsDeviceId}><Input value={form.gpsDeviceId} onChange={set('gpsDeviceId')} /></FormField>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('transport.vehicles.papers')}</p>
          <div className="divide-y divide-border rounded-xl border border-border">
            {VEHICLE_DOCS.map((d) => (
              <div key={d.value} className="grid sm:grid-cols-[1fr_180px_160px] gap-2 items-center px-3 py-2">
                <span className="text-sm text-ink">{L.doc(d.value)}</span>
                <Input value={form.docs[d.value].number} onChange={setDoc(d.value, 'number')} placeholder={t('transport.vehicles.docNumber')} aria-label={t('transport.vehicles.docNumber')} />
                <Input type="date" value={form.docs[d.value].expiry} onChange={setDoc(d.value, 'expiry')} aria-label={t('transport.vehicles.docExpiry')} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('transport.vehicles.driver')}</p>
          <PersonFields value={form.driver} onChange={(driver) => setForm((f) => ({ ...f, driver }))} logins={logins} licence />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink mb-2">{t('transport.vehicles.attendant')}</p>
          <PersonFields value={form.attendant} onChange={(attendant) => setForm((f) => ({ ...f, attendant }))} logins={logins} />
        </div>
        <FormField label={t('transport.vehicles.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
      </div>
    </Modal>
  )
}

function GpsPanel() {
  const { t } = useTranslation('transport')
  const { showSuccess } = useSnackbar()
  const [show, setShow] = useState(false)
  const { data } = useQuery({ queryKey: ['transport', 'gps-hook'], queryFn: fetchGpsHook, enabled: show })
  return (
    <Panel title={t('transport.vehicles.gpsTitle')}>
      <p className="text-sm text-ink-muted">{t('transport.vehicles.gpsHint')}</p>
      {!show ? <Button className="mt-3" size="sm" variant="secondary" icon={Radio} onClick={() => setShow(true)}>{t('transport.vehicles.gpsShow')}</Button> : data && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded-lg bg-black/[0.04] px-3 py-2 text-xs">{data.url}</code>
          <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard?.writeText(data.url).then(() => showSuccess(t('transport.vehicles.copied')))}>{t('transport.vehicles.copy')}</Button>
          <p className="w-full text-xs text-ink-faint">{t('transport.vehicles.gpsFormats')}</p>
        </div>
      )}
    </Panel>
  )
}

/** Transport › Vehicles & drivers: the fleet, each vehicle's papers and their expiry, the driver and attendant. */
export default function Vehicles() {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['transport', 'vehicles'], queryFn: fetchVehicles })
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] })
  const remove = useMutation({ mutationFn: deleteVehicle, onSuccess: () => { refresh(); showSuccess(t('transport.vehicles.deleted')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('transport.vehicles.edit')
  const expiring = rows.filter((v) => v.docsState === 'EXPIRED' || v.docsState === 'DUE')
  return (
    <PageContainer>
      <PageHeader icon={Bus} title={t('transport.vehicles.title')} subtitle={t('transport.vehicles.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="transport.vehicles.create" onClick={() => setEditing('new')}>{t('transport.vehicles.new')}</HeaderButton>} />
      <div className="space-y-4">
        <StatCardRow items={[
          { icon: Bus, tone: 'brand', label: t('transport.vehicles.onRoad'), value: rows.filter((v) => v.status === 'ACTIVE').length },
          { icon: Armchair, tone: 'violet', label: t('transport.vehicles.seats'), value: rows.filter((v) => v.status === 'ACTIVE').reduce((n, v) => n + (v.capacity ?? 0), 0) },
          { icon: FileWarning, label: t('transport.vehicles.papersDue'), value: expiring.length, tone: expiring.length ? 'warning' : 'neutral' },
          { icon: Radio, tone: 'sky', label: t('transport.vehicles.withGps'), value: rows.filter((v) => v.gpsDeviceId).length },
        ]} />
        {expiring.length > 0 && <Note tone="warning">{t('transport.vehicles.dueNote', { list: expiring.map((v) => v.regNo).join(', ') })}</Note>}
        <DataTable rows={rows} loading={isLoading} columns={[
          { key: 'regNo', header: t('transport.vehicles.regNo'), mobilePrimary: true, render: (v, r) => (
            <span className="flex flex-col items-start gap-1">
              <CodeBadge>{v}</CodeBadge>
              <ColorChip label={L.type(r.type)} seed={`vehicle-${r.type}`} icon={TYPE_ICON[r.type] ?? Bus} sub={[t('transport.vehicles.seatsN', { count: r.capacity }), r.make].filter(Boolean).join(' · ')} />
            </span>
          ) },
          { key: 'driver', header: t('transport.vehicles.driver'), render: (v) => (v?.name ? <PersonCell name={v.name} sub={v.mobile ? <PhoneLink number={v.mobile} /> : undefined} size={28} /> : '—') },
          { key: 'routes', header: t('transport.vehicles.routes'), mobileHidden: true, render: (v) => (v?.length ? <span className="flex flex-wrap gap-1">{v.map((r) => <ColorChip key={r.id} label={r.name} seed={r.id} icon={RouteIcon} />)}</span> : <span className="text-ink-faint">{t('transport.vehicles.noRoute')}</span>) },
          { key: 'docsState', header: t('transport.vehicles.papers'), render: (v, r) => <span className="flex flex-col items-start gap-0.5"><DocStatePill state={v} />{r.docs.filter((d) => d.state === 'EXPIRED' || d.state === 'DUE').slice(0, 2).map((d) => <span key={d.kind} className="text-[11px] text-ink-faint">{L.doc(d.kind)} · {date(d.expiry)}</span>)}</span> },
          { key: 'lastPosition', header: t('transport.vehicles.lastSeen'), mobileHidden: true, render: (v, r) => (v?.at ? (r.map ? <a href={r.map} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}><DateCell value={v.at} time /></a> : <DateCell value={v.at} time />) : '—') },
          { key: 'status', header: t('transport.vehicles.status'), render: (v) => <VehicleStatusPill status={v} /> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1">
              {canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('transport.edit')} onClick={(e) => { e.stopPropagation(); setEditing(r) }} />}
              {hasPermission('transport.vehicles.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('transport.delete')}
                onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('transport.vehicles.deleteConfirm', { reg: r.regNo }), confirmLabel: t('transport.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
            </div>
          ) },
        ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} emptyTitle={t('transport.vehicles.empty')} />
        {(canEdit || hasPermission('transport.vehicles.create')) && <GpsPanel />}
      </div>
      {editing && <VehicleForm vehicle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('transport.vehicles.saved')) }} />}
    </PageContainer>
  )
}
