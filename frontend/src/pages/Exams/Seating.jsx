import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Armchair, CalendarClock, ClipboardList, DoorOpen, Megaphone, Printer, ShieldCheck, Trash2, Undo2, Unlock, Users } from 'lucide-react'
import { SEAT_PLAN_DEFAULTS } from '@schoolgiant/shared'
import { ColorChip, EmptyState, Note, PageContainer, PageHeader, SideNav, SideNavLayout, Skeleton, StatCardRow, StatusPill, Tabs, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { ClassLegend, InvigilatorsPanel, PickedBar, RoomSeatMap, SeatingRuns, SeatingSetup, UnseatedList } from '../../components/exams/SeatingKit'
import {
  autoInvigilators, deleteSeating, fetchMyDuties, fetchSeatingSession, fetchSeatingSessions, generateAllSeating, generateSeating, moveSeats, publishSeating,
  setInvigilators, unlockSeats, unpublishSeating,
} from '../../api/examSeating'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** Exams › Seating & invigilation: per session, who sits where in which room, and who invigilates. */
export default function Seating() {
  const { t } = useTranslation('exams')
  const { date } = useFormat()
  const canEdit = hasPermission('exams.seating.create') || hasPermission('exams.seating.edit')
  const { examId, chips, noExams } = useExamPick({ statuses: ['DRAFT', 'SCHEDULED', 'PUBLISHED'], withSection: false })
  const [key, setKey] = useState('')
  const { data: list, isLoading } = useQuery({ queryKey: ['seating-sessions', examId], queryFn: () => fetchSeatingSessions(examId), enabled: !!examId })
  const sessions = useMemo(() => list?.sessions ?? [], [list])
  useEffect(() => { if (sessions.length && !sessions.some((s) => s.key === key)) setKey(sessions[0].key) }, [sessions, key])
  const session = sessions.find((s) => s.key === key)
  const { data: duties = [] } = useQuery({ queryKey: ['my-duties'], queryFn: fetchMyDuties })

  return (
    <PageContainer>
      <PageHeader icon={Armchair} title={t('exams.seating.title')} subtitle={t('exams.seating.subtitle')}
        actions={examId && sessions.some((s) => s.plan) && hasPermission('exams.seating.print') && (
          <Button variant="secondary" icon={ClipboardList} onClick={() => printDocument('INVIGILATION_DUTY', examId)}>{t('exams.seating.printDuties')}</Button>
        )} />
      {duties.length > 0 && (
        <Note icon={ShieldCheck}>
          <p className="font-medium">{t('exams.seating.myDuties', { count: duties.length })}</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {duties.slice(0, 5).map((d) => <li key={d.planId + d.room}>{date(d.date)} · {d.startTime}{d.endTime ? `–${d.endTime}` : ''} · <b>{d.room}</b> · {d.exam} · {t('exams.seating.studentsN', { count: d.students })}</li>)}
          </ul>
        </Note>
      )}
      <div className="flex flex-wrap items-center gap-2">{chips}</div>
      {noExams ? <EmptyState icon={CalendarClock} title={t('exams.seating.noExams')} hint={t('exams.seating.noExamsHint')} />
        : isLoading ? <Skeleton className="h-96 rounded-xl" />
          : !sessions.length ? <EmptyState icon={CalendarClock} title={t('exams.seating.noSessions')} hint={t('exams.seating.noSessionsHint')} />
            : (
              <SideNavLayout nav={(
                <SideNav title={t('exams.seating.sessions')} value={key} onChange={setKey} items={sessions.map((s) => ({
                  id: s.key, label: `${date(s.date)} · ${s.startTime}`,
                  hint: [t('exams.seating.classesN', { count: new Set(s.papers.map((p) => p.classId)).size }), t('exams.seating.studentsN', { count: s.students })].join(' · '),
                  count: s.plan ? (s.plan.status === 'PUBLISHED' ? '✓' : t('exams.seating.draftShort')) : '—',
                  countTone: !s.plan ? undefined : s.plan.unseated ? 'danger' : s.plan.status === 'PUBLISHED' ? undefined : 'warning',
                }))} />
              )}>
                {session && <SessionPanel key={`${examId}|${session.key}`} examId={examId} session={session} canEdit={canEdit} />}
              </SideNavLayout>
            )}
    </PageContainer>
  )
}

function SessionPanel({ examId, session, canEdit }) {
  const { t } = useTranslation('exams')
  const { date } = useFormat()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const qKey = ['seating-session', examId, session.key]
  const { data: view, isLoading } = useQuery({ queryKey: qKey, queryFn: () => fetchSeatingSession(examId, session.date, session.startTime) })
  const [roomIds, setRoomIds] = useState(null)
  const [rules, setRules] = useState(null)
  const [tab, setTab] = useState('rooms')
  const [roomTab, setRoomTab] = useState('')
  const [picked, setPicked] = useState(null)
  const plan = view?.plan
  useEffect(() => {
    if (!view) return
    setRoomIds((x) => x ?? (plan ? plan.rooms.map((r) => r.roomId) : view.suggestion.ids))
    setRules((x) => x ?? { ...SEAT_PLAN_DEFAULTS, ...view.rules })
  }, [view, plan])
  useEffect(() => { if (plan?.rooms.length && !plan.rooms.some((r) => r.roomId === roomTab)) setRoomTab(plan.rooms[0].roomId) }, [plan, roomTab])
  const draft = plan?.status !== 'PUBLISHED'
  const editable = canEdit && draft

  const done = (msg) => (data) => {
    qc.setQueryData(qKey, data)
    qc.invalidateQueries({ queryKey: ['seating-sessions', examId] })
    if (msg) showSuccess(msg)
  }
  const fail = (e) => showError(e.message)
  const gen = useMutation({ mutationFn: () => generateSeating(examId, { date: session.date, startTime: session.startTime, roomIds, rules }), onSuccess: done(t('exams.seating.generated')), onError: fail })
  const genAll = useMutation({
    mutationFn: () => generateAllSeating(examId, { roomIds, rules }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['seating-sessions', examId] }); qc.invalidateQueries({ queryKey: ['seating-session', examId] }); showSuccess(t('exams.seating.generatedAll', { count: r.sessions.filter((x) => !x.skipped).length })) },
    onError: fail,
  })
  const move = useMutation({ mutationFn: (m) => moveSeats(plan.id, [m]), onSuccess: done(), onError: fail })
  const unlock = useMutation({ mutationFn: () => unlockSeats(plan.id, { all: true }), onSuccess: done(t('exams.seating.unlocked')), onError: fail })
  const setInv = useMutation({ mutationFn: ({ roomId, teacherIds, auto }) => setInvigilators(plan.id, { roomId, teacherIds, auto }), onSuccess: done(), onError: fail })
  const autoInv = useMutation({ mutationFn: () => autoInvigilators(plan.id), onSuccess: done(t('exams.seating.invigilatorsPicked')), onError: fail })
  const publish = useMutation({ mutationFn: () => (draft ? publishSeating(plan.id) : unpublishSeating(plan.id)), onSuccess: done(draft ? t('exams.seating.published') : t('exams.seating.unpublished')), onError: fail })
  const clear = useMutation({ mutationFn: () => deleteSeating(plan.id), onSuccess: () => { qc.invalidateQueries({ queryKey: qKey }); qc.invalidateQueries({ queryKey: ['seating-sessions', examId] }); setRoomIds(null); showSuccess(t('exams.seating.cleared')) }, onError: fail })

  if (isLoading || !view || !rules || !roomIds) return <Skeleton className="h-96 rounded-xl" />
  const room = plan?.rooms.find((r) => r.roomId === roomTab)
  const invWanted = plan ? plan.rooms.reduce((n, r) => n + r.wanted, 0) : 0
  const invHave = plan ? plan.rooms.reduce((n, r) => n + r.invigilatorIds.length, 0) : 0
  const warnings = plan ? [
    plan.unseated.length > 0 && t('exams.seating.warnUnseated', { count: plan.unseated.length }),
    plan.clashes.length > 0 && t('exams.seating.warnClashes', { count: plan.clashes.length }),
    plan.ownSubject.length > 0 && t('exams.seating.warnOwn', { count: plan.ownSubject.length }),
    plan.awayAssigned.length > 0 && t('exams.seating.warnAway', { count: plan.awayAssigned.length }),
    invHave < invWanted && t('exams.seating.warnInvigilators', { count: invWanted - invHave }),
    plan.newStudents > 0 && t('exams.seating.warnNew', { count: plan.newStudents }),
  ].filter(Boolean) : []

  const place = (target) => {
    if (!picked) return
    move.mutate({ studentId: picked.studentId, roomId: target.roomId, seat: target.seat })
    setPicked(null)
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">{date(session.date)} · {session.startTime}{session.endTime ? `–${session.endTime}` : ''}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.classes.map((c) => <ColorChip key={c.id} label={c.name} seed={c.id} dot sub={`${c.subject} · ${c.students}`} />)}
            </div>
          </div>
          {plan && <StatusPill tone={plan.status === 'PUBLISHED' ? 'success' : 'warning'}>{plan.statusLabel}</StatusPill>}
        </div>
      </section>

      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('exams.seating.statStudents'), value: view.needed, sub: t('exams.seating.classesN', { count: view.classes.length }) },
        { icon: Armchair, tone: plan?.unseated.length ? 'danger' : 'success', label: t('exams.seating.statSeated'), value: plan ? plan.seats.length : '—',
          progress: plan ? (plan.seats.length / Math.max(1, view.needed)) * 100 : undefined,
          sub: plan ? (plan.unseated.length ? t('exams.seating.unseatedN', { count: plan.unseated.length }) : t('exams.seating.ofN', { count: view.needed })) : undefined },
        { icon: DoorOpen, tone: 'violet', label: t('exams.seating.statRooms'), value: plan ? plan.rooms.length : roomIds.length, sub: plan ? t('exams.seating.clashesN', { count: plan.clashes.length }) : t('exams.seating.notMade') },
        { icon: ShieldCheck, tone: invHave < invWanted ? 'warning' : 'info', label: t('exams.seating.statInvigilators'), value: plan ? invHave : '—',
          progress: plan && invWanted ? (invHave / invWanted) * 100 : undefined, sub: plan ? t('exams.seating.neededN', { count: invWanted }) : undefined },
      ]} />

      {(!plan || editable) && (
        <SeatingSetup view={view} roomIds={roomIds} setRoomIds={setRoomIds} rules={rules} setRules={setRules} canEdit={editable || (!plan && canEdit)} busy={gen.isPending || genAll.isPending}
          onGenerate={async () => { if (!plan || await confirm({ title: t('exams.seating.regenerateConfirm'), message: t('exams.seating.regenerateHint'), confirmLabel: t('exams.seating.regenerate') })) gen.mutate() }}
          onGenerateAll={async () => { if (await confirm({ title: t('exams.seating.generateAllConfirm'), message: t('exams.seating.generateAllHint'), confirmLabel: t('exams.seating.generateAll') })) genAll.mutate() }} />
      )}

      {plan && (
        <section className="rounded-xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'rooms', label: t('exams.seating.tabRooms') },
              { value: 'notice', label: t('exams.seating.tabNotice') },
              { value: 'invigilators', label: t('exams.seating.tabInvigilators') },
            ]} />
            <div className="flex flex-wrap gap-2 py-2">
              {hasPermission('exams.seating.print') && <>
                <Button size="sm" variant="secondary" icon={Printer} onClick={() => printDocument('EXAM_SEATING_CHART', plan.id)}>{t('exams.seating.printCharts')}</Button>
                <Button size="sm" variant="secondary" icon={Megaphone} onClick={() => printDocument('EXAM_DOOR_LIST', plan.id)}>{t('exams.seating.printNotice')}</Button>
              </>}
              {hasPermission('exams.seating.publish') && (
                <Button size="sm" icon={draft ? ShieldCheck : Undo2} variant={draft ? 'primary' : 'secondary'} loading={publish.isPending}
                  onClick={async () => { if (await confirm(draft ? { title: t('exams.seating.publishConfirm'), message: t('exams.seating.publishHint'), confirmLabel: t('exams.seating.publish') } : { title: t('exams.seating.unpublishConfirm'), message: t('exams.seating.unpublishHint'), confirmLabel: t('exams.seating.unpublish') })) publish.mutate() }}>
                  {draft ? t('exams.seating.publish') : t('exams.seating.unpublish')}
                </Button>
              )}
              {draft && hasPermission('exams.seating.delete') && <Button size="sm" variant="ghost" icon={Trash2}
                onClick={async () => { if (await confirm({ title: t('exams.seating.clearConfirm'), message: t('exams.seating.clearHint'), tone: 'danger', confirmLabel: t('exams.seating.clear') })) clear.mutate() }}>{t('exams.seating.clear')}</Button>}
            </div>
          </div>
          <div className="space-y-3 border-t border-border p-4">
            {warnings.length > 0 && (
              <Note tone="warning" icon={AlertTriangle}><ul className="list-disc space-y-0.5 ps-4 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Note>
            )}
            {tab === 'rooms' && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {plan.rooms.map((r) => (
                    <button key={r.roomId} type="button" onClick={() => setRoomTab(r.roomId)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${r.roomId === roomTab ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border bg-surface text-ink hover:bg-bg'}`}>
                      <span className="font-semibold font-mono-num">{r.code || r.name}</span>
                      <span className="tabular-nums text-ink-faint">{r.students}/{r.usable.length}</span>
                    </button>
                  ))}
                  {editable && plan.seats.some((s) => s.locked) && <Button size="sm" variant="ghost" icon={Unlock} className="ms-auto" onClick={() => unlock.mutate()}>{t('exams.seating.unlockAll')}</Button>}
                </div>
                {editable && <p className="text-xs text-ink-faint">{t('exams.seating.editHint')}</p>}
                <PickedBar picked={picked} onCancel={() => setPicked(null)} />
                <UnseatedList list={plan.unseated} picked={picked} onPick={setPicked} canEdit={editable} />
                {room && <>
                  <ClassLegend classes={view.classes} seats={plan.seats} roomId={room.roomId} />
                  <RoomSeatMap room={room} seats={plan.seats} classes={view.classes} clashes={plan.clashes} canEdit={editable} picked={picked} onPick={setPicked} onPlace={place} />
                </>}
              </>
            )}
            {tab === 'notice' && <SeatingRuns plan={plan} />}
            {tab === 'invigilators' && (
              <InvigilatorsPanel plan={plan} teachers={view.teachers} canEdit={editable} busy={autoInv.isPending}
                onAuto={() => autoInv.mutate()} onSet={(roomId, teacherIds, auto) => setInv.mutate({ roomId, teacherIds, auto })} />
            )}
          </div>
        </section>
      )}
    </div>
  )
}
