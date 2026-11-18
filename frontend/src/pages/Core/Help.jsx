import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle2, Clock, LifeBuoy, Mail, MessageCircle, Phone, Search, Send, Star, ThumbsDown, ThumbsUp } from 'lucide-react'
import { SUPPORT_CATEGORIES, SUPPORT_STATUS } from '@schoolgiant/shared'
import { EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { Messages, ReplyBox } from '../../components/support/Conversation'
import { createTicket, fetchMyTicket, fetchMyTickets, fetchSupportContact, helpFeedback, loadSupportFile, readHelp, replyTicket, searchHelp, solveTicket, uploadSupportFile } from '../../api/support'
import ArticleBody from '../../components/support/ArticleBody'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import useAuthUser from '../../hooks/useAuthUser'
import { gateFor } from '../../catalog/nav'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

// Help & support: ask the SchoolGiant team for help and follow the answer. Open to every staff member; each sees
// their own requests (a full-access admin sees all of the school's). The page the person came from is sent along,
// so they never have to explain where they were.

function ReachUs() {
  const { t } = useTranslation('admin')
  const { data: c } = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact })
  if (!c) return null
  const wa = c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91')}` : null
  const row = 'flex items-center gap-2.5 text-sm text-ink'
  return (
    <Panel title={t('admin.help.reachUs', { name: c.company })} icon={LifeBuoy}>
      <div className="space-y-2.5">
        {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className={`${row} hover:text-brand-700`}><Phone className="w-4 h-4 text-ink-faint" />{c.phone}</a>}
        {wa && <a href={wa} target="_blank" rel="noreferrer" className={`${row} hover:text-brand-700`}><MessageCircle className="w-4 h-4 text-ink-faint" />{t('admin.help.whatsapp', { number: c.whatsapp })}</a>}
        {c.email && <a href={`mailto:${c.email}`} className={`${row} hover:text-brand-700 break-all`}><Mail className="w-4 h-4 text-ink-faint" />{c.email}</a>}
        {c.hours && <p className={row}><Clock className="w-4 h-4 text-ink-faint" />{c.hours}</p>}
        {c.note && <p className="text-xs text-ink-muted">{c.note}</p>}
        {!c.phone && !c.email && !wa && <p className="text-sm text-ink-muted">{t('admin.help.writeHere')}</p>}
      </div>
    </Panel>
  )
}

