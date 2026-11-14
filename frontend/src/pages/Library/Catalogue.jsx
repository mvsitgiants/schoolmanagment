import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlarmClock, BookCopy, ClipboardCheck, BookMarked, BookOpen, BookUp, Disc3, Download, GraduationCap, Library, Newspaper, Pencil, Plus, Printer, ScrollText, TabletSmartphone, Trash2 } from 'lucide-react'
import { COPY_SOURCES, COPY_STATUS, ITEM_TYPES, hasCopies, toPaise, toRupees } from '@schoolgiant/shared'
import { DateInput, Attachments, CodeBadge, ColorChip, DataTable, Drawer, FormField, HeaderButton, ImportExportButtons, Input, LevelBar, Modal, Money, Note, PageContainer, PageHeader, Panel, PersonCell, SearchInput, Select, StatCardRow, Textarea, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { addCopies, deleteCopy, deleteTitle, exportCatalogue, fetchTitle, fetchTitles, importCatalogue, saveTitle, updateCopy } from '../../api/library'
import { hasPermission } from '../../api/auth'
import { printDocuments } from '../../components/print/printDocument'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { readSheet } from '../../utils/readSheet'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CopyPill, LoanPill, useLibraryLabels, useLibraryMeta } from '../../components/library/LibraryKit'
import TitleForm, { titleBody, titleFormValues } from '../../components/library/TitleForm'
import useUrlSearch from '../../hooks/useUrlSearch'

// each item type's icon in the catalogue table
const TYPE_ICON = { BOOK: BookOpen, REFERENCE: BookMarked, TEXTBOOK: GraduationCap, MAGAZINE: Newspaper, JOURNAL: ScrollText, MEDIA: Disc3, EBOOK: TabletSmartphone }

const PAGE = 50

/** Edit a title in a pop-up — the same form as the Add title page (its sections go plain inside the pop-up). */
function EditTitle({ title, onClose, onSaved }) {
  const { t } = useTranslation('library')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => titleFormValues(title))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => saveTitle(title.id, titleBody(form, { editing: true })),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={t('library.titles.editTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.title.trim()} onClick={() => save.mutate()}>{t('library.titles.save')}</Button>
    </>}>
      <TitleForm value={form} onChange={setForm} errors={errors} onErrors={setErrors} editing titleId={title.id} />
    </Modal>
  )
}

