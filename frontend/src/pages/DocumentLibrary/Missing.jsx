import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarX2, CircleAlert, FilePlus2, FileWarning, MessageSquareShare, School, UsersRound } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, DateCell, HeaderButton, PageContainer, PageHeader, PersonCell, SegmentedControl, StatCardRow, Tag, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { useFileLabels } from '../../components/documentLibrary/LibraryKit'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchExpiring, fetchLibraryMeta, fetchMissing, tellMissing } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50
const SHOW_PAPERS = 3 // chips on a row; the rest as "+2"

/** The class list beside the table: all classes, then each class with how many students it holds here. */
function ClassRail({ classes, byClass, all, value, onChange }) {
  const { t } = useTranslation('documentLibrary')
  const shown = [...(classes ?? []).filter((c) => byClass?.[c.id]), ...(byClass?.none ? [{ id: 'none', name: t('documentLibrary.auto.noClass') }] : [])]
  const item = (id, name, n, icon) => (
    <button key={id || 'all'} type="button" onClick={() => onChange(id)}
      className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm', value === id ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-muted hover:bg-bg hover:text-ink')}>
      {icon}<span className="min-w-0 flex-1 truncate">{name}</span><span className="text-xs tabular-nums text-ink-faint">{n ?? 0}</span>
    </button>
  )
  return (
    <nav aria-label={t('documentLibrary.filter.class')} className="h-max rounded-xl border border-border bg-surface p-2 shadow-card max-lg:max-h-72 max-lg:overflow-y-auto">
      {item('', t('documentLibrary.missing.allClasses'), all, <School className="h-4 w-4 shrink-0" aria-hidden />)}
      <div className="my-1 border-t border-border/60" />
      {shown.length ? shown.map((c) => item(c.id, c.name, byClass[c.id], <UsersRound className="h-4 w-4 shrink-0 opacity-60" aria-hidden />))
        : <p className="px-2 py-1 text-xs text-ink-faint">{t('documentLibrary.missing.noClasses')}</p>}
    </nav>
  )
}

/**
 * What is still to come: students missing papers from their campus's admission checklist (the ones needed at admission
 * first), and checked papers running out (income certificates…). Classes on the left, the students on the right; one
 * message asks each family for exactly what is missing, and "Add papers" opens the student's documents.
 */
