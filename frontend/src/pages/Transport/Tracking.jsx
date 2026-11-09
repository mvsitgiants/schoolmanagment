import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, LocateFixed, LocateOff, MapPin, Navigation, Play, Route as RouteIcon, Square, UserCheck, UserMinus, UserX, Users } from 'lucide-react'
import { osmEmbed, osmLink } from '@schoolgiant/shared'
import { Drawer, Note, PageContainer, PageHeader, Panel, PersonCell, PhoneLink, SegmentedControl, SideNav, SideNavLayout, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { endTrip, fetchBoard, fetchMyRoutes, fetchTrip, markRide, sendPosition, startTrip } from '../../api/transport'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { MapFrame, TripStatusPill, useTransportLabels } from '../../components/transport/TransportKit'

const SEND_EVERY_MS = 15_000
const LAST_EVENT_TONE = { BOARDED: 'success', DROPPED: 'info', ABSENT: 'warning' }

/** Share this phone's position with a running trip while the page is open. */
function useShareLocation(tripId, on) {
  const [state, setState] = useState({ sentAt: null, error: null })
  const last = useRef(0)
  useEffect(() => {
    if (!on || !tripId) return undefined
    if (!navigator.geolocation) { setState((s) => ({ ...s, error: 'NO_GEO' })); return undefined }
    let lock = null
    navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    const watch = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - last.current < SEND_EVERY_MS) return
      last.current = Date.now()
      const c = p.coords
      sendPosition(tripId, { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, ...(c.speed != null && { speed: Math.max(0, c.speed * 3.6) }), ...(c.heading != null && !Number.isNaN(c.heading) && { heading: c.heading }), at: new Date(p.timestamp).toISOString() })
        .then(() => setState({ sentAt: new Date(), error: null }))
        .catch((e) => setState((s) => ({ ...s, error: e.message })))
    }, (e) => setState((s) => ({ ...s, error: e.code === 1 ? 'DENIED' : e.message })), { enableHighAccuracy: true, maximumAge: 5000 })
    return () => { navigator.geolocation.clearWatch(watch); lock?.release?.().catch(() => {}) }
  }, [tripId, on])
  return state
}