function CopiesForm({ title, onClose, onSaved }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useLibraryMeta()
  const [form, setForm] = useState({ how: 'COUNT', count: 1, numbers: '', price: title.copyList?.[0]?.price != null ? String(toRupees(title.copyList[0].price)) : '', shelf: title.copyList?.[0]?.shelf ?? '', source: 'PURCHASE', vendor: '', billNo: '', acquiredOn: '', branchId: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const numbers = form.numbers.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: () => addCopies(title.id, {
      ...(form.how === 'COUNT' ? { count: Number(form.count) } : { accessionNos: numbers }),
      price: form.price === '' ? null : toPaise(form.price), shelf: form.shelf, source: form.source, vendor: form.vendor, billNo: form.billNo, acquiredOn: form.acquiredOn, branchId: form.branchId,
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('library.copies.addTitle', { title: title.title })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.how === 'COUNT' ? !(Number(form.count) > 0) : !numbers.length} onClick={() => save.mutate()}>{t('library.copies.add')}</Button>
    </>}>
      <div className="space-y-3">
        <FormField label={t('library.copies.how')}>
          <Select value={form.how} onChange={set('how')}><option value="COUNT">{t('library.copies.howCount')}</option><option value="NUMBERS">{t('library.copies.howNumbers')}</option></Select>
        </FormField>
        {form.how === 'COUNT'
          ? <FormField label={t('library.copies.count')}><Input type="number" min="1" max="200" value={form.count} onChange={set('count')} /></FormField>
          : <FormField label={t('library.copies.numbers')} hint={t('library.copies.numbersHint')} error={errors.accessionNos}><Textarea rows={3} value={form.numbers} onChange={set('numbers')} /></FormField>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('library.copies.price')}><Input type="number" min="0" value={form.price} onChange={set('price')} /></FormField>
          <FormField label={t('library.copies.shelf')}><Input value={form.shelf} onChange={set('shelf')} /></FormField>
          <FormField label={t('library.copies.source')}><Select value={form.source} onChange={set('source')}>{COPY_SOURCES.map((s) => <option key={s.value} value={s.value}>{L.source(s.value)}</option>)}</Select></FormField>
          <FormField label={t('library.copies.acquiredOn')}><DateInput value={form.acquiredOn} onChange={set('acquiredOn')} /></FormField>
          <FormField label={t('library.copies.vendor')}><Input value={form.vendor} onChange={set('vendor')} /></FormField>
          <FormField label={t('library.copies.billNo')}><Input value={form.billNo} onChange={set('billNo')} /></FormField>
          {(meta?.branches ?? []).length > 1 && (
            <FormField label={t('library.copies.campus')} className="col-span-2">
              <Select value={form.branchId} onChange={set('branchId')}><option value="">{t('library.copies.myCampus')}</option>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            </FormField>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TitleDrawer({ id, onClose, onEdit, onChanged }) {
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(false)
  const { data: x } = useQuery({ queryKey: ['library', 'title', id], queryFn: () => fetchTitle(id) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['library'] }); onChanged() }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  if (!x) return <Drawer open onClose={onClose} title={t('library.loading')}><span /></Drawer>
  const canEdit = hasPermission('library.catalogue.edit')
  const setStatus = async (c, status) => {
    let reason
    if (status === 'WITHDRAWN') { reason = await prompt({ title: t('library.copies.withdrawTitle', { no: c.accessionNo }), label: t('library.copies.withdrawReason') }); if (reason === null || reason === undefined) return }
    act.mutate({ fn: () => updateCopy(c.id, { status, reason }), done: t('library.copies.changed') })
  }
  return (
    <Drawer open onClose={onClose} size="xl" title={x.title} subtitle={[x.authors.join(', '), x.publisher, x.year].filter(Boolean).join(' · ')}
      footer={<div className="flex flex-wrap gap-2">
        {canEdit && <Button icon={Pencil} variant="secondary" onClick={() => onEdit(x)}>{t('library.edit')}</Button>}
        {hasCopies(x.type) && (canEdit || hasPermission('library.catalogue.create')) && <Button icon={BookCopy} variant="secondary" onClick={() => setAdding(true)}>{t('library.copies.add')}</Button>}
        {hasCopies(x.type) && x.copyList.length > 0 && <Button icon={Printer} variant="secondary" onClick={() => printDocuments('LIBRARY_LABEL', [x.id], { preparing: t('library.copies.preparing') })}>{t('library.copies.labels')}</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
          <span>{L.type(x.type)}</span>
          {x.category && <span>{x.category}</span>}
          {x.callNo && <span>{t('library.titles.callNo')}: {x.callNo}</span>}
          {x.isbn && <span>{t('library.titles.isbn')}: {x.isbn}</span>}
          {x.language && <span>{x.language}</span>}
          {x.edition && <span>{x.edition}</span>}
        </div>
        {x.description && <p className="text-sm text-ink whitespace-pre-line">{x.description}</p>}
        {x.type === 'EBOOK' ? (
          <Panel title={t('library.titles.ebook')}>
            {x.ebookUrl && <a href={x.ebookUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-700 break-all">{x.ebookUrl}</a>}
            <p className="text-xs text-ink-faint mt-1">{x.forFamilies ? (x.classNames.length ? t('library.titles.forClasses', { list: x.classNames.join(', ') }) : t('library.titles.forEveryone')) : t('library.titles.staffOnly')}</p>
            <div className="mt-3"><Attachments entityType="library_title" entityId={x.id} canAdd={canEdit} label={t('library.titles.files')} /></div>
          </Panel>
        ) : (
          <Panel title={t('library.copies.title', { count: x.copies.total })} flush>
            <DataTable rows={x.copyList} columns={[
              { key: 'accessionNo', header: t('library.copies.accessionNo'), mobilePrimary: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
              { key: 'status', header: t('library.copies.status'), render: (v, c) => <span className="flex flex-col items-start gap-0.5"><CopyPill status={v} />{c.loan && <span className="text-[11px] text-ink-faint">{t('library.copies.withDue', { name: c.loan.borrower, date: date(c.loan.dueOn) })}</span>}</span> },
              { key: 'shelf', header: t('library.copies.shelf'), mobileHidden: true, render: (v) => v || '—' },
              { key: 'price', header: t('library.copies.price'), align: 'right', mobileHidden: true, render: (v) => (v != null ? <Money value={v} paise /> : '—') },
              { key: 'id', header: '', align: 'right', width: 190, render: (_, c) => canEdit && c.status !== 'ISSUED' && (
                <div className="flex justify-end gap-1">
                  <div className="w-32"><Select value={c.status} aria-label={t('library.copies.status')} onChange={(e) => setStatus(c, e.target.value)}>{Object.keys(COPY_STATUS).filter((s) => s !== 'ISSUED').map((s) => <option key={s} value={s}>{L.copy(s)}</option>)}</Select></div>
                  {hasPermission('library.catalogue.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('library.delete')}
                    onClick={async () => { if (await confirm({ title: t('library.copies.deleteConfirm', { no: c.accessionNo }), confirmLabel: t('library.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteCopy(c.id), done: t('library.copies.deleted') }) }} />}
                </div>
              ) },
            ]} emptyTitle={t('library.copies.none')} />
          </Panel>
        )}
        {x.history.length > 0 && (
          <Panel title={t('library.titles.history')} flush>
            <div className="divide-y divide-border">
              {x.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <PersonCell name={h.borrower} sub={[h.place, h.accessionNo].filter(Boolean).join(' · ') || undefined} size={28} />
                  <span className="text-right text-xs text-ink-muted">{date(h.issuedOn)} → {h.returnedOn ? date(h.returnedOn) : date(h.dueOn)}<span className="block"><LoanPill state={h.status === 'ISSUED' ? 'ISSUED' : h.status} /></span></span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
      {adding && <CopiesForm title={x} onClose={() => setAdding(false)} onSaved={(made) => { setAdding(false); refresh(); showSuccess(t('library.copies.added', { count: made.length })) }} />}
    </Drawer>
  )
}

/** Library › Catalogue: titles and their copies (each with its accession number / barcode), e-books, import and labels. */
export default function Catalogue() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation('library')
  const L = useLibraryLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: meta } = useLibraryMeta()
  const [search, setSearch] = useUrlSearch()
  const q = useDebouncedValue(search.trim(), 300)
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(() => location.state?.open ?? null) // a title just added opens here
  const params = { search: q || undefined, type: type || undefined, category: category || undefined, page, pageSize: PAGE }
  const { data, isLoading } = useQuery({ queryKey: ['library', 'titles', params], queryFn: () => fetchTitles(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['library'] })
  const remove = useMutation({ mutationFn: deleteTitle, onSuccess: () => { refresh(); showSuccess(t('library.titles.deleted')) }, onError: (e) => showError(e.message) })
  const tot = meta?.totals
  return (
    <PageContainer>
      <PageHeader icon={Library} title={t('library.titles.pageTitle')} subtitle={t('library.titles.pageSubtitle')}
        actions={<>
          {hasPermission('library.catalogue.import') && <ImportExportButtons resourceLabel={t('library.titles.resource')} requires="library.catalogue.import"
            onImport={async (file) => importCatalogue(await readSheet(file), true)} onCommit={(r) => importCatalogue(r, false)}
            templateHeaders={['title', 'authors', 'isbn', 'publisher', 'year', 'edition', 'language', 'type', 'category', 'callNo', 'copies', 'accessionNos', 'price', 'shelf', 'source']}
            templateSample={['Wings of Fire', 'A. P. J. Abdul Kalam; Arun Tiwari', '9788173711466', 'Universities Press', '1999', '', 'English', 'BOOK', 'Biography', '920 KAL', '', 'ACC-1021, ACC-1022', '199', 'B2', 'PURCHASE']}
            onDone={refresh} />}
          {hasPermission('library.catalogue.export') && <HeaderButton icon={Download} onClick={() => exportCatalogue().catch((e) => showError(e.message))}>{t('library.titles.export')}</HeaderButton>}
          <HeaderButton icon={ClipboardCheck} onClick={() => navigate('/library/stock-check')}>{t('library.stock.button')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="library.catalogue.create" onClick={() => navigate('/library/catalogue/new')}>{t('library.titles.new')}</HeaderButton>
        </>} />
      <div className="space-y-4">
        {tot && <StatCardRow items={[
          { icon: Library, tone: 'brand', label: t('library.titles.titlesN'), value: tot.titles },
          { icon: BookCopy, tone: 'violet', label: t('library.titles.copiesN'), value: tot.copies },
          { icon: BookUp, tone: 'info', label: t('library.titles.out'), value: tot.issued, progress: tot.copies ? (tot.issued / tot.copies) * 100 : undefined },
          { icon: AlarmClock, label: t('library.titles.overdue'), value: tot.overdue, tone: tot.overdue ? 'danger' : 'neutral' },
        ]} />}
        {tot && !tot.titles && <Note>{t('library.titles.emptyHint')}</Note>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('library.titles.search')} /></div>
          <div className="w-44"><Select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} aria-label={t('library.titles.type')}><option value="">{t('library.titles.allTypes')}</option>{ITEM_TYPES.map((x) => <option key={x.value} value={x.value}>{L.type(x.value)}</option>)}</Select></div>
          {(meta?.categories ?? []).length > 0 && <div className="w-48"><Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} aria-label={t('library.titles.category')}><option value="">{t('library.titles.allCategories')}</option>{meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>}
        </div>
        <DataTable rows={data?.data ?? []} loading={isLoading} columns={[
          { key: 'title', header: t('library.titles.title'), mobilePrimary: true, render: (v, r) => <span className="font-medium">{v}<span className="block text-xs font-normal text-ink-faint">{r.authors.join(', ')}</span></span> },
          { key: 'type', header: t('library.titles.type'), mobileHidden: true, render: (v) => <ColorChip label={L.type(v)} seed={`item-${v}`} icon={TYPE_ICON[v] ?? BookOpen} /> },
          { key: 'category', header: t('library.titles.category'), mobileHidden: true, render: (v) => <ColorChip label={v} dot /> },
          { key: 'callNo', header: t('library.titles.callNo'), mobileHidden: true, render: (v) => <CodeBadge>{v}</CodeBadge> },
          { key: 'copies', header: t('library.titles.onShelf'), align: 'right', render: (v, r) => (hasCopies(r.type) && v.total ? <LevelBar value={v.available} max={v.total} dangerAt={0} width="w-24" /> : hasCopies(r.type) ? <span className="text-ink-faint">0</span> : '—') },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1">
              {hasPermission('library.catalogue.edit') && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('library.edit')} onClick={(e) => { e.stopPropagation(); setEditing(r) }} />}
              {hasPermission('library.catalogue.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('library.delete')}
                onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('library.titles.deleteConfirm', { title: r.title }), message: t('library.titles.deleteHint'), confirmLabel: t('library.delete'), tone: 'danger' })) remove.mutate(r.id) }} />}
            </div>
          ) },
        ]} onRowClick={(r) => setOpen(r.id)} emptyTitle={t('library.titles.empty')}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      </div>
      {open && <TitleDrawer id={open} onClose={() => setOpen(null)} onEdit={(x) => { setOpen(null); setEditing(x) }} onChanged={() => {}} />}
      {editing && <EditTitle title={editing} onClose={() => setEditing(null)}
        onSaved={(r) => { setEditing(null); refresh(); showSuccess(r.added ? t('library.titles.savedWithCopies', { count: r.added }) : t('library.titles.saved')); if (!r.id) return; setOpen(r.id) }} />}
    </PageContainer>
  )
}
