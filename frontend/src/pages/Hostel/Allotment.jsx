import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, BedDouble, DoorOpen, History, LogIn, LogOut, Snowflake, Ticket, Users } from 'lucide-react'
import {
  ColorChip, DataTable, DateCell, Drawer, HeaderButton, PageContainer, PageHeader, PersonCell, PhoneLink, RecordHero, SearchInput, SegmentedControl, SideNavLayout,
  SkeletonLines, StatCardRow, Tag, Timeline,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { BlockNav, OutpassStatusPill, useHostelLabels } from '../../components/hostel/HostelKit'
import { AllotModal, CheckoutModal, MoveModal } from '../../components/hostel/AllotForms'
import { fetchAllotments, fetchHostelBoard, fetchHostelHistory } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/** A student's hostel story: every bed, and their outpasses. */
function HistoryDrawer({ studentId, onClose }) {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const { date } = useFormat()
  const { data, isLoading } = useQuery({ queryKey: ['hostel', 'history', studentId], queryFn: () => fetchHostelHistory(studentId), enabled: !!studentId })
  if (!studentId) return null
  return (
    <Drawer open onClose={onClose} title={data?.student?.name ?? t('hostel.history.title')} subtitle={t('hostel.history.title')} size="lg">
      {isLoading || !data ? <SkeletonLines lines={6} /> : (
        <div className="space-y-5">
          <RecordHero name={data.student.name} subtitle={[data.student.className, data.student.admissionNo].filter(Boolean).join(' · ')}
            facts={[{ icon: Users, label: t('hostel.board.guardian'), value: data.student.guardian ?? '—' }, { label: t('hostel.board.mobile'), value: data.student.mobile ? <PhoneLink number={data.student.mobile} /> : '—' }]} />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hostel.history.beds')}</p>
            <Timeline dense items={data.allotments.map((a) => ({
              id: a.id, icon: a.active ? BedDouble : a.endReason === 'MOVED' ? ArrowRightLeft : DoorOpen, tone: a.active ? 'brand' : 'neutral',
              title: `${a.bedCode} · ${a.block}`, time: a.to ? `${date(a.from)} – ${date(a.to)}` : t('hostel.history.since', { date: date(a.from) }),
              meta: a.active ? t('hostel.history.current') : a.endReason === 'MOVED' ? t('hostel.history.moved') : L.reason(a.endReason),
              body: a.endNote || a.note ? <p className="text-xs text-ink-muted">{a.endNote || a.note}</p> : null,
            }))} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('hostel.history.outpasses')}</p>
            {data.outpasses.length ? (
              <Timeline dense items={data.outpasses.map((o) => ({
                id: o.id, icon: Ticket, tone: o.late ? 'danger' : 'violet', title: `${o.outpassNo} · ${L.outpassKind(o.kind)}`,
                time: `${date(o.leaveDate)} ${o.leaveTime} → ${date(o.returnDate)} ${o.returnTime}`, meta: o.reason, status: <OutpassStatusPill status={o.status} />,
              }))} />
            ) : <p className="text-sm text-ink-faint">{t('hostel.history.noPasses')}</p>}
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** Hostel › Allotment: who lives where; allot a bed, move, check out, and each student's history. */
export default function HostelAllotment() {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [blockId, setBlockId] = useState('')
  const [view, setView] = useState('CURRENT')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [modal, setModal] = useState(null)
  const [historyOf, setHistoryOf] = useState(null)
  const { data: board } = useQuery({ queryKey: ['hostel', 'board'], queryFn: fetchHostelBoard })
  const blocks = board?.blocks ?? []
  const params = { ...(blockId && { blockId }), ...(q && { search: q }), ...(view === 'HISTORY' && { history: '1' }) }
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['hostel', 'allotments', params], queryFn: () => fetchAllotments(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['hostel'] })
  const done = (msg) => (r) => { setModal(null); refresh(); if (r?.warning) showError(r.warning); else showSuccess(msg) }
  const scope = blockId ? blocks.filter((b) => b.id === blockId) : blocks
  const sum = (k) => scope.reduce((n, b) => n + b.counts[k], 0)
  const canAllot = hasPermission('hostel.allotment.allot')
  const canOut = hasPermission('hostel.allotment.checkout')

  const current = [
    { key: 'student', header: t('hostel.allot.student'), mobilePrimary: true, render: (v) => <PersonCell name={v?.name} sub={[v?.className, v?.admissionNo].filter(Boolean).join(' · ') || undefined} /> },
    { key: 'bedCode', header: t('hostel.allot.bed'), render: (v, r) => (
      <span className="flex flex-col items-start gap-1">
        <ColorChip label={v} seed={r.blockId} icon={BedDouble} mono />
        <span className="flex items-center gap-1 text-[11px] text-ink-faint">{[r.block, L.floor(r.floor), L.roomType(r.roomType)].join(' · ')}{r.ac && <Snowflake className="h-3 w-3 text-sky-500" />}</span>
      </span>
    ) },
    { key: 'from', header: t('hostel.allot.since'), mobileHidden: true, render: (v) => <DateCell value={v} /> },
    { key: 'guardian', header: t('hostel.allot.guardian'), mobileHidden: true, render: (_, r) => (r.student?.guardian ? <PersonCell name={r.student.guardian} sub={<PhoneLink number={r.student.mobile} />} size={26} /> : '—') },
    { key: 'out', header: t('hostel.allot.status'), render: (v) => (v ? <Tag size="xs" tone="violet" icon={LogOut}>{t('hostel.board.outNow')}</Tag> : <Tag size="xs" tone="success">{t('hostel.allot.inHostel')}</Tag>) },
    { key: 'id', header: '', align: 'right', width: 96, render: (_, r) => (
      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        {canAllot && <Button size="sm" variant="ghost" icon={ArrowRightLeft} aria-label={t('hostel.board.move')} onClick={() => setModal({ kind: 'move', allotment: r })} />}
        {canOut && <Button size="sm" variant="ghost" icon={DoorOpen} aria-label={t('hostel.board.checkout')} onClick={() => setModal({ kind: 'checkout', allotment: r })} />}
      </span>
    ) },
  ]
  const past = [
    current[0], current[1],
    { key: 'from', header: t('hostel.allot.stay'), render: (v, r) => <span className="text-xs tabular-nums text-ink">{r.to ? `${v} → ${r.to}` : t('hostel.history.since', { date: v })}</span> },
    { key: 'endReason', header: t('hostel.allot.ended'), mobileHidden: true, render: (v, r) => (r.active ? <Tag size="xs" tone="brand">{t('hostel.history.current')}</Tag> : <Tag size="xs" tone={v === 'MOVED' ? 'info' : 'neutral'}>{v === 'MOVED' ? t('hostel.history.moved') : L.reason(v)}</Tag>) },
  ]

  return (
    <PageContainer>
      <PageHeader icon={Users} title={t('hostel.allot.pageTitle')} subtitle={t('hostel.allot.subtitle')}
        actions={canAllot && blocks.length > 0 && <HeaderButton icon={LogIn} variant="primary" onClick={() => setModal({ kind: 'allot' })}>{t('hostel.allot.new')}</HeaderButton>} />
      <SideNavLayout nav={blocks.length > 0 && <BlockNav blocks={blocks} value={blockId} onChange={setBlockId} allLabel={t('hostel.nav.allBlocks')} />}>
        <StatCardRow items={[
          { icon: Users, tone: 'brand', label: t('hostel.allot.living'), value: sum('OCCUPIED'), progress: sum('total') ? Math.round((sum('OCCUPIED') / Math.max(1, sum('total') - sum('BLOCKED'))) * 100) : undefined },
          { icon: BedDouble, tone: 'success', label: t('hostel.board.freeBeds'), value: sum('FREE'), sub: t('hostel.board.reservedBlocked', { reserved: sum('RESERVED'), blocked: sum('BLOCKED') }) },
          { icon: LogOut, tone: 'violet', label: t('hostel.board.outOnPass'), value: blockId ? rows.filter((r) => r.out).length : board?.outNow ?? '—' },
        ]} />
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl value={view} onChange={setView} options={[{ value: 'CURRENT', label: t('hostel.allot.current'), icon: BedDouble }, { value: 'HISTORY', label: t('hostel.allot.history'), icon: History }]} />
          <div className="w-full sm:ms-auto sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder={t('hostel.allot.search')} /></div>
        </div>
        <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} columns={view === 'HISTORY' ? past : current}
          onRowClick={(r) => setHistoryOf(r.studentId)} emptyIcon={BedDouble} emptyTitle={t('hostel.allot.empty')} emptyHint={t('hostel.allot.emptyHint')}
          rowTone={(r) => (r.out ? 'info' : undefined)} exportable exportName="hostel-allotment" />
      </SideNavLayout>
      <HistoryDrawer studentId={historyOf} onClose={() => setHistoryOf(null)} />
      {modal?.kind === 'allot' && <AllotModal blocks={blocks} onClose={() => setModal(null)} onSaved={done(t('hostel.allot.saved'))} />}
      {modal?.kind === 'move' && <MoveModal blocks={blocks} allotment={modal.allotment} onClose={() => setModal(null)} onSaved={done(t('hostel.move.saved'))} />}
      {modal?.kind === 'checkout' && <CheckoutModal allotment={modal.allotment} onClose={() => setModal(null)} onSaved={done(t('hostel.checkout.saved'))} />}
    </PageContainer>
  )
}
