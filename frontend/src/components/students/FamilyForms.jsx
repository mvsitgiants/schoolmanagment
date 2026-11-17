import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileText, Inbox, Mail, MessageCircle, Paperclip, RefreshCw, Send, Smartphone, X } from 'lucide-react'
import { ADMISSION_FORM_STATUS } from '@schoolgiant/shared'
import { FormField, Input, Modal, Note, Panel, Select, StatusPill, useConfirm } from '../system'
import Button from '../ui/Button'
import { cancelAdmissionForm, fetchAdmissionForms, resendAdmissionForm, sendAdmissionForm } from '../../api/students'
import { fetchAcademicLookup } from '../../api/academics'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// New admission › Send form to family: the office sends a link by SMS / WhatsApp / email (or copies it to share
// itself); the family fills the form and adds documents on their phone. Forms they send back wait in the panel on
// New admission until someone opens one, checks it and admits.

const CHANNELS = [
  { value: 'WHATSAPP', icon: MessageCircle, needs: 'mobile' },
  { value: 'SMS', icon: Smartphone, needs: 'mobile' },
  { value: 'EMAIL', icon: Mail, needs: 'email' },
]
const digits = (v) => String(v ?? '').replace(/\D/g, '')

function CopyLink({ link }) {
  const { t } = useTranslation('students')
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(link); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ } }
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
      <Button variant="secondary" icon={done ? Check : Copy} onClick={copy}>{done ? t('students.familyForm.copied') : t('students.familyForm.copy')}</Button>
    </div>
  )
}

