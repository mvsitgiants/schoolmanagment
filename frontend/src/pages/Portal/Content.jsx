import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Save, Smartphone, X } from 'lucide-react'
import { FormField, Input, PageContainer, PageHeader, Panel, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAppContent, saveAppContent } from '../../api/family'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/** App content: the welcome line, how to reach the school and its office hours, shown to families. */
export default function PortalContent() {
  const { t } = useTranslation('portal')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['app-content'], queryFn: fetchAppContent })
  const [form, setForm] = useState(null)
  useEffect(() => { if (data) setForm({ welcome: data.welcome ?? '', help: data.help ?? '', contact: { phone: '', whatsapp: '', email: '', address: '', mapUrl: '', ...(data.contact ?? {}) }, timings: data.timings?.length ? data.timings : [{ label: '', hours: '' }] }) }, [data])
  const canEdit = hasPermission('portal.content.edit')
  const save = useMutation({
    mutationFn: () => saveAppContent(form),
    onSuccess: (d) => { qc.setQueryData(['app-content'], d); showSuccess(t('portal.content.saved')) },
    onError: (e) => showError(e.message),
  })
  const setC = (k) => (e) => setForm((f) => ({ ...f, contact: { ...f.contact, [k]: e.target.value } }))
  const setT = (i, k, v) => setForm((f) => ({ ...f, timings: f.timings.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))

  return (
    <PageContainer>
      <PageHeader icon={Smartphone} title={t('portal.content.title')} subtitle={t('portal.content.subtitle')}
        actions={canEdit && form && <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('portal.content.save')}</Button>} />
      {isLoading || !form ? <p className="text-sm text-ink-faint">{t('portal.loading')}</p> : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Panel title={t('portal.content.welcomeTitle')}>
            <div className="space-y-4">
              <FormField label={t('portal.content.welcome')} hint={t('portal.content.welcomeHint')}><Textarea rows={2} maxLength={300} disabled={!canEdit} value={form.welcome} onChange={(e) => setForm((f) => ({ ...f, welcome: e.target.value }))} /></FormField>
              <FormField label={t('portal.content.help')} hint={t('portal.content.helpHint')}><Textarea rows={4} maxLength={1000} disabled={!canEdit} value={form.help} onChange={(e) => setForm((f) => ({ ...f, help: e.target.value }))} /></FormField>
            </div>
          </Panel>
          <Panel title={t('portal.content.contactTitle')}>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label={t('portal.content.phone')}><Input disabled={!canEdit} value={form.contact.phone} onChange={setC('phone')} /></FormField>
              <FormField label={t('portal.content.whatsapp')}><Input disabled={!canEdit} value={form.contact.whatsapp} onChange={setC('whatsapp')} /></FormField>
              <div className="sm:col-span-2"><FormField label={t('portal.content.email')}><Input type="email" disabled={!canEdit} value={form.contact.email} onChange={setC('email')} /></FormField></div>
              <div className="sm:col-span-2"><FormField label={t('portal.content.address')} hint={t('portal.content.addressHint')}><Textarea rows={2} disabled={!canEdit} value={form.contact.address} onChange={setC('address')} /></FormField></div>
              <div className="sm:col-span-2"><FormField label={t('portal.content.mapUrl')}><Input disabled={!canEdit} value={form.contact.mapUrl} onChange={setC('mapUrl')} placeholder="https://maps.google.com/…" /></FormField></div>
            </div>
          </Panel>
          <Panel title={t('portal.content.timingsTitle')} subtitle={t('portal.content.timingsHint')}>
            <div className="space-y-2">
              {form.timings.map((x, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="flex-1" disabled={!canEdit} value={x.label} onChange={(e) => setT(i, 'label', e.target.value)} placeholder={t('portal.content.timingLabel')} />
                  <Input className="flex-1" disabled={!canEdit} value={x.hours} onChange={(e) => setT(i, 'hours', e.target.value)} placeholder={t('portal.content.timingHours')} />
                  {canEdit && <Button size="sm" variant="ghost" icon={X} aria-label={t('portal.content.remove')} onClick={() => setForm((f) => ({ ...f, timings: f.timings.filter((_, j) => j !== i) }))} />}
                </div>
              ))}
              {canEdit && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, timings: [...f.timings, { label: '', hours: '' }] }))}>{t('portal.content.addTiming')}</Button>}
            </div>
          </Panel>
        </div>
      )}
    </PageContainer>
  )
}
