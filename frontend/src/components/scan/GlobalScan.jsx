import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, BookCopy, Boxes, CalendarHeart, DoorClosed, CheckCircle2, DoorOpen, HandHelping, HelpCircle, Receipt, ScanQrCode, ShieldAlert, Ticket, UserRound, UsersRound, Utensils } from 'lucide-react'
import { Modal, Note, PhoneLink, StatusPill } from '../system'
import Button from '../ui/Button'
import { fetchGates, resolveCode } from '../../api/scan'
import api from '../../api/client'
import { useFormat } from '../../context/SettingsContext'
import { ScanDialog, scanFeedback } from './Scanner'
import { CanteenTokenCard } from '../canteen/TokenScan'

const KIND_ICON = { CANTEEN_TOKEN: Utensils, VISITOR: DoorClosed, ASSET: Boxes, EVENT_PASS: CalendarHeart, MEETING_PASS: UsersRound, PICKUP_PASS: HandHelping, TC: Award, HALL_TICKET: Ticket, STUDENT: UserRound, STAFF: UsersRound, BOOK: BookCopy, RECEIPT: Receipt, CERTIFICATE: Award, UNKNOWN: HelpCircle }
export const OPEN_SCAN_EVENT = 'sg:open-scan'
export const openScan = () => window.dispatchEvent(new Event(OPEN_SCAN_EVENT))

/**
 * The app's Scan button (top bar and the phone's tab bar both open it): point the camera at any card, book label,
 * receipt or certificate and it says what it is, with the next steps the person may take. Mounted once, in the top bar.
 */
