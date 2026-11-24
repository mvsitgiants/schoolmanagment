import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { DataTable, DateCell, LevelBar, PageContainer, PageHeader, PersonCell, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { FileIcon, fmtSize, useFileLabels } from '../../components/documentLibrary/LibraryKit'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchRemoved, fetchStorage, restoreFile } from '../../api/documentLibrary'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50

/** Files removed from records — never destroyed: who removed them and why, and putting one back. Plus the space used. */
export default function Bin() {
  const { t } = useTranslation('documentLibrary')
  const L = useFileLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const params = { search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['doc-library', 'bin', params], queryFn: () => fetchRemoved(params), placeholderData: keepPreviousData })
  const { data: storage } = useQuery({ queryKey: ['doc-library', 'storage'], queryFn: fetchStorage })
  const canRestore = hasPermission('documents.bin.restore')
  const restore = useMutation({
    mutationFn: (id) => restoreFile(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-library'] }); showSuccess(t('documentLibrary.bin.restored')) },
    onError: (e) => showError(e.message),
  })
  const usedBytes = storage?.bytes ?? 0
  return (
    <PageContainer>
      <PageHeader icon={Trash2} title={t('documentLibrary.bin.title')} subtitle={t('documentLibrary.bin.subtitle')} />
      {storage && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4">
          <HardDrive className="h-5 w-5 text-ink-muted" aria-hidden />
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-medium text-ink">{storage.limitGb ? t('documentLibrary.bin.spaceOf', { used: fmtSize(usedBytes), limit: `${storage.limitGb} GB` }) : t('documentLibrary.bin.space', { used: fmtSize(usedBytes) })}</p>
            {storage.limitGb ? <LevelBar value={storage.usedGb} max={storage.limitGb} highIsBad warnAt={storage.limitGb * 0.8} dangerAt={storage.limitGb * 0.95} width="w-full" bare /> : null}
            <p className="mt-1 text-xs text-ink-faint">{t('documentLibrary.bin.spaceHint')}</p>
          </div>
        </div>
      )}
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('documentLibrary.bin.search')} />}
        columns={[
          { key: 'fileName', header: t('documentLibrary.col.file'), mobileTitle: true, render: (v, f) => <span className="flex min-w-0 items-center gap-2"><FileIcon file={f} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{f.title || v}</span><span className="block truncate text-xs text-ink-faint">{L.source(f.source)} · {fmtSize(f.size)}</span></span></span> },
          { key: 'person', header: t('documentLibrary.col.person'), mobileHidden: true, render: (p) => (p?.name ? <PersonCell name={p.name} sub={p.sub} size={26} /> : <span className="text-sm text-ink-muted">{L.person(p?.kind ?? 'SCHOOL')}</span>) },
          { key: 'removed', header: t('documentLibrary.bin.colRemoved'), mobilePrimary: true, render: (r) => <div><DateCell value={r.at} /><p className="text-xs text-ink-faint">{r.by}</p></div> },
          { key: 'reason', header: t('documentLibrary.bin.colWhy'), mobilePrimary: true, render: (_, f) => <span className="text-sm text-ink">{f.removed.reason || '—'}</span> },
          { key: 'actions', header: '', align: 'right', width: 120, render: (_, f) => canRestore && (
            <Button size="sm" variant="secondary" icon={RotateCcw} loading={restore.isPending && restore.variables === f.id}
              onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('documentLibrary.bin.restoreTitle', { name: f.title || f.fileName }), message: t('documentLibrary.bin.restoreMessage'), confirmLabel: t('documentLibrary.bin.restore') })) restore.mutate(f.id) }}>
              {t('documentLibrary.bin.restore')}
            </Button>
          ) },
        ]}
        emptyIcon={Trash2} emptyTitle={t('documentLibrary.bin.empty')} emptyHint={t('documentLibrary.bin.emptyHint')} />
    </PageContainer>
  )
}