/** One article to read, with "was this helpful?" — and, if not, a way straight to asking. */
function ArticleModal({ slug, onClose, onAsk }) {
  const { t, i18n } = useTranslation('admin')
  const { data: a, error } = useQuery({ queryKey: ['help-article', slug, i18n.language], queryFn: () => readHelp(slug, i18n.language) })
  const [voted, setVoted] = useState(null)
  const vote = (helpful) => { setVoted(helpful); helpFeedback(slug, helpful).catch(() => {}) }
  return (
    <Modal open onClose={onClose} size="lg" title={a?.title ?? '…'}>
      {error ? <Note tone="danger">{error.message}</Note> : !a ? <p className="text-sm text-ink-faint">…</p> : (
        <div className="space-y-5">
          {a.summary && <p className="text-sm text-ink-muted">{a.summary}</p>}
          <ArticleBody text={a.body} />
          <div className="rounded-lg border border-border p-3 flex flex-wrap items-center gap-2">
            {voted === null ? <>
              <span className="text-sm text-ink me-auto">{t('admin.help.wasHelpful')}</span>
              <Button size="sm" variant="secondary" icon={ThumbsUp} onClick={() => vote(true)}>{t('admin.help.yes')}</Button>
              <Button size="sm" variant="secondary" icon={ThumbsDown} onClick={() => vote(false)}>{t('admin.help.no')}</Button>
            </> : voted ? <span className="text-sm text-success-700">{t('admin.help.gladHelped')}</span> : <>
              <span className="text-sm text-ink me-auto">{t('admin.help.sorryAsk')}</span>
              <Button size="sm" icon={Send} onClick={() => onAsk(a.title)}>{t('admin.help.askUs')}</Button>
            </>}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Search the help articles; with nothing typed, the ones for the screen the person came from, then the rest. */
function HelpSearch({ pageKey, pageName, onAsk }) {
  const { t, i18n } = useTranslation('admin')
  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [open, setOpen] = useState(null)
  const { data } = useQuery({ queryKey: ['help-search', dq, pageKey, i18n.language], queryFn: () => searchHelp({ q: dq || undefined, page: pageKey || undefined, lang: i18n.language }) })
  const forPage = !dq ? data?.forPage ?? [] : []
  const rows = (data?.rows ?? []).filter((r) => !forPage.some((f) => f.slug === r.slug)).slice(0, dq ? 20 : 6)
  const item = (a) => (
    <li key={a.slug}>
      <button type="button" onClick={() => setOpen(a.slug)} className="w-full flex items-start gap-3 px-4 py-2.5 text-start hover:bg-black/[0.02]">
        <BookOpen className="w-4 h-4 mt-0.5 text-ink-faint shrink-0" />
        <span className="min-w-0"><span className="block text-sm font-medium text-ink">{a.title}</span>{a.summary && <span className="block text-xs text-ink-muted">{a.summary}</span>}</span>
      </button>
    </li>
  )
  if (data && !data.rows.length && !dq) return null // no articles published yet
  return (
    <Panel title={t('admin.help.searchTitle')} flush>
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.help.searchPlaceholder')} className="ps-9" />
        </div>
      </div>
      {forPage.length > 0 && <>
        <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t('admin.help.forThisPage', { page: pageName })}</p>
        <ul className="divide-y divide-border">{forPage.map(item)}</ul>
      </>}
      {rows.length > 0 ? <>
        {!dq && <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t('admin.help.popular')}</p>}
        <ul className="divide-y divide-border">{rows.map(item)}</ul>
      </> : dq ? <p className="px-4 py-3 text-sm text-ink-muted">{t('admin.help.noMatch')}</p> : null}
      <div className="h-2" />
      {open && <ArticleModal slug={open} onClose={() => setOpen(null)} onAsk={(title) => { setOpen(null); onAsk(title) }} />}
    </Panel>
  )
}

/** Ask for help: what it is about, a subject, what happened, files. */
function AskForm({ from, onSent, subject: startSubject = '' }) {
  const { t } = useTranslation('admin')
  const user = useAuthUser()
  const { showError } = useSnackbar()
  const [v, setV] = useState({ category: 'PROBLEM', subject: startSubject, priority: 'NORMAL' })
  const [errors, setErrors] = useState({})
  const cl = useCatalogLabel()
  const gate = from ? gateFor(user, from) : null
  // the screen by its name ("Fees › Collect fees"), not its address
  const fromName = gate?.module ? [cl.module(gate.module), gate.page ? cl.page(gate.module, gate.page) : null].filter(Boolean).join(' › ') : ''
  const send = useMutation({
    mutationFn: ({ body, fileIds }) => createTicket({
      ...v, body, fileIds,
      context: { path: from || undefined, module: gate?.module?.id, page: gate?.page?.id, userAgent: navigator.userAgent.slice(0, 400) },
    }),
    onSuccess: (r) => { setV({ category: 'PROBLEM', subject: '', priority: 'NORMAL' }); setErrors({}); onSent(r) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Panel title={t('admin.help.askTitle')} subtitle={t('admin.help.askHint')}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('admin.help.category')}>
            <Select value={v.category} onChange={(e) => setV((x) => ({ ...x, category: e.target.value }))}>
              {SUPPORT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`admin.help.categories.${c.value}`, c.label)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('admin.help.howUrgent')}>
            <SegmentedControl size="md" value={v.priority} onChange={(p) => setV((x) => ({ ...x, priority: p }))}
              options={[{ value: 'NORMAL', label: t('admin.help.normal') }, { value: 'URGENT', label: t('admin.help.urgent') }]} />
          </FormField>
        </div>
        <FormField label={t('admin.help.subject')} required error={errors.subject}>
          <Input value={v.subject} maxLength={160} onChange={(e) => setV((x) => ({ ...x, subject: e.target.value }))} placeholder={t('admin.help.subjectPlaceholder')} />
        </FormField>
        {fromName && <p className="text-xs text-ink-muted">{t('admin.help.fromPage', { page: fromName })}</p>}
        <FormField label={t('admin.help.details')} error={errors.body} hint={t('admin.help.detailsHint')}>
          <ReplyBox busy={send.isPending} disabled={v.subject.trim().length < 3} sendLabel={t('admin.help.send')} placeholder={t('admin.help.detailsPlaceholder')}
            uploadFile={uploadSupportFile} onSend={(m) => send.mutateAsync(m).then(() => true, () => false)} />
        </FormField>
      </div>
    </Panel>
  )
}

/** One request: the conversation, a reply, and "this is sorted" with how the help was. */
function RequestModal({ id, onClose }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: r } = useQuery({ queryKey: ['support-ticket', id], queryFn: () => fetchMyTicket(id), refetchInterval: 30_000 })
  const [rating, setRating] = useState(0)
  const done = (d) => { qc.setQueryData(['support-ticket', id], d); qc.invalidateQueries({ queryKey: ['support-tickets'] }) }
  const reply = useMutation({ mutationFn: (m) => replyTicket(id, m), onSuccess: done, onError: (e) => showError(e.message) })
  const solve = useMutation({ mutationFn: () => solveTicket(id, rating ? { score: rating } : {}), onSuccess: (d) => { done(d); showSuccess(t('admin.help.thanks')) }, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={r ? `${r.ticketNo} · ${r.subject}` : '…'}>
      {!r ? <p className="text-sm text-ink-faint">…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <StatusPill tone={SUPPORT_STATUS[r.status]?.tone}>{t(`admin.help.status.${r.status}`)}</StatusPill>
            <span>{t(`admin.help.categories.${r.category}`)}</span>
            {r.priority === 'URGENT' && <span className="text-danger-600">· {t('admin.help.urgent')}</span>}
            {r.createdBy?.name && <span>· {r.createdBy.name}</span>}
          </div>
          {r.status === 'WAITING' && <Note tone="warning">{t('admin.help.waitingNote')}</Note>}
          <Messages messages={r.messages} side="SCHOOL" loadFile={loadSupportFile} />
          {r.status !== 'CLOSED' ? (
            <>
              <ReplyBox busy={reply.isPending} uploadFile={uploadSupportFile} placeholder={t('admin.help.replyPlaceholder')} onSend={(m) => reply.mutateAsync(m).then(() => true, () => false)} />
              {r.status !== 'SOLVED' ? (
                <div className="rounded-lg border border-border p-3 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-ink">{t('admin.help.sorted')}</span>
                  <span className="flex items-center gap-0.5" aria-label={t('admin.help.rate')}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setRating(n)} title={t('admin.help.stars', { count: n })} className="p-0.5">
                        <Star className={`w-5 h-5 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-ink-faint'}`} />
                      </button>
                    ))}
                  </span>
                  <Button size="sm" variant="secondary" icon={CheckCircle2} loading={solve.isPending} onClick={() => solve.mutate()} className="ms-auto">{t('admin.help.markSolved')}</Button>
                </div>
              ) : <Note tone="success">{t('admin.help.solvedNote')}</Note>}
            </>
          ) : <Note>{t('admin.help.closedNote')}</Note>}
        </div>
      )}
    </Modal>
  )
}

