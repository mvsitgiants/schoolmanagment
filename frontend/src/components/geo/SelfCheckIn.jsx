import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, LogIn, LogOut, MapPin, ShieldAlert } from 'lucide-react'
import { metresText } from '@schoolgiant/shared'
import Button from '../ui/Button'
import { currentLocation } from './geolocation'

/**
 * Check in / check out from the phone (staff in My workspace, students in the student app). Reads the location once,
 * when the button is pressed, and sends it; the server decides inside or outside the campus's attendance sites.
 * Any number of ins and outs a day — the first in and the last out make the day.
 *
 *   status  { enabled, mode, next, today: [{ time, direction, via, siteName, distanceM, outside }] }
 *   punch   async ({ direction, location, locationError }) => result   (throws with the server's reason)
 */
export default function SelfCheckIn({ status, punch, onDone, compact = false }) {
  const { t } = useTranslation('geo')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { tone, text }
  if (!status?.enabled) return null
  const go = async (direction) => {
    setBusy(true)
    setMsg(null)
    try {
      const needsLocation = status.mode !== 'OFF'
      const r = needsLocation ? await currentLocation({ timeout: 15_000 }) : {}
      const res = await punch({ direction, ...(r.location ? { location: r.location } : {}), ...(r.error ? { locationError: r.error } : {}) })
      setMsg({ tone: res.geofence?.outside ? 'warning' : 'success', text: t(direction === 'IN' ? 'geo.self.doneIn' : 'geo.self.doneOut', { time: res.time }) + (res.geofence?.message ? ` ${res.geofence.message}` : '') })
      onDone?.(res)
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message })
    } finally { setBusy(false) }
  }
  const next = status.next ?? 'IN'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" icon={LogIn} variant={next === 'IN' ? 'primary' : 'secondary'} loading={busy && next === 'IN'} disabled={busy} className="min-h-[52px]" onClick={() => go('IN')}>{t('geo.self.checkIn')}</Button>
        <Button size="lg" icon={LogOut} variant={next === 'OUT' ? 'primary' : 'secondary'} loading={busy && next === 'OUT'} disabled={busy} className="min-h-[52px]" onClick={() => go('OUT')}>{t('geo.self.checkOut')}</Button>
      </div>
      {msg && (
        <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.tone === 'danger' ? 'bg-danger-50 text-danger-700' : msg.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-success-50 text-success-700'}`}>
          {msg.tone === 'danger' ? <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}<span>{msg.text}</span>
        </p>
      )}
      <p className="text-xs text-ink-muted flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" />{status.mode === 'OFF' ? t('geo.self.anywhere') : status.sites ? t('geo.self.onCampus') : t('geo.self.noSites')}</p>
      {!compact && status.today?.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {status.today.map((p, i) => (
            <li key={`${p.time}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              {p.direction === 'OUT' ? <LogOut className="w-4 h-4 text-ink-faint shrink-0" /> : <LogIn className="w-4 h-4 text-success-600 shrink-0" />}
              <span className="font-medium tabular-nums text-ink">{p.time}</span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">{p.direction ? t(`geo.self.dir.${p.direction}`) : ''}{p.via === 'PHONE' ? (p.siteName ? ` · ${p.siteName}${p.distanceM != null ? ` · ${metresText(p.distanceM)}` : ''}` : ` · ${t('geo.self.phone')}`) : p.via ? ` · ${p.via}` : ''}</span>
              {p.outside && <span className="text-[11px] font-medium text-amber-700">{t('geo.self.flagged')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
