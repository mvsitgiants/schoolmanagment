import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Send, Trash2, Undo2, X } from 'lucide-react'
import { JOURNAL_STATUSES, toPaise, toRupees } from '@schoolgiant/shared'
import { DateInput, Drawer, FormField, Input, Modal, Money, Note, Select, StatusPill, localIso, usePrompt } from '../system'
import Button from '../ui/Button'
import { createJournal, discardJournal, fetchFinanceMeta, fetchJournal, postJournal, reverseJournal, updateJournal } from '../../api/finance'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

export const useFinanceMeta = () => useQuery({ queryKey: ['finance-meta'], queryFn: fetchFinanceMeta, staleTime: 60_000 })

/** A ledger picker: the chart in order, groups shown as headings (they take no entries). */
export function AccountSelect({ value, onChange, accounts, filter, placeholder, ...rest }) {
  const { t } = useTranslation('finance')
  const list = (accounts ?? []).filter((a) => !filter || a.isGroup || filter(a))
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder ?? t('finance.pickAccount')}</option>
      {list.map((a) => (a.isGroup
        ? <option key={a.id} value={`g:${a.id}`} disabled>{`${'  '.repeat(a.depth)}${a.name}`}</option>
        : <option key={a.id} value={a.id}>{`${'  '.repeat(a.depth)}${a.code} · ${a.name}`}</option>))}
    </Select>
  )
}

export function JournalStatus({ status }) {
  const { t } = useTranslation('finance')
  return <StatusPill tone={JOURNAL_STATUSES[status]?.tone}>{t(`finance.journalStatus.${status}`)}</StatusPill>
}

const blankLine = { accountId: '', debit: '', credit: '', party: '', note: '' }

/** A voucher by hand: type, date, narration and balanced lines. Saves a draft, or posts at once. */
export function VoucherForm({ journal, onClose, onSaved }) {
  const { t } = useTranslation('finance')
  const { showError } = useSnackbar()
  const { data: meta } = useFinanceMeta()
  const [head, setHead] = useState({ type: journal?.type ?? 'JOURNAL', date: journal?.date ?? localIso(new Date()), narration: journal?.narration ?? '', reference: journal?.reference ?? '' })
  const [lines, setLines] = useState(() => (journal?.lines?.length
    ? journal.lines.map((l) => ({ accountId: String(l.accountId), debit: l.debit ? String(toRupees(l.debit)) : '', credit: l.credit ? String(toRupees(l.credit)) : '', party: l.party?.name ?? '', note: l.note ?? '' }))
    : [{ ...blankLine }, { ...blankLine }]))
  const setLine = (i, k, v) => setLines((x) => x.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) } : l)))
  const dr = lines.reduce((s, l) => s + toPaise(l.debit), 0)
  const cr = lines.reduce((s, l) => s + toPaise(l.credit), 0)
  const body = (post) => ({
    ...head, post,
    lines: lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit))).map((l) => ({ accountId: l.accountId, debit: toPaise(l.debit), credit: toPaise(l.credit), note: l.note, ...(l.party.trim() && { party: { type: 'OTHER', name: l.party.trim() } }) })),
  })
  const save = useMutation({
    mutationFn: (post) => (journal ? updateJournal(journal.id, body(false)).then((j) => (post ? postJournal(j.id) : j)) : createJournal(body(post))),
    onSuccess: onSaved, onError: (e) => showError(e.message),
  })
  const ok = dr > 0 && dr === cr
  return (
    <Modal open onClose={onClose} size="xl" title={journal ? t('finance.voucher.editTitle') : t('finance.voucher.newTitle')} footer={<>
      <span className={`mr-auto text-sm ${ok ? 'text-success-700' : 'text-danger-600'}`}>{t('finance.voucher.totals', { dr: toRupees(dr), cr: toRupees(cr) })}</span>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="secondary" loading={save.isPending && !save.variables} disabled={!ok} onClick={() => save.mutate(false)}>{t('finance.voucher.saveDraft')}</Button>
      {hasPermission('finance.journals.post') && <Button icon={Send} loading={save.isPending && save.variables} disabled={!ok} onClick={() => save.mutate(true)}>{t('finance.voucher.post')}</Button>}
    </>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <FormField label={t('finance.voucher.type')}>
            <Select value={head.type} onChange={(e) => setHead((h) => ({ ...h, type: e.target.value }))}>
              {(meta?.voucherTypes ?? []).filter((v) => v.manual).map((v) => <option key={v.value} value={v.value}>{t(`finance.voucherTypes.${v.value}`)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('finance.voucher.date')}><DateInput value={head.date} onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} /></FormField>
          <div className="sm:col-span-2"><FormField label={t('finance.voucher.reference')}><Input value={head.reference} onChange={(e) => setHead((h) => ({ ...h, reference: e.target.value }))} /></FormField></div>
        </div>
        <p className="text-xs text-ink-muted">{t(`finance.voucherHints.${head.type}`)}</p>
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1.2fr_auto] gap-2 text-[11px] font-semibold text-ink-muted uppercase"><span>{t('finance.voucher.account')}</span><span>{t('finance.voucher.debit')}</span><span>{t('finance.voucher.credit')}</span><span>{t('finance.voucher.party')}</span><span /></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1.2fr_auto] gap-2">
              <div className="col-span-2 sm:col-span-1"><AccountSelect accounts={meta?.accounts} value={l.accountId} onChange={(v) => setLine(i, 'accountId', v)} aria-label={t('finance.voucher.account')} /></div>
              <Input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} aria-label={t('finance.voucher.debit')} placeholder={t('finance.voucher.debit')} />
              <Input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} aria-label={t('finance.voucher.credit')} placeholder={t('finance.voucher.credit')} />
              <Input value={l.party} onChange={(e) => setLine(i, 'party', e.target.value)} aria-label={t('finance.voucher.party')} placeholder={t('finance.voucher.party')} />
              <Button size="sm" variant="ghost" icon={X} disabled={lines.length <= 2} aria-label={t('finance.remove')} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines((x) => [...x, { ...blankLine, ...(dr !== cr && { [dr > cr ? 'credit' : 'debit']: String(toRupees(Math.abs(dr - cr))) }) }])}>{t('finance.voucher.addLine')}</Button>
        </div>
        <FormField label={t('finance.voucher.narration')}><Input value={head.narration} onChange={(e) => setHead((h) => ({ ...h, narration: e.target.value }))} /></FormField>
      </div>
    </Modal>
  )
}

