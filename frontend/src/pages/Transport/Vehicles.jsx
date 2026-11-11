import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight, Armchair, Bike, Bus, BusFront, CarFront, CheckCircle2, Clock, Copy, FileWarning, LayoutGrid, List, MapPin, Navigation, Pencil, Plus, Radio,
  Route as RouteIcon, Sunrise, Sunset, Trash2, Users,
} from 'lucide-react'
import { VEHICLE_DOCS, VEHICLE_STATUS, VEHICLE_TYPES } from '@schoolgiant/shared'
import {
  DateInput, CodeBadge, ColorChip, DataTable, DateCell, Drawer, EmptyState, FormField, HeaderButton, Input, Modal, Note, PANEL, PageContainer, PageHeader, Panel, PersonCell, PhoneLink, PillRow,
  SegmentedControl, Select, SideNavLayout, Skeleton, StatCardRow, StatusPill, TONE, Tag, Textarea, pillClass, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteVehicle, fetchGpsHook, fetchRoutes, fetchStaffLogins, fetchVehicleBoard, fetchVehicles, saveVehicle } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { DocStatePill, RouteNav, TripStatusPill, VehicleStatusPill, useTransportLabels } from '../../components/transport/TransportKit'
import SeatMap, { SeatLegend, SeatsBar, seatGroups } from '../../components/transport/SeatMap'

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
      {licence && <FormField label={t('transport.vehicles.licenceExpiry')}><DateInput value={value.licenceExpiry} onChange={set('licenceExpiry')} /></FormField>}
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
                <DateInput value={form.docs[d.value].expiry} onChange={setDoc(d.value, 'expiry')} aria-label={t('transport.vehicles.docExpiry')} />
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

// ───────────────────────────────────────────────────────── the board: each vehicle drawn with its seats

/** What the vehicle is doing today (from its routes' trips). */
const LIVE = {
  ON_TRIP: { tone: 'success', icon: Navigation },
  TRIP_DONE: { tone: 'info', icon: CheckCircle2 },
  NOT_STARTED: { tone: 'neutral', icon: Clock },
  NO_ROUTE: { tone: 'warning', icon: RouteIcon },
}
const MODE_ICON = { BOTH: ArrowLeftRight, PICKUP: Sunrise, DROP: Sunset }
const DOC_TONE = { EXPIRED: 'danger', DUE: 'warning' }

function LiveChip({ state }) {
  const { t } = useTranslation('transport')
  return <StatusPill tone={LIVE[state]?.tone ?? 'neutral'}>{t(`transport.board.live.${state}`)}</StatusPill>
}

/** Papers (and the driver's licence) expired or due soon, as chips; "not added" when nothing is due but some are missing. */
function DocChips({ v, max = 2 }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const due = [
    ...v.docs.map((d) => ({ key: d.kind, state: d.state, label: L.doc(d.kind) })),
    ...(DOC_TONE[v.licenceState] ? [{ key: 'licence', state: v.licenceState, label: t('transport.board.licence') }] : []),
  ].sort((a, b) => (a.state === 'EXPIRED' ? -1 : 0) - (b.state === 'EXPIRED' ? -1 : 0))
  if (!due.length) return v.docsState === 'MISSING' ? <Tag size="xs" icon={FileWarning}>{t('transport.board.papersMissing')}</Tag> : null
  return (
    <span className="flex flex-wrap gap-1">
      {due.slice(0, max).map((d) => <Tag key={d.key} size="xs" tone={DOC_TONE[d.state]} icon={FileWarning}>{t('transport.board.docWarn', { doc: d.label, state: L.docState(d.state) })}</Tag>)}
      {due.length > max && <Tag size="xs" tone="neutral">{t('transport.board.moreN', { count: due.length - max })}</Tag>}
    </span>
  )
}

/** The trip running now on any of the vehicle's routes. */
const runningTrip = (v) => v.routes.flatMap((r) => r.trips.map((tr) => ({ ...tr, route: r.name }))).find((tr) => tr.status === 'RUNNING')

