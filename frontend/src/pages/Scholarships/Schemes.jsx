import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { ColorChip, ControlChip, DataTable, HeaderButton, LevelBar, PageContainer, PageHeader, StatusPill, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteScheme, fetchSchemes } from '../../api/scholarships'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** Scholarship schemes: what each gives, who can apply, the documents to give, and this year's seats and budget used. */
export default function Schemes() {
  const { t } = useTranslation('scholarships')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [all, setAll] = useState(false)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['scholarship-schemes', all], queryFn: () => fetchSchemes(all) })
  const rows = data?.rows ?? []
  const remove = useMutation({
    mutationFn: (id) => deleteScheme(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scholarship-schemes'] }); qc.invalidateQueries({ queryKey: ['scholarship-meta'] }); showSuccess(t('scholarships.schemes.deleted')) },
    onError: (e) => showError(e.message),
  })
  const canEdit = hasPermission('scholarships.schemes.edit')
  const canDelete = hasPermission('scholarships.schemes.delete')

  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('scholarships.schemes.title')} subtitle={data?.year ? t('scholarships.schemes.subtitleYear', { year: data.year.name }) : t('scholarships.schemes.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="scholarships.schemes.create" onClick={() => navigate('/scholarships/schemes/new')}>{t('scholarships.schemes.new')}</HeaderButton>} />
      <DataTable
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        onSelect={(r) => canEdit && navigate(`/scholarships/schemes/${r.id}`)}
        toolbar={<Toolbar right={<ControlChip label={t('scholarships.schemes.showing')} active={all} value={all ? t('scholarships.schemes.allSchemes') : t('scholarships.schemes.activeOnly')}
          options={[{ value: 'active', label: t('scholarships.schemes.activeOnly') }, { value: 'all', label: t('scholarships.schemes.allSchemes') }]} onChange={(v) => setAll(v === 'all')} />} />}
        columns={[
          { key: 'name', header: t('scholarships.schemes.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{t(`scholarships.provider.${r.provider}`)} · {t(`scholarships.benefit.${r.benefit}`)}</p></div> },
          { key: 'valueText', header: t('scholarships.schemes.gives'), render: (v) => <ColorChip label={v} seed={v} /> },
          { key: 'documents', header: t('scholarships.schemes.documents'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{t('scholarships.schemes.docCount', { count: v.length })}</span> },
          { key: 'usage', header: t('scholarships.schemes.thisYear'), render: (u, r) => (
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">{t('scholarships.schemes.usage', { applied: u.applied, approved: u.approved, open: u.open })}</p>
              {r.seats ? <LevelBar value={u.approved} max={r.seats} label={t('scholarships.schemes.seatsUsed', { used: u.approved, seats: r.seats })} highIsBad warnAt={r.seats} width="w-44" /> : null}
              {r.budget ? <LevelBar value={u.approvedAmount} max={r.budget} label={t('scholarships.schemes.budgetUsed', { used: formatINR(u.approvedAmount), budget: formatINR(r.budget) })} highIsBad warnAt={r.budget} width="w-44" /> : null}
            </div>
          ) },
          { key: 'active', header: t('scholarships.schemes.state'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('scholarships.schemes.on') : t('scholarships.schemes.off')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={ExternalLink} title={t('scholarships.schemes.seeApplications')} aria-label={t('scholarships.schemes.seeApplications')} onClick={() => navigate(`/scholarships/applications?scheme=${id}`)} />
              {canEdit && <Button size="sm" variant="ghost" icon={Pencil} title={t('scholarships.common.edit')} aria-label={t('scholarships.common.edit')} onClick={() => navigate(`/scholarships/schemes/${id}`)} />}
              {canDelete && r.usage.applied === 0 && <Button size="sm" variant="ghost" icon={Trash2} title={t('scholarships.common.delete')} aria-label={t('scholarships.common.delete')}
                onClick={async () => { if (await confirm({ title: t('scholarships.schemes.deleteTitle', { name: r.name }), message: t('scholarships.schemes.deleteMessage'), tone: 'danger', confirmLabel: t('scholarships.common.delete') })) remove.mutate(id) }} />}
            </div>
          ) },
        ]}
        emptyIcon={Award} emptyTitle={t('scholarships.schemes.empty')} emptyHint={t('scholarships.schemes.emptyHint')}
        emptyAction={hasPermission('scholarships.schemes.create') && <Button icon={Plus} onClick={() => navigate('/scholarships/schemes/new')}>{t('scholarships.schemes.new')}</Button>}
      />
    </PageContainer>
  )
}
