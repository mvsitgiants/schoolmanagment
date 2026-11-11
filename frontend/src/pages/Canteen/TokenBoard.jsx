import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Bell, BellOff, ChefHat, HandPlatter, Maximize, Minimize, MonitorPlay } from 'lucide-react'
import { CANTEEN_TOKEN_LINGER_MS } from '@schoolgiant/shared'
import { Note, PageContainer, PageHeader, Select } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchTokenBoard } from '../../api/canteen'
import { useCanteenLive } from '../../components/canteen/CanteenKit'
import { startRinging, unlockAudio } from '../../components/comms/ringer'

const REFRESH_MS = 20_000

/** One token on the board: big and easy to read from across the room. */
function TokenTile({ token, tone = 'neutral', faded = false }) {
  return (
    <span className={clsx('flex items-center justify-center rounded-2xl border-2 font-mono-num font-extrabold tabular-nums leading-none transition-opacity',
      'min-h-[88px] sm:min-h-[112px] text-5xl sm:text-6xl xl:text-7xl',
      tone === 'ready' ? 'border-success-300 bg-success-50 text-success-700' : 'border-border bg-surface text-ink',
      faded && 'opacity-35 line-through decoration-4')}>
      {token}
    </span>
  )
}

function Column({ icon: Icon, title, count, highlight, children, empty }) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-2xl border p-3 sm:p-4', highlight ? 'border-success-200 bg-success-50/40' : 'border-border bg-surface')}>
      <h2 className={clsx('mb-3 flex items-center gap-2 font-display text-xl sm:text-2xl font-bold', highlight ? 'text-success-700' : 'text-ink')}>
        <Icon className="w-6 h-6 shrink-0" />{title}<span className="ms-auto font-mono-num text-base font-semibold text-ink-muted">{count}</span>
      </h2>
      {empty ? <p className="py-10 text-center text-base text-ink-faint">{empty}</p> : <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3">{children}</div>}
    </section>
  )
}

/** Canteen › Token board: a TV at the counter — tokens being made, and tokens ready to collect (live). */
export default function TokenBoard() {
  const { t } = useTranslation('canteen')
  const boxRef = useRef(null)
  const [branchId, setBranchId] = useState('')
  const [full, setFull] = useState(false)
  const [chime, setChime] = useState(false)
  const [, tick] = useState(0)
  const { data, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['canteen', 'tokens', branchId],
    queryFn: () => fetchTokenBoard(branchId),
    refetchInterval: REFRESH_MS,
  })
  const campus = data?.branchId ?? null
  const live = useCanteenLive((e) => { if (!campus || !e?.order?.branchId || e.order.branchId === campus) refetch() }, campus)

  // collected tokens fade out: re-draw every few seconds so they drop off on time
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(id) }, [])

  // a soft chime when a new token turns ready (not on the first load)
  const seen = useRef(null)
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.ready.map((o) => o.id))
    if (seen.current && chime && [...ids].some((id) => !seen.current.has(id))) startRinging('ROUTINE')
    seen.current = ids
  }, [data, chime])

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else boxRef.current?.requestFullscreen?.().catch(() => {})
  }
  const toggleChime = () => { unlockAudio(); setChime((c) => !c) }

  // the server's clock, so a token drops off two minutes after it was collected whatever this screen's clock says
  const skew = data ? new Date(data.now).getTime() - dataUpdatedAt : 0
  const now = Date.now() + skew
  const collected = (data?.collected ?? []).filter((o) => o.collectedAt && new Date(o.collectedAt).getTime() + CANTEEN_TOKEN_LINGER_MS > now)
  const preparing = data?.preparing ?? []
  const ready = data?.ready ?? []

  return (
    <PageContainer>
      <div ref={boxRef} className={clsx(full && 'h-full overflow-auto bg-surface p-4 sm:p-6')}>
        <PageHeader icon={MonitorPlay} title={t('canteen.board.title')} subtitle={live ? t('canteen.board.live') : t('canteen.board.polling')}
          actions={<div className="flex flex-wrap items-center gap-2">
            {(data?.branches ?? []).length > 1 && (
              <Select value={campus ?? ''} onChange={(e) => setBranchId(e.target.value)} aria-label={t('canteen.board.campus')} className="min-w-[160px]">
                {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
            <Button variant="secondary" icon={chime ? Bell : BellOff} onClick={toggleChime} aria-pressed={chime}>{chime ? t('canteen.board.chimeOn') : t('canteen.board.chimeOff')}</Button>
            <Button variant="secondary" icon={full ? Minimize : Maximize} onClick={toggleFull}>{full ? t('canteen.board.exitFullScreen') : t('canteen.board.fullScreen')}</Button>
          </div>} />
        {data && !data.tokens && <Note tone="warning" className="mb-4">{t('canteen.board.off')}</Note>}
        {!data ? <div className="grid gap-4 md:grid-cols-2"><div className="h-64 rounded-2xl bg-black/[0.05] animate-pulse" /><div className="h-64 rounded-2xl bg-black/[0.05] animate-pulse" /></div> : (
          <div className="grid gap-4 md:grid-cols-2 items-start">
            <Column icon={ChefHat} title={t('canteen.board.preparing')} count={preparing.length} empty={!preparing.length && t('canteen.board.nonePreparing')}>
              {preparing.map((o) => <TokenTile key={o.id} token={o.token} />)}
            </Column>
            <Column icon={HandPlatter} title={t('canteen.board.ready')} count={ready.length} highlight empty={!ready.length && !collected.length && t('canteen.board.noneReady')}>
              {ready.map((o) => <TokenTile key={o.id} token={o.token} tone="ready" />)}
              {collected.map((o) => <TokenTile key={o.id} token={o.token} faded />)}
            </Column>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
