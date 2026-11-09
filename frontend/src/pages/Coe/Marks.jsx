import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Calculator, CalendarPlus, ClipboardList, FileStack, GraduationCap, Lock, NotebookPen, Pencil, Scale, ScrollText } from 'lucide-react'
import { COE_SESSION_STATUS } from '@schoolgiant/shared'
import {
  CodeBadge, ColorChip, ControlChip, DataTable, EmptyState, HeaderButton, LevelBar, Note, PageContainer, PageHeader, StatCardRow, StatusPill,
} from '../../components/system'
import Button from '../../components/ui/Button'
import SessionForm from '../../components/coe/SessionForm'
import SheetView from '../../components/coe/SheetView'
import useSessionPick from '../../components/coe/useSessionPick'
import { computeResults, fetchCoeLookup, fetchSessionBoard, prepareSheets } from '../../api/coe'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function SheetCell({ part, onOpen }) {
  const { t } = useTranslation('coe')
  if (!part) return <span className="text-ink-faint">—</span>
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(part.id) }} className="flex w-full flex-col items-start gap-1 rounded-md px-1 py-0.5 text-start hover:bg-bg">
      <span className="flex items-center gap-1.5">
        {part.status === 'LOCKED' ? <Lock className="h-3.5 w-3.5 text-success-600" /> : <NotebookPen className="h-3.5 w-3.5 text-amber-600" />}
        <span className="text-xs text-ink-muted">{t(`coe.sheetStatus.${part.status}`)}</span>
        {part.moderation && <ColorChip label={t(`coe.moderationStatus.${part.moderation.status}`)} seed={part.moderation.status} icon={Scale} />}
      </span>
      <LevelBar value={part.entered} max={part.total || 1} label={`${part.entered}/${part.total}`} width="w-24" />
    </button>
  )
}