/** What happened on each channel, in plain words (sent, on its way, or why not). */
function SendResult({ result }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  return (
    <div className="space-y-4">
      <Note tone="success" icon={Send}>{t('students.familyForm.sentNote', { date: date(result.form.expiresOn) })}</Note>
      {result.messages.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.messages.map((m) => (
            <li key={m.channel} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-24 text-ink-muted">{t(`students.familyForm.channel.${m.channel}`)}</span>
              <span className="flex-1 min-w-0 text-ink">{m.to}</span>
              <StatusPill tone={m.status === 'FAILED' || m.status === 'SKIPPED' ? 'warning' : 'success'}>{t(`students.familyForm.msg.${m.status}`, m.status)}</StatusPill>
              {m.reason && <span className="basis-full text-xs text-ink-faint ps-24">{m.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      <FormField label={t('students.familyForm.link')} hint={t('students.familyForm.linkHint')}><CopyLink link={result.link} /></FormField>
    </div>
  )
}

/**
 * Send a new form (`prefill`: what the office already typed on New admission) or send an existing one again (`form`).
 */
export function SendFormModal({ onClose, prefill = {}, form }) {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup, enabled: !form })
  const [v, setV] = useState(() => ({
    childName: prefill.childName ?? '', parentName: prefill.parentName ?? '', mobile: form?.mobile ?? prefill.mobile ?? '', email: form?.email ?? prefill.email ?? '',
    sectionId: prefill.sectionId ?? '', channels: null, // null = worked out from the contact given
  }))
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
  const hasMobile = digits(v.mobile).length >= 10
  const hasEmail = /\S+@\S+\.\S+/.test(v.email)
  const channels = v.channels ?? CHANNELS.filter((c) => (c.needs === 'mobile' ? hasMobile : hasEmail)).map((c) => c.value)
  const toggle = (ch) => setV((x) => ({ ...x, channels: channels.includes(ch) ? channels.filter((c) => c !== ch) : [...channels, ch] }))
  const usable = (c) => (c.needs === 'mobile' ? hasMobile : hasEmail)
  const chosen = channels.filter((ch) => usable(CHANNELS.find((c) => c.value === ch)))

  const groups = useMemo(() => {
    const byClass = new Map()
    for (const s of lookup?.sections ?? []) {
      const c = lookup.classes.find((x) => x.id === s.classId)
      if (!byClass.has(s.classId)) byClass.set(s.classId, { name: c?.name ?? '', items: [] })
      byClass.get(s.classId).items.push(s)
    }
    return [...byClass.values()]
  }, [lookup])

  const send = useMutation({
    mutationFn: () => (form
      ? resendAdmissionForm(form.id, { channels: chosen, mobile: v.mobile, email: v.email })
      : sendAdmissionForm({ ...v, channels: chosen })),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['admission-forms'] }) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  return (
    <Modal open onClose={onClose} size="lg" title={form ? t('students.familyForm.resendTitle', { name: form.childName || form.parentName }) : t('students.familyForm.title')}
      footer={result ? <Button onClick={onClose}>{t('students.familyForm.done')}</Button> : <>
        <Button variant="secondary" onClick={onClose}>{t('students.familyForm.cancel')}</Button>
        <Button icon={chosen.length ? Send : Copy} loading={send.isPending} onClick={() => send.mutate()}>{chosen.length ? t('students.familyForm.send') : t('students.familyForm.makeLink')}</Button>
      </>}>
      {result ? <SendResult result={result} /> : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">{t('students.familyForm.intro')}</p>
          {!form && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t('students.familyForm.childName')} error={errors.childName}><Input value={v.childName} onChange={set('childName')} /></FormField>
              <FormField label={t('students.familyForm.parentName')} error={errors.parentName}><Input value={v.parentName} onChange={set('parentName')} /></FormField>
              <div className="sm:col-span-2">
                <FormField label={t('students.form.section')} hint={t('students.familyForm.sectionHint')} error={errors.sectionId}>
                  <Select value={v.sectionId} onChange={set('sectionId')}>
                    <option value="">{t('students.familyForm.noSection')}</option>
                    {groups.map((g) => <optgroup key={g.name} label={g.name}>{g.items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>)}
                  </Select>
                </FormField>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('students.familyForm.mobile')} error={errors.mobile}><Input value={v.mobile} onChange={set('mobile')} inputMode="tel" placeholder="98450 12345" /></FormField>
            <FormField label={t('students.familyForm.email')} error={errors.email}><Input type="email" value={v.email} onChange={set('email')} /></FormField>
          </div>
          <FormField label={t('students.familyForm.sendBy')} hint={t('students.familyForm.sendByHint')}>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => {
                const on = chosen.includes(c.value)
                const Icon = c.icon
                return (
                  <button key={c.value} type="button" disabled={!usable(c)} onClick={() => toggle(c.value)} aria-pressed={on}
                    className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm transition-colors disabled:opacity-40 ${on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-border text-ink-muted hover:bg-black/[0.03]'}`}>
                    <Icon className="w-4 h-4" />{t(`students.familyForm.channel.${c.value}`)}{on && <Check className="w-3.5 h-3.5" />}
                  </button>
                )
              })}
            </div>
          </FormField>
        </div>
      )}
    </Modal>
  )
}

/** Right-hand panel on New admission: forms families have filled (open one to admit) and links still waiting. */
export function FamilyFormsPanel({ onOpen, openId }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [resend, setResend] = useState(null)
  const { data: forms = [] } = useQuery({ queryKey: ['admission-forms'], queryFn: () => fetchAdmissionForms() })
  const cancel = useMutation({
    mutationFn: (id) => cancelAdmissionForm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admission-forms'] }); showSuccess(t('students.familyForm.cancelled')) },
    onError: (e) => showError(e.message),
  })
  if (!forms.length) return null
  const filled = forms.filter((f) => f.status === 'SUBMITTED')
  const waiting = forms.filter((f) => f.status !== 'SUBMITTED')
  const row = (f) => (
    <li key={f.id} className={`px-4 py-2.5 ${openId === f.id ? 'bg-brand-50/60' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{f.childName || f.parentName || f.mobile || f.email}</span>
          <span className="block truncate text-[11px] text-ink-faint">
            {[f.classLabel, f.status === 'SUBMITTED' ? t('students.familyForm.filledOn', { date: date(f.submittedAt) }) : t('students.familyForm.sentOn', { date: date(f.sentAt) }), f.fileCount ? t('students.familyForm.files', { count: f.fileCount }) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <StatusPill tone={ADMISSION_FORM_STATUS[f.status]?.tone}>{t(`students.familyForm.status.${f.status}`)}</StatusPill>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1 -ms-2">
        {f.status === 'SUBMITTED' && <Button size="sm" variant="ghost" icon={FileText} onClick={() => onOpen(f)}>{openId === f.id ? t('students.familyForm.opened') : t('students.familyForm.open')}</Button>}
        {f.status !== 'SUBMITTED' && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setResend(f)}>{t('students.familyForm.sendAgain')}</Button>}
        <Button size="sm" variant="ghost" icon={X} onClick={async () => { if (await confirm({ title: t('students.familyForm.cancelTitle'), message: t('students.familyForm.cancelMessage'), confirmLabel: t('students.familyForm.cancelConfirm'), tone: 'danger' })) cancel.mutate(f.id) }}>{t('students.familyForm.close')}</Button>
      </div>
    </li>
  )
  return (
    <>
      <Panel title={t('students.familyForm.panelTitle')} icon={Inbox} flush>
        {filled.length > 0 && <ul className="divide-y divide-border">{filled.map(row)}</ul>}
        {waiting.length > 0 && (
          <>
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint flex items-center gap-1.5"><Paperclip className="w-3 h-3" />{t('students.familyForm.waiting', { count: waiting.length })}</p>
            <ul className="divide-y divide-border">{waiting.map(row)}</ul>
          </>
        )}
      </Panel>
      {resend && <SendFormModal form={resend} onClose={() => setResend(null)} />}
    </>
  )
}
