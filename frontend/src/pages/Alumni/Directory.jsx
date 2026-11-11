import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Briefcase, Download, GraduationCap, HandHeart, Linkedin, Mail, MapPin, Phone, Plus, ShieldCheck, Users } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import {
  ColorChip, DataTable, HeaderButton, PageContainer, PageHeader, PersonCell, SearchInput, SegmentedControl, SideNav, SideNavLayout, StackCell, StatCardRow, StatusPill,
} from '../../components/system'
import { exportAlumni, fetchAlumni, fetchAlumnus } from '../../api/alumni'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { AlumnusForm, ImportLeaversModal, useAlumniMeta } from '../../components/alumni/AlumniKit'

const PAGE = 50

/** Alumni › Directory: former students by batch (left), where they work now, how to reach them, and whether they agree to be contacted. */
export default function AlumniDirectory() {
  const { t } = useTranslation('alumni')
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = useAlumniMeta()
  const [batch, setBatch] = useState('')
  const [consent, setConsent] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [importing, setImporting] = useState(false)
  const params = { batch: batch || undefined, consent: consent || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['alumni', 'list', params], queryFn: () => fetchAlumni(params) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['alumni'] })
  const tot = meta?.totals ?? {}
  const canEdit = hasPermission('alumni.directory.edit')
  const open = async (a) => { if (!canEdit) return; try { setEditing(await fetchAlumnus(a.id)) } catch (e) { showError(e.message) } }
  const peak = Math.max(1, ...(meta?.batches ?? []).map((b) => b.count))
  return (
    <PageContainer>
      <PageHeader icon={GraduationCap} title={t('alumni.directory.title')} subtitle={t('alumni.directory.subtitle')}
        actions={<>
          <HeaderButton icon={Download} requires="alumni.directory.export" onClick={() => exportAlumni({ batch: batch || undefined, consent: consent || undefined, search: q || undefined }).catch((e) => showError(e.message))}>{t('alumni.directory.export')}</HeaderButton>
          <HeaderButton icon={Users} requires="alumni.directory.create" onClick={() => setImporting(true)}>{t('alumni.directory.importLeavers')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="alumni.directory.create" onClick={() => setEditing('new')}>{t('alumni.directory.new')}</HeaderButton>
        </>} />
      <SideNavLayout nav={<SideNav title={t('alumni.directory.batches')} value={batch} onChange={(v) => { setBatch(v); setPage(1) }} items={[
        { id: '', label: t('alumni.directory.allBatches'), count: tot.alumni ?? 0 },
        ...(meta?.batches ?? []).map((b) => ({ id: String(b.batch), label: t('alumni.directory.batchOf', { year: b.batch }), hint: t('alumni.directory.consentHint', { count: b.consent }), count: b.count, progress: { value: b.count, max: peak, kind: 'done' } })),
      ]} />}>
        <StatCardRow items={[
          { icon: GraduationCap, label: t('alumni.directory.statAlumni'), value: tot.alumni ?? 0, tone: 'brand' },
          { icon: ShieldCheck, label: t('alumni.directory.statConsent'), value: tot.consent ?? 0, tone: 'success', progress: tot.alumni ? (tot.consent / tot.alumni) * 100 : 0 },
          { icon: Briefcase, label: t('alumni.directory.statWorking'), value: tot.working ?? 0, tone: 'violet', progress: tot.alumni ? (tot.working / tot.alumni) * 100 : 0 },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('alumni.directory.search')} /></div>
          <SegmentedControl value={consent} onChange={(v) => { setConsent(v); setPage(1) }} options={[{ value: '', label: t('alumni.directory.everyone') }, { value: '1', label: t('alumni.directory.consenting') }, { value: '0', label: t('alumni.directory.notConsenting') }]} />
        </div>
        <DataTable rows={data?.data ?? []} loading={isLoading} error={error} onRetry={refetch} onRowClick={canEdit ? open : undefined}
          emptyIcon={GraduationCap} emptyTitle={t('alumni.directory.empty')} emptyHint={t('alumni.directory.emptyHint')}
          columns={[
            { key: 'name', header: t('alumni.directory.name'), mobilePrimary: true, render: (v, a) => <PersonCell name={v} sub={a.admissionNo ?? undefined} /> },
            { key: 'batch', header: t('alumni.directory.batch'), render: (v, a) => <ColorChip label={String(v)} seed={`batch-${v}`} sub={a.program ?? undefined} /> },
            { key: 'organisation', header: t('alumni.directory.workingAt'), render: (v, a) => (v ? <StackCell title={v} sub={a.designation ?? undefined} /> : <span className="text-ink-faint">—</span>) },
            { key: 'city', header: t('alumni.directory.city'), mobileHidden: true, render: (v, a) => (v ? <span className="inline-flex items-center gap-1 text-sm text-ink-muted"><MapPin className="h-3.5 w-3.5" />{[v, a.country].filter(Boolean).join(', ')}</span> : '—') },
            { key: 'email', header: t('alumni.directory.contact'), mobileHidden: true, render: (v, a) => (
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
                {v && <a href={`mailto:${v}`} title={v} className="text-brand-700"><Mail className="h-4 w-4" /></a>}
                {a.mobile && <a href={`tel:${a.mobile}`} title={a.mobile} className="text-brand-700"><Phone className="h-4 w-4" /></a>}
                {a.linkedIn && <a href={a.linkedIn} target="_blank" rel="noreferrer" title="LinkedIn" className="text-sky-700"><Linkedin className="h-4 w-4" /></a>}
                {!v && !a.mobile && !a.linkedIn && <span className="text-ink-faint">—</span>}
              </span>
            ) },
            { key: 'consent', header: t('alumni.directory.consent'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('alumni.directory.consentYes') : t('alumni.directory.consentNo')}</StatusPill> },
            { key: 'given', header: t('alumni.directory.given'), align: 'right', mobileHidden: true, render: (g) => (g ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><HandHeart className="h-3.5 w-3.5" />{formatINR(g.amount)}</span> : <span className="text-ink-faint">—</span>) },
          ]}
          pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      </SideNavLayout>
      {editing && <AlumnusForm alumnus={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showSuccess(t('alumni.form.saved')) }} onDeleted={() => { setEditing(null); refresh(); showSuccess(t('alumni.form.deleted')) }} />}
      {importing && <ImportLeaversModal onClose={() => setImporting(false)} onDone={(r) => { setImporting(false); refresh(); showSuccess(t('alumni.import.done', { count: r.added })) }} />}
    </PageContainer>
  )
}
