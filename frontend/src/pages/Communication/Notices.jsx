import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eye, Megaphone, Pin, Plus, Send, Trash2, Undo2 } from 'lucide-react'
import { NOTICE_CATEGORIES, NOTICE_STATUS, SEND_CHANNELS } from '@schoolgiant/shared'
import { Attachments, ControlChip, DataTable, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Select, StatusPill, Textarea, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import AudiencePicker, { emptyAudience } from '../../components/communication/AudiencePicker'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { createNotice, deleteNotice, fetchNotices, publishNotice, updateNotice, withdrawNotice } from '../../api/communication'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const catKey = (c) => c.replace(/[^A-Za-z]/g, '')

function PublishModal({ notice, onClose, onDone }) {
  const { t } = useTranslation('communication')
  const { showError } = useSnackbar()
  const [channels, setChannels] = useState([])
  const go = useMutation({ mutationFn: () => publishNotice(notice.id, channels), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('communication.notices.publishTitle', { title: notice.title })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={Send} loading={go.isPending} onClick={() => go.mutate()}>{t('communication.notices.publish')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink">{t('communication.notices.publishHint')}</p>
        <p className="text-xs font-medium text-ink-muted">{t('communication.notices.alsoSend')}</p>
        <div className="flex flex-wrap gap-3">
          {SEND_CHANNELS.map((c) => (
            <label key={c} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {t(`communication.channels.${c}`)}
            </label>
          ))}
        </div>
        <Note>{t('communication.notices.channelHint')}</Note>
      </div>
    </Modal>
  )
}

function NoticeDrawer({ notice, onClose, onSaved }) {
  const { t } = useTranslation('communication')
  const { showError } = useSnackbar()
  const isNew = !notice?.id
  const [form, setForm] = useState(() => ({ title: notice?.title ?? '', body: notice?.body ?? '', category: notice?.category ?? 'General', audience: notice?.audience ?? emptyAudience(), pinned: !!notice?.pinned, expiresOn: notice?.expiresOn ?? '' }))
  const [saved, setSaved] = useState(notice)
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const published = saved?.status === 'PUBLISHED'
  const canEdit = hasPermission(isNew ? 'communication.notices.create' : 'communication.notices.edit') && saved?.status !== 'WITHDRAWN'
  const save = useMutation({
    mutationFn: () => (saved?.id ? updateNotice(saved.id, form) : createNotice(form)),
    onSuccess: (n) => { setSaved(n); onSaved(n) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open onClose={onClose} size="xl" title={saved?.id ? saved.title : t('communication.notices.newTitle')} subtitle={saved?.id ? t(`communication.status.${saved.status}`) : undefined}
      footer={canEdit && <Button loading={save.isPending} disabled={form.title.trim().length < 3} onClick={() => save.mutate()}>{saved?.id ? t('communication.notices.save') : t('communication.notices.saveDraft')}</Button>}>
      <div className="space-y-4">
        <FormField label={t('communication.notices.titleLabel')} required error={errors.title}><Input value={form.title} disabled={!canEdit} onChange={set('title')} maxLength={160} /></FormField>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('communication.notices.category')}><Select value={form.category} disabled={!canEdit} onChange={set('category')}>{NOTICE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`communication.categories.${catKey(c)}`, c)}</option>)}</Select></FormField>
          <FormField label={t('communication.notices.expiresOn')} hint={t('communication.notices.expiresHint')}><Input type="date" value={form.expiresOn} disabled={!canEdit} onChange={set('expiresOn')} /></FormField>
          <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" checked={form.pinned} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('communication.notices.pinned')}</label>
        </div>
        <FormField label={t('communication.notices.body')}><Textarea rows={8} value={form.body} disabled={!canEdit} onChange={set('body')} maxLength={8000} /></FormField>
        <div>
          <p className="text-xs font-medium text-ink-muted mb-1.5">{t('communication.notices.forWhom')}</p>
          <AudiencePicker value={form.audience} disabled={!canEdit || published} onChange={(audience) => setForm((f) => ({ ...f, audience }))} />
          {published && <p className="text-xs text-ink-faint mt-1">{t('communication.notices.audienceLocked')}</p>}
          {errors.audience && <p className="text-xs text-danger-600 mt-1">{errors.audience}</p>}
        </div>
        {saved?.id ? <Attachments entityType="notice" entityId={saved.id} canAdd={canEdit} compact /> : <Note>{t('communication.notices.filesAfterSave')}</Note>}
      </div>
    </Drawer>
  )
}

export default function Notices() {
  const { t } = useTranslation('communication')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [publishing, setPublishing] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, status: status || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notices', params], queryFn: () => fetchNotices(params), placeholderData: keepPreviousData })
  const refresh = () => qc.invalidateQueries({ queryKey: ['notices'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const STATUSES = ['', 'DRAFT', 'PUBLISHED', 'WITHDRAWN']
  const statusLabel = (s) => (s ? t(`communication.status.${s}`, NOTICE_STATUS[s]?.label) : t('communication.all'))
  const audienceText = (r) => (r.audience.kind === 'ALL' ? t('communication.audience.ALL') : r.audience.kind === 'STUDENTS' ? t('communication.audience.students', { count: r.audience.studentIds.length }) : r.audienceNames.join(', '))
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={Megaphone} title={t('communication.notices.title')} subtitle={t('communication.notices.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="communication.notices.create" onClick={() => setOpen({})}>{t('communication.notices.new')}</HeaderButton>} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('communication.notices.search')}
          right={<ControlChip label={t('communication.statusLabel')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />} />}
        columns={[
          { key: 'title', header: t('communication.notices.titleLabel'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink flex items-center gap-1">{r.pinned && <Pin size={13} className="text-amber-500" />}{v}</p><p className="text-xs text-ink-faint">{t(`communication.categories.${catKey(r.category)}`, r.category)}{r.files ? ` · ${t('communication.notices.filesN', { count: r.files })}` : ''}</p></div> },
          { key: 'audience', header: t('communication.notices.forWhom'), render: (_, r) => <span className="text-sm text-ink-muted line-clamp-2">{audienceText(r)}</span> },
          { key: 'publishedAt', header: t('communication.notices.published'), mobileHidden: true, render: (v, r) => (v ? <span className="text-sm">{dateTime(v)}<span className="block text-xs text-ink-faint">{r.publishedBy}</span></span> : '—') },
          { key: 'reads', header: t('communication.notices.reads'), align: 'right', render: (v, r) => (r.status === 'DRAFT' ? '—' : <span title={t('communication.notices.readsHint')}>{v} / {r.recipients ?? '—'}</span>) },
          { key: 'status', header: t('communication.statusLabel'), render: (v) => <StatusPill tone={NOTICE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={Eye} title={t('communication.notices.open')} aria-label={t('communication.notices.open')} onClick={() => setOpen(r)} />
              {r.status === 'DRAFT' && hasPermission('communication.notices.publish') && <Button size="sm" variant="ghost" icon={Send} title={t('communication.notices.publish')} aria-label={t('communication.notices.publish')} onClick={() => setPublishing(r)} />}
              {r.status === 'PUBLISHED' && hasPermission('communication.notices.publish') && <Button size="sm" variant="ghost" icon={Undo2} title={t('communication.notices.withdraw')} aria-label={t('communication.notices.withdraw')}
                onClick={async () => { if (await confirm({ title: t('communication.notices.withdrawConfirm', { title: r.title }), message: t('communication.notices.withdrawHint'), tone: 'danger', confirmLabel: t('communication.notices.withdraw') })) act.mutate({ fn: () => withdrawNotice(id), done: t('communication.notices.withdrawn') }) }} />}
              {r.status === 'DRAFT' && hasPermission('communication.notices.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('communication.notices.delete')} aria-label={t('communication.notices.delete')}
                onClick={async () => { if (await confirm({ title: t('communication.notices.deleteConfirm', { title: r.title }), tone: 'danger', confirmLabel: t('communication.notices.delete') })) act.mutate({ fn: () => deleteNotice(id), done: t('communication.notices.deleted') }) }} />}
            </div>
          ) },
        ]}
        onRowClick={(r) => setOpen(r)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={Megaphone} emptyTitle={t('communication.notices.empty')} emptyHint={t('communication.notices.emptyHint')}
      />
      {open && <NoticeDrawer notice={open.id ? open : null} onClose={() => setOpen(null)} onSaved={() => { refresh(); showSuccess(t('communication.notices.saved')) }} />}
      {publishing && <PublishModal notice={publishing} onClose={() => setPublishing(null)} onDone={(r) => { refresh(); setPublishing(null); showSuccess(t('communication.notices.publishedDone', { count: r.recipients, sent: r.queued })) }} />}
    </PageContainer>
  )
}