export default function Marks() {
  const { t } = useTranslation('coe')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [sheetId, setSheetId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [program, setProgram] = useState('')
  const { sessions, sessionId, setSessionId, session, isLoading: loadingSessions } = useSessionPick()
  const { data: lookup } = useQuery({ queryKey: ['coe-lookup'], queryFn: fetchCoeLookup })
  const boardKey = ['coe-board', sessionId]
  const { data: board, isLoading, error, refetch } = useQuery({ queryKey: boardKey, queryFn: () => fetchSessionBoard(sessionId), enabled: !!sessionId })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['coe-board'] }); qc.invalidateQueries({ queryKey: ['coe-sessions'] }) }
  const prepare = useMutation({ mutationFn: () => prepareSheets(sessionId), onSuccess: (r) => { refresh(); showSuccess(t('coe.marks.prepared', { created: r.created, students: r.students })) }, onError: (e) => showError(e.message) })
  const compute = useMutation({ mutationFn: () => computeResults(sessionId), onSuccess: (r) => { refresh(); showSuccess(t('coe.marks.computed', { results: r.results, missing: r.missing })) }, onError: (e) => showError(e.message) })
  const published = board?.session.status === 'PUBLISHED'
  const rows = (board?.rows ?? []).filter((r) => !program || r.programId === program)
  const s = board?.summary
  const noPrograms = lookup && !lookup.programs.length

  if (sheetId) return <PageContainer><SheetView sheetId={sheetId} onBack={() => { setSheetId(null); refresh() }} /></PageContainer>

  const header = (
    <PageHeader icon={ScrollText} title={t('coe.marks.title')} subtitle={t('coe.marks.subtitle')}
      actions={<HeaderButton icon={CalendarPlus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('coe.sessions.new')}</HeaderButton>} />
  )
  if (!loadingSessions && !sessions.length) {
    return (
      <PageContainer>
        {header}
        <EmptyState icon={noPrograms ? GraduationCap : FileStack}
          title={noPrograms ? t('coe.marks.noPrograms') : t('coe.marks.noSessions')}
          hint={noPrograms ? t('coe.marks.noProgramsHint') : t('coe.marks.noSessionsHint')}
          action={!noPrograms && hasPermission('coe.marks.create') && <Button icon={CalendarPlus} onClick={() => setEditing('new')}>{t('coe.marks.firstSession')}</Button>} />
        {editing && <SessionForm session={null} onClose={() => setEditing(null)} onSaved={(x) => { setEditing(null); refresh(); setSessionId(x.id); showSuccess(t('coe.sessions.saved')) }} />}
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <ControlChip icon={FileStack} label={t('coe.session')} active value={session?.name}
          options={sessions.map((x) => ({ value: x.id, label: `${x.name} — ${t(`coe.sessionStatus.${x.status}`)}` }))} onChange={setSessionId} />
        {board && board.session.targets.length > 1 && (
          <ControlChip icon={GraduationCap} label={t('coe.program')} active={!!program} value={program ? board.session.targets.find((x) => x.programId === program)?.programCode : t('coe.all')}
            options={[{ value: '', label: t('coe.all') }, ...[...new Map(board.session.targets.map((x) => [x.programId, x])).values()].map((x) => ({ value: x.programId, label: x.programCode }))]} onChange={setProgram} />
        )}
        {board && <StatusPill tone={COE_SESSION_STATUS[board.session.status]?.tone}>{t(`coe.sessionStatus.${board.session.status}`)}</StatusPill>}
        {board && <ColorChip label={t(`coe.sessionKinds.${board.session.kind}`)} seed={board.session.kind} />}
        <div className="ms-auto flex flex-wrap gap-2">
          {board && !published && hasPermission('coe.marks.edit') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(board.session)}>{t('coe.sessions.edit')}</Button>}
          {board && !published && hasPermission('coe.marks.create') && <Button size="sm" variant="secondary" icon={ClipboardList} loading={prepare.isPending} onClick={() => prepare.mutate()}>{t('coe.marks.prepare')}</Button>}
          {board && !published && hasPermission('coe.marks.lock') && board.rows.length > 0 && <Button size="sm" icon={Calculator} loading={compute.isPending} onClick={() => compute.mutate()}>{t('coe.marks.compute')}</Button>}
        </div>
      </div>
      {published && <Note tone="success">{t('coe.marks.publishedNote', { at: dateTime(board.session.publishedAt), by: board.session.publishedBy })}</Note>}
      {s && (
        <StatCardRow items={[
          { icon: ClipboardList, tone: 'brand', label: t('coe.marks.statCourses'), value: s.courses, sub: t('coe.marks.statCoursesSub', { sheets: s.sheets }) },
          { icon: NotebookPen, tone: s.entered === s.entries ? 'success' : 'warning', label: t('coe.marks.statEntered'), value: s.entries ? `${Math.round((s.entered / s.entries) * 100)}%` : '—', sub: t('coe.marks.statEnteredSub', { entered: s.entered, total: s.entries }), progress: s.entries ? (s.entered / s.entries) * 100 : 0 },
          { icon: Lock, tone: s.locked === s.sheets && s.sheets ? 'success' : 'info', label: t('coe.marks.statLocked'), value: `${s.locked} / ${s.sheets}`, progress: s.sheets ? (s.locked / s.sheets) * 100 : 0, sub: t('coe.marks.statLockedSub') },
          { icon: Scale, tone: s.moderationPending ? 'warning' : 'teal', label: t('coe.marks.statModeration'), value: s.moderationPending, sub: t('coe.marks.statModerationSub', { revals: s.revaluationsOpen }) },
        ]} />
      )}
      <DataTable
        title={t('coe.marks.list')} exportable exportName={`coe-marks-${session?.name ?? ''}`}
        rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id"
        emptyIcon={ClipboardList} emptyTitle={t('coe.marks.noSheets')} emptyHint={t('coe.marks.noSheetsHint')}
        emptyAction={!published && hasPermission('coe.marks.create') && <Button icon={ClipboardList} loading={prepare.isPending} onClick={() => prepare.mutate()}>{t('coe.marks.prepare')}</Button>}
        columns={[
          { key: 'code', header: t('coe.course'), sortable: true, mobileTitle: true, render: (v, r) => <div className="flex items-center gap-2 min-w-0"><CodeBadge>{v}</CodeBadge><span className="text-sm text-ink truncate">{r.title}</span></div> },
          { key: 'programCode', header: t('coe.program'), sortable: true, render: (v, r) => <ColorChip label={v} seed={v} sub={`${t('coe.semShort', { n: r.semester })}`} /> },
          { key: 'credits', header: t('coe.credits'), align: 'right' },
          { key: 'students', header: t('coe.marks.students'), align: 'right', sortable: true },
          { key: 'internal', header: t('coe.parts.INTERNAL'), render: (v) => <SheetCell part={v} onOpen={setSheetId} /> },
          { key: 'external', header: t('coe.parts.EXTERNAL'), render: (v) => <SheetCell part={v} onOpen={setSheetId} /> },
        ]}
      />
      {editing && <SessionForm session={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(x) => { setEditing(null); refresh(); setSessionId(x.id); showSuccess(t('coe.sessions.saved')) }} />}
    </PageContainer>
  )
}
