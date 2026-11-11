import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Library, Pencil, Plus, Trash2, X } from 'lucide-react'
import { CONTENT_TYPES } from '@schoolgiant/shared'
import { EmptyState, HeaderButton, PageContainer, PageHeader, Pagination, Panel, SearchInput, Select, SkeletonRows, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { ContentCard, ContentPreview } from '../../components/lms/ContentKit'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { deleteContent, fetchContentLibrary, fetchContentTopics, fetchLmsLookup, fetchMyContent } from '../../api/lms'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 20
const SHARED = Object.keys(CONTENT_TYPES).filter((k) => CONTENT_TYPES[k].kind)

/** "My content" (`mine`) or the content library: shared items as cards, with filters, open / edit / delete. */
export default function ContentBrowser({ mine = false }) {
  const { t } = useTranslation('lms')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState(() => ({ classId: params.get('classId') ?? '', subjectId: params.get('subjectId') ?? '', topicId: params.get('topicId') ?? '', type: params.get('type') ?? '', teacherId: '', status: '' }))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search.trim(), 300)
  const setFilter = (k) => (e) => {
    const v = e?.target ? e.target.value : e
    setPage(0)
    setF((x) => ({ ...x, [k]: v, ...(k === 'classId' && { subjectId: '', topicId: '' }), ...(k === 'subjectId' && { topicId: '' }) }))
    if (k === 'topicId' || k === 'classId' || k === 'subjectId') setParams({}, { replace: true })
  }
  const { data: look } = useQuery({ queryKey: ['lms-lookup'], queryFn: fetchLmsLookup, staleTime: 60_000 })
  const classes = look?.classes ?? []
  const cls = classes.find((c) => c.id === f.classId)
  const { data: units = [] } = useQuery({ queryKey: ['lms-content-topics', f.classId, f.subjectId], queryFn: () => fetchContentTopics(f.classId, f.subjectId), enabled: !!(cls && f.subjectId) })
  const query = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), search: q || undefined, page: page + 1, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['lms-content', mine ? 'mine' : 'all', query], queryFn: () => (mine ? fetchMyContent(query) : fetchContentLibrary(query)), placeholderData: keepPreviousData })
  const rows = data?.data ?? []
  const meta = data?.meta ?? { total: 0, totalPages: 1 }
  const remove = useMutation({
    mutationFn: (id) => deleteContent(id),
    onSuccess: () => { setOpen(null); qc.invalidateQueries({ queryKey: ['lms-content'] }); qc.invalidateQueries({ queryKey: ['lms-topic-count'] }); showSuccess(t('lms.content.list.deleted')) },
    onError: (e) => showError(e.message),
  })
  const askDelete = async (item) => {
    if (await confirm({ title: t('lms.content.list.deleteConfirm', { title: item.title }), message: t('lms.content.list.deleteHint'), confirmLabel: t('lms.content.delete'), tone: 'danger' })) remove.mutate(item.id)
  }
  const edit = (item) => navigate(`/lms/create-content?edit=${item.id}`)
  // a topic picked from a syllabus link, before class and subject are chosen here
  const topicOnly = f.topicId && !units.some((u) => u.topics.some((x) => x.id === f.topicId))
  return (
    <PageContainer>
      <PageHeader icon={mine ? FolderOpen : Library} title={mine ? t('lms.content.list.mineTitle') : t('lms.content.list.libraryTitle')} subtitle={mine ? t('lms.content.list.mineSubtitle') : t('lms.content.list.librarySubtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="lms.create-content.create" onClick={() => navigate('/lms/create-content')}>{t('lms.content.list.create')}</HeaderButton>} />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder={t('lms.content.list.search')} className="col-span-2" />
        <Select value={f.classId} onChange={setFilter('classId')} className="sm:w-40">
          <option value="">{t('lms.content.list.allClasses')}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={f.subjectId} onChange={setFilter('subjectId')} disabled={!cls} className="sm:w-40">
          <option value="">{t('lms.content.list.allSubjects')}</option>
          {(cls?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {!topicOnly && (
          <Select value={f.topicId} onChange={setFilter('topicId')} disabled={!units.length} className="sm:w-48">
            <option value="">{t('lms.content.list.allTopics')}</option>
            {units.map((u) => <optgroup key={u.id} label={u.name}>{u.topics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
          </Select>
        )}
        <Select value={f.type} onChange={setFilter('type')} className="sm:w-40">
          <option value="">{t('lms.content.list.allTypes')}</option>
          {SHARED.map((k) => <option key={k} value={k}>{t(`lms.content.types.${k}.name`)}</option>)}
        </Select>
        {mine ? (
          <Select value={f.status} onChange={setFilter('status')} className="sm:w-36">
            <option value="">{t('lms.content.list.anyStatus')}</option>
            <option value="PUBLISHED">{t('lms.content.status.PUBLISHED')}</option>
            <option value="SCHEDULED">{t('lms.content.status.SCHEDULED')}</option>
          </Select>
        ) : (
          <Select value={f.teacherId} onChange={setFilter('teacherId')} className="sm:w-44">
            <option value="">{t('lms.content.list.allTeachers')}</option>
            {(data?.teachers ?? []).map((x) => <option key={x.id} value={x.id}>{x.name || t('lms.content.list.someone')}</option>)}
          </Select>
        )}
        {topicOnly && (
          <button type="button" onClick={() => setFilter('topicId')('')} className="col-span-2 inline-flex items-center gap-1.5 self-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            {t('lms.content.list.topicFilter', { topic: rows[0]?.topic || t('lms.content.list.oneTopic') })}<X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      <Panel flush className="mt-3">
        {isLoading ? <div className="p-4"><SkeletonRows rows={5} /></div> : error ? <EmptyState error={error} onRetry={refetch} /> : !rows.length ? (
          <EmptyState icon={mine ? FolderOpen : Library} title={mine ? t('lms.content.list.emptyMine') : t('lms.content.list.emptyLibrary')} hint={mine ? t('lms.content.list.emptyMineHint') : undefined} />
        ) : (
          <ul className="divide-y divide-border px-3 sm:px-4">
            {rows.map((item) => (
              <ContentCard key={item.id} item={item} showTeacher={!mine} onOpen={() => setOpen(item)} onEdit={() => edit(item)} onDelete={() => askDelete(item)} />
            ))}
          </ul>
        )}
      </Panel>
      {meta.totalPages > 1 && <Pagination page={page} size={PAGE} totalElements={meta.total} totalPages={meta.totalPages} onPageChange={setPage} />}
      {open && (
        <ContentPreview item={open} onClose={() => setOpen(null)} footer={<>
          {open.canDelete && <Button variant="ghost" icon={Trash2} onClick={() => askDelete(open)}>{t('lms.content.delete')}</Button>}
          {open.canEdit && <Button variant="secondary" icon={Pencil} onClick={() => edit(open)}>{t('lms.content.edit')}</Button>}
          <Button onClick={() => setOpen(null)}>{t('lms.content.preview.close')}</Button>
        </>} />
      )}
    </PageContainer>
  )
}
