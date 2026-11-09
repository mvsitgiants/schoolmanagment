import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, BookCopy, DoorOpen, HelpCircle, Receipt, ScanQrCode, UserRound, UsersRound } from 'lucide-react'
import { Modal, StatusPill } from '../system'
import Button from '../ui/Button'
import { fetchGates, resolveCode } from '../../api/scan'
import { ScanDialog, scanFeedback } from './Scanner'

const KIND_ICON = { STUDENT: UserRound, STAFF: UsersRound, BOOK: BookCopy, RECEIPT: Receipt, CERTIFICATE: Award, UNKNOWN: HelpCircle }
export const OPEN_SCAN_EVENT = 'sg:open-scan'
export const openScan = () => window.dispatchEvent(new Event(OPEN_SCAN_EVENT))

/**
 * The app's Scan button (top bar and the phone's tab bar both open it): point the camera at any card, book label,
 * receipt or certificate and it says what it is, with the next steps the person may take. Mounted once, in the top bar.
 */
export default function GlobalScan() {
  const { t } = useTranslation('scan')
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
              {result.kind === 'UNKNOWN' && <p className="text-sm text-ink-muted">{result.error ?? t('scan.unknownHint')}</p>}
              {result.actions?.length > 0 && (
                <div className="grid gap-2">
                  {result.actions.map((a) => <Button key={a.key} variant={a === result.actions[0] ? 'primary' : 'secondary'} className="w-full" onClick={() => go(a.link)}>{t(`scan.action.${a.key}`)}</Button>)}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
