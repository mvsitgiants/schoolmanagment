import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Crosshair, MapPinned, Pencil, Plus, Route as RouteIcon, Trash2, X } from 'lucide-react'
import { osmEmbed, toPaise, toRupees } from '@schoolgiant/shared'
import { DataTable, Drawer, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, Select, StatusPill, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteRoute, fetchRoutes, fetchVehicles, saveRoute } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { MapFrame, currentPosition } from '../../components/transport/TransportKit'

let seq = 0
const blankStop = () => ({ key: `n${++seq}`, id: '', name: '', lat: '', lng: '', pickupTime: '', dropTime: '', fee: '', landmark: '' })
const stopOf = (s) => ({ key: s.id, id: s.id, name: s.name, lat: s.lat ?? '', lng: s.lng ?? '', pickupTime: s.pickupTime ?? '', dropTime: s.dropTime ?? '', fee: s.fee != null ? String(toRupees(s.fee)) : '', landmark: s.landmark ?? '', students: s.students })
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

function RouteForm({ route, onClose, onSaved }) {
  const { t } = useTranslation('transport')
  const { showError } = useSnackbar()
  const { data: vehicles = [] } = useQuery({ queryKey: ['transport', 'vehicles'], queryFn: fetchVehicles })
  const [form, setForm] = useState({ name: route?.name ?? '', code: route?.code ?? '', vehicleId: route?.vehicleId ?? '', active: route?.active ?? true, notes: route?.notes ?? '' })
  const [stops, setStops] = useState(route?.stops?.length ? route.stops.map(stopOf) : [blankStop()])
  const [locating, setLocating] = useState(null)
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setStop = (i, k) => (e) => setStops((list) => list.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)))
  const move = (i, d) => setStops((list) => { const next = [...list]; [next[i], next[i + d]] = [next[i + d], next[i]]; return next })
  const here = async (i) => {
    setLocating(i)
    try { const p = await currentPosition(); setStops((list) => list.map((s, j) => (j === i ? { ...s, lat: String(p.lat), lng: String(p.lng) } : s))) } catch { showError(t('transport.routes.noLocation')) } finally { setLocating(null) }
  }
  const save = useMutation({
    mutationFn: () => saveRoute(route?.id, {
      ...form,
      stops: stops.filter((s) => s.name.trim()).map((s) => ({ id: s.id || undefined, name: s.name.trim(), lat: num(s.lat), lng: num(s.lng), pickupTime: s.pickupTime, dropTime: s.dropTime, fee: s.fee === '' ? null : toPaise(s.fee), landmark: s.landmark })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={route ? t('transport.routes.editTitle', { name: route.name }) : t('transport.routes.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>{t('transport.routes.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label={t('transport.routes.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('transport.routes.namePlaceholder')} /></FormField>
          <FormField label={t('transport.routes.code')}><Input value={form.code} onChange={set('code')} /></FormField>
          <FormField label={t('transport.routes.vehicle')} error={errors.vehicleId}>
            <Select value={form.vehicleId} onChange={set('vehicleId')}>
              <option value="">{t('transport.routes.noVehicle')}</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{t('transport.routes.vehicleOption', { reg: v.regNo, count: v.capacity })}</option>)}
            </Select>
          </FormField>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink">{t('transport.routes.stops')}</p>
            <p className="text-xs text-ink-faint">{t('transport.routes.stopsHint')}</p>
          </div>
          <div className="space-y-2">
            {stops.map((s, i) => (
              <div key={s.key} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 text-center text-xs font-semibold text-ink-muted">{i + 1}</span>
                  <Input className="flex-1" value={s.name} onChange={setStop(i, 'name')} placeholder={t('transport.routes.stopName')} aria-label={t('transport.routes.stopName')} />
                  <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} aria-label={t('transport.routes.up')} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === stops.length - 1} aria-label={t('transport.routes.down')} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="ghost" icon={X} disabled={s.students > 0} aria-label={t('transport.routes.removeStop')} onClick={() => setStops((list) => list.filter((_, j) => j !== i))} />
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-[110px_110px_auto_90px_90px_110px] gap-2 items-end sm:pl-8">
                  <FormField label={t('transport.routes.lat')}><Input inputMode="decimal" value={s.lat} onChange={setStop(i, 'lat')} /></FormField>
                  <FormField label={t('transport.routes.lng')}><Input inputMode="decimal" value={s.lng} onChange={setStop(i, 'lng')} /></FormField>
                  <Button size="sm" variant="secondary" icon={Crosshair} loading={locating === i} onClick={() => here(i)}>{t('transport.routes.here')}</Button>
                  <FormField label={t('transport.routes.pickup')}><Input type="time" value={s.pickupTime} onChange={setStop(i, 'pickupTime')} /></FormField>
                  <FormField label={t('transport.routes.drop')}><Input type="time" value={s.dropTime} onChange={setStop(i, 'dropTime')} /></FormField>
                  <FormField label={t('transport.routes.fee')}><Input type="number" min="0" value={s.fee} onChange={setStop(i, 'fee')} /></FormField>
                </div>
                <div className="mt-2 sm:pl-8"><Input value={s.landmark} onChange={setStop(i, 'landmark')} placeholder={t('transport.routes.landmark')} aria-label={t('transport.routes.landmark')} /></div>
                {s.students > 0 && <p className="mt-1 sm:pl-8 text-xs text-ink-faint">{t('transport.routes.stopStudents', { count: s.students })}</p>}
              </div>
            ))}
          </div>
          <Button className="mt-2" size="sm" variant="secondary" icon={Plus} onClick={() => setStops((list) => [...list, blankStop()])}>{t('transport.routes.addStop')}</Button>
        </div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
          <FormField label={t('transport.routes.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
          <label className="inline-flex items-center gap-2 text-sm text-ink sm:mt-7"><input type="checkbox" checked={form.active} onChange={set('active')} className="rounded border-border text-brand-500" />{t('transport.routes.active')}</label>
        </div>
      </div>
    </Modal>
  )
}

function RouteDrawer({ route, onClose, onEdit }) {
  const { t } = useTranslation('transport')
  const map = osmEmbed(route.stops.filter((s) => s.lat != null && s.lng != null))
  return (
    <Drawer open onClose={onClose} size="lg" title={route.name} subtitle={route.vehicle ? t('transport.routes.drawerSub', { reg: route.vehicle.regNo, count: route.students }) : t('transport.routes.studentsN', { count: route.students })}
      footer={hasPermission('transport.routes.edit') && <Button icon={Pencil} onClick={onEdit}>{t('transport.edit')}</Button>}>
      <div className="space-y-4">
        <MapFrame src={map} />
        <ol className="divide-y divide-border rounded-xl border border-border">
          {route.stops.map((s, i) => (
            <li key={s.id} className="flex items-start gap-3 px-3 py-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">{s.name}</p>
                <p className="text-xs text-ink-faint">{[s.pickupTime && t('transport.routes.pickupAt', { time: s.pickupTime }), s.dropTime && t('transport.routes.dropAt', { time: s.dropTime }), s.landmark].filter(Boolean).join(' · ')}</p>
                {s.lat == null && <p className="text-xs text-amber-700">{t('transport.routes.noPlace')}</p>}
              </div>
              <div className="text-right text-xs">
                {s.fee != null && <Money value={s.fee} paise />}
                <p className="text-ink-faint">{t('transport.routes.studentsN', { count: s.students })}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Drawer>
  )
}

/** Transport › Routes & stops: each route's stops in order (with their place, times and yearly fee) and its vehicle. */
export default function Routes() {
  const { t } = useTranslation('transport')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['transport', 'routes', 'all'], queryFn: () => fetchRoutes(true) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] })
  const remove = useMutation({ mutationFn: deleteRoute, onSuccess: () => { refresh(); showSuccess(t('transport.routes.deleted')) }, onError: (e) => showError(e.message) })
  const openRoute = rows.find((r) => r.id === open)
  const unplaced = rows.filter((r) => r.active && r.stops.some((s) => s.lat == null)).length
  return (
    <PageContainer>
      <PageHeader icon={RouteIcon} title={t('transport.routes.title')} subtitle={t('transport.routes.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="transport.routes.create" onClick={() => setEditing('new')}>{t('transport.routes.new')}</HeaderButton>} />
      {unplaced > 0 && <Note className="mb-3" icon={MapPinned}>{t('transport.routes.unplacedNote', { count: unplaced })}</Note>}
      <DataTable rows={rows} loading={isLoading} columns={[
        { key: 'name', header: t('transport.routes.name'), mobilePrimary: true, render: (v, r) => <span className="font-medium">{v}{r.code && <span className="ml-1 text-xs text-ink-faint">{r.code}</span>}<span className="block text-xs font-normal text-ink-faint">{r.stops.map((s) => s.name).slice(0, 4).join(' → ')}{r.stops.length > 4 ? ' …' : ''}</span></span> },
        { key: 'vehicle', header: t('transport.routes.vehicle'), render: (v) => (v ? <span>{v.regNo}{v.driver && <span className="block text-xs text-ink-faint">{v.driver}</span>}</span> : <span className="text-ink-faint">—</span>) },
        { key: 'stops', header: t('transport.routes.stops'), align: 'right', render: (v) => v.length },
        { key: 'students', header: t('transport.routes.students'), align: 'right', render: (v, r) => <span className={r.vehicle?.capacity && v > r.vehicle.capacity ? 'text-danger-600 font-medium' : ''}>{r.vehicle?.capacity ? `${v}/${r.vehicle.capacity}` : v}</span> },
        { key: 'active', header: '', render: (v) => !v && <StatusPill tone="neutral">{t('transport.routes.off')}</StatusPill> },
        { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
          <div className="flex justify-end gap-1">
            {hasPermission('transport.routes.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('transport.edit')} onClick={(e) => { e.stopPropagation(); setEditing(r) }} />}
            {hasPermission('transport.routes.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('transport.delete')}
              onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('transport.routes.deleteConfirm', { name: r.name }), confirmLabel: t('transport.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
          </div>
        ) },
      ]} onRowClick={(r) => setOpen(r.id)} emptyTitle={t('transport.routes.empty')} />
      {openRoute && <RouteDrawer route={openRoute} onClose={() => setOpen(null)} onEdit={() => { setEditing(openRoute); setOpen(null) }} />}
      {editing && <RouteForm route={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('transport.routes.saved')) }} />}
    </PageContainer>
  )
}
