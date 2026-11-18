import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Building2, LifeBuoy, Lock, UserRound } from 'lucide-react'
import { SUPPORT_STATUS } from '@schoolgiant/shared'
import { EmptyState, FormField, Input, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { Messages, ReplyBox } from '../../components/support/Conversation'
import { fetchSupportInbox, fetchSupportStaff, fetchTeamTicket, loadTeamFile, teamReply, updateTeamTicket, uploadTeamFile } from '../../api/support'
import { canPlatform } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// Superadmin › Support: every school's requests. The inbox puts what needs the team first (open and urgent, waiting
// longest); a request shows the school, who asked and from which page, the conversation, and the team's own notes.

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'SOLVED', 'CLOSED']

function Inbox() {
  const { t } = useTranslation('superadmin')
  const { dateTime } = useFormat()
  const navigate = useNavigate()
  const [status, setStatus] = useState('ACTIVE')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search, 300)
  const { data, isLoading } = useQuery({ queryKey: ['sa-support', status, q], queryFn: () => fetchSupportInbox({ status: status === 'ALL' ? undefined : status, search: q || undefined }) })
  const c = data?.counts ?? {}
  const rows = data?.rows ?? []
  return (
    <PageContainer>
      <PageHeader icon={LifeBuoy} title={t('superadmin.support.title')} subtitle={t('superadmin.support.subtitle')} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedControl value={status} onChange={setStatus} options={[
          { value: 'ACTIVE', label: t('superadmin.support.needsReply', { count: (c.OPEN ?? 0) + (c.IN_PROGRESS ?? 0) }) },
          { value: 'WAITING', label: t('superadmin.support.waitingSchool', { count: c.WAITING ?? 0 }) },
          { value: 'SOLVED', label: t('superadmin.support.solved') },
          { value: 'CLOSED', label: t('superadmin.support.closed') },
          { value: 'ALL', label: t('superadmin.support.all') },
        ]} />
        <div className="w-full sm:w-72 sm:ms-auto"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('superadmin.support.search')} /></div>
      </div>
      <Panel flush>
        {isLoading ? <p className="px-4 py-4 text-sm text-ink-faint">…</p> : !rows.length ? <EmptyState icon={LifeBuoy} title={t('superadmin.support.empty')} /> : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/superadmin/support/${r.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-black/[0.02]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {r.priority === 'URGENT' && <span className="me-1.5 text-danger-600">{t('superadmin.support.urgent')} ·</span>}{r.subject}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {[r.ticketNo, r.tenantName, r.createdBy?.name, t(`admin:admin.help.categories.${r.category}`, r.categoryLabel), r.assignedTo ? t('superadmin.support.with', { name: r.assignedTo }) : t('superadmin.support.unassigned'),
                        r.lastFrom === 'SCHOOL' ? t('superadmin.support.schoolWrote', { when: dateTime(r.lastAt) }) : t('superadmin.support.weWrote', { when: dateTime(r.lastAt) })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusPill tone={SUPPORT_STATUS[r.status]?.tone}>{t(`superadmin.support.status.${r.status}`)}</StatusPill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PageContainer>
  )
}

function Detail({ id }) {
  const { t } = useTranslation('superadmin')
  const { dateTime } = useFormat()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const canAct = canPlatform('support')
  const { data: r } = useQuery({ queryKey: ['sa-support-ticket', id], queryFn: () => fetchTeamTicket(id), refetchInterval: 30_000 })
  const { data: staff = [] } = useQuery({ queryKey: ['sa-support-staff'], queryFn: fetchSupportStaff })
  const [internal, setInternal] = useState(false)
  const [after, setAfter] = useState('WAITING')
  const done = (d) => { qc.setQueryData(['sa-support-ticket', id], d); qc.invalidateQueries({ queryKey: ['sa-support'] }) }
  const reply = useMutation({ mutationFn: (m) => teamReply(id, { ...m, internal, status: internal ? undefined : after }), onSuccess: (d) => { done(d); showSuccess(internal ? t('superadmin.support.noteSaved') : t('superadmin.support.sent')) }, onError: (e) => showError(e.message) })
  const update = useMutation({ mutationFn: (p) => updateTeamTicket(id, p), onSuccess: done, onError: (e) => showError(e.message) })
  if (!r) return <PageContainer><p className="text-sm text-ink-faint">…</p></PageContainer>
  const ctx = r.context ?? {}
  const dl = (rows) => (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.filter(([, v]) => v).flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-muted">{k}</dt>, <dd key={`v${k}`} className="text-ink break-words min-w-0">{v}</dd>])}
    </dl>
  )
  return (
    <PageContainer>
      <PageHeader icon={LifeBuoy} title={`${r.ticketNo} · ${r.subject}`} subtitle={`${r.tenantName} · ${t(`admin:admin.help.categories.${r.category}`, r.categoryLabel)}`}
        actions={<Button variant="secondary" icon={ArrowLeft} to="/superadmin/support">{t('superadmin.support.back')}</Button>} />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Panel>
            <Messages messages={r.messages} side="SUPPORT" loadFile={loadTeamFile} />
          </Panel>
          {canAct && (
            <Panel title={internal ? t('superadmin.support.noteTitle') : t('superadmin.support.replyTitle')} subtitle={internal ? t('superadmin.support.noteHint') : t('superadmin.support.replyHint')}>
              <ReplyBox busy={reply.isPending} uploadFile={(f) => uploadTeamFile(f, r.tenantId)} sendLabel={internal ? t('superadmin.support.saveNote') : t('superadmin.support.sendReply')}
                placeholder={internal ? t('superadmin.support.notePlaceholder') : t('superadmin.support.replyPlaceholder')} onSend={(m) => reply.mutateAsync(m).then(() => true, () => false)}
                extra={<>
                  <label className="flex items-center gap-1.5 text-xs text-ink cursor-pointer"><input type="checkbox" className="rounded border-border text-brand-500 focus:ring-brand-500" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><Lock className="w-3.5 h-3.5" />{t('superadmin.support.internal')}</label>
                  {!internal && (
                    <div className="w-48"><Select aria-label={t('superadmin.support.after')} value={after} onChange={(e) => setAfter(e.target.value)} className="!h-9 text-xs">
                      {['WAITING', 'IN_PROGRESS', 'SOLVED'].map((s) => <option key={s} value={s}>{t('superadmin.support.thenStatus', { status: t(`superadmin.support.status.${s}`) })}</option>)}
                    </Select></div>
                  )}
                </>} />
            </Panel>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <Panel title={t('superadmin.support.request')}>
            <div className="space-y-3">
              <FormField label={t('superadmin.support.statusLabel')}>
                <Select value={r.status} disabled={!canAct || update.isPending} onChange={(e) => update.mutate({ status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{t(`superadmin.support.status.${s}`)}</option>)}
                </Select>
              </FormField>
              <FormField label={t('superadmin.support.urgency')}>
                <SegmentedControl value={r.priority} onChange={(p) => canAct && update.mutate({ priority: p })} options={[{ value: 'NORMAL', label: t('superadmin.support.normal') }, { value: 'URGENT', label: t('superadmin.support.urgent') }]} />
              </FormField>
              <FormField label={t('superadmin.support.assignedTo')}>
                <Select value={r.assignedToId ?? ''} disabled={!canAct || update.isPending} onChange={(e) => update.mutate({ assignedToId: e.target.value || null })}>
                  <option value="">{t('superadmin.support.nobody')}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              {dl([[t('superadmin.support.opened'), dateTime(r.createdAt)], [t('superadmin.support.firstReply'), r.firstReplyAt ? dateTime(r.firstReplyAt) : t('superadmin.support.notYet')], [t('superadmin.support.rating'), r.rating?.score ? `${'★'.repeat(r.rating.score)}${r.rating.note ? ` — ${r.rating.note}` : ''}` : null]])}
            </div>
          </Panel>
          <Panel title={t('superadmin.support.asker')} icon={UserRound}>
            {dl([[t('superadmin.support.name'), r.createdBy?.name], [t('superadmin.support.email'), r.createdBy?.email], [t('superadmin.support.mobile'), r.createdBy?.mobile],
              [t('superadmin.support.page'), ctx.path], [t('superadmin.support.module'), ctx.module], [t('superadmin.support.browser'), ctx.userAgent]])}
          </Panel>
          {r.school && (
            <Panel title={r.school.name} icon={Building2} actions={<Link to={`/superadmin/tenants/${r.school.id}`} className="text-xs text-brand-600 hover:underline">{t('superadmin.support.openSchool')}</Link>}>
              {dl([[t('superadmin.support.plan'), r.school.plan], [t('superadmin.support.schoolStatus'), r.school.status], [t('superadmin.support.city'), r.school.city], [t('superadmin.support.phone'), r.school.phone]])}
              {r.earlier?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border space-y-1">
                  <p className="text-xs font-semibold text-ink-muted">{t('superadmin.support.earlier')}</p>
                  {r.earlier.map((e) => <Link key={e.id} to={`/superadmin/support/${e.id}`} className="block truncate text-xs text-brand-600 hover:underline">{e.ticketNo} · {e.subject}</Link>)}
                </div>
              )}
            </Panel>
          )}
          {!canAct && <Note>{t('superadmin.support.readOnly')}</Note>}
        </div>
      </div>
    </PageContainer>
  )
}

export default function SaSupport() {
  const { id } = useParams()
  return id ? <Detail key={id} id={id} /> : <Inbox />
}
