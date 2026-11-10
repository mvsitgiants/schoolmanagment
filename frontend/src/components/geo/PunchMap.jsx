import { useEffect, useState } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { BaseMap, FixMark, SiteShape, brandColour } from './SiteMap'

// The punch-in card's map: the campus check-in areas, and where the person is now (when their location has been read).
// Read-only. Loaded lazily through LazyMaps.jsx, like SiteMap.

const siteBounds = (s) => {
  if (s.shape === 'POLYGON') return (s.polygon?.length ?? 0) >= 3 ? L.latLngBounds(s.polygon) : null
  return Number.isFinite(s.lat) && Number.isFinite(s.lng) ? L.latLng(s.lat, s.lng).toBounds((s.radiusM || 100) * 2.4) : null
}

/** Fit the matched site and the person in view; with no fix, all the sites. Refits when the fix or the site changes. */
function Fit({ sites, fix, focus }) {
  const map = useMap()
  const key = `${fix?.lat},${fix?.lng},${focus?.id},${sites.length}`
  useEffect(() => {
    const pool = focus ? [focus] : sites
    let b = null
    for (const s of pool) { const sb = siteBounds(s); if (sb) b = b ? b.extend(sb) : sb }
    if (fix) { const fb = L.latLng(fix.lat, fix.lng).toBounds(Math.max(fix.accuracy || 0, 40) * 2); b = b ? b.extend(fb) : fb }
    if (b) map.fitBounds(b, { padding: [28, 28], maxZoom: 18 })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** sites: [{ id, name, shape, lat, lng, radiusM, polygon }] · fix: { lat, lng, accuracy } | null · focus: the nearest site */
export default function PunchMap({ sites = [], fix = null, focus = null, height = 300 }) {
  const [colour] = useState(brandColour)
  const first = sites[0]
  const center = fix ? [fix.lat, fix.lng] : first?.lat != null ? [first.lat, first.lng] : [20.59, 78.96]
  return (
    <div className="punch-map">
    <BaseMap center={center} zoom={fix || first ? 16 : 5} height={height}>
      {sites.map((s) => <SiteShape key={s.id} site={s} colour={colour} faint={!!focus && focus.id !== s.id} label={s.name} />)}
      <FixMark fix={fix} />
      <Fit sites={sites} fix={fix} focus={focus} />
    </BaseMap>
    </div>
  )
}
