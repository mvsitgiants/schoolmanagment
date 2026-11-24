import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CircleAlert, Download, FolderDown, FolderOpen, HardDrive, LayoutGrid, List, UsersRound } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, DateCell, EmptyState, HeaderButton, PageContainer, PageHeader, Pagination, PersonCell, SegmentedControl,
  StatCardRow, Toolbar,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CheckedPill, ClassZip, FileIcon, PersonFolder, Thumb, fmtSize, openFile, useFileLabels } from '../../components/documentLibrary/LibraryKit'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { downloadZip, fetchLibrary, fetchLibraryMeta, fetchStorage } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 48
const PEOPLE = ['', 'STUDENT', 'STAFF', 'APPLICANT', 'SCHOOL']

/**
 * Every document and picture the school keeps, in one place: students' papers, staff records, applicants' and the
 * school's own files. Find by person, kind, class or where it came from; preview; download many as one ZIP — picked
 * files, one person's folder, or a whole class.
 */
export default function Library() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const { showError, showSuccess } = useSnackbar()
  const [view, setView] = useState('grid')
  const [person, setPerson] = useState('')
  const [kind, setKind] = useState('')
  const [source, setSource] = useState('')
  const [classId, setClassId] = useState('')
  const [checked, setChecked] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const [folder, setFolder] = useState(null)
  const [classZip, setClassZip] = useState(false)
  const [busy, setBusy] = useState(false)
  const canExport = hasPermission('documents.library.export')

  const { data: meta } = useQuery({ queryKey: ['doc-library', 'meta'], queryFn: fetchLibraryMeta })
  const { data: storage } = useQuery({ queryKey: ['doc-library', 'storage'], queryFn: fetchStorage })
  const params = { person: person || undefined, kind: kind || undefined, source: source || undefined, classId: classId || undefined, checked: checked || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['doc-library', params], queryFn: () => fetchLibrary(params), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const s = data?.summary
  const set = (fn) => (v) => { fn(v); setPage(1); setSelected([]) }
  const toggle = (id) => setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const zipPicked = async () => {
    setBusy(true)
    try { await downloadZip({ ids: selected, name: 'documents' }); showSuccess(t('documentLibrary.zip.started')); setSelected([]) } catch (e) { showError(e.message) } finally { setBusy(false) }
  }
  const PersonLink = ({ p }) => (p?.name ? (
    <button type="button" className="min-w-0 text-start hover:underline" onClick={(e) => { e.stopPropagation(); if (p.id && (p.kind === 'STUDENT' || p.kind === 'STAFF')) setFolder(p) }}>
      <PersonCell name={p.name} sub={p.sub} size={26} />
    </button>
  ) : <span className="text-sm text-ink-muted">{L.person(p?.kind ?? 'SCHOOL')}</span>)

  const filtersOn = !!(person || kind || source || classId || checked || q)
  return (
    <PageContainer>
      <PageHeader icon={FolderOpen} title={t('documentLibrary.title')} subtitle={t('documentLibrary.subtitle')}
        actions={canExport && <HeaderButton icon={FolderDown} onClick={() => setClassZip(true)}>{t('documentLibrary.zip.classButton')}</HeaderButton>} />

      {s && <StatCardRow items={[
        { icon: FolderOpen, tone: 'brand', label: t('documentLibrary.stat.files'), value: s.files, sub: filtersOn ? t('documentLibrary.stat.filtered') : t('documentLibrary.stat.all') },
        { icon: UsersRound, tone: 'info', label: t('documentLibrary.stat.students'), value: s.students, sub: t('documentLibrary.stat.studentsSub') },
        { icon: CircleAlert, tone: s.unchecked ? 'warning' : 'neutral', label: t('documentLibrary.stat.unchecked'), value: s.unchecked, sub: t('documentLibrary.stat.uncheckedSub'), onClick: () => set(setChecked)('PENDING') },
        { icon: HardDrive, tone: storage?.limitGb && storage.usedGb > storage.limitGb * 0.8 ? 'warning' : 'neutral', label: t('documentLibrary.stat.space'), value: fmtSize(filtersOn ? s.bytes : storage?.bytes ?? s.bytes),
          sub: !filtersOn && storage?.limitGb ? t('documentLibrary.stat.spaceOf', { limit: `${storage.limitGb} GB` }) : t('documentLibrary.stat.spaceSub'),
          progress: !filtersOn && storage?.limitGb ? Math.min(100, (storage.usedGb / storage.limitGb) * 100) : undefined },
      ]} />}

      <SegmentedControl value={person} onChange={set(setPerson)} options={PEOPLE.map((p) => ({ value: p, label: p ? L.person(p) : t('documentLibrary.filter.everyone') }))} />

      <BulkActionBar count={selected.length} onClear={() => setSelected([])} noun={t('documentLibrary.noun')}>
        {canExport && <Button size="sm" icon={Download} loading={busy} onClick={zipPicked}>{t('documentLibrary.zip.picked', { count: selected.length })}</Button>}
      </BulkActionBar>

      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('documentLibrary.search')}
        right={<div className="flex flex-wrap items-center gap-2">
          <ControlChip label={t('documentLibrary.filter.kind')} active={!!kind} value={kind ? L.kind(kind) : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...FILE_CATEGORIES.map((c) => ({ value: c.value, label: L.kind(c.value) }))]} onChange={set(setKind)} />
          <ControlChip label={t('documentLibrary.filter.class')} active={!!classId} value={classId ? meta?.classes?.find((c) => c.id === classId)?.name : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...(meta?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={set(setClassId)} />
          <ControlChip label={t('documentLibrary.filter.source')} active={!!source} value={source ? L.source(source) : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...(meta?.sources ?? []).map((x) => ({ value: x.value, label: L.source(x.value) }))]} onChange={set(setSource)} />
          <ControlChip label={t('documentLibrary.filter.checked')} active={!!checked} value={checked ? t(`documentLibrary.checked.${checked}`) : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...['PENDING', 'VERIFIED', 'REJECTED'].map((v) => ({ value: v, label: t(`documentLibrary.checked.${v}`) }))]} onChange={set(setChecked)} />
          <SegmentedControl value={view} onChange={setView} options={[{ value: 'grid', label: t('documentLibrary.view.grid'), icon: LayoutGrid }, { value: 'list', label: t('documentLibrary.view.list'), icon: List }]} />
        </div>} />

      {view === 'list' ? (
        <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
          selectable={canExport} selectedIds={selected} onSelectionChange={setSelected} onSelect={openFile}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
          columns={[
            { key: 'fileName', header: t('documentLibrary.col.file'), mobileTitle: true, render: (v, f) => (
              <span className="flex min-w-0 items-center gap-2"><FileIcon file={f} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink" title={v}>{f.title || v}</span><span className="block truncate text-xs text-ink-faint">{f.title ? `${v} · ` : ''}{fmtSize(f.size)}</span></span></span>
            ) },
            { key: 'person', header: t('documentLibrary.col.person'), mobilePrimary: true, render: (p) => <span className="flex items-center gap-2"><PersonLink p={p} />{p?.classShort && <ColorChip label={p.classShort} seed={p.classId ?? p.classShort} />}</span> },
            { key: 'category', header: t('documentLibrary.col.kind'), render: (v) => <ColorChip label={L.kind(v)} seed={v} dot /> },
            { key: 'source', header: t('documentLibrary.col.source'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{L.source(v)}</span> },
            { key: 'uploadedAt', header: t('documentLibrary.col.added'), mobileHidden: true, render: (v, f) => <div><DateCell value={v} /><p className="text-xs text-ink-faint">{f.uploadedBy}</p></div> },
            { key: 'verification', header: t('documentLibrary.col.checked'), mobilePrimary: true, render: (_, f) => <CheckedPill file={f} /> },
          ]}
          emptyIcon={FolderOpen} emptyTitle={filtersOn ? t('documentLibrary.emptyFilter') : t('documentLibrary.empty')} emptyHint={filtersOn ? undefined : t('documentLibrary.emptyHint')} />
      ) : (
        <>
          {!isLoading && !rows.length ? <EmptyState icon={FolderOpen} title={filtersOn ? t('documentLibrary.emptyFilter') : t('documentLibrary.empty')} hint={filtersOn ? undefined : t('documentLibrary.emptyHint')} /> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {(isLoading ? Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, skeleton: true })) : rows).map((f) => f.skeleton ? <div key={f.id} className="aspect-[3/4] animate-pulse rounded-xl bg-black/[0.05]" /> : (
                <div key={f.id} className={clsx('group relative overflow-hidden rounded-xl border bg-surface transition-colors', selected.includes(f.id) ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border hover:border-brand-300')}>
                  {canExport && (
                    <label className="absolute start-2 top-2 z-[1] flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-surface/90 shadow-sm">
                      <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} aria-label={t('documentLibrary.pick', { name: f.fileName })} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                    </label>
                  )}
                  <button type="button" className="block w-full text-start" onClick={() => openFile(f)}>
                    <Thumb file={f} className="aspect-[4/3] w-full" />
                  </button>
                  <div className="space-y-1 p-2.5">
                    <p className="truncate text-sm font-medium text-ink" title={f.fileName}>{f.title || f.fileName}</p>
                    <ColorChip label={L.kind(f.category)} seed={f.category} dot />
                    <div className="text-xs"><PersonLink p={f.person} /></div>
                    <p className="truncate text-[11px] text-ink-faint">{L.source(f.source)} · {fmtSize(f.size)}</p>
                    <CheckedPill file={f} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {data && data.total > PAGE && <Pagination page={page - 1} size={PAGE} totalElements={data.total} totalPages={Math.ceil(data.total / PAGE)} onPageChange={(p) => setPage(p + 1)} />}
        </>
      )}

      {folder && <PersonFolder person={folder} onClose={() => setFolder(null)} />}
      {classZip && <ClassZip meta={meta} onClose={() => setClassZip(false)} />}
    </PageContainer>
  )
}