export default function Help() {
  const { t } = useTranslation('admin')
  const { date } = useFormat()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const from = location.state?.from && location.state.from !== '/help' ? location.state.from : ''
  const [filter, setFilter] = useState('ACTIVE')
  const { data } = useQuery({ queryKey: ['support-tickets', filter], queryFn: () => fetchMyTickets(filter === 'ALL' ? '' : filter) })
  const [openId, setOpenId] = useState(params.get('request'))
  useEffect(() => { const r = params.get('request'); if (r) setOpenId(r) }, [params])
  const rows = data?.rows ?? []
  const user = useAuthUser()
  const cl = useCatalogLabel()
  const gate = from ? gateFor(user, from) : null
  const pageKey = gate?.module && gate?.page ? `${gate.module.id}.${gate.page.id}` : ''
  const pageName = gate?.module ? [cl.module(gate.module), gate.page ? cl.page(gate.module, gate.page) : null].filter(Boolean).join(' › ') : ''
  const [ask, setAsk] = useState({ n: 0, subject: '' })
  const askAbout = (title) => { setAsk((a) => ({ n: a.n + 1, subject: title })); setTimeout(() => document.getElementById('ask-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const close = () => { setOpenId(null); if (params.get('request')) { params.delete('request'); setParams(params, { replace: true }) } }

  return (
    <PageContainer>
      <PageHeader icon={LifeBuoy} title={t('admin.help.title')} subtitle={t('admin.help.subtitle')} />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <HelpSearch pageKey={pageKey} pageName={pageName} onAsk={askAbout} />
          <div id="ask-form" className="scroll-mt-4"><AskForm key={ask.n} subject={ask.subject} from={from} onSent={(r) => { setFilter('ACTIVE'); setOpenId(r.id) }} /></div>
          <Panel title={data?.all ? t('admin.help.schoolRequests') : t('admin.help.myRequests')} flush
            actions={<SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'ACTIVE', label: t('admin.help.filterActive') }, { value: 'SOLVED', label: t('admin.help.filterSolved') }, { value: 'ALL', label: t('admin.help.filterAll') }]} />}>
            {!rows.length ? <EmptyState icon={Send} title={t('admin.help.none')} hint={t('admin.help.noneHint')} /> : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenId(r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-black/[0.02]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{r.subject}</span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {[r.ticketNo, t(`admin.help.categories.${r.category}`), data?.all ? r.createdBy?.name : null, r.lastFrom === 'SUPPORT' ? t('admin.help.lastFromTeam', { date: date(r.lastAt) }) : t('admin.help.lastFromYou', { date: date(r.lastAt) })].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <StatusPill tone={SUPPORT_STATUS[r.status]?.tone}>{t(`admin.help.status.${r.status}`)}</StatusPill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5 min-w-0">
          <ReachUs />
          <Note>{t('admin.help.tips')}</Note>
        </div>
      </div>
      {openId && <RequestModal id={openId} onClose={close} />}
    </PageContainer>
  )
}

