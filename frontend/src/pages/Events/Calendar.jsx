import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bus, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Flag, Hourglass, ListChecks, Music, NotebookPen, PartyPopper, Pencil, Plus, Send, Shapes, Sparkles, Trash2, Trophy, UsersRound, XCircle } from 'lucide-react'
import { EVENT_KINDS, REPLY_KINDS, addDaysYmd, monthGrid } from '@schoolgiant/shared'
import { Attachments, ColorChip, DataTable, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Panel, PersonCell, PhoneLink, SegmentedControl, Select, StatCardRow, StatusPill, Textarea, localIso, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteEvent, downloadIcs, exportReplies, fetchCalendar, fetchEvent, fetchEvents, fetchReplies, publishEvent, saveEvent, saveReply, unpublishEvent } from '../../api/events'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { AudienceFields, chipClass, toneOf, useEventLabels } from '../../components/events/EventsKit'

// each event kind's icon in the events list
const KIND_ICON = { EVENT: Sparkles, CELEBRATION: PartyPopper, CULTURAL: Music, SPORTS: Trophy, TRIP: Bus, EXAM: NotebookPen, DEADLINE: Flag, MEETING: UsersRound, OTHER: Shapes }
const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function EventForm({ event, day, onClose, onSaved }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const { showError } = useSnackbar()
  const [form, setForm] = useState({
    title: event?.title ?? '', kind: event?.kind ?? 'EVENT', startDate: event?.startDate ?? day ?? localIso(new Date()), endDate: event?.endDate ?? '',
    allDay: !event?.startTime, startTime: event?.startTime ?? '', endTime: event?.endTime ?? '', venue: event?.venue ?? '', description: event?.description ?? '',
    remind: event?.remind ?? false, replyKind: event?.reply?.kind ?? 'NONE', question: event?.reply?.question ?? '', replyBy: event?.reply?.by ?? '',
  })
  const [aud, setAud] = useState({ audience: event?.audience ?? 'EVERYONE', classIds: event?.classIds ?? [], sectionIds: event?.sectionIds ?? [] })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => saveEvent(event?.id, {
      title: form.title, kind: form.kind, startDate: form.startDate, endDate: form.endDate || form.startDate, startTime: form.allDay ? '' : form.startTime, endTime: form.allDay ? '' : form.endTime,
      venue: form.venue, description: form.description, remind: form.remind, ...aud, branchIds: event?.branchIds ?? [],
      reply: aud.audience === 'STAFF' ? { kind: 'NONE' } : { kind: form.replyKind, question: form.question, by: form.replyBy },
    }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={event ? t('events.form.editTitle') : t('events.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 2 || !form.startDate} onClick={() => save.mutate()}>{t('events.form.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_200px] gap-3">
          <FormField label={t('events.form.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField>
          <FormField label={t('events.form.kind')}><Select value={form.kind} onChange={set('kind')}>{EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{L.kind(k.value)}</option>)}</Select></FormField>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <FormField label={t('events.form.from')} required><Input type="date" value={form.startDate} onChange={set('startDate')} /></FormField>
          <FormField label={t('events.form.to')} error={errors.endDate}><Input type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} /></FormField>
          {!form.allDay && <FormField label={t('events.form.startTime')}><Input type="time" value={form.startTime} onChange={set('startTime')} /></FormField>}
          {!form.allDay && <FormField label={t('events.form.endTime')} error={errors.endTime}><Input type="time" value={form.endTime} onChange={set('endTime')} /></FormField>}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.allDay} onChange={set('allDay')} className="rounded border-border text-brand-500" />{t('events.form.allDay')}</label>
        <FormField label={t('events.form.venue')}><Input value={form.venue} onChange={set('venue')} /></FormField>
        <FormField label={t('events.form.description')}><Textarea rows={3} value={form.description} onChange={set('description')} /></FormField>
        <AudienceFields value={aud} onChange={setAud} errors={errors} />
        {aud.audience !== 'STAFF' && (
          <div className="rounded-xl border border-border p-3 space-y-3">
            <FormField label={t('events.form.reply')} error={errors.reply}><Select value={form.replyKind} onChange={set('replyKind')}>{REPLY_KINDS.map((r) => <option key={r.value} value={r.value}>{L.reply(r.value)}</option>)}</Select></FormField>
            {form.replyKind !== 'NONE' && (
              <div className="grid sm:grid-cols-[1fr_170px] gap-3">
                <FormField label={t('events.form.question')} hint={t('events.form.questionHint')}><Input value={form.question} onChange={set('question')} placeholder={form.replyKind === 'CONSENT' ? t('events.form.consentPlaceholder') : t('events.form.rsvpPlaceholder')} /></FormField>
                <FormField label={t('events.form.replyBy')}><Input type="date" value={form.replyBy} max={form.startDate} onChange={set('replyBy')} /></FormField>
              </div>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.remind} onChange={set('remind')} className="rounded border-border text-brand-500" />{t('events.form.remind')}</label>
          </div>
        )}
      </div>
    </Modal>
  )
}

function RepliesDrawer({ event, onClose }) {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const [answer, setAnswer] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['events', 'replies', event.id, answer], queryFn: () => fetchReplies(event.id, answer || undefined) })
  const set = useMutation({ mutationFn: (b) => saveReply(event.id, b), onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }), onError: (e) => showError(e.message) })
  const words = event.reply?.kind === 'CONSENT' ? { YES: t('events.replies.consentYes'), NO: t('events.replies.consentNo') } : { YES: t('events.replies.going'), NO: t('events.replies.notGoing') }
  const canEdit = hasPermission('events.calendar.edit')
  return (
    <Drawer open onClose={onClose} size="xl" title={t('events.replies.title', { title: event.title })} subtitle={event.reply?.question}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={answer} onChange={setAnswer} options={[{ value: '', label: t('events.replies.all') }, { value: 'YES', label: words.YES }, { value: 'NO', label: words.NO }, { value: 'WAITING', label: t('events.replies.waiting') }]} />
          <Button size="sm" variant="secondary" icon={Download} onClick={() => exportReplies(event.id).catch((e) => showError(e.message))}>{t('events.replies.export')}</Button>
        </div>
        <DataTable rows={data?.rows ?? []} loading={isLoading} rowKey="studentId" columns={[
          { key: 'name', header: t('events.replies.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.section, r.admissionNo].filter(Boolean).join(' · ') || undefined} /> },
          { key: 'guardian', header: t('events.replies.parent'), mobileHidden: true, render: (v, r) => (v || r.mobile ? <PersonCell name={v} sub={r.mobile ? <PhoneLink number={r.mobile} /> : undefined} size={26} /> : '—') },
          { key: 'answer', header: t('events.replies.reply'), render: (v, r) => (canEdit
            ? <div className="w-40"><Select value={v ?? ''} aria-label={t('events.replies.reply')} onChange={(e) => set.mutate({ studentId: r.studentId, answer: e.target.value || null })}><option value="">{t('events.replies.none')}</option><option value="YES">{words.YES}</option><option value="NO">{words.NO}</option></Select></div>
            : v ? <StatusPill tone={v === 'YES' ? 'success' : 'danger'}>{words[v]}</StatusPill> : <span className="text-xs text-ink-faint">{t('events.replies.none')}</span>) },
          { key: 'note', header: t('events.replies.note'), mobileHidden: true, render: (v, r) => <span className="text-xs">{v}{r.at && <span className="block text-ink-faint">{r.byStaff ? t('events.replies.byOffice', { name: r.by }) : r.by} · {dateTime(r.at)}</span>}</span> },
        ]} emptyTitle={t('events.replies.empty')} />
      </div>
    </Drawer>
  )
}

function EventDrawer({ id, onClose, onEdit }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [replies, setReplies] = useState(false)
  const { data: e } = useQuery({ queryKey: ['events', 'event', id], queryFn: () => fetchEvent(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['events'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { refresh(); showSuccess(v.done(r)); if (v.close) onClose() }, onError: (err) => showError(err.message) })
  if (!e) return <Drawer open onClose={onClose} title={t('events.loading')}><span /></Drawer>
  const canEdit = hasPermission('events.calendar.edit')
  const publish = async () => {
    const forFamilies = e.audience !== 'STAFF'
    const notify = forFamilies && await confirm({ title: t('events.drawer.tellTitle'), message: e.replySummary ? t('events.drawer.tellReply', { count: e.replySummary.students }) : t('events.drawer.tellHint'), confirmLabel: t('events.drawer.tell'), cancelLabel: t('events.drawer.dontTell') })
    act.mutate({ fn: () => publishEvent(e.id, !!notify), done: (r) => (r.told ? t('events.drawer.publishedTold', { count: r.told }) : t('events.drawer.published')) })
  }
  const when = `${date(e.startDate)}${e.endDate !== e.startDate ? ` – ${date(e.endDate)}` : ''}${e.startTime ? ` · ${e.startTime}–${e.endTime}` : ''}`
  return (
    <Drawer open onClose={onClose} size="lg" title={e.title} subtitle={when}
      footer={canEdit && <div className="flex flex-wrap gap-2">
        {!e.published ? <Button icon={Send} onClick={publish}>{t('events.drawer.publish')}</Button> : <Button variant="secondary" icon={EyeOff} onClick={() => act.mutate({ fn: () => unpublishEvent(e.id), done: () => t('events.drawer.unpublished') })}>{t('events.drawer.unpublish')}</Button>}
        <Button variant="secondary" icon={Pencil} onClick={() => onEdit(e)}>{t('events.edit')}</Button>
        {hasPermission('events.calendar.delete') && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: t('events.drawer.deleteConfirm', { title: e.title }), confirmLabel: t('events.delete'), tone: 'danger' })) act.mutate({ fn: () => deleteEvent(e.id), done: () => t('events.drawer.deleted'), close: true }) }}>{t('events.delete')}</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chipClass(toneOf({ source: 'EVENT', kind: e.kind }))}`}>{L.kind(e.kind)}</span>
          <StatusPill tone={e.published ? 'success' : 'neutral'}>{e.published ? t('events.drawer.onFamilies') : t('events.drawer.draft')}</StatusPill>
          <span className="text-sm text-ink-muted">{e.audience === 'EVERYONE' ? L.audience('EVERYONE') : e.audience === 'STAFF' ? L.audience('STAFF') : e.audienceLabel}</span>
        </div>
        {e.venue && <p className="text-sm text-ink">{e.venue}</p>}
        {e.description && <p className="text-sm text-ink whitespace-pre-line">{e.description}</p>}
        {e.replySummary && (
          <Panel title={L.reply(e.reply.kind)} actions={<Button size="sm" variant="secondary" icon={ListChecks} onClick={() => setReplies(true)}>{t('events.drawer.seeReplies')}</Button>}>
            {e.reply.question && <p className="text-sm text-ink mb-2">{e.reply.question}</p>}
            <StatCardRow items={[
              { icon: CheckCircle2, label: t('events.drawer.yes'), value: e.replySummary.yes, tone: 'success' },
              { icon: XCircle, tone: 'pink', label: t('events.drawer.no'), value: e.replySummary.no },
              { icon: Hourglass, label: t('events.drawer.waiting'), value: e.replySummary.waiting, tone: e.replySummary.waiting ? 'warning' : 'neutral' },
            ]} />
            {e.reply.by && <p className="mt-2 text-xs text-ink-faint">{t('events.drawer.replyBy', { date: date(e.reply.by) })}</p>}
          </Panel>
        )}
        <Attachments entityType="school_event" entityId={e.id} canAdd={canEdit} label={t('events.drawer.files')} />
      </div>
      {replies && <RepliesDrawer event={e} onClose={() => setReplies(false)} />}
    </Drawer>
  )
}

function MonthView({ month, setMonth, onOpen, onAdd }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const [y, m] = month.split('-').map(Number)
  const { data } = useQuery({ queryKey: ['events', 'calendar', month], queryFn: async () => { const g = monthGrid(y, m); return fetchCalendar(g[0][0], g[g.length - 1][6]) } })
  const weeks = useMemo(() => monthGrid(y, m, { sundayFirst: data?.weekStartsSunday }), [y, m, data?.weekStartsSunday])
  const days = data?.weekStartsSunday ? ['SUN', ...DOW.slice(0, 6)] : DOW
  const todayIso = localIso(new Date())
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`) }
  const itemsOn = (d) => (data?.items ?? []).filter((i) => i.startDate <= d && i.endDate >= d)
  const canAdd = hasPermission('events.calendar.create')
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={t('events.cal.prev')} onClick={() => shift(-1)} />
        <p className="min-w-[10rem] text-center text-sm font-semibold text-ink">{t(`events.months.${m}`)} {y}</p>
        <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={t('events.cal.next')} onClick={() => shift(1)} />
        <Button size="sm" variant="secondary" onClick={() => setMonth(todayIso.slice(0, 7))}>{t('events.cal.today')}</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-7 bg-black/[0.02] text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {days.map((d) => <div key={d} className="py-1.5">{t(`events.dow.${d}`)}</div>)}
        </div>
        {weeks.map((w) => (
          <div key={w[0]} className="grid grid-cols-7 border-t border-border">
            {w.map((d) => {
              const items = itemsOn(d)
              const other = d.slice(0, 7) !== month
              return (
                <div key={d} className={`min-h-[92px] border-l border-border first:border-l-0 p-1 ${other ? 'bg-black/[0.015]' : ''}`}>
                  <button type="button" disabled={!canAdd} onClick={() => onAdd(d)} className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${d === todayIso ? 'bg-brand-500 text-white' : other ? 'text-ink-faint' : 'text-ink'} enabled:hover:ring-1 enabled:hover:ring-brand-300`} aria-label={t('events.cal.addOn', { date: d })}>{Number(d.slice(8))}</button>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map((i) => (
                      <button key={i.id} type="button" onClick={() => onOpen(i)} title={i.title}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${chipClass(toneOf(i))} ${i.published === false ? 'opacity-60 italic' : ''}`}>
                        {i.startTime && i.startDate === d ? `${i.startTime} ` : ''}{i.title}
                      </button>
                    ))}
                    {items.length > 3 && <p className="px-1 text-[10px] text-ink-faint">{t('events.cal.more', { count: items.length - 3 })}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        {['HOLIDAY', 'EXAM', 'PTM'].map((s) => <span key={s} className={`rounded px-1.5 py-0.5 ${chipClass(toneOf({ source: s }))}`}>{L.source(s)}</span>)}
        <span className="rounded px-1.5 py-0.5 bg-black/5 text-ink-muted italic opacity-60">{t('events.cal.draftLegend')}</span>
      </div>
    </div>
  )
}

function ListView({ onOpen }) {
  const { t } = useTranslation('events')
  const L = useEventLabels()
  const { date } = useFormat()
  const [when, setWhen] = useState('UPCOMING')
  const { data = [], isLoading } = useQuery({ queryKey: ['events', 'list', when], queryFn: () => fetchEvents({ when }) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={when} onChange={setWhen} options={['UPCOMING', 'PAST', 'DRAFTS'].map((v) => ({ value: v, label: t(`events.list.${v}`) }))} />
      <DataTable rows={data} loading={isLoading} columns={[
        { key: 'startDate', header: t('events.list.when'), nowrap: true, render: (v, e) => <span>{date(v)}{e.endDate !== v && <span className="text-ink-faint"> – {date(e.endDate)}</span>}{e.startTime && <span className="block text-xs text-ink-faint">{e.startTime}–{e.endTime}</span>}</span> },
        { key: 'title', header: t('events.list.event'), mobilePrimary: true, render: (v, e) => (
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="font-medium text-ink">{v}</span>
            <ColorChip label={L.kind(e.kind)} tone={toneOf({ source: 'EVENT', kind: e.kind })} icon={KIND_ICON[e.kind] ?? Sparkles} sub={e.venue || undefined} />
          </span>
        ) },
        { key: 'audienceLabel', header: t('events.list.for'), mobileHidden: true, render: (v, e) => (e.audience === 'EVERYONE' ? L.audience('EVERYONE') : e.audience === 'STAFF' ? L.audience('STAFF') : v) },
        { key: 'replies', header: t('events.list.replies'), mobileHidden: true, render: (v) => (v ? (
          <span className="inline-flex items-center gap-3 text-sm tabular-nums" title={t('events.list.replyCounts', { yes: v.yes, no: v.no })}>
            <span className="inline-flex items-center gap-1 font-semibold text-success-600"><CheckCircle2 className="h-3.5 w-3.5" aria-label={t('events.drawer.yes')} />{v.yes}</span>
            <span className={v.no ? 'inline-flex items-center gap-1 font-semibold text-danger-600' : 'inline-flex items-center gap-1 text-ink-faint'}><XCircle className="h-3.5 w-3.5" aria-label={t('events.drawer.no')} />{v.no}</span>
          </span>
        ) : '—') },
        { key: 'published', header: '', render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('events.drawer.onFamilies') : t('events.drawer.draft')}</StatusPill> },
      ]} onRowClick={(e) => onOpen({ source: 'EVENT', id: e.id })} emptyTitle={t('events.list.empty')} />
    </div>
  )
}

/** Events › Calendar: the school calendar (events, holidays, exams, meetings) by month or as a list. */
export default function Calendar() {
  const { t } = useTranslation('events')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [view, setView] = useState('MONTH')
  const [month, setMonth] = useState(localIso(new Date()).slice(0, 7))
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const [info, setInfo] = useState(null)
  const openItem = (i) => (i.source === 'EVENT' ? setOpen(i.id) : setInfo(i))
  const ics = () => { const from = `${month}-01`; downloadIcs(from, addDaysYmd(from, 365)).catch((e) => showError(e.message)) }
  return (
    <PageContainer>
      <PageHeader icon={CalendarDays} title={t('events.cal.title')} subtitle={t('events.cal.subtitle')}
        actions={<>
          <HeaderButton icon={Download} onClick={ics}>{t('events.cal.ics')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="events.calendar.create" onClick={() => setEditing({ day: null })}>{t('events.cal.new')}</HeaderButton>
        </>} />
      <div className="space-y-4">
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'MONTH', label: t('events.cal.month') }, { value: 'LIST', label: t('events.cal.list') }]} />
        {view === 'MONTH' ? <MonthView month={month} setMonth={setMonth} onOpen={openItem} onAdd={(d) => setEditing({ day: d })} /> : <ListView onOpen={openItem} />}
      </div>
      {open && <EventDrawer id={open} onClose={() => setOpen(null)} onEdit={(e) => { setOpen(null); setEditing({ event: e }) }} />}
      {info && (
        <Modal open onClose={() => setInfo(null)} title={info.title}>
          <Note icon={Eye}>{t(`events.cal.fromModule.${info.source}`)}</Note>
        </Modal>
      )}
      {editing && <EventForm event={editing.event} day={editing.day} onClose={() => setEditing(null)} onSaved={(e) => { setEditing(null); qc.invalidateQueries({ queryKey: ['events'] }); showSuccess(t('events.form.saved')); setOpen(e.id) }} />}
    </PageContainer>
  )
}
