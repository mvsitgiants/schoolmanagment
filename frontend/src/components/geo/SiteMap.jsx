import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
import { Eraser, Focus, LocateFixed, Undo2 } from 'lucide-react'
import { GEOFENCE_DEFAULT_RADIUS_M, SITE_POLYGON_MAX_POINTS, metresText, polygonCentroid } from '@schoolgiant/shared'
import Button from '../ui/Button'
import { useSnackbar } from '../../context/SnackbarContext'
import { currentLocation } from './geolocation'

// The map for drawing one attendance site (OpenStreetMap tiles, Leaflet). This file and
// PunchMap.jsx are the only ones that load Leaflet, and both are loaded lazily (LazyMaps.jsx),
// so the map code only downloads when a map is actually on screen. The map is controlled: the
// site lives in the editor's row state and the typed fields stay the fallback, kept in sync.

// Vite serves Leaflet's marker images from the bundle (Leaflet guesses the path from its CSS,
// which breaks once bundled).
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const FALLBACK = { center: [20.59, 78.96], zoom: 5 } // India, when nothing better is known
export const OTHER_COLOUR = '#64748b'
const FIX_COLOUR = '#2563eb'
const SLIDER = { min: 20, max: 1000, step: 10 }
const TIP_CLASS = '!bg-white/80 !border-0 !shadow-none !px-1 !py-0 !rounded !text-[10px] !text-ink-muted'

const round6 = (n) => Math.round(n * 1e6) / 1e6
const toPair = (ll) => [round6(ll.lat), round6(ll.lng)]

/** The tenant's accent (a CSS variable of "r g b") as a colour Leaflet's SVG paths accept. */
export function brandColour() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim().split(/\s+/).map(Number)
    if (v.length === 3 && v.every(Number.isFinite)) return `rgb(${v.join(',')})`
  } catch { /* fall through to the default teal */ }
  return '#0b6670'
}

// Where the browser is, asked at most once per page load when a map has nothing else to centre on.
let hereOnce = null
const askHereOnce = () => (hereOnce ??= currentLocation({ timeout: 10_000 }))

/** Keep Leaflet's idea of its size right (a Modal animates open; the card can resize). */
function SizeKeeper() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    ro?.observe(map.getContainer())
    return () => { clearTimeout(t); ro?.disconnect() }
  }, [map])
  return null
}

/** OSM map in a rounded box that stays under the app's modals, drawers and menus. */
export function BaseMap({ mapRef, center, zoom, bounds, height = 280, children }) {
  return (
    <div className="relative z-0 isolate overflow-hidden rounded-lg border border-border bg-bg">
      <MapContainer ref={mapRef} center={bounds ? undefined : center} zoom={bounds ? undefined : zoom} bounds={bounds}
        boundsOptions={{ padding: [24, 24], maxZoom: 18 }} maxZoom={19} scrollWheelZoom={false} style={{ height, width: '100%' }}>
        <TileLayer url={TILES} attribution={ATTRIBUTION} maxZoom={19} />
        <SizeKeeper />
        {children}
      </MapContainer>
    </div>
  )
}

/** One site drawn read-only — full colour, or faint for context. */
export function SiteShape({ site, colour, faint = false, label }) {
  const opts = faint
    ? { color: colour, weight: 1, opacity: 0.7, fillOpacity: 0.05, dashArray: '4 4' }
    : { color: colour, weight: 2, fillOpacity: 0.12 }
  const tip = label ? <Tooltip permanent direction="center" className={TIP_CLASS}>{label}</Tooltip> : null
  if (site.shape === 'POLYGON') {
    return (site.polygon?.length ?? 0) >= 3 ? <Polygon positions={site.polygon} pathOptions={opts} interactive={false}>{tip}</Polygon> : null
  }
  if (!Number.isFinite(site.lat) || !Number.isFinite(site.lng)) return null
  return <Circle center={[site.lat, site.lng]} radius={Number(site.radiusM) || GEOFENCE_DEFAULT_RADIUS_M} pathOptions={opts} interactive={false}>{tip}</Circle>
}

/** The accuracy circle and dot of a location fix. */
export function FixMark({ fix, colour = FIX_COLOUR }) {
  if (!fix) return null
  return (
    <>
      {fix.accuracy > 0 && <Circle center={[fix.lat, fix.lng]} radius={fix.accuracy} interactive={false} pathOptions={{ color: colour, weight: 1, fillOpacity: 0.08, dashArray: '3 3' }} />}
      <CircleMarker center={[fix.lat, fix.lng]} radius={6} interactive={false} pathOptions={{ color: '#ffffff', weight: 2, fillColor: colour, fillOpacity: 1 }} />
    </>
  )
}

const sitePoint = (s) => (s.shape === 'POLYGON'
  ? ((s.polygon?.length ?? 0) ? polygonCentroid(s.polygon) : null)
  : Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : null)

