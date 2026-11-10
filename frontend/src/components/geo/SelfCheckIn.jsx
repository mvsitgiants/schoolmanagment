import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Crosshair, Loader2, LogIn, LogOut, MapPin, MapPinOff, ShieldAlert } from 'lucide-react'
import { metresText, nearestSite } from '@schoolgiant/shared'
import { useFormat } from '../../context/SettingsContext'
import { currentLocation } from './geolocation'
import { LazyPunchMap } from './LazyMaps'

/**
 * Punch in / punch out from the phone (staff in My workspace, students in the student app): where you are against the
 * campus check-in areas on a map, the time now, two big buttons and today's punches. The location is read when a button
 * is pressed (and, if the browser already allows it, once when the card opens so the map can show you) — never tracked.
 * The server decides inside or outside; the map is only a preview. Any number of ins and outs a day: the first in and
 * the last out make the day.
 *
 *   status  { enabled, mode, next, siteList: [{ id, name, shape, lat, lng, radiusM, polygon }], today: [{ time, direction, via, siteName, distanceM, outside }] }
 *   punch   async ({ direction, location, locationError }) => result   (throws with the server's reason)
 *   framed  false inside a card that already has a title (the student app)
 */
export default function SelfCheckIn({ status, punch, onDone, title, subtitle, framed = true }) {
  const { t } = useTranslation('geo')
  const { date, time } = useFormat()
  const [busy, setBusy] = useState(null) // 'IN' | 'OUT'
  const [msg, setMsg] = useState(null) // { tone, text }
  const [loc, setLoc] = useState({ state: 'idle' }) // idle · checking · ok { fix } · error { error }
  const [now, setNow] = useState(() => new Date())
  const sites = status?.siteList ?? []
  const geo = status?.enabled && status.mode !== 'OFF'

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(id) }, [])

  const check = async () => {
    setLoc({ state: 'checking' })
    const r = await currentLocation({ timeout: 15_000 })
    setLoc(r.location ? { state: 'ok', fix: r.location } : { state: 'error', error: r.error })
    if (r.error) setMsg({ tone: 'danger', text: t(`geo.location.${r.error}`) })
    return r
  }
  // Show where they are straight away only when the browser already allows it — no permission prompt on page load.
  useEffect(() => {
    if (!geo || !sites.length || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') check() }).catch(() => {})
  }, [geo, sites.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status?.enabled) return null
  const fix = loc.state === 'ok' ? loc.fix : null
  const near = fix && sites.length ? nearestSite(fix, sites) : null
  const next = status.next ?? 'IN'
  // a punch's time as the clock shows it (the server's HH:mm is the fallback)
  const at = (p) => (p?.at ? time(p.at) : p?.time ?? '—')

  const go = async (direction) => {
    setBusy(direction)
    setMsg(null)
    try {
      const r = geo ? await check() : {}
      const res = await punch({ direction, ...(r.location ? { location: r.location } : {}), ...(r.error ? { locationError: r.error } : {}) })
      setMsg({ tone: res.geofence?.outside ? 'warning' : 'success', text: t(direction === 'IN' ? 'geo.self.doneIn' : 'geo.self.doneOut', { time: res.at ? time(res.at) : res.time }) + (res.geofence?.message ? ` ${res.geofence.message}` : '') })
      onDone?.(res)
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message })
    } finally { setBusy(null) }
  }

  // the first cell of the strip: where you are, in plain words
  const where = !geo
    ? { icon: CheckCircle2, tone: 'ok', title: t('geo.self.where.anywhere'), sub: t('geo.self.where.anywhereSub') }
    : !sites.length ? { icon: MapPinOff, tone: 'warn', title: t('geo.self.where.noSites'), sub: t('geo.self.where.noSitesSub') }
      : loc.state === 'checking' ? { icon: Loader2, spin: true, tone: 'idle', title: t('geo.self.where.checking'), sub: t('geo.self.where.checkingSub') }
        : loc.state === 'error' ? { icon: MapPinOff, tone: 'bad', title: t('geo.self.where.off'), sub: t('geo.self.where.offSub') }
          : near?.inside ? { icon: CheckCircle2, tone: 'ok', title: t('geo.self.where.inside'), sub: t('geo.self.where.insideSub', { site: near.site.name }) }
            : near ? { icon: AlertTriangle, tone: 'warn', title: t('geo.self.where.outside'), sub: t('geo.self.where.outsideSub', { distance: metresText(near.distanceM), site: near.site.name }) }
              : { icon: Crosshair, tone: 'idle', title: t('geo.self.where.unknown'), sub: t('geo.self.where.unknownSub') }
  const TONE = { ok: 'bg-success-50 text-success-600', warn: 'bg-amber-50 text-amber-600', bad: 'bg-danger-50 text-danger-600', idle: 'bg-black/[0.04] text-ink-muted' }
  const SUB = { ok: 'text-success-700', warn: 'text-amber-700', bad: 'text-danger-700', idle: 'text-ink-muted' }
  const firstIn = status.today?.find((p) => p.direction === 'IN')
  const lastOut = [...(status.today ?? [])].reverse().find((p) => p.direction === 'OUT')

  const body = (
    <div className="flex flex-col gap-3">
      {/* where · time · site */}
      <div className="grid grid-cols-2 sm:grid-cols-[1.3fr_1fr_1fr] rounded-xl border border-border bg-bg/60 [&>*]:border-border max-sm:[&>*:first-child]:border-b sm:[&>*:not(:first-child)]:border-s max-sm:[&>*:last-child]:border-s">
        <div className="col-span-2 sm:col-span-1 flex items-center gap-3 px-3 py-2.5 min-w-0">
          <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 ${TONE[where.tone]}`}><where.icon className={`w-[18px] h-[18px] ${where.spin ? 'animate-spin' : ''}`} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink leading-tight">{where.title}</span>
            <span className={`block text-xs mt-0.5 ${SUB[where.tone]}`}>{where.sub}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-full shrink-0 bg-sky-50 text-sky-600"><Clock3 className="w-[18px] h-[18px]" /></span>
          <span><span className="block text-xs text-ink-muted">{t('geo.self.timeNow')}</span><span className="block text-lg font-semibold tabular-nums text-ink leading-tight">{time(now)}</span></span>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-full shrink-0 bg-violet-50 text-violet-600"><MapPin className="w-[18px] h-[18px]" /></span>
          <span className="min-w-0"><span className="block text-xs text-ink-muted">{t('geo.self.site')}</span><span className="block text-sm font-semibold text-ink truncate">{near?.site.name ?? (sites.length === 1 ? sites[0].name : sites.length ? t('geo.self.sitesN', { count: sites.length }) : '—')}</span></span>
        </div>
      </div>

      {/* map · buttons */}
      <div className={geo && sites.length ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]' : 'grid gap-3'}>
        {geo && sites.length > 0 && (
          <div className="relative min-w-0">
            <LazyPunchMap sites={sites} fix={fix} focus={near?.site ?? null} height={260} />
            <div className="pointer-events-none absolute start-12 end-2 top-2 z-[500] flex justify-between gap-2">
              {near && <span className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-white/95 px-2.5 py-1 text-xs font-medium shadow-sm ${near.inside ? 'border-success-200 text-success-700' : 'border-amber-200 text-amber-700'}`}>{near.inside ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{near.inside ? t('geo.self.where.inside') : metresText(near.distanceM)}</span>}
              <button type="button" onClick={check} disabled={loc.state === 'checking'} className="pointer-events-auto ms-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-white/95 px-2.5 py-1 text-xs font-medium text-ink shadow-sm hover:bg-white disabled:opacity-60">
                <Crosshair className="w-3.5 h-3.5" />{fix ? t('geo.self.recheck') : t('geo.self.checkMe')}
              </button>
            </div>
            {(near?.site ?? sites[0])?.shape !== 'POLYGON' && (
              <span className="pointer-events-none absolute start-2 bottom-2 z-[500] inline-flex items-center gap-1 rounded-full bg-white/95 border border-border px-2.5 py-1 text-[11px] text-ink-muted shadow-sm">
                <MapPin className="w-3 h-3" />{t('geo.self.radius', { distance: metresText((near?.site ?? sites[0]).radiusM) })}{fix?.accuracy ? ` · ${t('geo.self.accuracy', { distance: metresText(fix.accuracy) })}` : ''}
              </span>
            )}
          </div>
        )}
        <div className={geo && sites.length ? 'grid grid-cols-2 lg:grid-cols-1 gap-3 content-start' : 'grid grid-cols-2 gap-3'}>
          {[
            { dir: 'IN', icon: LogIn, label: t('geo.self.punchIn'), hint: t('geo.self.punchInHint') },
            { dir: 'OUT', icon: LogOut, label: t('geo.self.punchOut'), hint: t('geo.self.punchOutHint') },
          ].map((b) => {
            const main = next === b.dir
            const Icon = busy === b.dir ? Loader2 : b.icon
            return (
              <button key={b.dir} type="button" disabled={!!busy} onClick={() => go(b.dir)}
                className={`flex items-center gap-3 rounded-xl px-4 py-4 lg:py-5 text-start transition disabled:opacity-70 ${main
                  ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700'
                  : 'border border-border bg-surface text-ink hover:border-brand-300 hover:bg-brand-50/40'}`}>
                <Icon className={`w-7 h-7 shrink-0 ${busy === b.dir ? 'animate-spin' : ''} ${main ? '' : 'text-brand-600'}`} />
                <span className="min-w-0">
                  <span className="block text-base font-semibold leading-tight">{b.label}</span>
                  <span className={`block text-xs mt-0.5 ${main ? 'text-white/80' : 'text-ink-muted'}`}>{b.hint}</span>
                </span>
              </button>
            )
          })}
          {(firstIn || lastOut) && (
            <p className="col-span-2 lg:col-span-1 text-xs text-ink-muted text-center">
              {t('geo.self.daySummary', { in: firstIn ? at(firstIn) : '—', out: lastOut ? at(lastOut) : '—' })}
            </p>
          )}
        </div>
      </div>

      {msg && (
        <p role="status" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.tone === 'danger' ? 'bg-danger-50 text-danger-700' : msg.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-success-50 text-success-700'}`}>
          {msg.tone === 'danger' ? <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}<span>{msg.text}</span>
        </p>
      )}

      {/* today */}
      <div className="rounded-xl border border-border">
        <p className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-ink border-b border-border"><Clock3 className="w-4 h-4 text-ink-faint" />{t('geo.self.todayTitle')}</p>
        {status.today?.length ? (
          <ul className="divide-y divide-border">
            {status.today.map((p, i) => (
              <li key={`${p.time}-${i}`} className="grid grid-cols-[auto_6.5rem_4.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${p.direction === 'OUT' ? 'bg-ink-faint' : 'bg-success-500'}`} />
                <span className="font-medium text-ink">{p.direction === 'OUT' ? t('geo.self.punchedOut') : t('geo.self.punchedIn')}</span>
                <span className="tabular-nums text-ink">{at(p)}</span>
                <span className="min-w-0 truncate text-xs text-ink-muted inline-flex items-center gap-1.5">
                  {p.outside
                    ? <span className="inline-flex items-center gap-1 text-amber-700 font-medium"><AlertTriangle className="w-3.5 h-3.5" />{t('geo.self.flagged')}</span>
                    : p.via === 'PHONE' || p.via === 'GEO' ? <><MapPin className="w-3.5 h-3.5 text-success-600" />{p.siteName ? `${p.siteName}${p.distanceM != null ? ` · ${metresText(p.distanceM)}` : ''}` : t('geo.self.phone')}</>
                      : p.via ? t('geo.self.viaDevice', { device: p.via }) : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-3 py-3 text-sm text-ink-faint">{t('geo.self.nothingYet')}</p>}
      </div>
      {geo && <p className="text-[11px] text-ink-faint">{t('geo.self.privacy')}</p>}
    </div>
  )

  if (!framed) return body
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600 shrink-0"><MapPin className="w-5 h-5" /></span>
          <span className="min-w-0">
            <span className="block font-display text-base font-semibold text-ink leading-tight">{title ?? t('geo.self.title')}</span>
            <span className="block text-xs text-ink-muted mt-0.5">{subtitle ?? (geo ? t('geo.self.subtitleGeo') : t('geo.self.subtitle'))}</span>
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink shrink-0"><CalendarDays className="w-3.5 h-3.5 text-ink-faint" />{date(now)}</span>
      </div>
      {body}
    </section>
  )
}
