import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Coffee, Cookie, Moon, Pencil, RotateCcw, Save, Soup, UserCheck, Users, Utensils, LogOut } from 'lucide-react'
import { MEALS, MESS_DAYS } from '@schoolgiant/shared'
import { EmptyState, HeaderButton, Note, PageContainer, PageHeader, SideNav, SideNavLayout, Skeleton, StatCardRow, Textarea, TONE, localIso, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { useHostelLabels } from '../../components/hostel/HostelKit'
import { clearMessMenu, fetchHostelBlocks, fetchMess, saveMealCount, saveMessMenu } from '../../api/hostel'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const MEAL_LOOK = { BREAKFAST: { icon: Coffee, tone: 'orange' }, LUNCH: { icon: Soup, tone: 'success' }, SNACKS: { icon: Cookie, tone: 'pink' }, DINNER: { icon: Moon, tone: 'violet' } }
const shiftWeek = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 7 * 864e5).toISOString().slice(0, 10)

/** Hostel › Mess: the weekly menu (day × meal) for the common mess or a block, and how many ate each meal. */
export default function HostelMess() {
  const { t } = useTranslation('hostel')
  const L = useHostelLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [blockId, setBlockId] = useState('')
  const [day, setDay] = useState(() => localIso(new Date()))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const { data: blocks = [] } = useQuery({ queryKey: ['hostel', 'blocks'], queryFn: fetchHostelBlocks })
  const params = { ...(blockId && { blockId }), date: day }
  const { data: m, isLoading, error, refetch } = useQuery({ queryKey: ['hostel', 'mess', params], queryFn: () => fetchMess(params) })
  const canEdit = hasPermission('hostel.mess.edit')
  const key = (d, meal) => `${d}:${meal}`
  useEffect(() => { setEditing(false) }, [blockId])
  const startEdit = () => { setDraft(Object.fromEntries((m?.items ?? []).map((x) => [key(x.day, x.meal), x.dishes]))); setEditing(true) }
  const refresh = () => qc.invalidateQueries({ queryKey: ['hostel', 'mess'] })
  const save = useMutation({
    mutationFn: () => saveMessMenu({ blockId: blockId || null, items: MESS_DAYS.flatMap((d) => MEALS.map((x) => ({ day: d, meal: x.value, dishes: draft[key(d, x.value)] ?? '' }))) }),
    onSuccess: () => { setEditing(false); refresh(); showSuccess(t('hostel.mess.saved')) }, onError: (e) => showError(e.message),
  })
  const reset = useMutation({ mutationFn: () => clearMessMenu(blockId), onSuccess: () => { refresh(); showSuccess(t('hostel.mess.usingCommon')) }, onError: (e) => showError(e.message) })
  const count = useMutation({ mutationFn: (body) => saveMealCount(body), onSuccess: () => { refresh(); showSuccess(t('hostel.mess.countSaved')) }, onError: (e) => showError(e.message) })
  const dishes = (d, meal) => m?.items.find((x) => x.day === d && x.meal === meal)?.dishes ?? ''
  const countOf = (dt, meal) => m?.counts.find((c) => c.date === dt && c.meal === meal)?.count
  const todayDay = m?.week.find((w) => w.date === m.today)?.day
  const block = blocks.find((b) => b.id === blockId)
  const askCount = async (dt, meal) => {
    if (!canEdit || dt > m.today) return
    const v = await prompt({ title: t('hostel.mess.countTitle', { meal: L.meal(meal), date: date(dt) }), label: t('hostel.mess.countLabel'), required: true })
    if (v && /^\d+$/.test(v.trim())) count.mutate({ blockId: blockId || null, date: dt, meal, count: Number(v.trim()) })
    else if (v) showError(t('hostel.mess.countNumber'))
  }
  const servedToday = m ? MEALS.reduce((n, x) => n + (countOf(m.today, x.value) ?? 0), 0) : 0

  return (
    <PageContainer>
      <PageHeader icon={Utensils} title={t('hostel.mess.title')} subtitle={t('hostel.mess.subtitle')}
        actions={canEdit && m && (editing ? <>
          <HeaderButton onClick={() => setEditing(false)}>{t('actions.cancel')}</HeaderButton>
          <HeaderButton icon={Save} variant="primary" onClick={() => save.mutate()}>{t('hostel.mess.saveMenu')}</HeaderButton>
        </> : <>
          {blockId && m.own && !m.inherited && <HeaderButton icon={RotateCcw} onClick={async () => { if (await confirm({ title: t('hostel.mess.resetConfirm', { name: block?.name ?? '' }), confirmLabel: t('hostel.mess.reset') })) reset.mutate() }}>{t('hostel.mess.reset')}</HeaderButton>}
          <HeaderButton icon={Pencil} variant="primary" onClick={startEdit}>{blockId && !m.own ? t('hostel.mess.ownMenu') : t('hostel.mess.editMenu')}</HeaderButton>
        </>)} />
      <SideNavLayout nav={blocks.length > 0 && (
        <SideNav title={t('hostel.mess.messes')} value={blockId} onChange={setBlockId} items={[
          { id: '', label: t('hostel.mess.common'), icon: Utensils, hint: t('hostel.mess.commonHint') },
          ...blocks.map((b) => ({ id: b.id, label: b.name, icon: Utensils, hint: L.kind(b.kind), count: b.counts.OCCUPIED })),
        ]} />
      )}>
        <StatCardRow items={[
          { icon: Users, tone: 'brand', label: t('hostel.mess.residents'), value: m?.residents ?? '—' },
          { icon: LogOut, tone: 'violet', label: t('hostel.board.outOnPass'), value: m?.outNow ?? '—' },
          { icon: UserCheck, tone: 'success', label: t('hostel.mess.expected'), value: m?.expected ?? '—', sub: t('hostel.mess.expectedHint') },
        ]} />
        {m?.inherited && <Note tone="info">{t('hostel.mess.inheritedNote', { name: block?.name ?? '' })}</Note>}
        {m && blockId && !m.own && !m.inherited && <Note tone="warning">{t('hostel.mess.noMenuNote')}</Note>}
        {isLoading ? <Skeleton className="h-96 rounded-2xl" /> : error ? <EmptyState error={error} onRetry={refetch} /> : (
          <section className="rounded-2xl border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="font-display font-semibold text-ink">{t('hostel.mess.weekMenu')}</h2>
              {m.updatedAt && <span className="text-xs text-ink-faint">{t('hostel.mess.updatedBy', { name: m.updatedBy ?? '', date: date(m.updatedAt) })}</span>}
            </header>
            <div className="overflow-x-auto scroll-thin">
              <div className="grid min-w-[760px] grid-cols-[96px_repeat(4,minmax(0,1fr))] gap-2 p-3">
                <span />
                {MEALS.map((x) => {
                  const Icon = MEAL_LOOK[x.value].icon
                  return <span key={x.value} className={clsx('flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold', TONE[MEAL_LOOK[x.value].tone].bg, TONE[MEAL_LOOK[x.value].tone].text)}><Icon className="h-3.5 w-3.5" />{L.meal(x.value)}<span className="ms-auto font-normal opacity-70 tabular-nums">{x.time}</span></span>
                })}
                {MESS_DAYS.map((d) => (
                  <div key={d} className="contents">
                    <span className={clsx('flex items-center rounded-lg px-2 text-sm font-semibold', d === todayDay ? 'bg-brand-50 text-brand-700' : 'text-ink')}>{L.day(d)}</span>
                    {MEALS.map((x) => (editing ? (
                      <Textarea key={x.value} rows={2} value={draft[key(d, x.value)] ?? ''} maxLength={300} aria-label={`${L.day(d)} ${L.meal(x.value)}`}
                        onChange={(e) => setDraft((o) => ({ ...o, [key(d, x.value)]: e.target.value }))} />
                    ) : (
                      <div key={x.value} className={clsx('min-h-[56px] rounded-lg border p-2 text-[12.5px] leading-snug', d === todayDay ? 'border-brand-200 bg-brand-50/40' : 'border-border bg-black/[0.015]')}>
                        {dishes(d, x.value) ? <span className="text-ink">{dishes(d, x.value)}</span> : <span className="text-ink-faint">—</span>}
                      </div>
                    )))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {m && (
          <section className="rounded-2xl border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="font-display font-semibold text-ink">{t('hostel.mess.served')}</h2>
              <span className="text-xs text-ink-faint">{t('hostel.mess.servedToday', { count: servedToday })}</span>
              <span className="ms-auto inline-flex items-center gap-1">
                <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={t('hostel.mess.prevWeek')} onClick={() => setDay((x) => shiftWeek(x, -1))} />
                <span className="text-xs tabular-nums text-ink-muted">{date(m.week[0].date)} – {date(m.week[6].date)}</span>
                <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={t('hostel.mess.nextWeek')} disabled={m.week[6].date >= m.today} onClick={() => setDay((x) => shiftWeek(x, 1))} />
              </span>
            </header>
            <div className="overflow-x-auto scroll-thin">
              <div className="grid min-w-[640px] grid-cols-[96px_repeat(7,minmax(0,1fr))] gap-1.5 p-3">
                <span />
                {m.week.map((w) => <span key={w.date} className={clsx('text-center text-[11px] font-semibold', w.date === m.today ? 'text-brand-700' : 'text-ink-faint')}>{L.day(w.day)}<br /><span className="font-normal tabular-nums">{Number(w.date.slice(8, 10))}</span></span>)}
                {MEALS.map((x) => (
                  <div key={x.value} className="contents">
                    <span className="flex items-center text-xs font-medium text-ink">{L.meal(x.value)}</span>
                    {m.week.map((w) => {
                      const n = countOf(w.date, x.value)
                      const pct = n != null && m.expected ? Math.min(100, Math.round((n / m.expected) * 100)) : 0
                      const future = w.date > m.today
                      return (
                        <button key={w.date} type="button" disabled={!canEdit || future} onClick={() => askCount(w.date, x.value)}
                          title={future ? undefined : t('hostel.mess.countHint')}
                          className={clsx('flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-1 transition-colors', future ? 'border-dashed border-border bg-transparent' : 'border-border bg-black/[0.015] hover:border-brand-300 disabled:hover:border-border')}>
                          <span className={clsx('text-sm font-semibold tabular-nums', n == null ? 'text-ink-faint' : 'text-ink')}>{n ?? '—'}</span>
                          {n != null && <span className="h-1 w-full max-w-[56px] overflow-hidden rounded-full bg-black/[0.06]"><span className={clsx('block h-full rounded-full', TONE[MEAL_LOOK[x.value].tone].fill)} style={{ width: `${pct}%` }} /></span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </SideNavLayout>
    </PageContainer>
  )
}