/** Map clicks → onPick(latlng). */
function Clicks({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng) })
  return null
}

/**
 * When the site moves somewhere the map is not showing (typed coordinates, "Use my location"),
 * follow it. Points added or dragged on the map are inside the view already, so the map does
 * not jump while someone is drawing. Debounced so half-typed numbers do not send it flying.
 */
function Follow({ points }) {
  const map = useMap()
  const prev = useRef(null)
  const key = points.map((p) => p.join(',')).join(';')
  useEffect(() => {
    const before = prev.current
    prev.current = new Set(points.map((p) => p.join(',')))
    if (!before || !points.length) return undefined
    const fresh = points.filter((p) => !before.has(p.join(',')))
    const view = map.getBounds()
    if (!fresh.some((p) => !view.contains(p))) return undefined
    const t = setTimeout(() => {
      if (points.length === 1) map.flyTo(points[0], Math.max(map.getZoom(), 16))
      else map.flyToBounds(points, { padding: [24, 24], maxZoom: 18 })
    }, 500)
    return () => clearTimeout(t)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Small numbered handles for outline corners (nicer to grab than the big pin).
const handleIcons = new Map()
function cornerIcon(n, colour) {
  const k = `${n}|${colour}`
  if (!handleIcons.has(k)) {
    handleIcons.set(k, L.divIcon({
      className: 'site-map-corner',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `<span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:#ffffff;border:2px solid ${colour};color:${colour};font:600 10px/1 system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:grab">${n}</span>`,
    }))
  }
  return handleIcons.get(k)
}

/**
 * Draw one attendance site.
 *  shape     'CIRCLE' | 'POLYGON'
 *  lat, lng  the circle's centre (numbers) or null
 *  radiusM   the circle's radius in metres
 *  corners   [[lat, lng], …] for an outline, or null when the typed corner list is not valid
 *  others    the branch's other sites, drawn faintly: [{ name, shape, lat, lng, radiusM, polygon }]
 *  onCircle  ({ lat, lng }) when the centre is set/dragged, ({ radiusM }) from the slider
 *  onCorners (corners) with the whole new corner list
 */
export default function SiteMap({ shape, lat, lng, radiusM, corners, others = [], onCircle, onCorners }) {
  const { t } = useTranslation('geo')
  const { showError } = useSnackbar()
  const [colour] = useState(brandColour)
  const [map, setMap] = useState(null)
  const [liveCentre, setLiveCentre] = useState(null) // while the pin is dragged
  const [liveCorners, setLiveCorners] = useState(null) // while a corner is dragged
  const [fix, setFix] = useState(null) // the last "Locate me"
  const [locating, setLocating] = useState(false)
  const lastDrag = useRef(0)

  const polygon = shape === 'POLYGON'
  const radius = Number(radiusM) > 0 ? Number(radiusM) : GEOFENCE_DEFAULT_RADIUS_M
  const centre = !polygon && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
  const shown = polygon ? (liveCorners ?? corners ?? []) : []
  const ownPoints = polygon ? (corners ?? []) : centre ? [centre] : []
  const hasOwn = useRef(ownPoints.length > 0)
  hasOwn.current = ownPoints.length > 0

  // First view: the site → another site of the branch → (then) the browser's location → India.
  const [initial] = useState(() => {
    if (ownPoints.length >= 2) return { bounds: L.latLngBounds(ownPoints) }
    if (ownPoints.length === 1) return { center: ownPoints[0], zoom: 17 }
    const other = others.map(sitePoint).find(Boolean)
    if (other) return { center: [other.lat, other.lng], zoom: 16 }
    return { ...FALLBACK, ask: true }
  })
  useEffect(() => {
    if (!map || !initial.ask) return undefined
    let live = true
    askHereOnce().then((r) => {
      if (live && r.location && !hasOwn.current) map.setView([r.location.lat, r.location.lng], 16)
    })
    return () => { live = false }
  }, [map, initial.ask])
  useEffect(() => {
    if (!map) return undefined
    const timer = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(timer)
  }, [map, shape])

  const pick = (ll) => {
    if (!polygon) { onCircle({ lat: round6(ll.lat), lng: round6(ll.lng) }); return }
    if (!corners || corners.length >= SITE_POLYGON_MAX_POINTS) return
    onCorners([...corners, toPair(ll)])
  }
  const locate = async () => {
    setLocating(true)
    const r = await currentLocation({ timeout: 15_000 })
    setLocating(false)
    if (r.error) { showError(t(`geo.location.${r.error}`)); return }
    setFix(r.location)
    map?.flyTo([r.location.lat, r.location.lng], Math.max(map.getZoom(), 17))
  }
  const centreOnSite = () => {
    if (!map || !ownPoints.length) return
    if (polygon && ownPoints.length >= 2) map.flyToBounds(ownPoints, { padding: [24, 24], maxZoom: 18 })
    else if (polygon) map.flyTo(ownPoints[0], Math.max(map.getZoom(), 17))
    else map.flyToBounds(L.latLng(centre).toBounds(radius * 2.4), { maxZoom: 18 })
  }

  const pathOptions = { color: colour, weight: 2, fillOpacity: 0.12 }
  const full = polygon && (corners?.length ?? 0) >= SITE_POLYGON_MAX_POINTS
  const hint = polygon
    ? t('geo.siteMap.hintPolygon')
    : t('geo.siteMap.hintCircle')

  return (
    <div className="space-y-2 min-w-0">
      <BaseMap mapRef={setMap} center={initial.center} zoom={initial.zoom} bounds={initial.bounds}>
        <Clicks onPick={pick} />
        <Follow points={ownPoints} />
        {others.map((o, i) => <SiteShape key={`${o.name}-${i}`} site={o} colour={OTHER_COLOUR} faint label={o.name} />)}
        <FixMark fix={fix} />
        {!polygon && centre && (
          <>
            <Circle center={liveCentre ?? centre} radius={radius} pathOptions={pathOptions} />
            <Marker position={centre} draggable title={t('geo.siteMap.dragCentre')}
              eventHandlers={{
                drag: (e) => setLiveCentre(e.target.getLatLng()),
                dragend: (e) => { const p = e.target.getLatLng(); setLiveCentre(null); onCircle({ lat: round6(p.lat), lng: round6(p.lng) }) },
              }} />
          </>
        )}
        {polygon && shown.length >= 3 && <Polygon positions={shown} pathOptions={pathOptions} />}
        {polygon && shown.length === 2 && <Polyline positions={shown} pathOptions={pathOptions} />}
        {polygon && corners && corners.map((p, i) => (
          <Marker key={`${i}|${p[0]},${p[1]}`} position={p} draggable icon={cornerIcon(i + 1, colour)} title={t('geo.siteMap.cornerTitle', { n: i + 1 })}
            eventHandlers={{
              dragstart: () => setLiveCorners(corners),
              drag: (e) => { const q = e.target.getLatLng(); setLiveCorners(corners.map((c, j) => (j === i ? [q.lat, q.lng] : c))) },
              dragend: (e) => { lastDrag.current = Date.now(); setLiveCorners(null); onCorners(corners.map((c, j) => (j === i ? toPair(e.target.getLatLng()) : c))) },
              click: () => { if (Date.now() - lastDrag.current > 400) onCorners(corners.filter((_, j) => j !== i)) },
            }} />
        ))}
      </BaseMap>

      <div className="flex flex-wrap items-center gap-2">
        {!polygon && (
          <label className="flex items-center gap-2 flex-1 min-w-[12rem] text-xs text-ink-muted">
            <span className="shrink-0">{t('geo.siteMap.radius')}</span>
            <input type="range" min={SLIDER.min} max={SLIDER.max} step={SLIDER.step} value={Math.min(SLIDER.max, Math.max(SLIDER.min, radius))}
              onChange={(e) => onCircle({ radiusM: Number(e.target.value) })} className="flex-1 min-w-0 accent-brand-600" aria-label={t('geo.siteMap.radiusAria')} />
            <span className="shrink-0 font-mono-num text-ink w-14 text-end">{metresText(radius)}</span>
          </label>
        )}
        {polygon && (
          <>
            <span className="text-xs text-amber-700 me-auto">{full ? t('geo.siteMap.maxCorners', { max: SITE_POLYGON_MAX_POINTS }) : ''}</span>
            <Button size="sm" variant="ghost" icon={Undo2} disabled={!corners?.length} onClick={() => onCorners(corners.slice(0, -1))}>{t('geo.siteMap.undoCorner')}</Button>
            <Button size="sm" variant="ghost" icon={Eraser} disabled={!corners?.length} onClick={() => onCorners([])}>{t('geo.common.clear')}</Button>
          </>
        )}
        <Button size="sm" variant="secondary" icon={LocateFixed} loading={locating} disabled={!map} onClick={locate}>{t('geo.siteMap.locateMe')}</Button>
        <Button size="sm" variant="secondary" icon={Focus} disabled={!map || !ownPoints.length} onClick={centreOnSite}>{t('geo.siteMap.centreOnSite')}</Button>
      </div>
      {polygon && !corners
        ? <p className="text-xs text-amber-700">{t('geo.siteMap.badCorners')}</p>
        : <p className="text-xs text-ink-faint">{hint}{fix ? t('geo.siteMap.blueDot', { distance: metresText(fix.accuracy) }) : ''}</p>}
    </div>
  )
}
