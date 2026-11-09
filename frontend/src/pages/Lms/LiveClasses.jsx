import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Square, Users, Video, XCircle } from 'lucide-react'
import { LIVE_PROVIDERS, LIVE_STATUS } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, SegmentedControl, Select, StatusPill, Textarea, localIso, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { cancelLiveClass, createLiveClass, endLiveClass, fetchLiveAttendance, fetchLiveClasses, startLiveClass } from '../../api/lms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { ClassSubjectPicker } from './Courses'

function LiveForm({ onClose, onSaved }) {
  const { t } = useTranslation('lms')
  const { showError } = useSnackbar()
  const [f, setF] = useState({ title: '', classId: '', subjectId: '', sectionIds: [], date: localIso(new Date()), start: '10:00', durationMin: 40, provider: 'JITSI', joinUrl: '', notes: '', notify: true })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({ mutationFn: () => createLiveClass({ ...f, subjectId: f.subjectId || undefined, durationMin: Number(f.durationMin) }), onSuccess: onSaved, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  return (
    <Modal open onClose={onClose} size="lg" title={t('lms.live.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={f.title.trim().length < 2 || !f.classId || (f.provider !== 'JITSI' && !f.joinUrl.trim())} onClick={() => save.mutate()}>{t('lms.live.schedule')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('lms.live.name')} required error={errors.title}><Input value={f.title} onChange={set('title')} placeholder={t('lms.live.namePlaceholder')} /></FormField>
        <ClassSubjectPicker value={f} onChange={setF} errors={errors} />
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('lms.live.date')} required error={errors.date}><Input type="date" value={f.date} onChange={set('date')} /></FormField>
          <FormField label={t('lms.live.start')} required><Input type="time" value={f.start} onChange={set('start')} /></FormField>
          <FormField label={t('lms.live.duration')}><Input type="number" min="10" max="240" value={f.durationMin} onChange={set('durationMin')} /></FormField>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('lms.live.provider')}><Select value={f.provider} onChange={set('provider')}>{LIVE_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{t(`lms.providers.${p.value}`)}</option>)}</Select></FormField>
          {f.provider !== 'JITSI' && <FormField label={t('lms.live.joinUrl')} required error={errors.joinUrl}><Input value={f.joinUrl} onChange={set('joinUrl')} placeholder="https://" /></FormField>}
        </div>
        {f.provider === 'JITSI' && <Note>{t('lms.live.jitsiHint')}</Note>}
        <FormField label={t('lms.live.notes')}><Textarea rows={2} value={f.notes} onChange={set('notes')} /></FormField>
        <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.notify} onChange={set('notify')} className="rounded border-border text-brand-500" />{t('lms.live.notify')}</label>
      </div>
    </Modal>
  )
}

