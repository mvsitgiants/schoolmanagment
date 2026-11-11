import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ScanQrCode, XCircle } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { Note } from '../system'
import Button from '../ui/Button'
import api from '../../api/client'
import { resolveCode } from '../../api/scan'
import { fetchOrderByToken } from '../../api/canteen'
import { useFormat } from '../../context/SettingsContext'
import { ScanDialog, scanFeedback } from '../scan/Scanner'
import { FoodMark, OrderPill, TokenPill } from './CanteenKit'

// Scanning canteen tokens: the slip's QR (SGT1.<order>.<signature>) or the code a child shows in the family app.
// The app's Scan button shows the token (CanteenTokenCard); the counter's "Scan to collect" hands each one over.

/** Why a token can't be handed over now (null when it can): another day, already collected / served, cancelled. */
function blockedReason(c, t, time) {
  if (c.otherDay) return { tone: 'warning', text: t('canteen.scan.otherDay', { date: c.otherDayLabel }) }
  if (c.status === 'COLLECTED') {
    return { tone: 'success', text: c.collectedBy ? t('canteen.scan.alreadyCollected', { time: time(c.collectedAt), by: c.collectedBy }) : t('canteen.scan.alreadyCollectedAt', { time: time(c.collectedAt) }) }
  }
  if (c.status === 'SERVED') return { tone: 'success', text: t('canteen.scan.served') }
  if (c.status === 'CANCELLED') return { tone: 'danger', text: t('canteen.scan.cancelled') }
  return null
}

/** The Scan sheet's view of a token: why it can't be handed over (if so), what is in it, the total and where it stands. */
export function CanteenTokenCard({ result }) {
  const { t } = useTranslation('canteen')
  const { date, time } = useFormat()
  const c = result.canteen
  const why = blockedReason({ ...c, otherDayLabel: c.otherDay && date(c.otherDay) }, t, time)
  return (
    <div className="space-y-3">
      {why && <Note tone={why.tone} className="text-sm">{why.text}</Note>}
      <div className="rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {c.lines.map((l, i) => (
            <li key={`${l.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-ink"><FoodMark mark={l.mark} size={10} /><span className="truncate">{l.name} × {l.qty}</span></span>
              <span className="font-mono-num text-ink-muted">{formatINR(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm font-semibold text-ink">
          <span>{t('canteen.scan.total')}</span><span className="font-mono-num">{formatINR(c.total)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {c.token && ['PLACED', 'READY', 'COLLECTED'].includes(c.status) ? <TokenPill status={c.status} /> : <OrderPill status={c.status} />}
        <span className="text-xs text-ink-muted">{t('canteen.scan.placedAt', { time: time(c.at) })}</span>
      </div>
    </div>
  )
}

/**
 * Canteen › Orders: "Scan to collect" — the camera (or a scanner gun) stays on; every token scanned is handed over
 * (marked collected, ready or not), with a running list of what each scan did. A token number typed in finds today's
 * order with that token at this campus.
 */
export function ScanToCollect({ className }) {
  const { t } = useTranslation('canteen')
  const { date, time } = useFormat()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([])
  const add = (row) => setLog((l) => [{ key: `${Date.now()}-${Math.random()}`, ...row }, ...l].slice(0, 15))
  const fail = (row) => { scanFeedback(false); add({ ...row, ok: false }) }
  const onCode = async (text) => {
    const typed = /^\d{1,5}$/.test(text)
    const asTyped = typed ? t('canteen.tokens.tokenN', { token: Number(text) }) : text
    let r
    try {
      r = typed ? await fetchOrderByToken(Number(text)) : await resolveCode(text)
    } catch (e) {
      fail({ title: asTyped, reason: e?.response?.status === 404 ? t('canteen.scan.notFound') : e.message })
      return
    }
    if (r?.kind !== 'CANTEEN_TOKEN' || !r.canteen) { fail({ title: asTyped.length > 32 ? `${asTyped.slice(0, 32)}…` : asTyped, reason: t('canteen.scan.notToken') }); return }
    const c = r.canteen
    const head = { title: c.token ? t('canteen.tokens.tokenN', { token: c.token }) : c.orderNo, who: c.studentName ?? t('canteen.orders.walkIn') }
    const why = blockedReason({ ...c, otherDayLabel: c.otherDay && date(c.otherDay) }, t, time)
    if (why) { fail({ ...head, reason: why.text }); return }
    const collect = r.actions?.find((a) => a.key === 'canteenCollected')
    if (!collect) { fail({ ...head, reason: t('canteen.scan.noPermission') }); return }
    try {
      await api.post(collect.post)
      add({ ...head, ok: true })
      qc.invalidateQueries({ queryKey: ['canteen'] })
    } catch (e) {
      fail({ ...head, reason: e.message })
    }
  }
  return (
    <>
      <Button variant="secondary" icon={ScanQrCode} className={className} onClick={() => setOpen(true)}>{t('canteen.scan.button')}</Button>
      <ScanDialog open={open} onClose={() => setOpen(false)} onCode={onCode} continuous title={t('canteen.scan.title')} hint={t('canteen.scan.hint')}>
        {log.length === 0 ? <p className="text-center text-xs text-ink-faint">{t('canteen.scan.empty')}</p> : (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-live="polite">
            {log.map((x) => (
              <li key={x.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                {x.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink"><span className="font-semibold">{x.title}</span>{x.who ? ` · ${x.who}` : ''}</span>
                  <span className={`block text-xs ${x.ok ? 'text-success-700' : 'text-danger-700'}`}>{x.ok ? t('canteen.scan.collected') : x.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ScanDialog>
    </>
  )
}
