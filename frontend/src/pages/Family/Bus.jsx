import { useTranslation } from 'react-i18next'
import { Bus, CheckCircle2, Circle, ExternalLink, Phone } from 'lucide-react'
import { StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyBus } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const EVENT_TONE = { BOARDED: 'success', DROPPED: 'info', ABSENT: 'warning' }

/** The family app › Bus: the child's route and stop, today's pickup and drop, and where the bus is now. */
export default function FamilyBus() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { time } = useFormat()
  const { data: b, isLoading, error } = useFamilyQuery(['bus'], () => familyBus(slug, studentId), { refetchInterval: 30_000 })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!b.assigned) return <FCard><FEmpty icon={Bus} title={t('family.bus.none')} hint={t('family.bus.noneHint')} /></FCard>
  return (
    <>
      {b.live && (
        <FCard title={t('family.bus.liveTitle')}>
          <p className="text-[15px] font-semibold text-ink">
            {b.live.minutes != null ? t('family.bus.minutesAway', { count: b.live.minutes }) : t('family.bus.onTheWay')}
          </p>
          <p className="text-xs text-ink-muted">{t('family.bus.seenAt', { time: time(b.live.at) })}{b.live.metres != null && ` · ${t('family.bus.km', { km: (b.live.metres / 1000).toFixed(1) })}`}</p>
          {b.live.map && <iframe title={t('family.bus.map')} src={b.live.map} loading="lazy" referrerPolicy="no-referrer" className="mt-3 h-56 w-full rounded-xl border border-border" />}
          {b.live.link && <a href={b.live.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><ExternalLink className="w-4 h-4" />{t('family.bus.openMap')}</a>}
        </FCard>
      )}
      <FCard title={t('family.bus.today')}>
        <div className="divide-y divide-border">
          {b.trips.map((trip) => {
            const last = trip.events[trip.events.length - 1]
            return (
              <div key={trip.kind} className="flex items-center gap-3 py-2">
                {trip.status === 'DONE' || trip.reachedMyStop ? <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" /> : <Circle className="w-5 h-5 text-ink-faint shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{t(`family.bus.kinds.${trip.kind}`)}</p>
                  <p className="text-xs text-ink-muted">{t(`family.bus.status.${trip.status}`)}{trip.reachedMyStop && trip.status === 'RUNNING' ? ` · ${t('family.bus.passedStop')}` : ''}</p>
                </div>
                {last && <StatusPill tone={EVENT_TONE[last.event]}>{t(`family.bus.events.${last.event}`, { time: time(last.at) })}</StatusPill>}
              </div>
            )
          })}
        </div>
      </FCard>
      <FCard title={t('family.bus.routeTitle')}>
        <p className="text-[15px] font-semibold text-ink">{b.route}</p>
        {b.stop && (
          <div className="mt-1 text-sm text-ink-muted">
            <p>{t('family.bus.stop', { name: b.stop.name })}</p>
            {b.stop.landmark && <p className="text-xs">{b.stop.landmark}</p>}
            <p className="mt-1">{[b.mode !== 'DROP' && b.stop.pickupTime && t('family.bus.pickupAt', { time: b.stop.pickupTime }), b.mode !== 'PICKUP' && b.stop.dropTime && t('family.bus.dropAt', { time: b.stop.dropTime })].filter(Boolean).join(' · ')}</p>
          </div>
        )}
        {b.vehicle && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-ink-muted">{t('family.bus.vehicle', { reg: b.vehicle.regNo })}</p>
            {[['driver', b.vehicle.driver, b.vehicle.driverMobile], ['attendant', b.vehicle.attendant, b.vehicle.attendantMobile]].filter(([, name]) => name).map(([role, name, mobile]) => (
              <div key={role} className="flex items-center justify-between gap-2">
                <span className="text-ink">{t(`family.bus.${role}`, { name })}</span>
                {mobile && <a href={`tel:${mobile}`} className="inline-flex min-h-[44px] items-center gap-1 text-brand-700"><Phone className="w-4 h-4" />{t('family.bus.call')}</a>}
              </div>
            ))}
          </div>
        )}
      </FCard>
    </>
  )
}
