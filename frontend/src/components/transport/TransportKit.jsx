import { useTranslation } from 'react-i18next'
import { DOC_STATES, TRIP_STATUS, VEHICLE_STATUS } from '@schoolgiant/shared'
import { StatusPill } from '../system'

/** Labels for the transport lists (shared values → this namespace's text). */
export function useTransportLabels() {
  const { t } = useTranslation('transport')
  return {
    type: (v) => t(`transport.vehicleTypes.${v}`),
    status: (v) => t(`transport.vehicleStatus.${v}`),
    doc: (v) => t(`transport.docs.${v}`),
    docState: (v) => t(`transport.docStates.${v}`),
    mode: (v) => t(`transport.modes.${v}`),
    trip: (v) => t(`transport.tripKinds.${v}`),
    tripStatus: (v) => t(`transport.tripStatus.${v}`),
    ride: (v) => t(`transport.rideEvents.${v}`),
  }
}

export function DocStatePill({ state }) {
  const L = useTransportLabels()
  if (!state) return null
  return <StatusPill tone={DOC_STATES[state]?.tone ?? 'neutral'}>{L.docState(state)}</StatusPill>
}

export function VehicleStatusPill({ status }) {
  const L = useTransportLabels()
  return <StatusPill tone={VEHICLE_STATUS[status]?.tone ?? 'neutral'}>{L.status(status)}</StatusPill>
}

export function TripStatusPill({ status }) {
  const L = useTransportLabels()
  return <StatusPill tone={TRIP_STATUS[status]?.tone ?? 'neutral'}>{L.tripStatus(status)}</StatusPill>
}

/** An OpenStreetMap frame (the server builds the embed address). */
export function MapFrame({ src, className = 'h-64' }) {
  const { t } = useTranslation('transport')
  if (!src) return null
  return <iframe title={t('transport.map')} src={src} loading="lazy" referrerPolicy="no-referrer" className={`w-full rounded-xl border border-border ${className}`} />
}

/** The browser's position, once (for filling in a stop's place). */
export const currentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error('NO_GEO')); return }
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), reject, { enableHighAccuracy: true, timeout: 15000 })
})
