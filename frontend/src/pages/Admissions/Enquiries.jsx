import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarDays, ClipboardList, Footprints, Globe, Megaphone, MoreHorizontal, Newspaper, Phone, PhoneCall, Plus, Share2, Trash2, UserPlus, Users } from 'lucide-react'
import { ENQUIRY_SOURCES, ENQUIRY_STAGES, FOLLOWUP_TYPES, LOST_REASONS, addDaysYmd } from '@schoolgiant/shared'
import { DateInput, ColorChip, ContactCell, ControlChip, DataTable, DateCell, Drawer, FormField, HeaderButton, PageContainer, PageHeader, PersonCell, PhoneLink, Select, StatusPill, Textarea, Timeline, Toolbar, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { addFollowUp, deleteEnquiry, fetchEnquiries, fetchEnquiry, updateEnquiry } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import useUrlSearch from '../../hooks/useUrlSearch'

const reasonKey = (r) => r.replace(/[^A-Za-z]/g, '')
// each enquiry source's icon in the table
const SOURCE_ICON = { WALK_IN: Footprints, PHONE: Phone, WEBSITE: Globe, SOCIAL: Share2, REFERRAL: Users, NEWSPAPER: Newspaper, HOARDING: Megaphone, EVENT: CalendarDays, OTHER: MoreHorizontal }
const STAGE_ORDER = Object.entries(ENQUIRY_STAGES).sort((a, b) => a[1].order - b[1].order).map(([k]) => k)

function EnquiryDrawer({ id, onClose }) {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: e } = useQuery({ queryKey: ['enquiry', id], queryFn: () => fetchEnquiry(id) })
  const [fu, setFu] = useState({ type: 'CALL', note: '', nextOn: addDaysYmd(localIso(new Date()), 2), stage: '' })
  const [lost, setLost] = useState('')
  const after = (d) => { qc.setQueryData(['enquiry', id], d); qc.invalidateQueries({ queryKey: ['enquiries'] }) }
  const log = useMutation({ mutationFn: () => addFollowUp(id, { ...fu, stage: fu.stage || undefined, nextOn: fu.nextOn || undefined }), onSuccess: (d) => { after(d); setFu((x) => ({ ...x, note: '' })); showSuccess(t('admissions.enquiries.logged')) }, onError: (er) => showError(er.message) })
  const markLost = useMutation({ mutationFn: () => updateEnquiry(id, { stage: 'LOST', lostReason: lost }), onSuccess: (d) => { after(d); showSuccess(t('admissions.enquiries.markedLost')) }, onError: (er) => showError(er.message) })
  const confirm = useConfirm()
  const remove = useMutation({ mutationFn: () => deleteEnquiry(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['enquiries'] }); showSuccess(t('admissions.enquiries.deleted')); onClose() }, onError: (er) => showError(er.message) })
  const canEdit = hasPermission('admissions.enquiries.edit')
  const open = e && !['APPLIED', 'ADMITTED', 'LOST'].includes(e.stage)
  const canDelete = e && !e.applicationId && !['APPLIED', 'ADMITTED'].includes(e.stage) && hasPermission('admissions.enquiries.delete')
  return (
    <Drawer open onClose={onClose} size="xl" title={e ? e.childName : t('admissions.loading')} subtitle={e ? `${e.enquiryNo} · ${e.sourceLabel}` : undefined}
      footer={canDelete ? <Button variant="ghost" icon={Trash2} className="me-auto text-danger-600" loading={remove.isPending}
        onClick={async () => { if (await confirm({ title: t('admissions.enquiries.deleteTitle', { name: e.childName }), message: t('admissions.enquiries.deleteHint'), tone: 'danger', confirmLabel: t('actions.delete') })) remove.mutate() }}>{t('actions.delete')}</Button> : undefined}>
      {!e ? <p className="text-sm text-ink-faint">{t('admissions.loading')}</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={ENQUIRY_STAGES[e.stage]?.tone}>{t(`admissions.stages.${e.stage}`, e.stageLabel)}</StatusPill>
            {e.className && <span className="text-sm text-ink-muted">{e.className}</span>}
            {e.nextFollowUpOn && open && <span className="text-sm text-ink-muted">· {t('admissions.enquiries.nextOn', { date: date(e.nextFollowUpOn) })}</span>}
          </div>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">{t('admissions.form.parentName')}</dt><dd>{e.parentName ?? '—'}</dd>
            <dt className="text-ink-muted">{t('admissions.form.mobile')}</dt><dd><PhoneLink number={e.mobile} /></dd>
            {e.email && <><dt className="text-ink-muted">{t('admissions.form.email')}</dt><dd>{e.email}</dd></>}
            {e.dob && <><dt className="text-ink-muted">{t('admissions.form.dob')}</dt><dd>{date(e.dob)}</dd></>}
            {e.locality && <><dt className="text-ink-muted">{t('admissions.enquiries.locality')}</dt><dd>{e.locality}</dd></>}
            {e.currentSchool && <><dt className="text-ink-muted">{t('admissions.enquiries.currentSchool')}</dt><dd>{e.currentSchool}</dd></>}
            {e.lostReason && <><dt className="text-ink-muted">{t('admissions.enquiries.lostReason')}</dt><dd>{e.lostReason}</dd></>}
          </dl>
          {open && canEdit && (
            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-sm font-semibold text-ink">{t('admissions.enquiries.logTitle')}</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <FormField label={t('admissions.enquiries.type')}><Select value={fu.type} onChange={(x) => setFu((f) => ({ ...f, type: x.target.value }))}>{FOLLOWUP_TYPES.map((f) => <option key={f.value} value={f.value}>{t(`admissions.followUps.${f.value}`, f.label)}</option>)}</Select></FormField>
                <FormField label={t('admissions.enquiries.moveTo')}><Select value={fu.stage} onChange={(x) => setFu((f) => ({ ...f, stage: x.target.value }))}><option value="">{t('admissions.enquiries.sameStage')}</option>{['CONTACTED', 'VISIT', 'VISITED'].map((s) => <option key={s} value={s}>{t(`admissions.stages.${s}`)}</option>)}</Select></FormField>
                <FormField label={t('admissions.enquiries.nextFollowUp')}><DateInput value={fu.nextOn} onChange={(x) => setFu((f) => ({ ...f, nextOn: x.target.value }))} /></FormField>
              </div>
              <Textarea rows={2} value={fu.note} onChange={(x) => setFu((f) => ({ ...f, note: x.target.value }))} placeholder={t('admissions.enquiries.notePlaceholder')} />
              <div className="flex flex-wrap gap-2 justify-between">
                <div className="flex gap-2 items-center">
                  <Select value={lost} onChange={(x) => setLost(x.target.value)} className="w-56"><option value="">{t('admissions.enquiries.lostPick')}</option>{LOST_REASONS.map((r) => <option key={r} value={r}>{t(`admissions.lostReasons.${reasonKey(r)}`, r)}</option>)}</Select>
                  <Button size="sm" variant="ghost" disabled={!lost} loading={markLost.isPending} onClick={() => markLost.mutate()}>{t('admissions.enquiries.markLost')}</Button>
                </div>
                <div className="flex gap-2">
                  {hasPermission('admissions.applications.create') && <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => navigate(`/admissions/applications/new?enquiry=${e.id}`)}>{t('admissions.enquiries.makeApplication')}</Button>}
                  <Button size="sm" icon={PhoneCall} loading={log.isPending} disabled={!fu.note.trim()} onClick={() => log.mutate()}>{t('admissions.enquiries.log')}</Button>
                </div>
              </div>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-ink mb-2">{t('admissions.enquiries.history')}</p>
            {e.followUps.length ? (
              <Timeline items={[...e.followUps].reverse().map((f) => ({ id: f.id ?? f._id, title: t(`admissions.followUps.${f.type}`, f.type), meta: f.by ?? '', body: f.note, time: dateTime(f.at) }))} />
            ) : <p className="text-sm text-ink-faint">{t('admissions.enquiries.noHistory')}</p>}
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default function Enquiries() {
  const { t } = useTranslation('admissions')
  const navigate = useNavigate()
  const [urlParams, setUrlParams] = useSearchParams()
  const [search, setSearch] = useUrlSearch()
  const [stage, setStage] = useState('')
  const [source, setSource] = useState('')
  const [due, setDue] = useState(false)
  const [page, setPage] = useState(1)
  // ?open=<id> opens that enquiry (the New enquiry page lands here after saving)
  const [openId, setOpenId] = useState(() => urlParams.get('open'))
  useEffect(() => {
    if (!urlParams.get('open')) return
    setOpenId(urlParams.get('open'))
    setUrlParams((p) => { const n = new URLSearchParams(p); n.delete('open'); return n }, { replace: true })
  }, [urlParams, setUrlParams])
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, stage: stage || undefined, source: source || undefined, due: due ? '1' : undefined, open: !stage && !due && !q ? '1' : undefined, page, pageSize: 50 } // a search looks at every enquiry, closed ones too
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['enquiries', params], queryFn: () => fetchEnquiries(params), placeholderData: keepPreviousData })
  const meta = data?.meta
  const today = localIso(new Date())
  const SOURCES = ['', ...ENQUIRY_SOURCES.map((s) => s.value)]
  const sourceLabel = (s) => (s ? t(`admissions.sources.${s}`, ENQUIRY_SOURCES.find((x) => x.value === s)?.label) : t('admissions.all'))

  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('admissions.enquiries.title')} subtitle={t('admissions.enquiries.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="admissions.enquiries.create" onClick={() => navigate('/admissions/enquiries/new')}>{t('admissions.enquiries.new')}</HeaderButton>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={() => { setDue(true); setStage(''); setPage(1) }} className={clsx('rounded-full border px-3 py-1.5 text-sm', due ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-border hover:bg-bg')}>
          {t('admissions.enquiries.dueToday', { count: meta?.dueToday ?? 0 })}
        </button>
        {STAGE_ORDER.map((s) => (
          <button key={s} type="button" onClick={() => { setStage(stage === s ? '' : s); setDue(false); setPage(1) }} className={clsx('rounded-full border px-3 py-1.5 text-sm', stage === s ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border hover:bg-bg')}>
            {t(`admissions.stages.${s}`, ENQUIRY_STAGES[s].label)} <span className="text-ink-faint">{meta?.stages?.[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable={hasPermission('admissions.enquiries.export')} exportName="enquiries"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('admissions.enquiries.search')}
          right={<>
            <ControlChip label={t('admissions.enquiries.source')} value={sourceLabel(source)} active={!!source} options={SOURCES.map(sourceLabel)} onChange={(v) => { setSource(SOURCES.find((s) => sourceLabel(s) === v) ?? ''); setPage(1) }} />
            {(stage || due) && <Button size="sm" variant="ghost" onClick={() => { setStage(''); setDue(false) }}>{t('admissions.enquiries.allOpen')}</Button>}
          </>} />}
        rowTone={(r) => (r.nextFollowUpOn && r.nextFollowUpOn < today && ['NEW', 'CONTACTED', 'VISIT', 'VISITED'].includes(r.stage) ? 'warning' : undefined)}
        columns={[
          { key: 'childName', header: t('admissions.enquiries.child'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.enquiryNo} size={34} /> },
          { key: 'className', header: t('admissions.form.class'), render: (v, r) => <ColorChip label={v} seed={r.classId ?? v} /> },
          { key: 'parentName', header: t('admissions.form.parentName'), render: (v, r) => <ContactCell name={v ?? '—'} phone={r.mobile} /> },
          { key: 'source', header: t('admissions.enquiries.source'), mobileHidden: true, render: (v) => <ColorChip label={sourceLabel(v)} seed={v} icon={SOURCE_ICON[v]} /> },
          { key: 'stage', header: t('admissions.enquiries.stage'), render: (v) => <StatusPill tone={ENQUIRY_STAGES[v]?.tone}>{t(`admissions.stages.${v}`, ENQUIRY_STAGES[v]?.label)}</StatusPill> },
          { key: 'nextFollowUpOn', header: t('admissions.enquiries.next'), nowrap: true, render: (v, r) => <DateCell value={v} tone={v && ['NEW', 'CONTACTED', 'VISIT', 'VISITED'].includes(r.stage) ? (v < today ? 'danger' : v === today ? 'warning' : undefined) : undefined} /> },
          { key: 'createdAt', header: t('admissions.enquiries.received'), nowrap: true, mobileHidden: true, render: (v) => <DateCell value={v ? String(v).slice(0, 10) : null} /> },
        ]}
        onRowClick={(r) => setOpenId(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={ClipboardList} emptyTitle={t('admissions.enquiries.empty')}
      />
      {openId && <EnquiryDrawer id={openId} onClose={() => setOpenId(null)} />}
    </PageContainer>
  )
}
