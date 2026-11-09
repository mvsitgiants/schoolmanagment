import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Armchair, ArrowLeftRight, Download, LogOut, MapPin, Plus, Route as RouteIcon, Users } from 'lucide-react'
import { RIDE_MODES } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, FormField, HeaderButton, Input, Modal, Money, Note, PageContainer, PageHeader, PersonCell, PhoneLink, PillRow, SearchInput, Select, SideNavLayout, StatCardRow, Textarea, localIso, pillClass, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import { assignStudent, downloadAssignments, endAssignment, fetchAssignments, fetchRoutes } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { RouteNav, useTransportLabels } from '../../components/transport/TransportKit'

function AssignForm({ routes, preset, onClose, onSaved }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ studentId: preset?.studentId ?? '', routeId: preset?.routeId ?? routes[0]?.id ?? '', stopId: preset?.stopId ?? '', mode: preset?.mode ?? 'BOTH', from: localIso(new Date()), note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'routeId' && { stopId: '' }) }))
  const route = routes.find((r) => r.id === form.routeId)
  const save = useMutation({ mutationFn: () => assignStudent(form), onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} title={preset ? t('transport.assign.moveTitle', { name: preset.student?.name }) : t('transport.assign.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.studentId || !form.routeId || !form.stopId} onClick={() => save.mutate()}>{t('transport.assign.save')}</Button>
    </>}>
      <div className="space-y-3">
        {!preset && <StudentPicker value={form.studentId} onChange={(id) => setForm((f) => ({ ...f, studentId: id }))} error={errors.studentId} />}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label={t('transport.assign.route')} required error={errors.routeId}><Select value={form.routeId} onChange={set('routeId')}>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
          <FormField label={t('transport.assign.stop')} required error={errors.stopId}>
            <Select value={form.stopId} onChange={set('stopId')}>
              <option value="">{t('transport.assign.pickStop')}</option>
              {(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{[s.name, s.pickupTime].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </FormField>
          <FormField label={t('transport.assign.mode')}><Select value={form.mode} onChange={set('mode')}>{RIDE_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select></FormField>
          <FormField label={t('transport.assign.from')} hint={preset ? t('transport.assign.fromMoveHint') : undefined}><Input type="date" value={form.from} onChange={set('from')} /></FormField>
        </div>
        <FormField label={t('transport.assign.note')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField>
      </div>
    </Modal>
  )
}

/** Transport › Student assignment: who rides which route from which stop; move, take off, export the list. */
export default function Assignments() {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [urlParams] = useSearchParams()
  const [routeId, setRoute] = useState(urlParams.get('routeId') ?? '') // the vehicle board links here for one route
  const [stopId, setStopId] = useState('')
  const setRouteId = (id) => { setRoute(id); setStopId('') }
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [editing, setEditing] = useState(null)
  const { data: routes = [] } = useQuery({ queryKey: ['transport', 'routes'], queryFn: () => fetchRoutes() })
  const params = { ...(routeId && { routeId }), ...(q && { search: q }) }
  const { data: all = [], isLoading } = useQuery({ queryKey: ['transport', 'assignments', params], queryFn: () => fetchAssignments(params) })
  const rows = stopId ? all.filter((a) => a.stopId === stopId) : all
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] })
  const end = useMutation({ mutationFn: (id) => endAssignment(id), onSuccess: () => { refresh(); showSuccess(t('transport.assign.ended')) }, onError: (e) => showError(e.message) })
  const route = routes.find((r) => r.id === routeId)
  const over = routes.filter((r) => r.vehicle?.capacity && r.students > r.vehicle.capacity)
  const canEdit = hasPermission('transport.assignments.edit')
  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('transport.assign.title')} subtitle={t('transport.assign.subtitle')}
        actions={<>
          {hasPermission('transport.assignments.export') && <HeaderButton icon={Download} onClick={() => downloadAssignments(params).catch((e) => showError(e.message))}>{t('transport.assign.export')}</HeaderButton>}
          {routes.length > 0 && <HeaderButton icon={Plus} variant="primary" requires="transport.assignments.create" onClick={() => setEditing('new')}>{t('transport.assign.new')}</HeaderButton>}
        </>} />
      {!routes.length && <Note className="mb-4">{t('transport.assign.noRoutes')}</Note>}
      <SideNavLayout nav={routes.length > 1 && <RouteNav routes={routes} value={routeId} onChange={setRouteId} allLabel={t('transport.assign.allRoutes')} allCount={routes.reduce((n, r) => n + r.students, 0)} />}>
        {route ? (
          <StatCardRow items={[
            { icon: Users, tone: 'brand', label: t('transport.assign.ridingRoute'), value: route.students },
            { icon: Armchair, tone: route.vehicle?.capacity && route.students > route.vehicle.capacity ? 'danger' : 'success', label: t('transport.assign.freeSeats'), value: route.vehicle?.capacity ? Math.max(0, route.vehicle.capacity - route.students) : '—', sub: route.vehicle ? t('transport.assign.onVehicle', { reg: route.vehicle.regNo, seats: route.vehicle.capacity }) : t('transport.nav.noVehicle') },
            { icon: MapPin, tone: 'info', label: t('transport.assign.stopsN'), value: route.stops.length },
          ]} />
        ) : (
          <StatCardRow items={[
            { icon: Users, tone: 'brand', label: t('transport.assign.riding'), value: routes.reduce((n, r) => n + r.students, 0) },
            { icon: RouteIcon, tone: 'info', label: t('transport.assign.routesN'), value: routes.length },
            { icon: AlertTriangle, label: t('transport.assign.overfull'), value: over.length, tone: over.length ? 'danger' : 'neutral' },
          ]} />
        )}
        {over.length > 0 && !route && <Note tone="warning">{t('transport.assign.overNote', { list: over.map((r) => `${r.name} (${r.students}/${r.vehicle.capacity})`).join(', ') })}</Note>}
        {route?.stops.length > 0 && (
          <PillRow>
            <button type="button" aria-pressed={!stopId} onClick={() => setStopId('')} className={pillClass(!stopId)}>{t('transport.assign.allStops', { count: route.students })}</button>
            {route.stops.map((st) => (
              <button key={st.id} type="button" aria-pressed={stopId === st.id} onClick={() => setStopId(st.id)} className={pillClass(stopId === st.id)}>
                {st.name} <span className="tabular-nums opacity-70">· {st.students}</span>
              </button>
            ))}
          </PillRow>
        )}
        <div className="w-full sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder={t('transport.assign.search')} /></div>
        <DataTable rows={rows} loading={isLoading} columns={[
          { key: 'student', header: t('transport.assign.student'), mobilePrimary: true, render: (v) => <PersonCell name={v?.name} sub={[v?.className, v?.admissionNo].filter(Boolean).join(' · ') || undefined} /> },
          // route, stop, times and how they ride in one column, so the table fits beside the route list
          { key: 'route', header: t('transport.assign.routeStop'), mobileLabel: t('transport.assign.route'), render: (v, r) => (
            <span className="flex flex-col items-start gap-1">
              {!routeId && <ColorChip label={v} seed={r.routeId} icon={RouteIcon} />}
              <span className="text-xs text-ink"><span className="font-medium">{r.stop}</span>{(r.pickupTime || r.dropTime) && <span className="text-ink-faint tabular-nums"> · {[r.pickupTime, r.dropTime].filter(Boolean).join(' / ')}</span>}</span>
              <ColorChip label={L.mode(r.mode)} seed={`ride-${r.mode}`} icon={ArrowLeftRight} />
            </span>
          ) },
          { key: 'fee', header: t('transport.assign.fee'), align: 'right', mobileHidden: true, render: (v) => (v != null ? <Money value={v} paise /> : '—') },
          { key: 'guardian', header: t('transport.assign.parent'), mobileHidden: true, render: (_, r) => (r.student?.mobile ? <PersonCell name={r.student.guardian} sub={<PhoneLink number={r.student.mobile} />} size={26} /> : '—') },
          { key: 'from', header: t('transport.assign.since'), mobileHidden: true, render: (v) => <DateCell value={v} /> },
          { key: 'id', header: '', align: 'right', width: 60, render: (_, r) => canEdit && <Button size="sm" variant="ghost" icon={LogOut} aria-label={t('transport.assign.end')}
            onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('transport.assign.endConfirm', { name: r.student?.name }), confirmLabel: t('transport.assign.end'), tone: 'danger' })) end.mutate(r.id) }} /> },
        ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} emptyTitle={t('transport.assign.empty')} />
      </SideNavLayout>
      {editing && <AssignForm routes={routes} preset={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(r) => { setEditing(null); refresh(); if (r?.warning) showError(r.warning); else showSuccess(t('transport.assign.saved')) }} />}
    </PageContainer>
  )
}
