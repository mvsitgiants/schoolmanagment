import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair, ExternalLink, MapPin, Plus, Trash2 } from 'lucide-react'
import { GEOFENCE_DEFAULT_RADIUS_M, SITE_POLYGON_MAX_POINTS, SITE_SHAPES, mapsLink, metresText, polygonCentroid } from '@schoolgiant/shared'
import { FormField, Input, SegmentedControl, Textarea } from '../system'
import Button from '../ui/Button'
import { Switch } from '../app/Controls'
import { useSnackbar } from '../../context/SnackbarContext'
import { currentLocation } from './geolocation'
import { LazySiteMap } from './LazyMaps'

// The attendance sites of one branch — where staff may mark their own attendance when the
// geofence is on (Settings › Staff & HR, or Attendance › Setup › Rules). Used by Core ›
// Branches and by Attendance › Setup › Sites & geofence. A site is a circle (centre + radius)
// or an outline (3+ corners) for a campus that is not round. The browser only collects the
// numbers; whether a punch is inside is decided on the server.

const polyText = (polygon) => (polygon ?? []).map(([a, b]) => `${a}, ${b}`).join('\n')
/** "12.97, 77.59" lines → [[lat, lng], …] (null when a line is not a point). */
export function parseCorners(text) {
  const lines = String(text ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const pts = lines.map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number))
  if (pts.some((p) => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) return null
  return pts
}

export const siteIn = (x = {}) => ({
  key: x._id ?? x.id ?? Math.random().toString(36).slice(2), id: x._id ?? x.id ?? '', name: x.name ?? '',
  shape: x.shape === 'POLYGON' ? 'POLYGON' : 'CIRCLE', lat: x.lat ?? '', lng: x.lng ?? '', radiusM: x.radiusM ?? GEOFENCE_DEFAULT_RADIUS_M,
  corners: polyText(x.polygon), active: x.active !== false,
})
export const siteOut = (x) => (x.shape === 'POLYGON'
  ? { ...(x.id ? { id: x.id } : {}), name: x.name.trim(), shape: 'POLYGON', polygon: parseCorners(x.corners) ?? [], active: x.active }
  : { ...(x.id ? { id: x.id } : {}), name: x.name.trim(), shape: 'CIRCLE', lat: Number(x.lat), lng: Number(x.lng), radiusM: Number(x.radiusM) || GEOFENCE_DEFAULT_RADIUS_M, active: x.active })
const validPoint = (x) => x.lat !== '' && x.lng !== '' && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
/** Is every site complete enough to save? */
export const sitesValid = (sites) => sites.every((x) => x.name.trim() && (x.shape === 'POLYGON' ? (parseCorners(x.corners)?.length ?? 0) >= 3 : validPoint(x)))

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
/** A row as the map draws it (null while it is not complete enough to draw). */
function siteGeo(x, t) {
  const base = x.name.trim() || t('geo.sites.siteFallback')
  const name = x.active ? base : t('geo.sites.notInUseName', { name: base })
  if (x.shape === 'POLYGON') {
    const polygon = parseCorners(x.corners)
    return polygon && polygon.length >= 3 ? { name, shape: 'POLYGON', polygon } : null
  }
  const lat = Number(x.lat)
  const lng = Number(x.lng)
  return validPoint(x) && inRange(lat, lng) ? { name, shape: 'CIRCLE', lat, lng, radiusM: Number(x.radiusM) || GEOFENCE_DEFAULT_RADIUS_M } : null
}

