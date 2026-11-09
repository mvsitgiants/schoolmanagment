import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Armchair, Award, CircleCheck, CircleDashed, Medal, Send, Trophy, UsersRound } from 'lucide-react'
import { APPLICATION_STATUS, MERIT_BASES } from '@schoolgiant/shared'
import { CodeBadge, ContactCell, DataTable, Note, PageContainer, PageHeader, PersonCell, SideNav, SideNavLayout, StatCardRow, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useCycle from '../../components/admissions/useCycle'
import { allotSeats, fetchMerit, publishMerit } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// the top three ranks get a medal colour
const MEDAL = { 1: 'text-amber-500', 2: 'text-slate-400', 3: 'text-orange-600' }
function Rank({ value }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  return (
    <span className="inline-flex items-center justify-end gap-1 font-semibold tabular-nums text-ink">
      {MEDAL[value] && <Medal className={`h-4 w-4 ${MEDAL[value]}`} aria-hidden />}{value}
    </span>
  )
}

/** A class's merit list: ranked applicants, the seats, publishing the list and offering the seats from the top. */
export default function Merit() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { cycle, chip, isLoading: cyclesLoading } = useCycle()
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
      {!cycle && !cyclesLoading && <Note tone="warning">{t('admissions.noCycles')}</Note>}
      {cycle && (
      <SideNavLayout nav={classes.length > 1 && (
        // one merit list per class: its applicants, and the seats filled so far (red when the class is full)
        <SideNav title={t('admissions.applications.classesNav')} value={picked?.classId} onChange={setClassId} items={classes.map((c) => ({
          id: c.classId, label: c.className, count: c.applications ?? 0,
          hint: c.seats ? t('admissions.applications.seatsFilled', { admitted: c.admitted ?? 0, seats: c.seats }) : undefined,
          progress: c.seats ? { value: c.admitted ?? 0, max: c.seats } : undefined,
        }))} />
      )}>
      {m && <StatCardRow items={[
        { icon: Armchair, tone: 'brand', label: t('admissions.merit.seats'), value: m.class.seats },
        { icon: CircleCheck, label: t('admissions.merit.taken'), value: m.taken, tone: 'success', progress: m.class.seats ? (m.taken / m.class.seats) * 100 : undefined },
        { icon: CircleDashed, label: t('admissions.merit.left'), value: m.left, tone: m.left ? 'info' : 'neutral' },
        { icon: UsersRound, tone: 'violet', label: t('admissions.merit.applicants'), value: m.rows.length },
      ]} />}
      {m && <Note>{t('admissions.merit.basis', { basis: basisLabel(m.class.meritBasis) })}{m.class.publishedAt ? ` ${t('admissions.merit.publishedNote', { at: dateTime(m.class.publishedAt), by: m.class.publishedBy ?? '' })}` : ''}</Note>}
      {m?.missingScores > 0 && <Note tone="warning">{t('admissions.merit.missing', { count: m.missingScores })}</Note>}
        <DataTable
          rows={m?.rows ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          exportable exportName="merit-list"
          toolbar={chip && <div className="flex flex-wrap justify-end gap-2">{chip}</div>}
          rowTone={(r) => (['OFFERED', 'ACCEPTED', 'ADMITTED'].includes(r.status) ? 'success' : undefined)}
          columns={[
            { key: 'rank', header: t('admissions.applications.rank'), width: 70, align: 'right', mobileTrail: true, render: (v) => <Rank value={v} /> },
            { key: 'childName', header: t('admissions.enquiries.child'), mobileTitle: true, render: (v, r) => <PersonCell name={v} sub={r.applicationNo} size={34} /> },
            { key: 'score', header: t('admissions.applications.score'), align: 'right', mobilePrimary: true, render: (v, r) => (r.testAbsent ? <CodeBadge tone="danger">{t('admissions.applications.ab')}</CodeBadge> : v != null ? <span className="font-semibold tabular-nums text-ink">{v}</span> : <span className="text-ink-faint">—</span>) },
            { key: 'parent', header: t('admissions.form.parentName'), render: (v) => <ContactCell name={v?.name} phone={v?.mobile} /> },
            { key: 'status', header: t('admissions.statusLabel'), mobilePrimary: true, render: (v) => <StatusPill tone={APPLICATION_STATUS[v]?.tone}>{t(`admissions.status.${v}`, APPLICATION_STATUS[v]?.label)}</StatusPill> },
          ]}
          emptyIcon={Trophy} emptyTitle={t('admissions.merit.empty')}
        />
      </SideNavLayout>
      )}
    </PageContainer>
  )
}
