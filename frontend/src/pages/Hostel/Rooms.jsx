import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, BedDouble, Ban, Building2, CalendarDays, DoorOpen, LayoutGrid, LogIn, LogOut, Pencil, Phone, Plus, Ticket, Unlock, UserRound } from 'lucide-react'
import {
  Drawer, EmptyState, HeaderButton, PageContainer, PageHeader, PhoneLink, RecordHero, SegmentedControl, SideNavLayout, Skeleton, StatCardRow, Tag, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { BedGlyph, BedLegend, BlockKindTag, BlockNav, RoomCard, useHostelLabels } from '../../components/hostel/HostelKit'
import { BlockModal, BulkRoomsModal, RoomModal } from '../../components/hostel/RoomForms'
import { AllotModal, CheckoutModal, MoveModal } from '../../components/hostel/AllotForms'
import { fetchHostelBoard, setBedState } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/** One bed: who sleeps there and since when, or hold / block / free it, or allot it. */
function BedDrawer({ bed, onClose, onChanged, onAllot, onMove, onCheckout }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const prompt = usePrompt()
  const navigate = useNavigate()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  if (!bed) return null
  const a = bed.allotment
  const s = a?.student
  const canBeds = hasPermission('hostel.rooms.edit') || hasPermission('hostel.allotment.allot')
  const act = async (state, ask) => {
    let note
    if (ask) { note = await prompt(ask); if (!note) return }
    try { await setBedState(bed.roomId, bed.id, { state, note }); showSuccess(t('hostel.board.bedSaved')); onChanged() } catch (e) { showError(e.message) }
  }
  return (
    <Drawer open onClose={onClose} title={t('hostel.board.bedTitle', { code: bed.code })} subtitle={[bed.blockName, L.floor(bed.floor), L.roomType(bed.roomType)].filter(Boolean).join(' · ')}>
      <div className="space-y-4">
        <div className="flex items-center gap-3"><BedGlyph state={bed.state} size={56} /><Tag tone={bed.state === 'FREE' ? 'success' : bed.state === 'OCCUPIED' ? 'brand' : bed.state === 'RESERVED' ? 'info' : 'neutral'}>{L.bed(bed.state)}</Tag>{a?.out && <Tag tone="violet" icon={LogOut}>{t('hostel.board.outNow')}</Tag>}</div>
        {s ? (
          <RecordHero name={s.name} subtitle={[s.className, s.admissionNo].filter(Boolean).join(' · ')}
            facts={[
              { icon: CalendarDays, label: t('hostel.board.since'), value: date(a.from) },
              { icon: UserRound, label: t('hostel.board.guardian'), value: s.guardian ?? '—' },
              { icon: Phone, label: t('hostel.board.mobile'), value: s.mobile ? <PhoneLink number={s.mobile} /> : '—' },
            ]} />
        ) : bed.note ? <p className="text-sm text-ink">{bed.note}</p> : null}
        <div className="flex flex-col gap-2">
          {!a && bed.state !== 'BLOCKED' && hasPermission('hostel.allotment.allot') && <Button icon={LogIn} onClick={() => onAllot(bed)}>{t('hostel.board.allotHere')}</Button>}
          {a && hasPermission('hostel.allotment.allot') && <Button variant="secondary" icon={ArrowRightLeft} onClick={() => onMove(bed)}>{t('hostel.board.move')}</Button>}
          {a && hasPermission('hostel.allotment.checkout') && <Button variant="secondary" icon={DoorOpen} onClick={() => onCheckout(bed)}>{t('hostel.board.checkout')}</Button>}
          {a && hasPermission('hostel.outpass.create') && <Button variant="ghost" icon={Ticket} onClick={() => navigate(`/hostel/outpass?studentId=${s?.id}`)}>{t('hostel.board.outpass')}</Button>}
          {!a && bed.state === 'FREE' && canBeds && <Button variant="ghost" icon={BedDouble} onClick={() => act('RESERVED', { title: t('hostel.board.reserveTitle', { code: bed.code }), label: t('hostel.board.reserveFor'), required: true })}>{t('hostel.board.reserve')}</Button>}
          {!a && bed.state === 'FREE' && canBeds && <Button variant="ghost" icon={Ban} onClick={() => act('BLOCKED', { title: t('hostel.board.blockTitle', { code: bed.code }), label: t('hostel.board.why'), required: true })}>{t('hostel.board.block')}</Button>}
          {!a && bed.state !== 'FREE' && canBeds && <Button variant="ghost" icon={Unlock} onClick={() => act('FREE')}>{t('hostel.board.free')}</Button>}
        </div>
      </div>
    </Drawer>
  )
}

/** Hostel › Rooms & beds: the bed board — blocks down the left, each floor's rooms as cards of beds. */
export default function HostelRooms() {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [blockId, setBlockId] = useState('')
  const [show, setShow] = useState('ALL')
  const [open, setOpen] = useState(null) // a bed
  const [modal, setModal] = useState(null) // { kind, … }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['hostel', 'board'], queryFn: fetchHostelBoard, refetchInterval: 60_000 })
  const blocks = data?.blocks ?? []
  const shown = blocks.filter((b) => !blockId || b.id === blockId)
  const c = data?.counts
  const refresh = () => { qc.invalidateQueries({ queryKey: ['hostel'] }); setOpen(null) }
  const done = (msg) => (r) => { setModal(null); refresh(); if (r?.warning) showError(r.warning); else showSuccess(msg) }
  const openBed = (b, room, block) => setOpen({ ...b, roomId: room.id, roomType: room.type, floor: room.floor, blockName: block.name })
  const allotmentOf = (bed) => ({ id: bed.allotment.id, student: bed.allotment.student, bedId: bed.id, bedCode: bed.code })
  const canCreate = hasPermission('hostel.rooms.create')
  const canEdit = hasPermission('hostel.rooms.edit')

  return (
    <PageContainer>
      <PageHeader icon={BedDouble} title={t('hostel.board.title')} subtitle={t('hostel.board.subtitle')}
        actions={<>
          {canCreate && <HeaderButton icon={Building2} onClick={() => setModal({ kind: 'block' })}>{t('hostel.board.addBlock')}</HeaderButton>}
          {canCreate && blocks.length > 0 && <HeaderButton icon={LayoutGrid} onClick={() => setModal({ kind: 'bulk' })}>{t('hostel.board.addRooms')}</HeaderButton>}
          {canCreate && blocks.length > 0 && <HeaderButton icon={Plus} variant="primary" onClick={() => setModal({ kind: 'room' })}>{t('hostel.board.addRoom')}</HeaderButton>}
        </>} />
      <StatCardRow items={[
        { icon: BedDouble, tone: 'brand', label: t('hostel.board.occupancy'), value: c ? `${c.occupancy}%` : '—', sub: c ? t('hostel.board.bedsInUse', { occupied: c.OCCUPIED, total: c.total - c.BLOCKED }) : null, progress: c ? c.occupancy : undefined },
        { icon: DoorOpen, tone: 'success', label: t('hostel.board.freeBeds'), value: c?.FREE ?? '—', sub: c ? t('hostel.board.reservedBlocked', { reserved: c.RESERVED, blocked: c.BLOCKED }) : null, onClick: () => setShow((x) => (x === 'FREE' ? 'ALL' : 'FREE')) },
        { icon: LogOut, tone: 'violet', label: t('hostel.board.outOnPass'), value: data?.outNow ?? '—' },
        { icon: Ticket, tone: data?.pendingOutpasses ? 'warning' : 'neutral', label: t('hostel.board.pendingPasses'), value: data?.pendingOutpasses ?? '—' },
      ]} />
      <SideNavLayout nav={blocks.length > 0 && <BlockNav blocks={blocks} value={blockId} onChange={setBlockId} allLabel={t('hostel.nav.allBlocks')} />}>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl value={show} onChange={setShow} options={[{ value: 'ALL', label: t('hostel.board.allBeds') }, { value: 'FREE', label: t('hostel.board.freeOnly'), count: c?.FREE }]} />
          <BedLegend className="ms-auto" />
        </div>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
        ) : error ? <EmptyState error={error} onRetry={refetch} /> : !blocks.length ? (
          <EmptyState icon={BedDouble} title={t('hostel.board.empty')} hint={t('hostel.board.emptyHint')}
            action={canCreate && <Button icon={Building2} onClick={() => setModal({ kind: 'block' })}>{t('hostel.board.addBlock')}</Button>} />
        ) : shown.map((b) => {
          const floors = [...new Set(b.rooms.map((r) => r.floor))].sort((x, y) => x - y)
          return (
            <section key={b.id} className="rounded-2xl border border-border bg-surface/60 shadow-card">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                <h2 className="font-display font-semibold text-ink">{b.name}</h2>
                <BlockKindTag kind={b.kind} />
                {b.warden && <span className="text-xs text-ink-muted">{t('hostel.board.warden', { name: b.warden.name })}{b.warden.mobile && <> · <PhoneLink number={b.warden.mobile} /></>}</span>}
                <span className="ms-auto text-xs text-ink-muted tabular-nums">{t('hostel.board.occupiedRatio', { occupied: b.counts.OCCUPIED, total: b.counts.total })}</span>
                <div className="h-1.5 w-24 rounded-full bg-black/5"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${b.counts.occupancy}%` }} /></div>
                {canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('hostel.board.editBlock')} onClick={() => setModal({ kind: 'block', block: b })} />}
              </header>
              {!b.rooms.length ? (
                <div className="p-4"><EmptyState icon={LayoutGrid} title={t('hostel.board.noRooms')} action={canCreate && <Button size="sm" icon={Plus} onClick={() => setModal({ kind: 'bulk', blockId: b.id })}>{t('hostel.board.addRooms')}</Button>} /></div>
              ) : floors.map((fl) => {
                const rooms = b.rooms.filter((r) => r.floor === fl).map((r) => (show === 'FREE' ? { ...r, beds: r.beds.filter((x) => x.state === 'FREE') } : r)).filter((r) => r.beds.length)
                if (!rooms.length) return null
                return (
                  <div key={fl} className="px-3 py-3">
                    <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{L.floor(fl)}</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {rooms.map((r) => (
                        <RoomCard key={r.id} room={r} selectedBed={open?.id} onBed={(bed, room) => openBed(bed, room, b)}
                          onRoom={canEdit ? () => setModal({ kind: 'room', room: { ...b.rooms.find((x) => x.id === r.id), blockId: b.id } }) : undefined} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}
      </SideNavLayout>
      <BedDrawer bed={open} onClose={() => setOpen(null)} onChanged={refresh}
        onAllot={(bed) => { setOpen(null); setModal({ kind: 'allot', bed }) }}
        onMove={(bed) => { setOpen(null); setModal({ kind: 'move', allotment: allotmentOf(bed) }) }}
        onCheckout={(bed) => { setOpen(null); setModal({ kind: 'checkout', allotment: allotmentOf(bed) }) }} />
      {modal?.kind === 'block' && <BlockModal block={modal.block} onClose={() => setModal(null)} onSaved={done(t('hostel.block.saved'))} />}
      {modal?.kind === 'room' && <RoomModal room={modal.room} blocks={blocks} blockId={blockId} onClose={() => setModal(null)} onSaved={done(t('hostel.room.saved'))} />}
      {modal?.kind === 'bulk' && <BulkRoomsModal blocks={blocks} blockId={modal.blockId ?? blockId} onClose={() => setModal(null)} onSaved={(r) => done(t('hostel.bulk.saved', { count: r?.created ?? 0 }))(null)} />}
      {modal?.kind === 'allot' && <AllotModal blocks={blocks} bed={modal.bed} onClose={() => setModal(null)} onSaved={done(t('hostel.allot.saved'))} />}
      {modal?.kind === 'move' && <MoveModal blocks={blocks} allotment={modal.allotment} onClose={() => setModal(null)} onSaved={done(t('hostel.move.saved'))} />}
      {modal?.kind === 'checkout' && <CheckoutModal allotment={modal.allotment} onClose={() => setModal(null)} onSaved={done(t('hostel.checkout.saved'))} />}
    </PageContainer>
  )
}
