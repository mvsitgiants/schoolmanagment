import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CheckCircle2, LogIn, LogOut, ShieldAlert, UserRound } from 'lucide-react'
import { SegmentedControl } from '../system'
import Button from '../ui/Button'
import { ScanDialog, scanFeedback } from '../scan/Scanner'
import { gateScan, parkIn } from '../../api/parking'
import { useFormat } from '../../context/SettingsContext'
import { Plate, useParkingLabels, useStay } from './ParkingKit'

const MODE_KEY = 'sg.parking.gateMode'
const readMode = () => { try { return localStorage.getItem(MODE_KEY) || 'AUTO' } catch { return 'AUTO' } }
const OK = new Set(['IN', 'OUT'])

/** One scan and what happened: green in, blue out, amber/red when the vehicle can't pass (with what to do). */
function ScanRow({ r, big, onVisitor, onParkAnyway }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const stay = useStay()
  const { date, time } = useFormat()
  const v = r.vehicle
  const tone = r.result === 'IN' ? 'border-success-200 bg-success-50' : r.result === 'OUT' ? 'border-brand-200 bg-brand-50' : r.result === 'ALREADY_IN' || r.result === 'NOT_INSIDE' ? 'border-amber-200 bg-amber-50' : 'border-danger-200 bg-danger-50'
  const Icon = r.result === 'IN' ? LogIn : r.result === 'OUT' ? LogOut : OK.has(r.result) ? CheckCircle2 : ShieldAlert
  const what = {
    IN: t('parking.scan.in', { area: r.entry?.areaName ?? t('parking.form.anyArea') }),
    OUT: t('parking.scan.out', { length: stay(r.entry?.minutes ?? 0) }),
    ALREADY_IN: t('parking.scan.alreadyIn', { time: r.entry ? time(r.entry.inAt) : '' }),
    NOT_INSIDE: t('parking.scan.notInside'),
    NO_PASS: t('parking.scan.noPass'),
    EXPIRED: t('parking.scan.expired', { date: v ? date(v.validTo) : '' }),
    REVOKED: t('parking.scan.revoked'),
    AREA_FULL: t('parking.scan.full', { area: r.area ?? '', inside: r.inside ?? '', capacity: r.capacity ?? '' }),
    REFUSED: r.message ?? '',
  }[r.result]
  return (
    <div className={clsx('rounded-xl border', tone, big ? 'p-4' : 'px-3 py-2')}>
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={clsx('shrink-0', big ? 'h-8 w-8' : 'h-5 w-5', r.result === 'IN' ? 'text-success-600' : r.result === 'OUT' ? 'text-brand-700' : 'text-amber-700')} aria-hidden />
        <Plate plate={r.plate} size={big ? 'lg' : 'md'} />
        <div className="min-w-0 flex-1">
          <p className={clsx('font-semibold text-ink', big && 'text-lg')}>{what}</p>
          {v && <p className="truncate text-xs text-ink-muted">{[v.ownerName, L.owner(v.ownerKind), v.classLabel, v.model].filter(Boolean).join(' · ')}</p>}
        </div>
        {!big && <span className="text-xs tabular-nums text-ink-faint">{time(r.at)}</span>}
      </div>
      {big && (r.result === 'NO_PASS' || r.result === 'EXPIRED' || r.result === 'REVOKED') && r.direction !== 'OUT' && (
        <Button size="sm" variant="secondary" icon={UserRound} className="mt-3" onClick={() => onVisitor(r)}>{t('parking.gate.asVisitor')}</Button>
      )}
      {big && r.result === 'AREA_FULL' && <Button size="sm" variant="secondary" className="mt-3" onClick={() => onParkAnyway(r)}>{t('parking.gate.parkAnyway')}</Button>}
    </div>
  )
}

/**
 * Parking › Gate › Scan at the gate: the camera (or a scanner gun) stays on; every sticker or plate read is recorded
 * at once — Entry gate (in), Exit gate (out), or one gate for both (in when outside, out when parked).
 */
export default function GateScanner({ open, onClose, onVisitor, onChanged }) {
  const { t } = useTranslation('parking')
  const [mode, setMode] = useState(readMode)
  const [recent, setRecent] = useState([])
  const pickMode = (m) => { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* private window */ } }
  const show = (r) => { setRecent((x) => [r, ...x].slice(0, 8)); scanFeedback(OK.has(r.result)); onChanged() }
  const read = useCallback(async (code) => {
    try { show(await gateScan(code, mode)) } catch (e) { show({ code, plate: code.toUpperCase(), result: 'REFUSED', message: e.message, at: new Date() }) }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const parkAnyway = async (r) => {
    try { const e = await parkIn({ vehicleId: r.vehicle.id, overFull: true }); show({ ...r, result: 'IN', entry: e, at: new Date() }) } catch (e) { show({ ...r, result: 'REFUSED', message: e.message, at: new Date() }) }
  }
  const [last, ...before] = recent
  return (
    <ScanDialog open={open} onClose={() => { setRecent([]); onClose() }} onCode={read} continuous title={t('parking.scan.title')} hint={t('parking.scan.hint')}>
      <SegmentedControl value={mode} onChange={pickMode} options={[
        { value: 'IN', label: t('parking.scan.modeIn') }, { value: 'OUT', label: t('parking.scan.modeOut') }, { value: 'AUTO', label: t('parking.scan.modeAuto') },
      ]} />
      {last ? <ScanRow r={last} big onVisitor={(r) => onVisitor({ plate: r.plate, kind: r.vehicle?.kind, name: r.vehicle?.ownerName, mobile: r.vehicle?.ownerMobile })} onParkAnyway={parkAnyway} />
        : <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">{t('parking.scan.waiting')}</p>}
      {!!before.length && <div className="space-y-1.5">{before.map((r, i) => <ScanRow key={`${r.code}${i}${r.at}`} r={r} />)}</div>}
    </ScanDialog>
  )
}