/** One voucher: its lines, where it came from, and post / discard / reverse. */
export function VoucherDrawer({ id, onClose, onChanged }) {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(false)
  const { data: j } = useQuery({ queryKey: ['journal', id], queryFn: () => fetchJournal(id) })
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['journal', id] }); onChanged?.(); showSuccess(msg) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (r, v) => { done(v.done); if (v.close) onClose() }, onError: (e) => showError(e.message) })
  if (!j) return <Drawer open onClose={onClose} title={t('finance.loading')}><span /></Drawer>
  return (
    <Drawer open onClose={onClose} size="lg" title={j.voucherNo ?? t('finance.voucher.draft')} subtitle={`${t(`finance.voucherTypes.${j.type}`)} · ${date(j.date)}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <JournalStatus status={j.status} />
          {j.auto && <StatusPill tone="info">{t(`finance.sources.${j.source?.type}`, j.source?.type)}{j.source?.no ? ` · ${j.source.no}` : ''}</StatusPill>}
          {j.reversedBy?.voucherNo && <StatusPill tone="danger">{t('finance.voucher.reversedBy', { no: j.reversedBy.voucherNo })}</StatusPill>}
          {j.reversalOf?.voucherNo && <StatusPill tone="neutral">{t('finance.voucher.reverses', { no: j.reversalOf.voucherNo })}</StatusPill>}
        </div>
        {j.narration && <p className="text-sm text-ink">{j.narration}</p>}
        <div className="rounded-xl border border-border divide-y divide-border">
          {j.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-mono-num text-xs text-ink-faint">{l.accountCode}</span> {l.accountName}{l.party?.name && <span className="block text-xs text-ink-muted">{l.party.name}</span>}{l.note && <span className="block text-[11px] text-ink-faint">{l.note}</span>}</span>
              <span className="w-28 text-right">{l.debit ? <Money value={l.debit} paise /> : ''}</span>
              <span className="w-28 text-right">{l.credit ? <Money value={l.credit} paise /> : ''}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm font-semibold bg-bg"><span>{t('finance.voucher.total')}</span><span className="w-28 text-right"><Money value={j.total} paise /></span><span className="w-28 text-right"><Money value={j.total} paise /></span></div>
        </div>
        <p className="text-xs text-ink-faint">{[j.reference && t('finance.voucher.refLine', { ref: j.reference }), j.created?.by && t('finance.voucher.madeBy', { by: j.created.by, at: dateTime(j.created.at) }), j.posted?.by && t('finance.voucher.postedBy', { by: j.posted.by, at: dateTime(j.posted.at) })].filter(Boolean).join(' · ')}</p>
        {j.reconciledLines?.length > 0 && <Note>{t('finance.voucher.reconciled')}</Note>}
        <div className="flex flex-wrap gap-2">
          {j.status === 'DRAFT' && hasPermission('finance.journals.create') && <Button variant="secondary" onClick={() => setEditing(true)}>{t('finance.edit')}</Button>}
          {j.status === 'DRAFT' && hasPermission('finance.journals.post') && <Button icon={Send} onClick={() => act.mutate({ fn: () => postJournal(j.id), done: t('finance.voucher.posted') })}>{t('finance.voucher.post')}</Button>}
          {j.status === 'DRAFT' && hasPermission('finance.journals.create') && <Button variant="ghost" icon={Trash2} onClick={() => act.mutate({ fn: () => discardJournal(j.id), done: t('finance.voucher.discarded'), close: true })}>{t('finance.voucher.discard')}</Button>}
          {j.status === 'POSTED' && !j.reversedBy?.id && !j.reversalOf?.id && hasPermission('finance.journals.reverse') && <Button variant="ghost" icon={Undo2}
            onClick={async () => { const reason = await prompt({ title: t('finance.voucher.reverseTitle', { no: j.voucherNo }), label: t('finance.voucher.why'), required: true, confirmLabel: t('finance.voucher.reverse') }); if (reason) act.mutate({ fn: () => reverseJournal(j.id, { reason }), done: t('finance.voucher.reversed') }) }}>{t('finance.voucher.reverse')}</Button>}
        </div>
      </div>
      {editing && <VoucherForm journal={j} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done(t('finance.saved')) }} />}
    </Drawer>
  )
}
