import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, DoorOpen, LogIn, LogOut, ScanQrCode, XCircle } from 'lucide-react'
import { Note, PageContainer, PageHeader, Panel, SegmentedControl, SideNav, SideNavLayout, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { ScanDialog, scanFeedback } from '../../components/scan/Scanner'
import { fetchGates, gateScan } from '../../api/scan'
import { useFormat } from '../../context/SettingsContext'

const OK_OUTCOMES = ['GATE', 'MARKED_PRESENT', 'ATTENDANCE']
const KEEP = 30 // scans shown on screen
const remember = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private window */ } }
const recall = (k) => { try { return localStorage.getItem(k) } catch { return null } }

/**
 * Attendance › Gate scanner: a phone or tablet at the gate, set up in Integrations › Devices as a "Phone / tablet
 * scanner". Scan cards as children (or staff) come in and go out; each scan goes the same way as a card reader's —
 * the gate log, "reached school" to the family, and (if the scanner is set to) present in today's register.
 */
export default function Gate() {
  const { t } = useTranslation('scan')
  const { time } = useFormat()
  const { data: gates = [], isLoading } = useQuery({ queryKey: ['scan-gates'], queryFn: fetchGates })
  const [gateId, setGateId] = useState(() => recall('sg-gate') ?? '')
  const [direction, setDirection] = useState('IN')
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState([]) // newest first: { id, at, name, outcome, ok, note }
  useEffect(() => { if (gates.length && !gates.some((g) => g.id === gateId)) setGateId(gates[0].id) }, [gates, gateId])
  useEffect(() => { if (gateId) remember('sg-gate', gateId) }, [gateId])
  const gate = gates.find((g) => g.id === gateId)

  const onCode = async (code) => {
    const at = new Date()
    const id = `${at.getTime()}-${Math.random()}`
    setLog((l) => [{ id, at, name: code, pending: true }, ...l].slice(0, KEEP))
    try {
      const r = await gateScan(gateId, code, direction)
      const ok = r.ok && OK_OUTCOMES.includes(r.outcome)
      if (!ok) scanFeedback(false)
      setLog((l) => l.map((x) => (x.id === id ? { ...x, pending: false, name: r.name ?? code, outcome: r.duplicate ? 'DUPLICATE' : r.outcome, ok, note: r.error ?? r.note } : x)))
    } catch (e) {
      scanFeedback(false)
      setLog((l) => l.map((x) => (x.id === id ? { ...x, pending: false, ok: false, outcome: 'UNKNOWN', note: e.message || t('scan.gate.offline') } : x)))
    }
  }
  const okCount = log.filter((x) => x.ok).length

  const recent = (
    <Panel title={t('scan.gate.recent')} subtitle={t('scan.gate.scanned', { count: okCount })} flush>
      {log.length ? (
        <ul className="divide-y divide-border max-h-[50vh] overflow-y-auto">
          {log.map((x) => {
            const Icon = x.pending ? ScanQrCode : x.ok ? CheckCircle2 : x.outcome === 'DUPLICATE' ? CircleAlert : XCircle
            return (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                <Icon className={`w-5 h-5 shrink-0 ${x.pending ? 'text-ink-faint animate-pulse' : x.ok ? 'text-success-600' : x.outcome === 'DUPLICATE' ? 'text-amber-600' : 'text-danger-600'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{x.name}</span>
                  {x.note && <span className="block text-xs text-ink-muted truncate">{x.note}</span>}
                </span>
                <span className="shrink-0 text-end">
                  {x.outcome && <StatusPill tone={x.ok ? 'success' : x.outcome === 'DUPLICATE' ? 'warning' : 'danger'}>{t(`scan.gate.outcome.${x.outcome}`, x.outcome)}</StatusPill>}
                  <span className="block text-[11px] text-ink-faint tabular-nums mt-0.5">{time(x.at)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : <p className="px-4 py-6 text-sm text-ink-faint text-center">{t('scan.gate.emptyRecent')}</p>}
    </Panel>
  )

  return (
    <PageContainer>
      <PageHeader icon={DoorOpen} title={t('scan.gate.title')} subtitle={t('scan.gate.subtitle')} />
      {!isLoading && !gates.length ? <Note tone="warning">{t('scan.gate.none')}</Note> : (
        <SideNavLayout nav={gates.length > 1 && (
          <SideNav title={t('scan.gate.pick')} value={gateId} onChange={setGateId} items={gates.map((g) => ({ id: g.id, label: g.name, icon: DoorOpen, hint: g.usedFor === 'STAFF' ? t('scan.gate.staff') : t('scan.gate.students') }))} />
        )}>
          {gate && (
            <Panel>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="font-semibold text-ink">{gate.name}</p>
                  <p className="text-xs text-ink-muted">{gate.usedFor === 'STAFF' ? t('scan.gate.staff') : t('scan.gate.students')}{gate.autoMarkAttendance ? ` · ${t('scan.gate.marksPresent')}` : ''}</p>
                </div>
                <SegmentedControl size="md" value={direction} onChange={setDirection} options={[{ value: 'IN', label: t('scan.gate.in'), icon: LogIn }, { value: 'OUT', label: t('scan.gate.out'), icon: LogOut }]} />
                <Button size="lg" icon={ScanQrCode} className="w-full sm:w-auto" onClick={() => setScanning(true)}>{t('scan.gate.start')}</Button>
              </div>
            </Panel>
          )}
          {recent}
        </SideNavLayout>
      )}
      <ScanDialog open={scanning} continuous onClose={() => setScanning(false)} onCode={onCode} title={`${gate?.name ?? ''} · ${direction === 'IN' ? t('scan.gate.in') : t('scan.gate.out')}`}>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {log.slice(0, 3).map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate text-ink">{x.name}</span>
              {x.outcome ? <StatusPill tone={x.ok ? 'success' : x.outcome === 'DUPLICATE' ? 'warning' : 'danger'}>{t(`scan.gate.outcome.${x.outcome}`, x.outcome)}</StatusPill> : <span className="text-xs text-ink-faint">…</span>}
            </li>
          ))}
          {!log.length && <li className="px-3 py-2 text-sm text-ink-faint">{t('scan.gate.emptyRecent')}</li>}
        </ul>
      </ScanDialog>
    </PageContainer>
  )
}
