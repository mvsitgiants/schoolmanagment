import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, Send, Trophy } from 'lucide-react'
import { APPLICATION_STATUS, MERIT_BASES } from '@schoolgiant/shared'
import { ControlChip, DataTable, Note, PageContainer, PageHeader, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useCycle from '../../components/admissions/useCycle'
import { allotSeats, fetchMerit, publishMerit } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** A class's merit list: ranked applicants, the seats, publishing the list and offering the seats from the top. */
export default function Merit() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { cycle, chip } = useCycle()
  const [classId, setClassId] = useState('')
  const classes = cycle?.classes ?? []
  const picked = classes.find((c) => c.classId === classId) ?? classes[0]
  const { data: m, isLoading, error, refetch } = useQuery({ queryKey: ['merit', cycle?.id, picked?.classId], queryFn: () => fetchMerit(cycle.id, picked.classId), enabled: !!cycle && !!picked })
  const after = (d) => { qc.setQueryData(['merit', cycle.id, picked.classId], d); qc.invalidateQueries({ queryKey: ['applications'] }); qc.invalidateQueries({ queryKey: ['admission-cycles'] }) }
  const publish = useMutation({ mutationFn: () => publishMerit(cycle.id, picked.classId), onSuccess: (d) => { after(d); showSuccess(t('admissions.merit.published')) }, onError: (e) => showError(e.message) })
  const allot = useMutation({ mutationFn: () => allotSeats(cycle.id, picked.classId), onSuccess: (r) => { after(r.list); showSuccess(t('admissions.merit.allotted', { offered: r.offered, waitlisted: r.waitlisted })) }, onError: (e) => showError(e.message) })
  const basisLabel = (b) => t(`admissions.bases.${b}`, MERIT_BASES.find((x) => x.value === b)?.label)

  return (
    <PageContainer>
      <PageHeader icon={Trophy} title={t('admissions.merit.title')} subtitle={t('admissions.merit.subtitle')}
        actions={m && <>
          {hasPermission('admissions.merit.publish') && <Button variant="secondary" icon={Award} loading={publish.isPending} onClick={async () => { if (await confirm({ title: t('admissions.merit.publishTitle', { cls: m.class.name }), message: t('admissions.merit.publishHint'), confirmLabel: t('admissions.merit.publish') })) publish.mutate() }}>{m.class.publishedAt ? t('admissions.merit.republish') : t('admissions.merit.publish')}</Button>}
          {hasPermission('admissions.merit.allot') && <Button icon={Send} loading={allot.isPending} disabled={!m.class.publishedAt || !m.left} onClick={async () => { if (await confirm({ title: t('admissions.merit.allotTitle', { count: m.left, cls: m.class.name }), message: t('admissions.merit.allotHint'), confirmLabel: t('admissions.merit.allot') })) allot.mutate() }}>{t('admissions.merit.allot')}</Button>}
        </>} />
      {!cycle && <Note tone="warning">{t('admissions.noCycles')}</Note>}
      {m && <StatCardRow className="mb-4" items={[
        { label: t('admissions.merit.seats'), value: m.class.seats },
        { label: t('admissions.merit.taken'), value: m.taken, tone: 'success' },
        { label: t('admissions.merit.left'), value: m.left, tone: m.left ? 'info' : 'neutral' },
        { label: t('admissions.merit.applicants'), value: m.rows.length },
      ]} />}
      {m && <Note className="mb-4">{t('admissions.merit.basis', { basis: basisLabel(m.class.meritBasis) })}{m.class.publishedAt ? ` ${t('admissions.merit.publishedNote', { at: dateTime(m.class.publishedAt), by: m.class.publishedBy ?? '' })}` : ''}</Note>}
      {m?.missingScores > 0 && <Note tone="warning" className="mb-4">{t('admissions.merit.missing', { count: m.missingScores })}</Note>}
      {cycle && (
        <DataTable
          rows={m?.rows ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          exportable exportName="merit-list"
          toolbar={<div className="flex flex-wrap justify-end gap-2">{chip}
            <ControlChip label={t('admissions.form.class')} value={picked?.className ?? '—'} active={!!classId} options={classes.map((c) => c.className)} onChange={(v) => setClassId(classes.find((c) => c.className === v)?.classId ?? '')} />
          </div>}
          rowTone={(r) => (['OFFERED', 'ACCEPTED', 'ADMITTED'].includes(r.status) ? 'success' : undefined)}
          columns={[
            { key: 'rank', header: t('admissions.applications.rank'), width: 70, align: 'right' },
            { key: 'childName', header: t('admissions.enquiries.child'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.applicationNo}</p></div> },
            { key: 'score', header: t('admissions.applications.score'), align: 'right', render: (v, r) => (r.testAbsent ? t('admissions.applications.ab') : v ?? '—') },
            { key: 'parent', header: t('admissions.form.parentName'), mobileHidden: true, render: (v) => <span className="text-sm">{v.name} · <span className="font-mono-num text-ink-faint">{v.mobile}</span></span> },
            { key: 'status', header: t('admissions.statusLabel'), render: (v) => <StatusPill tone={APPLICATION_STATUS[v]?.tone}>{t(`admissions.status.${v}`, APPLICATION_STATUS[v]?.label)}</StatusPill> },
          ]}
          emptyIcon={Trophy} emptyTitle={t('admissions.merit.empty')}
        />
      )}
    </PageContainer>
  )
}
