import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarX2, CircleAlert, FileWarning, MessageSquareShare, UsersRound } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, DateCell, HeaderButton, PageContainer, PageHeader, PersonCell, SegmentedControl, StatCardRow, Tag, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { useFileLabels } from '../../components/documentLibrary/LibraryKit'
import { fetchExpiring, fetchLibraryMeta, fetchMissing, tellMissing } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50

/**
 * What is still to come: students missing papers from their campus's admission checklist (the ones needed at admission
 * first), and checked papers about to run out (income certificates…). One message asks each family for exactly those.
 */
export default function Missing() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('missing')
  const [classId, setClassId] = useState('')
  const [kind, setKind] = useState('')
  const [days, setDays] = useState(60)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const canSend = hasPermission('documents.missing.send')

  const { data: meta } = useQuery({ queryKey: ['doc-library', 'meta'], queryFn: fetchLibraryMeta })
  const missingParams = { classId: classId || undefined, kind: kind || undefined, page, pageSize: PAGE }
  const missing = useQuery({ queryKey: ['doc-library', 'missing', missingParams], queryFn: () => fetchMissing(missingParams), placeholderData: keepPreviousData, enabled: tab === 'missing' })
  const expiringParams = { days, page, pageSize: PAGE }
  const expiring = useQuery({ queryKey: ['doc-library', 'expiring', expiringParams], queryFn: () => fetchExpiring(expiringParams), placeholderData: keepPreviousData, enabled: tab === 'expiring' })
  const q = tab === 'missing' ? missing : expiring
  const data = q.data
  const reset = (fn) => (v) => { fn(v); setPage(1); setSelected([]) }

  const tell = useMutation({
    mutationFn: (ids) => tellMissing(ids),
    onSuccess: (r) => { setSelected([]); showSuccess(t('documentLibrary.missing.told', { count: r.sent })) },
    onError: (e) => showError(e.message),
  })
  const tellIds = async (ids) => {
    if (await confirm({ title: t('documentLibrary.missing.tellTitle', { count: ids.length }), message: t('documentLibrary.missing.tellMessage'), confirmLabel: t('documentLibrary.missing.tellConfirm') })) tell.mutate(ids)
  }
  // a student picked on the expiring list is one family, however many of their papers run out
  const pickedStudents = tab === 'missing' ? selected : [...new Set((data?.rows ?? []).filter((r) => selected.includes(r.id)).map((r) => r.studentId))]
  const s = data?.summary

  return (
    <PageContainer>
      <PageHeader icon={FileWarning} title={t('documentLibrary.missing.title')} subtitle={t('documentLibrary.missing.subtitle')}
        actions={canSend && data?.ids?.length > 0 && <HeaderButton icon={MessageSquareShare} variant="primary" onClick={() => tellIds(data.ids)}>{t('documentLibrary.missing.tellAll', { count: data.ids.length })}</HeaderButton>} />

      <SegmentedControl value={tab} onChange={reset(setTab)} options={[{ value: 'missing', label: t('documentLibrary.missing.tabMissing') }, { value: 'expiring', label: t('documentLibrary.missing.tabExpiring') }]} />

      {tab === 'missing' && s && <StatCardRow items={[
        { icon: UsersRound, tone: 'brand', label: t('documentLibrary.missing.statStudents'), value: s.students, sub: t('documentLibrary.missing.statStudentsSub') },
        { icon: FileWarning, tone: s.missingStudents ? 'warning' : 'success', label: t('documentLibrary.missing.statMissing'), value: s.missingStudents, sub: t('documentLibrary.missing.statMissingSub'),
          progress: s.students ? ((s.students - s.missingStudents) / s.students) * 100 : 100 },
        { icon: CircleAlert, tone: s.neededNow ? 'danger' : 'neutral', label: t('documentLibrary.missing.statNow'), value: s.neededNow, sub: t('documentLibrary.missing.statNowSub') },
      ]} />}
      {tab === 'expiring' && s && <StatCardRow items={[
        { icon: CalendarX2, tone: s.expired ? 'danger' : 'neutral', label: t('documentLibrary.missing.statExpired'), value: s.expired, sub: t('documentLibrary.missing.statExpiredSub') },
        { icon: CircleAlert, tone: s.soon ? 'warning' : 'neutral', label: t('documentLibrary.missing.statSoon'), value: s.soon, sub: t('documentLibrary.missing.statSoonSub', { count: days }) },
      ]} />}

      {tab === 'missing' && s?.byKind?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {s.byKind.map((k) => (
            <button key={k.kind} type="button" onClick={() => reset(setKind)(kind === k.kind ? '' : k.kind)}
              className={`rounded-full border px-3 py-1 text-sm ${kind === k.kind ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink-muted hover:text-ink'}`}>
              {L.kind(k.kind)} <span className="ms-1 tabular-nums font-semibold">{k.n}</span>
            </button>
          ))}
        </div>
      )}

      <BulkActionBar count={selected.length} onClear={() => setSelected([])} noun={tab === 'missing' ? t('documentLibrary.missing.nounStudents') : t('documentLibrary.missing.nounPapers')}>
        {canSend && <Button size="sm" icon={MessageSquareShare} loading={tell.isPending} onClick={() => tellIds(pickedStudents)}>{t('documentLibrary.missing.tellPicked', { count: pickedStudents.length })}</Button>}
      </BulkActionBar>

      {tab === 'missing' ? (
        <DataTable rows={data?.rows ?? []} loading={q.isLoading} error={q.error} onRetry={q.refetch} rowKey="id"
          selectable={canSend} selectedIds={selected} onSelectionChange={setSelected}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
          toolbar={<Toolbar right={<div className="flex flex-wrap gap-2">
            <ControlChip label={t('documentLibrary.filter.class')} active={!!classId} value={classId ? meta?.classes?.find((c) => c.id === classId)?.name : t('documentLibrary.filter.all')}
              options={[{ value: '', label: t('documentLibrary.filter.all') }, ...(meta?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={reset(setClassId)} />
            <ControlChip label={t('documentLibrary.filter.kind')} active={!!kind} value={kind ? L.kind(kind) : t('documentLibrary.filter.all')}
              options={[{ value: '', label: t('documentLibrary.filter.all') }, ...FILE_CATEGORIES.map((c) => ({ value: c.value, label: L.kind(c.value) }))]} onChange={reset(setKind)} />
          </div>} />}
          columns={[
            { key: 'student', header: t('documentLibrary.col.student'), mobileTitle: true, render: (v) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={v?.admissionNo} size={30} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span> },
            { key: 'missing', header: t('documentLibrary.missing.colMissing'), mobilePrimary: true, render: (v) => (
              <div className="flex flex-wrap gap-1.5">{v.map((m) => <Tag key={m.category} tone={m.when === 'NOW' ? 'danger' : 'neutral'}>{L.kind(m.category)}</Tag>)}</div>
            ) },
            { key: 'total', header: t('documentLibrary.missing.colGiven'), align: 'right', mobileHidden: true, render: (v, r) => <span className="tabular-nums text-sm text-ink-muted">{t('documentLibrary.missing.givenOf', { given: v - r.missing.length, total: v })}</span> },
          ]}
          emptyIcon={FileWarning} emptyTitle={t('documentLibrary.missing.empty')} emptyHint={t('documentLibrary.missing.emptyHint')} />
      ) : (
        <DataTable rows={data?.rows ?? []} loading={q.isLoading} error={q.error} onRetry={q.refetch} rowKey="id"
          selectable={canSend} selectedIds={selected} onSelectionChange={setSelected}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
          toolbar={<Toolbar right={<ControlChip label={t('documentLibrary.missing.within')} active value={t('documentLibrary.missing.days', { count: days })}
            options={[30, 60, 90, 180].map((d) => ({ value: String(d), label: t('documentLibrary.missing.days', { count: d }) }))} onChange={(v) => reset(setDays)(Number(v))} />} />}
          columns={[
            { key: 'student', header: t('documentLibrary.col.student'), mobileTitle: true, render: (v) => <span className="flex items-center gap-2 min-w-0"><PersonCell name={v?.name ?? '—'} sub={v?.admissionNo} size={30} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span> },
            { key: 'label', header: t('documentLibrary.missing.colPaper'), mobilePrimary: true, render: (v, r) => <span className="text-sm text-ink">{r.type !== 'OTHER' ? t(`documentLibrary.missing.paper.${r.type}`, v) : v}</span> },
            { key: 'validTill', header: t('documentLibrary.missing.colValidTill'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2"><DateCell value={v} tone={r.expired ? 'danger' : undefined} />{r.expired && <Tag tone="danger">{t('documentLibrary.missing.expired')}</Tag>}</span> },
          ]}
          emptyIcon={CalendarX2} emptyTitle={t('documentLibrary.missing.noneExpiring')} />
      )}
    </PageContainer>
  )
}
