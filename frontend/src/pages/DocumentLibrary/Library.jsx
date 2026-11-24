import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronRight, CircleAlert, Download, FolderClosed, FolderInput, FolderOpen, FolderPlus, HardDrive, LayoutGrid, List, Pencil, Trash2, Upload, UsersRound } from 'lucide-react'
import { FILE_CATEGORIES } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, ControlChip, DataTable, EmptyState, HeaderButton, PageContainer, PageHeader, Pagination, PersonCell, SegmentedControl,
  StatCardRow, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CheckedPill, FileIcon, Thumb, fmtSize, openFile, useFileLabels } from '../../components/documentLibrary/LibraryKit'
import { FolderNameModal, FolderUpload } from '../../components/documentLibrary/FolderUpload'
import FolderTree, { useFolderName } from '../../components/documentLibrary/FolderTree'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { downloadFile } from '../../api/files'
import { downloadBlob } from '../../utils/download'
import { browseLibrary, downloadZip, fetchFolders, fetchLibrary, fetchLibraryMeta, fetchStorage, moveToFolder, removeFolder } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const PAGE = 50

/** A person's own folder in the automatic folders. */
const personPath = (p) => (p?.kind === 'STUDENT' && p.id ? `students/${p.classId ?? 'none'}/${p.id}` : p?.kind === 'STAFF' && p.id ? `staff/${p.id}` : null)
/** 'a/b/c' → ['a', 'a/b'] — the folders to open so 'a/b/c' shows in the tree. */
const ancestors = (path) => path.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))

/**
 * Every document and picture the school keeps. Folders on the left fill themselves — a paper added anywhere (a
 * scholarship check, a student's record, an admission, a staff record) is already in its place: Students › class ›
 * student, Scholarships …, Staff … — plus the school's own folders. Pick a folder; its documents (and everything in the
 * folders inside it) show on the right. Download a folder as one ZIP.
 */