export default function Missing() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('missing')
  const [classId, setClassId] = useState('')
  const [kind, setKind] = useState('')
  const [days, setDays] = useState(60)
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const canSend = hasPermission('documents.missing.send')

  const { data: meta } = useQuery({ queryKey: ['doc-library', 'meta'], queryFn: fetchLibraryMeta })
  const missingParams = { classId: classId || undefined, kind: kind || undefined, search: q || undefined, page, pageSize: PAGE }
  const missing = useQuery({ queryKey: ['doc-library', 'missing', missingParams], queryFn: () => fetchMissing(missingParams), placeholderData: keepPreviousData, enabled: tab === 'missing' })
  const expiringParams = { days, classId: classId || undefined, search: q || undefined, page, pageSize: PAGE }
  const expiring = useQuery({ queryKey: ['doc-library', 'expiring', expiringParams], queryFn: () => fetchExpiring(expiringParams), placeholderData: keepPreviousData, enabled: tab === 'expiring' })
  const query = tab === 'missing' ? missing : expiring
  const data = query.data
  const s = data?.summary
  const reset = (fn) => (v) => { fn(v); setPage(1); setSelected([]) }

  const tell = useMutation({
    mutationFn: (ids) => tellMissing(ids),
    onSuccess: (r) => { setSelected([]); showSuccess(t('documentLibrary.missing.told', { count: r.sent })) },
    onError: (e) => showError(e.message),
  })
  const tellIds = async (ids) => {
    if (await confirm({ title: t('documentLibrary.missing.tellTitle', { count: ids.length }), message: t('documentLibrary.missing.tellMessage'), confirmLabel: t('documentLibrary.missing.tellConfirm') })) tell.mutate(ids)
  }
  // a paper picked on the running-out list is one family, however many of their papers run out
  const pickedStudents = tab === 'missing' ? selected : [...new Set((data?.rows ?? []).filter((r) => selected.includes(r.id)).map((r) => r.studentId))]
  const shortKind = (c) => L.kind(c).replace(/\s*[(（][^)）]*[)）]/g, '') // "ID proof (Aadhaar, APAAR, passport)" → "ID proof"
  const openStudent = (id) => navigate(`/students/profile/${id}?tab=documents`)
  const pagination = data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined
  const studentCell = (v) => <span className="flex min-w-0 items-center gap-2"><PersonCell name={v?.name ?? '—'} sub={v?.admissionNo} size={30} />{v?.classShort && <ColorChip label={v.classShort} seed={v.classId ?? v.classShort} />}</span>
  const rowActions = (studentId) => (
    <span className="inline-flex items-center gap-0.5">
      <Button size="sm" variant="ghost" icon={FilePlus2} title={t('documentLibrary.missing.addPapers')} aria-label={t('documentLibrary.missing.addPapers')} onClick={(e) => { e.stopPropagation(); openStudent(studentId) }} />
      {canSend && <Button size="sm" variant="ghost" icon={MessageSquareShare} title={t('documentLibrary.missing.tellOne')} aria-label={t('documentLibrary.missing.tellOne')} onClick={(e) => { e.stopPropagation(); tellIds([studentId]) }} />}
    </span>
  )

  return (
    <PageContainer>
      <PageHeader icon={FileWarning} title={t('documentLibrary.missing.title')} subtitle={t('documentLibrary.missing.subtitle')}
        actions={canSend && data?.ids?.length > 0 && <HeaderButton icon={MessageSquareShare} variant="primary" onClick={() => tellIds(data.ids)}>{t('documentLibrary.missing.tellAll', { count: data.ids.length })}</HeaderButton>} />

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

      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1); setSelected([]) }} searchPlaceholder={t('documentLibrary.missing.search')}
        right={<div className="flex flex-wrap items-center gap-2">
          {tab === 'missing' ? (
            <ControlChip label={t('documentLibrary.missing.paperFilter')} active={!!kind} value={kind ? shortKind(kind) : t('documentLibrary.filter.all')}
              options={[{ value: '', label: t('documentLibrary.filter.all') }, ...(s?.byKind?.length ? s.byKind.map((k) => ({ value: k.kind, label: `${L.kind(k.kind)} (${k.n})` })) : FILE_CATEGORIES.map((c) => ({ value: c.value, label: L.kind(c.value) })))]} onChange={reset(setKind)} />
          ) : (
            <ControlChip label={t('documentLibrary.missing.within')} active value={t('documentLibrary.missing.days', { count: days })}
              options={[30, 60, 90, 180].map((d) => ({ value: String(d), label: t('documentLibrary.missing.days', { count: d }) }))} onChange={(v) => reset(setDays)(Number(v))} />
          )}
          <SegmentedControl value={tab} onChange={(v) => { reset(setTab)(v); setKind('') }} options={[{ value: 'missing', label: t('documentLibrary.missing.tabMissing'), icon: FileWarning }, { value: 'expiring', label: t('documentLibrary.missing.tabExpiring'), icon: CalendarX2 }]} />
        </div>} />

      <BulkActionBar count={selected.length} onClear={() => setSelected([])} noun={tab === 'missing' ? t('documentLibrary.missing.nounStudents') : t('documentLibrary.missing.nounPapers')}>
        {canSend && <Button size="sm" icon={MessageSquareShare} loading={tell.isPending} onClick={() => tellIds(pickedStudents)}>{t('documentLibrary.missing.tellPicked', { count: pickedStudents.length })}</Button>}
      </BulkActionBar>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-60 lg:shrink-0">
          <ClassRail classes={meta?.classes} byClass={s?.byClass} all={s?.all} value={classId} onChange={reset(setClassId)} />
        </div>
        <div className="min-w-0 flex-1">
          {tab === 'missing' ? (
            <DataTable rows={data?.rows ?? []} loading={query.isLoading} error={query.error} onRetry={query.refetch} rowKey="id"
              selectable={canSend} selectedIds={selected} onSelectionChange={setSelected} onSelect={(r) => openStudent(r.id)} pagination={pagination}
              columns={[
                { key: 'student', header: t('documentLibrary.col.student'), mobileTitle: true, render: studentCell },
                { key: 'missing', header: t('documentLibrary.missing.colMissing'), mobilePrimary: true, render: (v) => (
                  <span className="flex flex-wrap items-center gap-1" title={v.map((m) => L.kind(m.category)).join(', ')}>
                    {v.slice(0, SHOW_PAPERS).map((m) => <Tag key={m.category} tone={m.when === 'NOW' ? 'danger' : 'neutral'}>{shortKind(m.category)}</Tag>)}
                    {v.length > SHOW_PAPERS && <span className="text-xs text-ink-faint">+{v.length - SHOW_PAPERS}</span>}
                  </span>
                ) },
                { key: 'total', header: t('documentLibrary.missing.colGiven'), mobileHidden: true, width: 120, render: (v, r) => {
                  const given = v - r.missing.length
                  return (
                    <div className="w-24">
                      <p className="text-xs text-ink-muted">{t('documentLibrary.missing.givenOf', { given, total: v })}</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-brand-500" style={{ width: `${v ? (given / v) * 100 : 0}%` }} /></div>
                    </div>
                  )
                } },
                { key: 'actions', header: '', align: 'right', width: 92, render: (_, r) => rowActions(r.id) },
              ]}
              emptyIcon={FileWarning} emptyTitle={q ? t('documentLibrary.emptyFilter') : t('documentLibrary.missing.empty')} emptyHint={q ? undefined : t('documentLibrary.missing.emptyHint')} />
          ) : (
            <DataTable rows={data?.rows ?? []} loading={query.isLoading} error={query.error} onRetry={query.refetch} rowKey="id"
              selectable={canSend} selectedIds={selected} onSelectionChange={setSelected} onSelect={(r) => openStudent(r.studentId)} pagination={pagination}
              columns={[
                { key: 'student', header: t('documentLibrary.col.student'), mobileTitle: true, render: studentCell },
                { key: 'label', header: t('documentLibrary.missing.colPaper'), mobilePrimary: true, render: (v, r) => <span className="text-sm text-ink">{r.type !== 'OTHER' ? t(`documentLibrary.missing.paper.${r.type}`, v) : v}</span> },
                { key: 'validTill', header: t('documentLibrary.missing.colValidTill'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2"><DateCell value={v} tone={r.expired ? 'danger' : undefined} />{r.expired && <Tag tone="danger">{t('documentLibrary.missing.expired')}</Tag>}</span> },
                { key: 'actions', header: '', align: 'right', width: 92, render: (_, r) => rowActions(r.studentId) },
              ]}
              emptyIcon={CalendarX2} emptyTitle={q ? t('documentLibrary.emptyFilter') : t('documentLibrary.missing.noneExpiring')} />
          )}
        </div>
      </div>
    </PageContainer>
  )
}