/** A trip as the attendant works it: stops in order, who is at each, mark on / off / not there. */
function TripView({ tripId, live = false, onEnded }) {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { time } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [sharing, setSharing] = useState(live)
  const { data: trip } = useQuery({ queryKey: ['transport', 'trip', tripId], queryFn: () => fetchTrip(tripId), refetchInterval: 20_000 })
  const running = trip?.status === 'RUNNING'
  const share = useShareLocation(tripId, live && sharing && running)
  const canTrack = hasPermission('transport.tracking.track')
  const mark = useMutation({ mutationFn: ({ studentId, event }) => markRide(tripId, studentId, event), onSuccess: (d) => qc.setQueryData(['transport', 'trip', tripId], d), onError: (e) => showError(e.message) })
  const finish = useMutation({ mutationFn: () => endTrip(tripId), onSuccess: (d) => { qc.setQueryData(['transport', 'trip', tripId], d); qc.invalidateQueries({ queryKey: ['transport'] }); showSuccess(t('transport.track.ended')); onEnded?.() }, onError: (e) => showError(e.message) })
  if (!trip) return <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" />
  const students = trip.stops.flatMap((s) => s.students)
  const lastOf = (st) => st.events?.[st.events.length - 1]
  const on = students.filter((s) => lastOf(s) === 'BOARDED').length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TripStatusPill status={trip.status} />
        <span className="text-sm text-ink-muted">{t('transport.track.tripLine', { kind: L.trip(trip.kind), reached: trip.reached.length, total: trip.stops.length })}</span>
        {trip.lastPosition?.at && <span className="text-xs text-ink-faint">{t('transport.track.seenAt', { time: time(trip.lastPosition.at) })}</span>}
      </div>
      {live && running && (
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={sharing ? 'secondary' : 'primary'} icon={sharing ? LocateOff : LocateFixed} onClick={() => setSharing((v) => !v)}>{sharing ? t('transport.track.stopSharing') : t('transport.track.share')}</Button>
            <span className="text-sm text-ink-muted">
              {share.error ? <span className="text-danger-600">{share.error === 'DENIED' ? t('transport.track.denied') : share.error === 'NO_GEO' ? t('transport.track.noGeo') : share.error}</span>
                : sharing ? (share.sentAt ? t('transport.track.sentAt', { time: time(share.sentAt) }) : t('transport.track.waitingFix')) : t('transport.track.notSharing')}
            </span>
          </div>
          {sharing && <p className="mt-2 text-xs text-ink-faint">{t('transport.track.keepOpen')}</p>}
        </Panel>
      )}
      {trip.map && <MapFrame src={trip.map} className="h-56" />}
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('transport.track.students'), value: students.length },
        { icon: UserCheck, tone: 'success', label: t('transport.track.onBus'), value: on, progress: students.length ? (on / students.length) * 100 : undefined },
        { icon: UserX, label: t('transport.track.absent'), value: students.filter((s) => lastOf(s) === 'ABSENT').length, tone: students.some((s) => lastOf(s) === 'ABSENT') ? 'warning' : 'neutral' },
      ]} />
      <ol className="space-y-2">
        {trip.stops.map((s) => (
          <li key={s.id} className="rounded-xl border border-border">
            <div className="flex items-center gap-2 px-3 py-2">
              {s.reachedAt ? <CheckCircle2 className="w-4 h-4 text-success-600" /> : <Circle className="w-4 h-4 text-ink-faint" />}
              <span className="flex-1 text-sm font-medium text-ink">{s.name}</span>
              <span className="text-xs text-ink-faint">{s.reachedAt ? t('transport.track.reachedAt', { time: time(s.reachedAt) }) : s.time}</span>
              {s.lat != null && <a href={osmLink(s)} target="_blank" rel="noreferrer" className="text-brand-700" aria-label={t('transport.track.openMap')}><MapPin className="w-4 h-4" /></a>}
            </div>
            {s.students.length > 0 && (
              <div className="divide-y divide-border border-t border-border">
                {s.students.map((st) => {
                  const last = lastOf(st)
                  return (
                    <div key={st.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-[140px]">
                        <PersonCell name={st.name} size={28} sub={<>{st.className}{st.mobile && <> · <PhoneLink number={st.mobile} /></>}</>} />
                      </div>
                      {last && <StatusPill tone={LAST_EVENT_TONE[last]}>{L.ride(last)}</StatusPill>}
                      {running && canTrack && (
                        <div className="flex gap-1">
                          <Button size="sm" variant={last === 'BOARDED' ? 'primary' : 'secondary'} icon={UserCheck} disabled={mark.isPending} onClick={() => mark.mutate({ studentId: st.id, event: 'BOARDED' })}>{t('transport.track.on')}</Button>
                          <Button size="sm" variant={last === 'DROPPED' ? 'primary' : 'secondary'} icon={UserMinus} disabled={mark.isPending} onClick={() => mark.mutate({ studentId: st.id, event: 'DROPPED' })}>{t('transport.track.off')}</Button>
                          <Button size="sm" variant="ghost" icon={UserX} disabled={mark.isPending} aria-label={L.ride('ABSENT')} onClick={() => mark.mutate({ studentId: st.id, event: 'ABSENT' })} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </li>
        ))}
      </ol>
      {running && canTrack && (
        <Button variant="secondary" icon={Square} loading={finish.isPending}
          onClick={async () => { if (await confirm({ title: t('transport.track.endConfirm'), message: on ? t('transport.track.stillOn', { count: on }) : undefined, confirmLabel: t('transport.track.end') })) finish.mutate() }}>
          {t('transport.track.end')}
        </Button>
      )}
    </div>
  )
}

/** The driver's or attendant's phone: their routes today, start the trip, share location, mark students. */
function DriverMode() {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const [tripId, setTripId] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['transport', 'my-routes'], queryFn: fetchMyRoutes })
  const start = useMutation({ mutationFn: ({ routeId, kind }) => startTrip(routeId, kind), onSuccess: (d) => { qc.setQueryData(['transport', 'trip', d.id], d); qc.invalidateQueries({ queryKey: ['transport', 'my-routes'] }); setTripId(d.id) }, onError: (e) => showError(e.message) })
  if (tripId) {
    return (
      <div className="space-y-3">
        <Button size="sm" variant="ghost" onClick={() => setTripId(null)}>{t('transport.track.backToRoutes')}</Button>
        <TripView tripId={tripId} live />
      </div>
    )
  }
  if (isLoading) return <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" />
  if (!data?.routes.length) return <Note>{t('transport.track.noMyRoutes')}</Note>
  return (
    <div className="space-y-3">
      {data.routes.map((r) => (
        <Panel key={r.id} title={r.name} actions={r.vehicle && <span className="text-xs text-ink-muted">{r.vehicle.regNo}</span>}>
          <div className="grid sm:grid-cols-2 gap-2">
            {r.trips.map((trip) => (
              <div key={trip.kind} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-ink">{L.trip(trip.kind)}</p>
                  <TripStatusPill status={trip.status} />
                </div>
                {trip.status === 'RUNNING' ? <Button size="sm" icon={Navigation} onClick={() => setTripId(trip.id)}>{t('transport.track.continue')}</Button>
                  : trip.status === 'NOT_STARTED' ? <Button size="sm" icon={Play} loading={start.isPending && start.variables?.routeId === r.id && start.variables?.kind === trip.kind} onClick={() => start.mutate({ routeId: r.id, kind: trip.kind })}>{t('transport.track.start')}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setTripId(trip.id)}>{t('transport.track.view')}</Button>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}

/** The transport office: every route today, its pickup and drop, where the bus is. */
function Board() {
  const { t } = useTranslation('transport')
  const L = useTransportLabels()
  const { time } = useFormat()
  const [open, setOpen] = useState(null)
  const [routeId, setRouteId] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['transport', 'board'], queryFn: () => fetchBoard(), refetchInterval: 20_000 })
  const allRoutes = data?.routes ?? []
  const routes = routeId ? allRoutes.filter((r) => r.id === routeId) : allRoutes
  const trips = routes.flatMap((r) => r.trips)
  const fresh = (p) => p?.at && Date.now() - new Date(p.at).getTime() < 10 * 60_000
  const running = routes.filter((r) => r.trips.some((x) => x.status === 'RUNNING'))
  const map = osmEmbed(running.map((r) => r.lastPosition).filter(fresh))
  if (isLoading) return <div className="h-40 rounded-xl bg-black/[0.04] animate-pulse" />
  if (!allRoutes.length) return <Note>{t('transport.track.noRoutes')}</Note>
  const live = (r) => r.trips.filter((x) => x.status === 'RUNNING').length
  return (
    <SideNavLayout nav={allRoutes.length > 1 && (
      <SideNav title={t('transport.nav.routes')} value={routeId} onChange={setRouteId} items={[
        { id: '', label: t('transport.board.allRoutes'), icon: RouteIcon, count: allRoutes.reduce((n, r) => n + live(r), 0) || undefined, countTone: 'warning' },
        ...allRoutes.map((r) => ({ id: r.id, label: r.name, icon: RouteIcon, hint: r.vehicle?.regNo ?? t('transport.track.noVehicle'), count: live(r) ? t('transport.nav.runningN', { count: live(r) }) : undefined, countTone: 'warning' })),
      ]} />
    )}>
      <StatCardRow items={[
        { icon: Play, label: t('transport.track.running'), value: trips.filter((x) => x.status === 'RUNNING').length, tone: 'success' },
        { icon: CheckCircle2, tone: 'info', label: t('transport.track.done'), value: trips.filter((x) => x.status === 'DONE').length },
        { icon: Circle, tone: 'violet', label: t('transport.track.notStarted'), value: trips.filter((x) => x.status === 'NOT_STARTED').length },
        { icon: LocateOff, label: t('transport.track.noSignal'), value: running.filter((r) => !fresh(r.lastPosition)).length, tone: running.some((r) => !fresh(r.lastPosition)) ? 'warning' : 'neutral' },
      ]} />
      {map && <MapFrame src={map} />}
      <div className="grid xl:grid-cols-2 gap-3">
        {routes.map((r) => (
          <Panel key={r.id} title={r.name} actions={<span className="text-xs text-ink-muted">{r.vehicle?.regNo ?? t('transport.track.noVehicle')}</span>}>
            <div className="space-y-2">
              {r.trips.map((trip) => (
                <button key={trip.kind} type="button" disabled={!trip.id} onClick={() => setOpen(trip.id)} className="w-full flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left enabled:hover:bg-black/[0.02]">
                  <span>
                    <span className="block text-sm font-medium text-ink">{L.trip(trip.kind)}</span>
                    {trip.id && <span className="block text-xs text-ink-faint">{t('transport.track.reachedOf', { reached: trip.reached.length, total: r.stops.length })}{trip.startedAt && ` · ${t('transport.track.startedAt', { time: time(trip.startedAt) })}`}</span>}
                  </span>
                  <TripStatusPill status={trip.status} />
                </button>
              ))}
              {r.lastPosition?.at && (
                <p className="text-xs text-ink-faint">
                  {fresh(r.lastPosition) ? t('transport.track.lastSeen', { time: time(r.lastPosition.at) }) : t('transport.track.stale', { time: time(r.lastPosition.at) })}
                  {' · '}<a href={osmLink(r.lastPosition)} target="_blank" rel="noreferrer" className="text-brand-700">{t('transport.track.openMap')}</a>
                </p>
              )}
              {r.vehicle?.driver && <p className="text-xs text-ink-faint">{t('transport.track.driver', { name: r.vehicle.driver })}</p>}
            </div>
          </Panel>
        ))}
      </div>
      {open && <Drawer open onClose={() => setOpen(null)} size="xl" title={allRoutes.find((r) => r.trips.some((x) => x.id === open))?.name}><TripView tripId={open} /></Drawer>}
    </SideNavLayout>
  )
}

/** Transport › Live tracking: the office board of today's trips, and the driver / attendant mode on a phone. */
export default function Tracking() {
  const { t } = useTranslation('transport')
  const canView = hasPermission('transport.tracking.view')
  const canTrack = hasPermission('transport.tracking.track')
  const [mode, setMode] = useState(canView ? 'BOARD' : 'DRIVER')
  return (
    <PageContainer>
      <PageHeader icon={Navigation} title={t('transport.track.title')} subtitle={t('transport.track.subtitle')} />
      {canView && canTrack && (
        <div className="mb-4">
          <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'BOARD', label: t('transport.track.board') }, { value: 'DRIVER', label: t('transport.track.driverMode') }]} />
        </div>
      )}
      {mode === 'BOARD' && canView ? <Board /> : <DriverMode />}
    </PageContainer>
  )
}