export default function Library() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const folderName = useFolderName()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const path = params.get('path') ?? ''
  const [expanded, setExpanded] = useState(() => new Set(ancestors(path)))
  const [view, setView] = useState('list') // the list first; pictures on request
  const [kind, setKind] = useState('')
  const [classId, setClassId] = useState('')
  const [checked, setChecked] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState(false)
  const [naming, setNaming] = useState(null) // { folder } to rename, {} to make one
  const canExport = hasPermission('documents.library.export')
  const canCreate = hasPermission('documents.library.create')
  const canEdit = hasPermission('documents.library.edit')
  const canRemove = hasPermission('documents.library.delete')
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data: meta } = useQuery({ queryKey: ['doc-library', 'meta'], queryFn: fetchLibraryMeta })
  const { data: storage } = useQuery({ queryKey: ['doc-library', 'storage'], queryFn: fetchStorage })
  const { data: folders = [] } = useQuery({ queryKey: ['doc-library', 'folders'], queryFn: fetchFolders })
  const { data: here } = useQuery({ queryKey: ['doc-library', 'browse', path], queryFn: () => browseLibrary(path), placeholderData: keepPreviousData })
  const filtering = !!(q || kind || classId || checked)
  const listParams = { path: path || undefined, kind: kind || undefined, classId: classId || undefined, checked: checked || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['doc-library', listParams], queryFn: () => fetchLibrary(listParams), placeholderData: keepPreviousData })
  const rows = data?.rows ?? []
  const s = data?.summary
  const ownFolder = here?.own ? folders.find((f) => f.id === here.own) ?? null : null
  const crumbs = here?.crumbs ?? []
  const onePerson = !!here?.leaf && ['student', 'staff', 'person'].includes(crumbs[crumbs.length - 1]?.kind) // a person's own folder: no need to name them on every row
  useEffect(() => { if (path) setExpanded((x) => new Set([...x, ...ancestors(path)])) }, [path])

  const set = (fn) => (v) => { fn(v); setPage(1); setSelected([]) }
  const goPath = (p) => {
    setParams((x) => { const n = new URLSearchParams(x); if (p) n.set('path', p); else n.delete('path'); return n })
    setPage(1); setSelected([])
  }
  const toggleOpen = (p) => setExpanded((x) => { const n = new Set(x); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const move = useMutation({
    mutationFn: (id) => moveToFolder(id, selected),
    onSuccess: (r, id) => { qc.invalidateQueries({ queryKey: ['doc-library'] }); setSelected([]); showSuccess(t('documentLibrary.folders.moved', { count: r.moved, folder: folders.find((f) => f.id === id)?.name ?? '' })); if (r.skipped) showError(t('documentLibrary.folders.moveSkipped', { count: r.skipped })) },
    onError: (e) => showError(e.message),
  })
  const dropFolder = async (f) => {
    if (!(await confirm({ title: t('documentLibrary.folders.removeTitle', { name: f.name }), message: f.files ? t('documentLibrary.folders.notEmpty', { count: f.files }) : t('documentLibrary.folders.removeMessage'), confirmLabel: t('documentLibrary.folders.remove') }))) return
    try { await removeFolder(f.id); qc.invalidateQueries({ queryKey: ['doc-library'] }); goPath(''); showSuccess(t('documentLibrary.folders.removed')) } catch (e) { showError(e.message) }
  }
  const toggle = (id) => setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const zip = async (body) => {
    setBusy(true)
    try { await downloadZip(body); showSuccess(t('documentLibrary.zip.started')); return true } catch (e) { showError(e.message); return false } finally { setBusy(false) }
  }
  const zipPicked = async () => { if (await zip({ ids: selected, name: 'documents' })) setSelected([]) }
  const zipHere = () => zip({ ...listParams, page: undefined, pageSize: undefined, name: crumbs.map(folderName).join(' - ') || 'documents' })
  const saveOne = async (f) => { try { downloadBlob(await downloadFile(f.id), f.fileName) } catch (e) { showError(e.message) } }

  const PersonLink = ({ p }) => (p?.name ? (
    <button type="button" className="min-w-0 text-start hover:underline" onClick={(e) => { e.stopPropagation(); const to = personPath(p); if (to) goPath(to) }}>
      <PersonCell name={p.name} sub={p.sub} size={26} />
    </button>
  ) : <span className="text-sm text-ink-muted">{L.person(p?.kind ?? 'SCHOOL')}</span>)
  // where a file lives: the school's own folder, else where it was added (Scholarship document, Student record …)
  const whereCell = (f) => (f.folder ? (
    <button type="button" className="inline-flex min-w-0 items-center gap-1.5 text-start text-sm text-ink hover:underline" onClick={(e) => { e.stopPropagation(); goPath(`folder/${f.folder.id}`) }}>
      <FolderClosed className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /><span className="truncate">{f.folder.name}</span>
    </button>
  ) : <span className="text-sm text-ink-muted">{L.source(f.source)}</span>)

  const emptyTitle = filtering ? t('documentLibrary.emptyFilter') : here?.own ? t('documentLibrary.folders.empty') : path ? t('documentLibrary.auto.empty') : t('documentLibrary.empty')
  const emptyHint = filtering ? undefined : here?.own ? t('documentLibrary.folders.emptyHint') : path ? undefined : t('documentLibrary.emptyHint')
  const pagination = data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined

  // the folder you are in, above its documents: Scholarships › Class 8 › Prachi Verma · 3 documents, and what you can do here
  const heading = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="me-auto flex min-w-0 flex-wrap items-center gap-1 text-sm">
        <FolderOpen className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        {!crumbs.length ? <span className="font-semibold text-ink">{t('documentLibrary.auto.all')}</span> : crumbs.map((c, i) => (
          <span key={c.path} className="inline-flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden />}
            {i === crumbs.length - 1 ? <span className="truncate font-semibold text-ink">{folderName(c)}</span>
              : <button type="button" className="truncate text-brand-700 hover:underline" onClick={() => goPath(c.path)}>{folderName(c)}</button>}
          </span>
        ))}
        {data && <span className="ms-1 text-xs text-ink-faint">· {t('documentLibrary.auto.count', { count: data.total })}</span>}
      </div>
      {ownFolder && canCreate && <Button size="sm" variant="secondary" icon={Upload} onClick={() => setUpload(true)}>{t('documentLibrary.folders.addHere')}</Button>}
      {ownFolder && canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setNaming({ folder: ownFolder })}>{t('documentLibrary.folders.rename')}</Button>}
      {ownFolder && canRemove && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => dropFolder(ownFolder)}>{t('documentLibrary.folders.remove')}</Button>}
      {canExport && path && data?.total > 0 && <Button size="sm" variant="ghost" icon={Download} loading={busy} onClick={zipHere}>{t('documentLibrary.auto.zip', { count: data.total })}</Button>}
    </div>
  )

  return (
    <PageContainer>
      <PageHeader icon={FolderOpen} title={t('documentLibrary.title')} subtitle={t('documentLibrary.subtitle')}
        actions={<>
          {canCreate && <HeaderButton icon={FolderPlus} onClick={() => setNaming({})}>{t('documentLibrary.folders.new')}</HeaderButton>}
          {canCreate && <HeaderButton icon={Upload} variant="primary" onClick={() => setUpload(true)}>{t('documentLibrary.upload.button')}</HeaderButton>}
        </>} />

      {s && <StatCardRow items={[
        { icon: FolderOpen, tone: 'brand', label: t('documentLibrary.stat.files'), value: s.files, sub: filtering ? t('documentLibrary.stat.filtered') : path ? t('documentLibrary.auto.inHere') : t('documentLibrary.stat.all') },
        { icon: UsersRound, tone: 'info', label: t('documentLibrary.stat.students'), value: s.students, sub: t('documentLibrary.stat.studentsSub') },
        { icon: CircleAlert, tone: s.unchecked ? 'warning' : 'neutral', label: t('documentLibrary.stat.unchecked'), value: s.unchecked, sub: t('documentLibrary.stat.uncheckedSub'), onClick: () => set(setChecked)('PENDING') },
        { icon: HardDrive, tone: storage?.limitGb && storage.usedGb > storage.limitGb * 0.8 ? 'warning' : 'neutral', label: t('documentLibrary.stat.space'), value: fmtSize(path || filtering ? s.bytes : storage?.bytes ?? s.bytes),
          sub: !path && !filtering && storage?.limitGb ? t('documentLibrary.stat.spaceOf', { limit: `${storage.limitGb} GB` }) : t('documentLibrary.stat.spaceSub'),
          progress: !path && !filtering && storage?.limitGb ? Math.min(100, (storage.usedGb / storage.limitGb) * 100) : undefined },
      ]} />}

      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={path ? t('documentLibrary.auto.searchHere') : t('documentLibrary.search')}
        right={<div className="flex flex-wrap items-center gap-2">
          <ControlChip label={t('documentLibrary.filter.kind')} active={!!kind} value={kind ? L.kind(kind) : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...FILE_CATEGORIES.map((c) => ({ value: c.value, label: L.kind(c.value) }))]} onChange={set(setKind)} />
          <ControlChip label={t('documentLibrary.filter.class')} active={!!classId} value={classId ? meta?.classes?.find((c) => c.id === classId)?.name : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...(meta?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={set(setClassId)} />
          <ControlChip label={t('documentLibrary.filter.checked')} active={!!checked} value={checked ? t(`documentLibrary.checked.${checked}`) : t('documentLibrary.filter.all')}
            options={[{ value: '', label: t('documentLibrary.filter.all') }, ...['PENDING', 'VERIFIED', 'REJECTED'].map((v) => ({ value: v, label: t(`documentLibrary.checked.${v}`) }))]} onChange={set(setChecked)} />
          <SegmentedControl value={view} onChange={setView} options={[{ value: 'list', label: t('documentLibrary.view.list'), icon: List }, { value: 'grid', label: t('documentLibrary.view.grid'), icon: LayoutGrid }]} />
        </div>} />

      <BulkActionBar count={selected.length} onClear={() => setSelected([])} noun={t('documentLibrary.noun')}>
        {canExport && <Button size="sm" icon={Download} loading={busy} onClick={zipPicked}>{t('documentLibrary.zip.picked', { count: selected.length })}</Button>}
        {canEdit && folders.length > 0 && rows.some((f) => selected.includes(f.id) && f.folder) && (
          <ControlChip icon={FolderInput} label={t('documentLibrary.folders.moveTo')} value="" disabled={move.isPending}
            options={[{ value: '', label: t('documentLibrary.folders.moveTo') }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} onChange={(id) => id && move.mutate(id)} />
        )}
      </BulkActionBar>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-60 lg:shrink-0">
          <FolderTree current={path} expanded={expanded} onToggle={toggleOpen} onSelect={goPath} />
        </div>

        <div className="min-w-0 flex-1">
          {view === 'list' ? (
            <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" toolbar={heading}
              selectable={canExport} selectedIds={selected} onSelectionChange={setSelected} onSelect={openFile} pagination={pagination}
              columns={[
                { key: 'fileName', header: t('documentLibrary.col.file'), mobileTitle: true, render: (v, f) => (
                  <span className="flex min-w-0 max-w-[15rem] xl:max-w-[18rem] items-center gap-2" title={f.title ? v : undefined}><FileIcon file={f} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink" title={v}>{f.title || v}</span><span className="block truncate text-xs text-ink-faint">{[f.folder?.name ?? L.source(f.source), fmtSize(f.size), date(f.uploadedAt)].filter(Boolean).join(' · ')}</span></span></span>
                ) },
                !onePerson && { key: 'person', header: t('documentLibrary.col.person'), mobilePrimary: true, render: (p) => <PersonLink p={p?.classShort ? { ...p, sub: [p.sub, p.classShort].filter(Boolean).join(' · ') } : p} /> },
                { key: 'category', header: t('documentLibrary.col.kind'), render: (v) => <span className="block max-w-[8rem] truncate" title={L.kind(v)}><ColorChip label={L.kind(v)} seed={v} dot /></span> },
                { key: 'verification', header: t('documentLibrary.col.checked'), mobilePrimary: true, render: (_, f) => <CheckedPill file={f} /> },
                { key: 'actions', header: '', align: 'right', width: 52, render: (_, f) => (
                  <Button size="sm" variant="ghost" icon={Download} title={t('documentLibrary.download')} aria-label={t('documentLibrary.download')} onClick={(e) => { e.stopPropagation(); saveOne(f) }} />
                ) },
              ].filter(Boolean)}
              emptyIcon={FolderOpen} emptyTitle={emptyTitle} emptyHint={emptyHint} />
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-surface px-4 py-3">{heading}</div>
              {!isLoading && !rows.length ? <EmptyState icon={FolderOpen} title={emptyTitle} hint={emptyHint} /> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {(isLoading ? Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, skeleton: true })) : rows).map((f) => (f.skeleton ? <div key={f.id} className="aspect-[3/4] animate-pulse rounded-xl bg-black/[0.05]" /> : (
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
                        <div className="text-xs">{whereCell(f)}</div>
                        <CheckedPill file={f} />
                      </div>
                    </div>
                  )))}
                </div>
              )}
              {pagination && <Pagination {...pagination} />}
            </div>
          )}
        </div>
      </div>

      {upload && <FolderUpload folderId={here?.own || undefined} onClose={() => setUpload(false)} onDone={(f) => goPath(`folder/${f.id}`)} />}
      {naming && <FolderNameModal folder={naming.folder} onClose={() => setNaming(null)} onDone={(f) => goPath(`folder/${f.id}`)} />}
    </PageContainer>
  )
}
