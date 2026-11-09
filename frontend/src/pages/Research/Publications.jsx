import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpenText, Building2, ExternalLink, Layers, Pencil, Plus, Quote, Sigma, Trash2, Trophy } from 'lucide-react'
import { RESEARCH_INDEXING, RESEARCH_PUB_COLUMNS, RESEARCH_PUB_TYPES, doiUrl } from '@schoolgiant/shared'
import {
  BreakdownDonut, CHART, CodeBadge, ColorChip, ColumnBars, DataTable, Drawer, FactGrid, FormField, HeaderButton, ImportExportButtons, Input, Modal, Note,
  PageContainer, PageHeader, PillRow, SearchInput, Select, SideNav, SideNavLayout, StatCardRow, pillClass, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deletePublication, exportPublications, fetchPublications, importPublications, savePublication } from '../../api/research'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { readSheet } from '../../utils/readSheet'
import { useSnackbar } from '../../context/SnackbarContext'
import { AuthorsField, IndexingTags, PeopleStack, PubTypeTag, useResearchLabels, useResearchMeta } from '../../components/research/ResearchKit'

const P = 'research.publications'

function PublicationForm({ pub, onClose, onSaved }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useResearchMeta()
  const [form, setForm] = useState({
    title: pub?.title ?? '', type: pub?.type ?? 'JOURNAL', authors: pub?.authors ?? [], venue: pub?.venue ?? '', year: pub?.year ?? new Date().getFullYear(),
    volume: pub?.volume ?? '', issue: pub?.issue ?? '', pages: pub?.pages ?? '', doi: pub?.doi ?? '', issn: pub?.issn ?? '', isbn: pub?.isbn ?? '',
    patentNo: pub?.patentNo ?? '', indexing: pub?.indexing ?? [], impactFactor: pub?.impactFactor ?? '', citations: pub?.citations ?? 0,
    departmentId: pub?.departmentId ?? '', url: pub?.url ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const toggleIndex = (v) => setForm((f) => ({ ...f, indexing: f.indexing.includes(v) ? f.indexing.filter((x) => x !== v) : [...f.indexing, v] }))
  const book = form.type === 'BOOK' || form.type === 'CHAPTER'
  const patent = form.type === 'PATENT'
  const save = useMutation({
    mutationFn: () => savePublication(pub?.id, {
      ...form, year: Number(form.year), citations: Number(form.citations || 0), impactFactor: form.impactFactor === '' ? null : Number(form.impactFactor),
      doi: form.doi || null, departmentId: form.departmentId || null, url: form.url || null,
      authors: form.authors.map((a) => (a.userId ? { userId: a.userId } : { name: a.name })),
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={pub ? t('research.pubs.editTitle') : t('research.pubs.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 3 || !form.authors.length} onClick={() => save.mutate()}>{t('research.pubs.save')}</Button>
    </>}>
      <div className="space-y-4">
        <PillRow>
          {RESEARCH_PUB_TYPES.map((x) => (
            <button key={x.value} type="button" aria-pressed={form.type === x.value} className={pillClass(form.type === x.value)} onClick={() => setForm((f) => ({ ...f, type: x.value }))}>{L.type(x.value)}</button>
          ))}
        </PillRow>
        <FormField label={t('research.pubs.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField>
        <AuthorsField value={form.authors} onChange={(authors) => setForm((f) => ({ ...f, authors }))} staff={meta?.staff ?? []} error={errors.authors} />
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={patent ? t('research.pubs.office') : book ? t('research.pubs.publisher') : t('research.pubs.venue')} className="sm:col-span-2"><Input value={form.venue} onChange={set('venue')} /></FormField>
          <FormField label={t('research.pubs.year')} required error={errors.year}><Input type="number" min="1950" max="2100" value={form.year} onChange={set('year')} /></FormField>
          {!book && !patent && <>
            <FormField label={t('research.pubs.volume')}><Input value={form.volume} onChange={set('volume')} /></FormField>
            <FormField label={t('research.pubs.issue')}><Input value={form.issue} onChange={set('issue')} /></FormField>
          </>}
          {!patent && <FormField label={t('research.pubs.pages')}><Input value={form.pages} onChange={set('pages')} /></FormField>}
          {patent && <FormField label={t('research.pubs.patentNo')} className="sm:col-span-2"><Input value={form.patentNo} onChange={set('patentNo')} /></FormField>}
          <FormField label={t('research.pubs.doi')} error={errors.doi} hint={t('research.pubs.doiHint')} className="sm:col-span-2"><Input value={form.doi} onChange={set('doi')} placeholder="10.xxxx/…" /></FormField>
          {book ? <FormField label={t('research.pubs.isbn')} error={errors.isbn}><Input value={form.isbn} onChange={set('isbn')} /></FormField>
            : <FormField label={t('research.pubs.issn')} error={errors.issn}><Input value={form.issn} onChange={set('issn')} placeholder="0000-0000" /></FormField>}
        </div>
        <FormField label={t('research.pubs.indexing')}>
          <PillRow>
            {RESEARCH_INDEXING.map((x) => (
              <button key={x.value} type="button" aria-pressed={form.indexing.includes(x.value)} className={pillClass(form.indexing.includes(x.value))} onClick={() => toggleIndex(x.value)}>{L.indexing(x.value)}</button>
            ))}
          </PillRow>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('research.pubs.impactFactor')} error={errors.impactFactor}><Input type="number" min="0" step="0.001" value={form.impactFactor} onChange={set('impactFactor')} /></FormField>
          <FormField label={t('research.pubs.citations')} error={errors.citations}><Input type="number" min="0" value={form.citations} onChange={set('citations')} /></FormField>
          <FormField label={t('research.pubs.department')} error={errors.departmentId} hint={pub ? undefined : t('research.pubs.departmentHint')}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('research.pubs.noDepartment')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label={t('research.pubs.url')} error={errors.url}><Input type="url" value={form.url} onChange={set('url')} placeholder="https://" /></FormField>
      </div>
    </Modal>
  )
}

function PublicationDrawer({ pub, onClose, onEdit, onDelete }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  return (
    <Drawer open onClose={onClose} size="lg" title={pub.title} subtitle={[L.type(pub.type), pub.venue, pub.year].filter(Boolean).join(' · ')}
      footer={<div className="flex flex-wrap gap-2">
        {hasPermission(`${P}.edit`) && <Button variant="secondary" icon={Pencil} onClick={onEdit}>{t('research.edit')}</Button>}
        {hasPermission(`${P}.delete`) && <Button variant="ghost" icon={Trash2} onClick={onDelete}>{t('research.delete')}</Button>}
      </div>}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('research.pubs.authors')}</p>
          <div className="flex flex-wrap gap-2">
            {pub.authors.map((a, i) => (
              <span key={`${a.name}${i}`} className="inline-flex items-center gap-2 rounded-full border border-border py-1 ps-1 pe-3 text-sm">
                <PeopleStack people={[a]} size={24} />{a.name}
                {!a.userId && <span className="text-[11px] text-ink-faint">{t('research.pubs.external')}</span>}
              </span>
            ))}
          </div>
        </div>
        <FactGrid cols={3} items={[
          { label: t('research.pubs.type'), value: <PubTypeTag type={pub.type} /> },
          { label: t('research.pubs.year'), value: pub.year },
          { label: t('research.pubs.department'), value: pub.department ? <ColorChip label={pub.department.name} seed={pub.department.code} /> : null },
          { label: t('research.pubs.volume'), value: [pub.volume, pub.issue && `(${pub.issue})`, pub.pages && t('research.pubs.pagesShort', { pages: pub.pages })].filter(Boolean).join(' ') || null },
          { label: t('research.pubs.issn'), value: pub.issn, mono: true, hidden: !pub.issn },
          { label: t('research.pubs.isbn'), value: pub.isbn, mono: true, hidden: !pub.isbn },
          { label: t('research.pubs.patentNo'), value: pub.patentNo, mono: true, hidden: !pub.patentNo },
          { label: t('research.pubs.impactFactor'), value: pub.impactFactor },
          { label: t('research.pubs.citations'), value: pub.citations },
          { label: t('research.pubs.indexing'), value: <IndexingTags list={pub.indexing} />, span: 'full' },
        ]} />
        {(pub.doi || pub.url) && (
          <div className="flex flex-wrap gap-3 text-sm">
            {pub.doi && <a href={doiUrl(pub.doi)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><ExternalLink className="w-4 h-4" />{pub.doi}</a>}
            {pub.url && <a href={pub.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline break-all"><ExternalLink className="w-4 h-4" />{t('research.pubs.openLink')}</a>}
          </div>
        )}
      </div>
    </Drawer>
  )
}

/** Research › Publications: journal articles, conference papers, books, chapters and patents — by department and year. */
export default function Publications() {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useResearchMeta()
  const [departmentId, setDepartmentId] = useState('')
  const [year, setYear] = useState('')
  const [indexing, setIndexing] = useState('')
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const params = { departmentId, year, indexing, type, search: q }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['research', 'publications', params], queryFn: () => fetchPublications(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['research'] })
  const remove = useMutation({ mutationFn: deletePublication, onSuccess: () => { refresh(); setOpen(null); showSuccess(t('research.pubs.deleted')) }, onError: (e) => showError(e.message) })
  const askDelete = async (p) => {
    if (await confirm({ title: t('research.pubs.deleteConfirm', { title: p.title }), confirmLabel: t('research.delete'), tone: 'danger' })) remove.mutate(p.id)
  }
  const s = data?.summary
  const depts = meta?.departments ?? []
  const deptCount = useMemo(() => new Map((s?.byDepartment ?? []).map((d) => [d.departmentId ?? 'none', d.n])), [s])
  const allCount = (s?.byDepartment ?? []).reduce((n, d) => n + d.n, 0)
  const nav = (
    <SideNav title={t('research.pubs.departments')} value={departmentId} onChange={(v) => setDepartmentId(v ?? '')} items={[
      { id: '', label: t('research.pubs.allDepartments'), icon: Layers, count: allCount },
      ...depts.filter((d) => d.type !== 'ADMINISTRATIVE' || deptCount.has(d.id)).map((d) => ({ id: d.id, label: d.name, hint: d.code, count: deptCount.get(d.id) ?? 0, progress: allCount ? { value: deptCount.get(d.id) ?? 0, max: Math.max(...deptCount.values(), 1), kind: 'done' } : undefined })),
      ...(deptCount.get('none') ? [{ id: 'none', label: t('research.pubs.noDepartment'), count: deptCount.get('none') }] : []),
    ]} />
  )
  const years = [...new Set([...(meta?.years ?? []), ...(s?.byYear ?? []).map((y) => y.year)])].sort((a, b) => b - a)
  const lastYears = (s?.byYear ?? []).slice(-10)
  const canCreate = hasPermission(`${P}.create`)
  const canExport = hasPermission(`${P}.export`)
  return (
    <PageContainer>
      <PageHeader icon={BookOpenText} title={t('research.pubs.pageTitle')} subtitle={t('research.pubs.pageSubtitle')}
        actions={<>
          {(canCreate || canExport) && <ImportExportButtons resourceLabel={t('research.pubs.resource')} requires={`${P}.create`}
            onImport={canCreate ? async (file) => importPublications(await readSheet(file), true) : undefined} onCommit={(rows) => importPublications(rows, false)}
            onExport={canExport ? () => exportPublications(params) : undefined} exportFilename="publications.csv"
            templateHeaders={RESEARCH_PUB_COLUMNS}
            templateSample={['Phonon transport in layered materials', 'JOURNAL', 'K. Rao; R. Iyer', 'Physical Review B', '2025', '111', '4', '045301', '10.1103/PhysRevB.111.045301', '2469-9950', '', 'Scopus; Web of Science', '3.7', '6', 'PHY']}
            onDone={refresh} />}
          <HeaderButton icon={Plus} variant="primary" requires={`${P}.create`} onClick={() => setEditing('new')}>{t('research.pubs.new')}</HeaderButton>
        </>} />
      <SideNavLayout nav={nav}>
        {s && <StatCardRow items={[
          { icon: BookOpenText, label: t('research.pubs.total'), value: s.total, segments: s.byType.filter((x) => x.n).map((x) => ({ label: L.type(x.value), value: x.n })) },
          { icon: Trophy, label: t('research.pubs.indexed'), value: s.indexed, progress: s.total ? (s.indexed / s.total) * 100 : undefined, sub: t('research.pubs.indexedSub') },
          { icon: Quote, label: t('research.pubs.citationsN'), value: s.citations, sub: s.avgImpact ? t('research.pubs.avgImpact', { value: s.avgImpact }) : undefined },
          { icon: Sigma, label: t('research.pubs.hIndex'), value: s.hIndex, sub: t('research.pubs.hIndexSub') },
        ]} />}
        {s && s.total > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ColumnBars title={t('research.pubs.perYear')} subtitle={year ? t('research.pubs.pickAgain') : t('research.pubs.pickYear')}
              items={lastYears.map((y) => ({ id: String(y.year), label: String(y.year), short: `’${String(y.year).slice(2)}`, value: y.n, tone: 'brand' }))}
              activeId={year ? String(year) : ''} onPick={(it) => setYear(it ? Number(it.id) : '')} />
            {!departmentId && (s.byDepartment ?? []).length > 1 ? (
              <ColumnBars title={t('research.pubs.perDepartment')} subtitle={t('research.pubs.pickDepartment')}
                items={s.byDepartment.slice(0, 14).map((d) => ({ id: d.departmentId ?? 'none', label: d.name ?? t('research.pubs.noDepartment'), short: depts.find((x) => x.id === d.departmentId)?.code ?? '—', value: d.n }))}
                activeId="" onPick={(it) => it && setDepartmentId(it.id)} />
            ) : (
              <BreakdownDonut title={t('research.pubs.byIndexing')} centerLabel={t('research.pubs.total')} centerValue={s.total}
                segments={s.byIndexing.filter((x) => x.n).map((x, i) => ({ name: L.indexing(x.value), value: x.n, color: CHART.series[i % CHART.series.length] }))} />
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder={t('research.pubs.search')} /></div>
          <div className="w-36"><Select value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} aria-label={t('research.pubs.year')}>
            <option value="">{t('research.pubs.allYears')}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select></div>
          <div className="w-44"><Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('research.pubs.type')}>
            <option value="">{t('research.pubs.allTypes')}</option>{RESEARCH_PUB_TYPES.map((x) => <option key={x.value} value={x.value}>{L.type(x.value)}</option>)}
          </Select></div>
          <PillRow>
            <button type="button" aria-pressed={!indexing} className={pillClass(!indexing)} onClick={() => setIndexing('')}>{t('research.pubs.anyIndexing')}</button>
            {RESEARCH_INDEXING.map((x) => (
              <button key={x.value} type="button" aria-pressed={indexing === x.value} className={pillClass(indexing === x.value)} onClick={() => setIndexing(indexing === x.value ? '' : x.value)}>
                {L.indexing(x.value)}{s && <span className="text-ink-faint">{s.byIndexing.find((b) => b.value === x.value)?.n ?? 0}</span>}
              </button>
            ))}
          </PillRow>
        </div>
        {s && !s.total && !q && !year && !indexing && !type && !departmentId && <Note>{t('research.pubs.emptyHint')}</Note>}
        <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} onRowClick={(r) => setOpen(r)} emptyTitle={t('research.pubs.empty')} columns={[
          { key: 'title', header: t('research.pubs.title'), mobilePrimary: true, render: (v, r) => (
            <span className="block min-w-[220px]">
              <span className="font-medium text-ink line-clamp-2">{v}</span>
              <span className="mt-1 flex items-center gap-2 text-xs text-ink-faint"><PeopleStack people={r.authors} size={20} /><span className="truncate">{r.authors.map((a) => a.name).join(', ')}</span></span>
            </span>
          ) },
          { key: 'type', header: t('research.pubs.type'), mobileHidden: true, render: (v) => <PubTypeTag type={v} /> },
          { key: 'venue', header: t('research.pubs.venue'), mobileHidden: true, render: (v, r) => <span className="text-sm">{v || '—'}<span className="block text-xs text-ink-faint">{r.year}</span></span>, sortAccessor: (r) => r.year },
          { key: 'indexing', header: t('research.pubs.indexing'), mobileHidden: true, render: (v) => <IndexingTags list={v} /> },
          { key: 'department', header: t('research.pubs.department'), mobileHidden: true, render: (v) => (v ? <ColorChip label={v.code} seed={v.code} icon={Building2} /> : <span className="text-ink-faint">—</span>) },
          { key: 'impactFactor', header: t('research.pubs.ifShort'), align: 'right', mobileHidden: true, render: (v) => (v != null ? <CodeBadge>{v}</CodeBadge> : '—') },
          { key: 'citations', header: t('research.pubs.citations'), align: 'right', render: (v) => <span className="inline-flex items-center gap-2"><span className="hidden sm:block h-1.5 w-14 overflow-hidden rounded-full bg-black/[0.06]"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, (v / Math.max(1, ...(data?.rows ?? []).map((x) => x.citations))) * 100)}%` }} /></span><span className="tabular-nums font-semibold">{v}</span></span> },
          { key: 'doi', header: t('research.pubs.doi'), mobileHidden: true, render: (v) => (v ? <a href={doiUrl(v)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><ExternalLink className="w-3.5 h-3.5" />{t('research.pubs.doiLink')}</a> : '—') },
        ]} />
      </SideNavLayout>
      {open && <PublicationDrawer pub={open} onClose={() => setOpen(null)} onEdit={() => { setEditing(open); setOpen(null) }} onDelete={() => askDelete(open)} />}
      {editing && <PublicationForm pub={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); showSuccess(t('research.pubs.saved')) }} />}
    </PageContainer>
  )
}