function LiveDrawer({ live, onClose, onChanged }) {
  const { t } = useTranslation('lms')
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [recording, setRecording] = useState(live.recordingUrl ?? '')
  const { data: att } = useQuery({ queryKey: ['lms-live-att', live.id], queryFn: () => fetchLiveAttendance(live.id) })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { onChanged(); showSuccess(v.done); if (v.open) window.open(r.link, '_blank', 'noopener') }, onError: (e) => showError(e.message) })
  const canRun = hasPermission('lms.live-classes.start')
  return (
    <Drawer open onClose={onClose} size="lg" title={live.title} subtitle={`${date(live.date)} · ${live.start} · ${t('lms.live.minutes', { count: live.durationMin })}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={LIVE_STATUS[live.status]?.tone}>{t(`lms.liveStatus.${live.status}`)}</StatusPill>
          <span className="text-xs text-ink-muted">{[live.className, live.subject, live.sections.join(', '), t(`lms.providers.${live.provider}`)].filter(Boolean).join(' · ')}</span>
        </div>
        {live.notes && <p className="text-sm text-ink whitespace-pre-line">{live.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {['SCHEDULED', 'LIVE'].includes(live.status) && canRun && <Button icon={Video} onClick={() => act.mutate({ fn: () => startLiveClass(live.id), done: t('lms.live.started'), open: true })}>{live.status === 'LIVE' ? t('lms.live.rejoin') : t('lms.live.startNow')}</Button>}
          {live.status === 'LIVE' && canRun && <Button variant="secondary" icon={Square} onClick={() => act.mutate({ fn: () => endLiveClass(live.id, recording || undefined), done: t('lms.live.ended') })}>{t('lms.live.end')}</Button>}
          {live.status === 'SCHEDULED' && hasPermission('lms.live-classes.create') && <Button variant="ghost" icon={XCircle} onClick={async () => { const reason = await prompt({ title: t('lms.live.cancelTitle'), label: t('lms.live.why'), confirmLabel: t('lms.live.cancel') }); if (reason !== null) act.mutate({ fn: () => cancelLiveClass(live.id, { reason: reason || undefined, notify: true }), done: t('lms.live.cancelled') }) }}>{t('lms.live.cancel')}</Button>}
        </div>
        {['LIVE', 'ENDED'].includes(live.status) && canRun && (
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <FormField label={t('lms.live.recording')} hint={t('lms.live.recordingHint')}><Input value={recording} onChange={(e) => setRecording(e.target.value)} placeholder="https://" /></FormField>
            {live.status === 'ENDED' && <Button variant="secondary" disabled={!recording.trim()} onClick={() => act.mutate({ fn: () => endLiveClass(live.id, recording), done: t('lms.saved') })}>{t('lms.save')}</Button>}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-ink mb-2 inline-flex items-center gap-1.5"><Users className="w-4 h-4" />{t('lms.live.joinedOf', { joined: att?.joined ?? 0, total: att?.total ?? 0 })}</p>
          <DataTable rows={att?.rows ?? []} rowKey="studentId" dense columns={[
            { key: 'name', header: t('lms.progress.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.section || undefined} size={28} /> },
            { key: 'joinedAt', header: t('lms.live.joinedAt'), render: (v) => <DateCell value={v} time /> },
          ]} />
        </div>
      </div>
    </Drawer>
  )
}

/** LMS › Live classes: online classes on Jitsi (made for you) or the school's own Zoom / Meet; who joined. */
export default function LiveClasses() {
  const { t } = useTranslation('lms')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [when, setWhen] = useState('UPCOMING')
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const today = localIso(new Date())
  const params = when === 'UPCOMING' ? { from: today } : { from: localIso(new Date(Date.now() - 60 * 864e5)), to: today }
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['lms-live', when], queryFn: () => fetchLiveClasses(params) })
  const shown = when === 'PAST' ? rows.filter((r) => ['ENDED', 'CANCELLED'].includes(r.status) || r.date < today).reverse() : rows.filter((r) => ['SCHEDULED', 'LIVE'].includes(r.status))
  const refresh = () => qc.invalidateQueries({ queryKey: ['lms-live'] })
  return (
    <PageContainer>
      <PageHeader icon={Video} title={t('lms.live.title')} subtitle={t('lms.live.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="lms.live-classes.create" onClick={() => setCreating(true)}>{t('lms.live.new')}</HeaderButton>} />
      <SegmentedControl className="mb-3" value={when} onChange={setWhen} options={[{ value: 'UPCOMING', label: t('lms.live.upcoming') }, { value: 'PAST', label: t('lms.live.past') }]} />
      <DataTable rows={shown} loading={isLoading} columns={[
        { key: 'date', header: t('lms.live.when'), nowrap: true, render: (v, r) => <span>{date(v)}<span className="block text-xs text-ink-faint">{r.start} · {t('lms.live.minutes', { count: r.durationMin })}</span></span> },
        { key: 'title', header: t('lms.live.name'), mobilePrimary: true, render: (v, r) => (
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{v}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <ColorChip label={r.className} seed={r.classId} />
              <ColorChip label={r.subject} seed={r.subjectId ?? r.subject} dot sub={[r.sections.join(', '), r.hostName].filter(Boolean).join(' · ') || undefined} />
            </div>
          </div>
        ) },
        { key: 'provider', header: t('lms.live.provider'), mobileHidden: true, render: (v) => <ColorChip label={t(`lms.providers.${v}`)} seed={`live-${v}`} icon={Video} /> },
        { key: 'joined', header: t('lms.live.joined'), align: 'right', render: (v) => <span className={v ? 'font-semibold tabular-nums text-success-600' : 'tabular-nums text-ink-faint'}>{v}</span> },
        { key: 'status', header: t('lms.status'), render: (v) => <StatusPill tone={LIVE_STATUS[v]?.tone}>{t(`lms.liveStatus.${v}`)}</StatusPill> },
      ]} onRowClick={(r) => setOpen(r)} emptyIcon={Video} emptyTitle={when === 'UPCOMING' ? t('lms.live.noneUpcoming') : t('lms.live.nonePast')} />
      {open && <LiveDrawer live={rows.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} onChanged={refresh} />}
      {creating && <LiveForm onClose={() => setCreating(false)} onSaved={(l) => { setCreating(false); refresh(); showSuccess(l.told ? t('lms.live.scheduledTold', { count: l.told }) : t('lms.live.scheduled')) }} />}
    </PageContainer>
  )
}
