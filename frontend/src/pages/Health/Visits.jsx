import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ambulance, BedSingle, Clock, Home, LogOut, Plus, Stethoscope, Users } from 'lucide-react'
import {
  Avatar, ColumnBars, DataTable, DateInput, EmptyState, HeaderButton, PageContainer, PageHeader, PersonCell, RankBars, Skeleton, StatCardRow, Tag, localIso,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { OutcomePill, TempTag, useHealthLabels } from '../../components/health/HealthKit'
import { CloseVisitModal, VisitModal } from '../../components/health/VisitForms'
import { fetchAllVisits, fetchVisitBoard, fetchVisits } from '../../api/health'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50

/** One person in the sick room now: who, why, temperature, how long, and the button to end the visit. */
function InRoomCard({ v, onClose }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const { time } = useFormat()
  const p = v.person
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50/40 p-3 shadow-card">
      <div className="flex items-center gap-2.5">
        <Avatar name={p.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
          <p className="truncate text-[11px] text-ink-muted">{p.kind === 'STAFF' ? t('health.person.staff') : [p.className, p.admissionNo].filter(Boolean).join(' · ')}</p>
        </div>
        <OutcomePill outcome={v.outcome} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag size="xs" tone="info" icon={Stethoscope}>{L.complaint(v.complaint)}</Tag>
        <TempTag tempC={v.vitals?.tempC} />
        <Tag size="xs" icon={Clock}>{t('health.visits.since', { time: time(v.inAt), min: v.minutes })}</Tag>
      </div>
      {v.treatment && <p className="line-clamp-2 text-xs text-ink-muted">{v.treatment}</p>}
      {onClose && <Button size="sm" variant="secondary" icon={LogOut} onClick={() => onClose(v)}>{t('health.visits.end')}</Button>}
    </article>
  )
}

/** Health › Sick-room visits: who is in the sick room now, today's log, the last weeks' pattern. */
export default function HealthVisits() {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const qc = useQueryClient()
  const { time } = useFormat()
  const { showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState(null)
  const [day, setDay] = useState('')
  const [page, setPage] = useState(1)
  const { data: b, isLoading } = useQuery({ queryKey: ['health', 'board'], queryFn: fetchVisitBoard, refetchInterval: 30_000 })
  // today's log comes whole with the board; an earlier day is fetched a page at a time
  const { data: past, isLoading: loadingPast } = useQuery({ queryKey: ['health', 'visits', day, page], queryFn: () => fetchVisits({ date: day, page, pageSize: PAGE }), enabled: !!day })
  const refresh = () => qc.invalidateQueries({ queryKey: ['health'] })
  const canCreate = hasPermission('health.visits.create')
  const log = day ? past?.rows ?? [] : b?.today ?? []
  const o = b?.outcomes ?? {}

  return (
    <PageContainer>
      <PageHeader icon={Stethoscope} title={t('health.visits.title')} subtitle={t('health.visits.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="health.visits.create" onClick={() => setAdding(true)}>{t('health.visits.new')}</HeaderButton>} />
      <StatCardRow items={[
        { icon: BedSingle, tone: b?.inRoom.length ? 'warning' : 'neutral', label: t('health.visits.inRoom'), value: b?.inRoom.length ?? '—' },
        { icon: Users, tone: 'brand', label: t('health.visits.seenToday'), value: b?.today.length ?? '—', segments: b?.today.length ? Object.entries(o).map(([k, n]) => ({ label: L.outcome(k), value: n })) : undefined },
        { icon: Home, tone: 'violet', label: t('health.visits.sentHome'), value: o.SENT_HOME ?? 0 },
        { icon: Ambulance, tone: o.REFERRED ? 'danger' : 'neutral', label: t('health.visits.referred'), value: o.REFERRED ?? 0 },
      ]} />
      <section className="rounded-2xl border border-border bg-surface shadow-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <BedSingle className="h-4 w-4 text-amber-600" />
          <h2 className="font-display font-semibold text-ink">{t('health.visits.nowTitle')}</h2>
          <span className="text-xs text-ink-faint">{t('health.visits.nowHint')}</span>
        </header>
        <div className="p-3">
          {isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
            : !b?.inRoom.length ? <EmptyState icon={BedSingle} title={t('health.visits.nobodyIn')} hint={t('health.visits.nobodyInHint')} />
              : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{b.inRoom.map((v) => <InRoomCard key={v.id} v={v} onClose={canCreate ? setClosing : undefined} />)}</div>}
        </div>
      </section>
      {b && (
        <div className="grid gap-4 lg:grid-cols-3">
          <ColumnBars className="lg:col-span-2" title={t('health.visits.last14')} items={b.days.map((d) => ({ id: d.date, label: d.date.slice(8, 10), value: d.count, tone: d.date === b.date ? 'warning' : 'brand' }))} />
          <RankBars title={t('health.visits.complaints30')} rows={b.complaints.map((c) => ({ key: c.complaint, label: L.complaint(c.complaint), value: c.count }))} empty={t('health.visits.noVisits')} />
        </div>
      )}
      {b?.frequent.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('health.visits.frequent')}</p>
          <div className="flex flex-wrap gap-3">
            {b.frequent.map((f) => (
              <span key={f.student?.id} className="inline-flex items-center gap-2 rounded-xl border border-border px-2.5 py-1.5">
                <PersonCell name={f.student?.name} sub={f.student?.className} size={26} />
                <Tag size="xs" tone="warning">{t('health.visits.times', { count: f.count })}</Tag>
              </span>
            ))}
          </div>
        </section>
      )}
      <DataTable rows={log} loading={day ? loadingPast : isLoading} exportable exportName="sick-room-visits" exportAll={day ? () => fetchAllVisits({ date: day }) : undefined}
        pagination={day && past && past.total > PAGE ? { page: page - 1, size: PAGE, totalElements: past.total, totalPages: Math.ceil(past.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        title={day ? t('health.visits.logOn') : t('health.visits.logToday')}
        toolbar={<DateInput value={day || b?.date || localIso(new Date())} max={localIso(new Date())} onChange={(e) => { setDay(e.target.value === b?.date ? '' : e.target.value); setPage(1) }} className="w-40" aria-label={t('health.visits.pickDay')} />}
        emptyIcon={Stethoscope} emptyTitle={t('health.visits.emptyLog')}
        rowTone={(v) => (v.outcome === 'REFERRED' ? 'danger' : undefined)}
        columns={[
          { key: 'inAt', header: t('health.visits.in'), width: 70, render: (v) => <span className="text-xs tabular-nums">{time(v)}</span> },
          { key: 'person', header: t('health.visits.who'), mobilePrimary: true, render: (p) => <PersonCell name={p.name} sub={p.kind === 'STAFF' ? t('health.person.staff') : p.className} /> },
          { key: 'complaint', header: t('health.visits.complaint'), render: (v, r) => <span className="flex flex-wrap items-center gap-1"><Tag size="xs" tone="info">{L.complaint(v)}</Tag><TempTag tempC={r.vitals?.tempC} /></span> },
          { key: 'treatment', header: t('health.visits.treatment'), mobileHidden: true, render: (v) => <span className="line-clamp-2 text-xs text-ink-muted">{v ?? '—'}</span> },
          { key: 'outcome', header: t('health.visits.outcome'), render: (v, r) => <span className="flex flex-col items-start gap-0.5"><OutcomePill outcome={v} />{r.outAt && <span className="text-[10.5px] text-ink-faint tabular-nums">{time(r.outAt)} · {t('health.visits.minutes', { count: r.minutes })}</span>}</span> },
        ]} onRowClick={(v) => (canCreate && ['IN_ROOM', 'REST'].includes(v.outcome) ? setClosing(v) : undefined)} />
      {adding && <VisitModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); showSuccess(t('health.visits.saved')) }} />}
      {closing && <CloseVisitModal visit={closing} onClose={() => setClosing(null)} onSaved={(v) => { setClosing(null); refresh(); showSuccess(v.guardianNotified && v.outcome === 'SENT_HOME' ? t('health.visits.closedTold') : t('health.visits.closed')) }} />}
    </PageContainer>
  )
}