export default function AttendanceSitesEditor({ branchName, sites, onChange, errors = {}, errorPrefix = 'attendanceSites' }) {
  const { t } = useTranslation('geo')
  const { showError } = useSnackbar()
  const [locating, setLocating] = useState(null)
  const [fix, setFix] = useState({}) // key → accuracy of the last "use my location"
  const patch = (key, change) => onChange(sites.map((x) => (x.key === key ? { ...x, ...change } : x)))
  const here = async (x) => {
    setLocating(x.key)
    const r = await currentLocation({ timeout: 15_000 })
    setLocating(null)
    if (r.error) { showError(t(`geo.location.${r.error}`)); return }
    const lat = r.location.lat.toFixed(6)
    const lng = r.location.lng.toFixed(6)
    if (x.shape === 'POLYGON') patch(x.key, { corners: `${x.corners.trim() ? `${x.corners.trim()}\n` : ''}${lat}, ${lng}` })
    else patch(x.key, { lat, lng })
    setFix((f) => ({ ...f, [x.key]: r.location.accuracy }))
  }
  const err = (i, k) => errors[`${errorPrefix}.${i}.${k}`]
  const geos = sites.map((x) => siteGeo(x, t)) // each row as the maps draw it (the other rows show faintly)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('geo.sites.title')}</p>
          <p className="text-xs text-ink-muted">{t('geo.sites.subtitle')}</p>
        </div>
        <Button size="sm" variant="secondary" icon={Plus} disabled={sites.length >= 10}
          onClick={() => onChange([...sites, siteIn({ name: sites.length ? '' : branchName || 'Main building' })])}>{t('geo.sites.addSite')}</Button>
      </div>
      {sites.length === 0 && <p className="text-xs text-ink-faint">{t('geo.sites.noSites')}</p>}
      {sites.map((x, i) => {
        const corners = x.shape === 'POLYGON' ? parseCorners(x.corners) : null
        const centre = x.shape === 'POLYGON' ? (corners?.length ? polygonCentroid(corners) : null) : validPoint(x) ? { lat: Number(x.lat), lng: Number(x.lng) } : null
        return (
          <div key={x.key} className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2"><FormField label={t('geo.sites.siteName')} required error={err(i, 'name')}><Input value={x.name} onChange={(e) => patch(x.key, { name: e.target.value })} maxLength={60} placeholder={t('geo.sites.siteNamePlaceholder')} /></FormField></div>
              <FormField label={t('geo.sites.shape')}><SegmentedControl options={SITE_SHAPES.map((s) => ({ value: s.value, label: s.value === 'POLYGON' ? t('geo.sites.outline') : t(`hrms.enum.siteShapes.${s.value}`, { defaultValue: s.label }) }))} value={x.shape} onChange={(v) => patch(x.key, { shape: v })} /></FormField>
            </div>
            <LazySiteMap shape={x.shape} corners={corners}
              lat={x.shape === 'CIRCLE' && geos[i] ? geos[i].lat : null} lng={x.shape === 'CIRCLE' && geos[i] ? geos[i].lng : null}
              radiusM={Number(x.radiusM) || GEOFENCE_DEFAULT_RADIUS_M}
              others={geos.filter((g, j) => g && j !== i)}
              onCircle={(c) => patch(x.key, { ...(c.lat != null ? { lat: c.lat.toFixed(6), lng: c.lng.toFixed(6) } : {}), ...(c.radiusM != null ? { radiusM: c.radiusM } : {}) })}
              onCorners={(list) => patch(x.key, { corners: polyText(list) })} />
            {x.shape === 'CIRCLE' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <FormField label={t('geo.sites.latitude')} required error={err(i, 'lat')}><Input type="number" step="any" min={-90} max={90} value={x.lat} onChange={(e) => patch(x.key, { lat: e.target.value })} placeholder="12.971599" /></FormField>
                <FormField label={t('geo.sites.longitude')} required error={err(i, 'lng')}><Input type="number" step="any" min={-180} max={180} value={x.lng} onChange={(e) => patch(x.key, { lng: e.target.value })} placeholder="77.594566" /></FormField>
                <FormField label={t('geo.sites.radius')} error={err(i, 'radiusM')} hint={t('geo.sites.radiusDefault', { m: GEOFENCE_DEFAULT_RADIUS_M })}><Input type="number" min={20} max={5000} step={10} value={x.radiusM} onChange={(e) => patch(x.key, { radiusM: e.target.value })} /></FormField>
                <Button variant="secondary" icon={Crosshair} loading={locating === x.key} className="col-span-2 sm:col-span-1" onClick={() => here(x)}>{t('geo.sites.useMyLocation')}</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <FormField label={t('geo.sites.corners')} required error={err(i, 'polygon') || (x.corners.trim() && !corners ? t('geo.sites.cornersError') : undefined)}
                  hint={t('geo.sites.cornersHint', { max: SITE_POLYGON_MAX_POINTS })}>
                  <Textarea rows={4} value={x.corners} onChange={(e) => patch(x.key, { corners: e.target.value })} className="font-mono-num text-xs" placeholder={'12.97210, 77.59310\n12.97230, 77.59480\n12.97080, 77.59500'} />
                </FormField>
                <Button size="sm" variant="secondary" icon={Crosshair} loading={locating === x.key} disabled={(corners?.length ?? 0) >= SITE_POLYGON_MAX_POINTS} onClick={() => here(x)}>{t('geo.sites.addCorner')}</Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3 text-ink-muted">
                {centre
                  ? <a href={mapsLink(centre.lat, centre.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline font-mono-num"><MapPin className="w-3.5 h-3.5" />{centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}<ExternalLink className="w-3 h-3" /></a>
                  : <span className="text-ink-faint">{x.shape === 'POLYGON' ? t('geo.sites.markCorners') : t('geo.sites.standHint')}</span>}
                {x.shape === 'POLYGON' && corners && <span>{t('geo.sites.cornerCount', { count: corners.length })}</span>}
                {fix[x.key] != null && <span className={fix[x.key] > 50 ? 'text-amber-700' : ''}>{t(fix[x.key] > 50 ? 'geo.sites.fixAccuratePoor' : 'geo.sites.fixAccurate', { distance: metresText(fix[x.key]) })}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 text-ink">{t('geo.sites.inUse')} <Switch checked={x.active} onChange={(v) => patch(x.key, { active: v })} label={t('geo.sites.inUse')} /></span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('geo.sites.removeSite')} onClick={() => onChange(sites.filter((y) => y.key !== x.key))}>{t('actions.remove')}</Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