function VehicleCard({ v, colourBy, selected, onOpen }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const Icon = TYPE_ICON[v.type] ?? Bus
  const { riders, groups } = useMemo(() => seatGroups(v.riders, colourBy, t('transport.board.noClass')), [v.riders, colourBy, t])
  const run = runningTrip(v)
  return (
    <div role="button" tabIndex={0} aria-label={t('transport.board.openCard', { reg: v.regNo })} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className={`${PANEL} flex flex-col gap-3 p-4 text-start cursor-pointer transition-colors hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${selected ? 'ring-2 ring-brand-500' : ''} ${v.over > 0 ? 'border-rose-200' : ''}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE.brand.bg} ${TONE.brand.text}`}><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><CodeBadge>{v.regNo}</CodeBadge>{v.status !== 'ACTIVE' && <VehicleStatusPill status={v.status} />}</div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">{[L.type(v.type), v.make].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <LiveChip state={v.live} />
          {run && <span className="text-[10.5px] text-ink-faint">{t('transport.board.runningTrip', { kind: L.trip(run.kind), reached: run.reached, total: run.stops })}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {v.routes.length ? v.routes.map((r) => <ColorChip key={r.id} label={r.name} seed={r.id} icon={RouteIcon} />) : <span className="text-xs text-ink-faint">{t('transport.vehicles.noRoute')}</span>}
      </div>
      <SeatMap capacity={v.capacity} type={v.type} riders={riders} />
      <SeatsBar seated={v.seated} capacity={v.capacity} />
      {groups.length > 0 && <SeatLegend groups={groups} max={4} />}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {v.driver ? <PersonCell name={v.driver.name} sub={v.driver.mobile ? <PhoneLink number={v.driver.mobile} /> : undefined} size={28} /> : <span className="text-xs text-ink-faint">{t('transport.board.noDriver')}</span>}
        <DocChips v={v} />
      </div>
    </div>
  )
}

function VehicleDrawer({ v, colourBy, onClose, onEdit }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const { time } = useFormat()
  const [active, setActive] = useState(null)
  const { riders, groups } = useMemo(() => seatGroups(v?.riders ?? [], colourBy, t('transport.board.noClass')), [v, colourBy, t])
  if (!v) return null
  // riders by route, then stop (in stop order) — the order the seats fill
  const byStop = []
  for (const r of riders) {
    const key = `${r.routeId}:${r.stopId}`
    let g = byStop.find((x) => x.key === key)
    if (!g) {
      const stop = v.routes.find((x) => x.id === r.routeId)?.stops.find((x) => x.id === r.stopId)
      g = { key, route: r.route, stop: r.stop, times: [stop?.pickupTime, stop?.dropTime].filter(Boolean).join(' / '), tone: r.tone, riders: [] }
      byStop.push(g)
    }
    g.riders.push(r)
  }
  const many = v.routes.length > 1
  return (
    <Drawer open onClose={onClose} size="xl" title={v.regNo} subtitle={[L.type(v.type), v.make, t('transport.vehicles.seatsN', { count: v.capacity })].filter(Boolean).join(' · ')}
      footer={<>
        {hasPermission('transport.assignments.view') && v.routes.map((r) => (
          <Button key={r.id} size="sm" variant="secondary" icon={Users} to={`/transport/assignments?routeId=${r.id}`}>{many ? t('transport.board.assignmentsFor', { route: r.name }) : t('transport.board.assignments')}</Button>
        ))}
        {hasPermission('transport.tracking.view') && <Button size="sm" variant="secondary" icon={MapPin} to="/transport/tracking">{t('transport.board.openTracking')}</Button>}
        {onEdit && <Button size="sm" icon={Pencil} onClick={onEdit}>{t('transport.board.editVehicle')}</Button>}
      </>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><LiveChip state={v.live} /><VehicleStatusPill status={v.status} /><DocStatePill state={v.docsState} /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[['driver', v.driver], ['attendant', v.attendant]].map(([k, p]) => (
            <div key={k}>
              <p className="text-xs font-medium text-ink-muted mb-1">{t(`transport.vehicles.${k}`)}</p>
              {p ? <PersonCell name={p.name} sub={p.mobile ? <PhoneLink number={p.mobile} /> : undefined} /> : <span className="text-sm text-ink-faint">—</span>}
            </div>
          ))}
        </div>
        {(v.docs.length > 0 || DOC_TONE[v.licenceState]) && <Note tone={v.docsState === 'EXPIRED' || v.licenceState === 'EXPIRED' ? 'danger' : 'warning'} icon={FileWarning}><DocChips v={v} max={8} /></Note>}
        <section className="space-y-2">
          <SeatMap capacity={v.capacity} type={v.type} riders={riders} size="lg" active={active} />
          <SeatsBar seated={v.seated} capacity={v.capacity} />
          {groups.length > 0 && <SeatLegend groups={groups} active={active} onPick={setActive} />}
          {groups.length > 1 && <p className="text-[11px] text-ink-faint">{t('transport.board.pickHint')}</p>}
        </section>
        <section>
          <p className="text-sm font-semibold text-ink mb-2">{t('transport.board.todayTrips')}</p>
          {!v.routes.length ? <Note>{t('transport.board.noRouteNote')}</Note> : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {v.routes.flatMap((r) => r.trips.map((tr) => (
                <li key={`${r.id}-${tr.kind}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  {many && <ColorChip label={r.name} seed={r.id} icon={RouteIcon} />}
                  <span className="text-ink">{L.trip(tr.kind)}</span>
                  <TripStatusPill status={tr.status} />
                  {tr.status !== 'NOT_STARTED' && <span className="text-xs text-ink-faint">{t('transport.track.reachedOf', { reached: tr.reached, total: tr.stops })}</span>}
                  <span className="ms-auto text-xs text-ink-faint">
                    {[tr.startedAt && t('transport.track.startedAt', { time: time(tr.startedAt) }), tr.endedAt && t('transport.board.endedAt', { time: time(tr.endedAt) })].filter(Boolean).join(' · ')}
                  </span>
                </li>
              )))}
            </ul>
          )}
        </section>
        <section>
          <p className="text-sm font-semibold text-ink mb-2">{t('transport.board.ridersN', { count: riders.length })}</p>
          {!riders.length ? <p className="text-sm text-ink-muted">{t('transport.board.noRiders')}</p> : (
            <div className="space-y-3">
              {byStop.map((g) => (
                <div key={g.key} className="rounded-xl border border-border">
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    {colourBy === 'STOP' && <span className={`h-2.5 w-2.5 rounded-[3px] ${(TONE[g.tone] ?? TONE.neutral).fill}`} />}
                    <span className="text-sm font-medium text-ink">{g.stop}</span>
                    {many && <span className="text-xs text-ink-faint">{g.route}</span>}
                    {g.times && <span className="text-xs text-ink-faint tabular-nums">{g.times}</span>}
                    <span className="ms-auto text-xs text-ink-muted">{t('transport.routes.studentsN', { count: g.riders.length })}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {g.riders.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <PersonCell name={r.name} sub={r.admissionNo} size={28} className="flex-1 min-w-[10rem]" />
                        <ColorChip label={r.className} seed={r.classCode ?? r.className} />
                        <Tag size="xs" icon={MODE_ICON[r.mode] ?? ArrowLeftRight}>{L.mode(r.mode)}</Tag>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}

const SEAT_FILTERS = ['', 'OVER', 'FREE']
const NO_ROUTE = '__none' // the sub-navigation's "no route" item

/** `onRoute(v)`: does the vehicle belong in the route picked in the page's sub-navigation? */
function VehicleBoard({ onEdit, onRoute }) {
  const { t } = useTranslation('transport')
  const [seats, setSeats] = useState('')
  const [colourBy, setColourBy] = useState('STOP')
  const [openId, setOpenId] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['transport', 'vehicles', 'board'], queryFn: fetchVehicleBoard, refetchInterval: 60_000 })
  const all = data?.vehicles ?? []
  const shown = all.filter((v) => onRoute(v) && (seats !== 'OVER' || v.over > 0) && (seats !== 'FREE' || v.free > 0))
  const open = all.find((v) => v.id === openId)
  const canEdit = hasPermission('transport.vehicles.edit')
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <PillRow className="w-full sm:w-auto">
          {SEAT_FILTERS.map((f) => <button key={f || 'ALL'} type="button" aria-pressed={seats === f} onClick={() => setSeats(f)} className={pillClass(seats === f)}>{t(`transport.board.filter.${f || 'ALL'}`)}</button>)}
        </PillRow>
        <span className="sm:ms-auto flex items-center gap-2 text-xs text-ink-muted">
          {t('transport.board.colourBy')}
          <SegmentedControl value={colourBy} onChange={setColourBy} options={[{ value: 'STOP', label: t('transport.board.byStop') }, { value: 'CLASS', label: t('transport.board.byClass') }]} />
        </span>
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[300px] rounded-2xl" />)}</div>
      ) : !all.length ? <EmptyState icon={Bus} title={t('transport.vehicles.empty')} hint={t('transport.board.emptyHint')} />
        : !shown.length ? <EmptyState icon={Bus} title={t('transport.board.noMatch')} />
          : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((v) => <VehicleCard key={v.id} v={v} colourBy={colourBy} selected={openId === v.id} onOpen={() => setOpenId(v.id)} />)}
            </div>
          )}
      {open && <VehicleDrawer key={open.id} v={open} colourBy={colourBy} onClose={() => setOpenId(null)} onEdit={canEdit ? () => { setOpenId(null); onEdit(open.id) } : undefined} />}
    </>
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
  const [view, setView] = useState('BOARD')
  const [routeId, setRouteId] = useState('')
  const { data: all = [], isLoading } = useQuery({ queryKey: ['transport', 'vehicles'], queryFn: fetchVehicles })
  const { data: routes = [] } = useQuery({ queryKey: ['transport', 'routes'], queryFn: () => fetchRoutes() })
  // the sub-navigation: one route, the vehicles with no route, or all
  const onRoute = (v) => (!routeId ? true : routeId === NO_ROUTE ? !v.routes?.length : (v.routes ?? []).some((r) => r.id === routeId))
  const rows = all.filter(onRoute)
  const spare = all.filter((v) => !v.routes?.length).length
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] })
  const remove = useMutation({ mutationFn: deleteVehicle, onSuccess: () => { refresh(); showSuccess(t('transport.vehicles.deleted')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('transport.vehicles.edit')
  const expiring = all.filter((v) => v.docsState === 'EXPIRED' || v.docsState === 'DUE')
  return (
    <PageContainer>
      <PageHeader icon={Bus} title={t('transport.vehicles.title')} subtitle={t('transport.vehicles.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="transport.vehicles.create" onClick={() => setEditing('new')}>{t('transport.vehicles.new')}</HeaderButton>} />
      <SideNavLayout nav={(routes.length > 1 || spare > 0) && (
        <RouteNav routes={routes} value={routeId} onChange={setRouteId} allLabel={t('transport.board.allVehicles')} allCount={all.length}
          extra={spare ? [{ id: NO_ROUTE, label: t('transport.nav.spare'), icon: Bus, count: spare }] : []} />
      )}>
        <StatCardRow items={[
          { icon: Bus, tone: 'brand', label: t('transport.vehicles.onRoad'), value: rows.filter((v) => v.status === 'ACTIVE').length },
          { icon: Armchair, tone: 'violet', label: t('transport.vehicles.seats'), value: rows.filter((v) => v.status === 'ACTIVE').reduce((n, v) => n + (v.capacity ?? 0), 0) },
          { icon: FileWarning, label: t('transport.vehicles.papersDue'), value: rows.filter((v) => v.docsState === 'EXPIRED' || v.docsState === 'DUE').length, tone: expiring.length ? 'warning' : 'neutral' },
          { icon: Radio, tone: 'sky', label: t('transport.vehicles.withGps'), value: rows.filter((v) => v.gpsDeviceId).length },
        ]} />
        {expiring.length > 0 && <Note tone="warning">{t('transport.vehicles.dueNote', { list: expiring.map((v) => v.regNo).join(', ') })}</Note>}
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'BOARD', label: t('transport.board.view.BOARD'), icon: LayoutGrid }, { value: 'LIST', label: t('transport.board.view.LIST'), icon: List }]} />
        {view === 'BOARD' ? <VehicleBoard onRoute={onRoute} onEdit={(id) => { const v = all.find((x) => x.id === id); if (v) setEditing(v) }} /> : <DataTable rows={rows} loading={isLoading} columns={[
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
        ]} onRowClick={canEdit ? (r) => setEditing(r) : undefined} emptyTitle={t('transport.vehicles.empty')} />}
        {(canEdit || hasPermission('transport.vehicles.create')) && <GpsPanel />}
      </SideNavLayout>
      {editing && <VehicleForm vehicle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('transport.vehicles.saved')) }} />}
    </PageContainer>
  )
}