export default function GlobalScan() {
  const { t } = useTranslation('scan')
  const { date, time } = useFormat()
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ...resolve } or { error }
  const { data: gates = [] } = useQuery({ queryKey: ['scan-gates'], queryFn: fetchGates, enabled: scanning, staleTime: 5 * 60_000, retry: false })
  useEffect(() => {
    const open = () => { setResult(null); setScanning(true) }
    window.addEventListener(OPEN_SCAN_EVENT, open)
    return () => window.removeEventListener(OPEN_SCAN_EVENT, open)
  }, [])
  const look = async (code) => {
    setBusy(true)
    try {
      const r = await resolveCode(code)
      if (r.kind === 'UNKNOWN') scanFeedback(false)
      setResult(r)
    } catch (e) {
      scanFeedback(false)
      setResult({ kind: 'UNKNOWN', title: code, error: e.message })
    } finally { setBusy(false) }
  }
  // an action that changes something (check in, hand over) runs here and shows the pass again, updated
  const run = async (post) => {
    setBusy(true)
    try { setResult((await api.post(post)).data.data) } catch (e) { scanFeedback(false); setResult((r) => ({ ...r, error: e.message })) } finally { setBusy(false) }
  }
  const go = (link) => {
    setResult(null)
    if (/^https?:/i.test(link)) window.open(link, '_blank', 'noopener')
    else navigate(link)
  }
  const Icon = KIND_ICON[result?.kind] ?? HelpCircle
  return (
    <>
      <ScanDialog open={scanning} onClose={() => setScanning(false)} onCode={look} title={t('scan.title')} hint={t('scan.anyHint')}>
        {gates.length > 0 && (
          <Button size="sm" variant="secondary" icon={DoorOpen} className="w-full" onClick={() => { setScanning(false); navigate('/scan/gate') }}>{t('scan.openGate')}</Button>
        )}
      </ScanDialog>
      {(busy || result) && (
        <Modal open onClose={() => setResult(null)} size="sm" title={busy ? t('scan.looking') : t(`scan.kind.${result.kind}`)} footer={!busy && <>
          <Button variant="secondary" icon={ScanQrCode} onClick={() => { setResult(null); setScanning(true) }}>{t('scan.again')}</Button>
        </>}>
          {busy ? <div className="h-16 rounded-lg bg-black/[0.04] animate-pulse" /> : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink break-words">{result.title}</p>
                  {result.subtitle && <p className="text-sm text-ink-muted break-words">{result.subtitle}</p>}
                  {result.status && <StatusPill tone="warning" className="mt-1">{t(`scan.status.${result.status}`, result.status)}</StatusPill>}
                </div>
              </div>
              {result.kind === 'HALL_TICKET' && result.admitCardHeld && <Note tone="danger">{t('scan.exam.held')}</Note>}
              {result.kind === 'HALL_TICKET' && (result.papers?.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {result.papers.map((p) => (
                    <li key={`${p.subject}-${p.startTime}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0"><span className="block text-sm font-medium text-ink truncate">{p.subject}</span><span className="block text-xs text-ink-muted tabular-nums">{p.startTime}–{p.endTime}</span></span>
                      <span className="text-end text-sm font-semibold text-ink">{p.room ? t('scan.exam.roomSeat', { room: p.room, seat: p.seat ?? '—' }) : <span className="font-normal text-ink-faint">{t('scan.exam.notSeated')}</span>}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-amber-700">{result.nextDate ? t('scan.exam.notToday', { date: date(result.nextDate) }) : t('scan.exam.noMore')}</p>)}
              {['EVENT_PASS', 'MEETING_PASS', 'PICKUP_PASS'].includes(result.kind) && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${result.checkedInAt || result.usedAt ? 'bg-success-50 text-success-700' : result.valid ? 'bg-brand-50 text-brand-800' : 'bg-danger-50 text-danger-700'}`}>
                  {result.valid || result.checkedInAt || result.usedAt ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
                  <span>{result.usedAt ? t('scan.pass.handedOver', { time: time(result.usedAt), by: result.usedBy ?? '' })
                    : result.checkedInAt ? t('scan.pass.checkedIn', { time: time(result.checkedInAt) })
                      : result.valid ? t(`scan.pass.valid.${result.kind}`) : t('scan.pass.notValid')}</span>
                </div>
              )}
              {result.kind === 'PICKUP_PASS' && result.person && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('scan.pass.collectedBy')}</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{result.person.name}{result.person.relation ? <span className="text-sm font-normal text-ink-muted"> · {result.person.relation}</span> : null}</p>
                  {result.person.mobile && <PhoneLink number={result.person.mobile} />}
                  {result.reason && <p className="mt-1 text-sm text-ink-muted">{result.reason}</p>}
                  {result.valid && <p className="mt-2 text-xs text-amber-700">{t('scan.pass.checkId')}</p>}
                </div>
              )}
              {result.kind === 'STUDENT' && result.gatePass && (
                <div className={`rounded-lg p-3 text-sm ${result.gatePass.status === 'LEFT' ? 'bg-success-50 text-success-800' : 'bg-amber-50 text-amber-900'}`}>
                  <p className="font-semibold">{result.gatePass.status === 'LEFT' ? t('scan.gatePass.left', { time: time(result.gatePass.leftAt) }) : t('scan.gatePass.approved', { no: result.gatePass.passNo })}</p>
                  {result.gatePass.collector && <p className="mt-0.5">{t('scan.gatePass.with', { name: result.gatePass.collector, relation: result.gatePass.relation ?? '' })}</p>}
                  {result.gatePass.reason && <p className="mt-0.5 text-xs opacity-80">{result.gatePass.reason}</p>}
                </div>
              )}
              {result.kind === 'STUDENT' && result.outpass && (
                <div className={`rounded-lg p-3 text-sm ${result.outpass.status === 'OUT' ? 'bg-violet-50 text-violet-900' : 'bg-brand-50 text-brand-900'}`}>
                  <p className="font-semibold">{result.outpass.status === 'OUT' ? t('scan.outpass.out', { no: result.outpass.no, time: time(result.outpass.outAt) }) : t('scan.outpass.approved', { no: result.outpass.no })}</p>
                  {result.outpass.returnBy && <p className="mt-0.5">{t('scan.outpass.returnBy', { when: `${date(result.outpass.returnBy)} ${time(result.outpass.returnBy)}` })}</p>}
                  {result.outpass.reason && <p className="mt-0.5 text-xs opacity-80">{result.outpass.reason}</p>}
                </div>
              )}
              {result.kind === 'VISITOR' && (
                <div className={`rounded-lg px-3 py-2.5 text-sm font-medium ${result.outAt ? 'bg-success-50 text-success-700' : 'bg-brand-50 text-brand-800'}`}>
                  {result.outAt ? t('scan.visitor.out', { time: time(result.outAt) }) : t('scan.visitor.inSince', { time: time(result.inAt), badge: result.badgeNo ?? '—' })}
                </div>
              )}
              {result.kind === 'ASSET' && (
                <p className={`rounded-lg px-3 py-2.5 text-sm ${result.lastVerified ? 'bg-success-50 text-success-700' : 'bg-black/[0.04] text-ink-muted'}`}>
                  {result.lastVerified ? t('scan.asset.verified', { when: date(result.lastVerified.at), by: result.lastVerified.by ?? '' }) : t('scan.asset.never')}
                </p>
              )}
              {result.kind === 'CANTEEN_TOKEN' && result.canteen && <CanteenTokenCard result={result} />}
              {result.error && result.kind !== 'UNKNOWN' && <p className="text-sm text-danger-600">{result.error}</p>}
              {result.kind === 'UNKNOWN' && <p className="text-sm text-ink-muted">{result.error ?? t('scan.unknownHint')}</p>}
              {result.actions?.length > 0 && (
                <div className="grid gap-2">
                  {result.actions.map((a) => <Button key={a.key} variant={a === result.actions[0] ? 'primary' : 'secondary'} className="w-full" onClick={() => (a.post ? run(a.post) : go(a.link))}>{t(`scan.action.${a.key}`)}</Button>)}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
