import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { FileBadge, Printer } from 'lucide-react'
import { CERTIFICATE_KINDS, CERTIFICATE_PURPOSES, CERTIFICATE_STATUS, CONDUCT_OPTIONS, formatINR, recentFinancialYears } from '@schoolgiant/shared'
import { CodeBadge, DataTable, DateCell, FormField, Input, Note, PageContainer, PageHeader, Panel, Select, StatusPill, Textarea, localIso } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentPicker from '../../components/fees/StudentPicker'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchStudent, fetchStudents } from '../../api/students'
import { fetchCertificates, issueCertificates, previewCertificate } from '../../api/certificates'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { printDocument, printDocuments } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { KindChip } from './Register'

const purposeKey = (p) => p.replace(/[^A-Za-z0-9]/g, '')

/** Merit certificates: a class's students, ticked. */
function ManyStudents({ value, onChange }) {
  const { t } = useTranslation('certificates')
  const [sectionId, setSectionId] = useState('')
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const { data } = useQuery({ queryKey: ['students', 'cert-section', sectionId], queryFn: () => fetchStudents({ sectionId, status: 'ACTIVE', pageSize: 100 }), enabled: !!sectionId })
  const rows = data?.data ?? []
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="space-y-3">
      <FormField label={t('certificates.issue.class')}>
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">{t('certificates.issue.pickClass')}</option>
          {(lookup?.sections ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </FormField>
      {rows.length > 0 && (
        <div>
          <div className="flex justify-between text-xs text-ink-muted mb-1.5">
            <span>{t('certificates.issue.picked', { count: value.length })}</span>
            <button type="button" className="text-brand-600 hover:underline" onClick={() => onChange([...new Set([...value, ...rows.map((r) => r.id)])])}>{t('certificates.issue.pickAll')}</button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {rows.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                <span className="font-mono-num text-ink-faint w-8">{s.rollNo ?? ''}</span>
                <span className="flex-1">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** What the certificate will state, from the preview (nothing saved yet). */
function Preview({ kind, snap }) {
  const { t } = useTranslation('certificates')
  const { date } = useFormat()
  const rows = [
    [t('certificates.preview.name'), snap.name],
    [t('certificates.preview.admissionNo'), snap.admissionNo],
    [t('certificates.preview.class'), snap.class],
    [t('certificates.preview.parent'), snap.father || snap.mother],
    [t('certificates.preview.dob'), snap.dob && date(snap.dob)],
    kind === 'CHARACTER' && [t('certificates.preview.conduct'), snap.conduct],
    (kind === 'CHARACTER' || kind === 'STUDY') && [t('certificates.preview.from'), snap.from ? date(snap.from) : null],
    (kind === 'CHARACTER' || kind === 'STUDY') && [t('certificates.preview.to'), snap.to ? date(snap.to) : t('certificates.preview.tillDate')],
    kind === 'STUDY' && [t('certificates.preview.classes'), [snap.fromClass, snap.toClass].filter(Boolean).join(' → ')],
  ].filter((r) => r && r[1])
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-muted">{k}</dt>, <dd key={`v${k}`} className="text-ink font-medium">{v}</dd>])}
      </dl>
      {kind === 'FEE' && snap.fees && (
        <div className="rounded-lg border border-border p-3 text-sm space-y-1">
          {snap.fees.heads.map((h) => <div key={h.name} className="flex justify-between"><span>{h.name}</span><span className="font-mono-num">{formatINR(h.amount)}</span></div>)}
          {snap.fees.refunded > 0 && <div className="flex justify-between text-ink-muted"><span>{t('certificates.preview.refunded')}</span><span className="font-mono-num">− {formatINR(snap.fees.refunded)}</span></div>}
          <div className="flex justify-between font-semibold border-t border-border pt-1"><span>{t('certificates.preview.total', { fy: snap.fees.fy })}</span><span className="font-mono-num">{formatINR(snap.fees.total)}</span></div>
          <div className="flex justify-between text-ink-muted"><span>{t('certificates.preview.tuition')}</span><span className="font-mono-num">{formatINR(snap.fees.tuition)}</span></div>
        </div>
      )}
    </div>
  )
}

export default function Issue() {
  const { t } = useTranslation('certificates')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [params] = useSearchParams()
  const today = localIso(new Date())
  const enabled = new Set(getCurrentUser()?.enabledModules ?? [])
  const kinds = CERTIFICATE_KINDS.filter((k) => !k.needsModule || enabled.has(k.needsModule))
  const [kind, setKind] = useState('BONAFIDE')
  const [studentId, setStudentId] = useState(params.get('student') ?? '')
  const [picked, setPicked] = useState(null)
  const [many, setMany] = useState([])
  const [form, setForm] = useState({ purpose: '', purposeText: '', remarks: '', conduct: 'Good', fy: recentFinancialYears(today, 1)[0].label, event: '', achievement: '', eventDate: '', fromClass: '', toClass: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const def = kinds.find((k) => k.value === kind)
  const isMany = !!def?.many
  const ids = isMany ? many : studentId ? [studentId] : []
  const { data: preset } = useQuery({ queryKey: ['student', studentId, false], queryFn: () => fetchStudent(studentId), enabled: !!studentId && !picked })
  const purpose = form.purpose === 'Other' ? form.purposeText.trim() : form.purpose
  const body = useMemo(() => ({
    kind, studentIds: ids, purpose: purpose || undefined, remarks: form.remarks || undefined,
    ...(kind === 'CHARACTER' && { conduct: form.conduct }),
    ...(kind === 'STUDY' && { fromClass: form.fromClass || undefined, toClass: form.toClass || undefined }),
    ...(kind === 'FEE' && { fy: form.fy }),
    ...(kind === 'MERIT' && { event: form.event, achievement: form.achievement || undefined, eventDate: form.eventDate || undefined }),
  }), [kind, ids.join(), purpose, form]) // eslint-disable-line react-hooks/exhaustive-deps
  const previewBody = useDebouncedValue(JSON.stringify(body), 400)
  const canPreview = ids.length > 0 && (kind !== 'MERIT' || form.event.trim())
  const { data: snap, error: previewError, isFetching } = useQuery({
    queryKey: ['certificate-preview', previewBody], queryFn: () => previewCertificate(JSON.parse(previewBody)), enabled: canPreview && !isMany, retry: false,
  })
  const { data: history } = useQuery({ queryKey: ['certificates', 'student', studentId], queryFn: () => fetchCertificates({ studentId, pageSize: 20 }), enabled: !!studentId && !isMany })
  useEffect(() => { setMany([]) }, [kind])
  const issue = useMutation({
    mutationFn: () => issueCertificates(body),
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: ['certificates'] })
      showSuccess(r.created === 1 ? t('certificates.issue.issued', { no: r.numbers[0] }) : t('certificates.issue.issuedMany', { count: r.created }))
      if (hasPermission('certificates.issue.print')) {
        const res = r.ids.length === 1 ? { ok: await printDocument('CERTIFICATE', r.ids[0]) } : await printDocuments('CERTIFICATE', r.ids, { preparing: t('certificates.issue.preparing') })
        if (res?.error) showError(res.error)
      }
      if (isMany) setMany([])
    },
    onError: (e) => showError(e.message),
  })
  const presetRow = picked ?? (preset ? { id: preset.id, name: preset.name, classShort: preset.classShort, admissionNo: preset.admissionNo } : null)

  return (
    <PageContainer>
      <PageHeader icon={FileBadge} title={t('certificates.issue.title')} subtitle={t('certificates.issue.subtitle')} />
      <div className="grid lg:grid-cols-[1fr_24rem] gap-4 items-start">
        <div className="space-y-4">
          <Panel title={t('certificates.issue.which')}>
            <div className="grid sm:grid-cols-2 gap-2">
              {kinds.map((k) => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={clsx('text-start rounded-lg border p-3 transition-colors', kind === k.value ? 'border-brand-500 bg-brand-50' : 'border-border hover:bg-bg')}>
                  <p className="text-sm font-semibold text-ink">{t(`certificates.kinds.${k.value}.label`, k.label)}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{t(`certificates.kinds.${k.value}.hint`, k.hint)}</p>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title={isMany ? t('certificates.issue.students') : t('certificates.issue.student')}>
            {isMany ? <ManyStudents value={many} onChange={setMany} /> : (
              <div className="grid sm:grid-cols-2 gap-4">
                <StudentPicker value={studentId} onChange={(id, s) => { setStudentId(id); setPicked(s ?? null) }} preset={presetRow} />
              </div>
            )}
          </Panel>
          <Panel title={t('certificates.issue.details')}>
            <div className="grid sm:grid-cols-2 gap-4">
              {kind === 'CHARACTER' && <FormField label={t('certificates.issue.conduct')}>
                <Select value={form.conduct} onChange={set('conduct')}>{CONDUCT_OPTIONS.map((c) => <option key={c} value={c}>{t(`certificates.conducts.${purposeKey(c)}`, c)}</option>)}</Select>
              </FormField>}
              {kind === 'STUDY' && <>
                <FormField label={t('certificates.issue.fromClass')} hint={t('certificates.issue.classHint')}><Input value={form.fromClass} onChange={set('fromClass')} placeholder={snap?.fromClass ?? ''} /></FormField>
                <FormField label={t('certificates.issue.toClass')} hint={t('certificates.issue.classHint')}><Input value={form.toClass} onChange={set('toClass')} placeholder={snap?.toClass ?? ''} /></FormField>
              </>}
              {kind === 'FEE' && <FormField label={t('certificates.issue.fy')} required>
                <Select value={form.fy} onChange={set('fy')}>{recentFinancialYears(today, 4).map((f) => <option key={f.label} value={f.label}>{t('certificates.issue.fyLabel', { fy: f.label })}</option>)}</Select>
              </FormField>}
              {kind === 'MERIT' && <>
                <div className="sm:col-span-2"><FormField label={t('certificates.issue.event')} required><Input value={form.event} onChange={set('event')} placeholder={t('certificates.issue.eventPlaceholder')} /></FormField></div>
                <FormField label={t('certificates.issue.achievement')} hint={t('certificates.issue.achievementHint')}><Input value={form.achievement} onChange={set('achievement')} placeholder={t('certificates.issue.achievementPlaceholder')} /></FormField>
                <FormField label={t('certificates.issue.eventDate')}><Input type="date" value={form.eventDate} onChange={set('eventDate')} /></FormField>
              </>}
              {kind !== 'MERIT' && <FormField label={t('certificates.issue.purpose')}>
                <Select value={form.purpose} onChange={set('purpose')}>
                  <option value="">{t('certificates.issue.noPurpose')}</option>
                  {CERTIFICATE_PURPOSES.map((p) => <option key={p} value={p}>{t(`certificates.purposes.${purposeKey(p)}`, p)}</option>)}
                </Select>
              </FormField>}
              {form.purpose === 'Other' && kind !== 'MERIT' && <FormField label={t('certificates.issue.purposeText')}><Input value={form.purposeText} onChange={set('purposeText')} /></FormField>}
              <div className="sm:col-span-2"><FormField label={t('certificates.issue.remarks')} hint={t('certificates.issue.remarksHint')}><Textarea rows={2} value={form.remarks} onChange={set('remarks')} /></FormField></div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Panel title={t('certificates.preview.title')} subtitle={t(`certificates.kinds.${kind}.label`, def?.label)}>
            {isMany
              ? (ids.length ? <p className="text-sm text-ink">{t('certificates.preview.many', { count: ids.length, event: form.event || '—' })}</p> : <p className="text-sm text-ink-faint">{t('certificates.preview.pickStudents')}</p>)
              : !ids.length ? <p className="text-sm text-ink-faint">{t('certificates.preview.pickStudent')}</p>
                : previewError ? <Note tone="warning">{previewError.response?.data?.details?.fields ? Object.values(previewError.response.data.details.fields).join(' ') : previewError.message}</Note>
                  : snap ? <Preview kind={kind} snap={snap} /> : <p className="text-sm text-ink-faint">{isFetching ? t('certificates.loading') : ''}</p>}
            <Button className="w-full mt-4" icon={Printer} loading={issue.isPending}
              disabled={!hasPermission('certificates.issue.create') || !ids.length || (!isMany && (!snap || !!previewError)) || (kind === 'MERIT' && !form.event.trim())}
              onClick={() => issue.mutate()}>
              {isMany ? t('certificates.issue.issueMany', { count: ids.length }) : t('certificates.issue.issue')}
            </Button>
            <p className="text-xs text-ink-faint mt-2">{t('certificates.issue.numberHint')}</p>
          </Panel>
          {!isMany && studentId && (history?.data?.length ?? 0) > 0 && (
            <DataTable
              title={t('certificates.issue.earlier')}
              rows={history.data}
              dense
              columns={[
                { key: 'certificateNo', header: t('certificates.register.no'), render: (v) => <CodeBadge>{v}</CodeBadge> },
                { key: 'kindLabel', header: t('certificates.register.kind'), render: (v, r) => (
                  <span className="inline-flex flex-col items-start gap-1">
                    <KindChip kind={r.kind} label={t(`certificates.kinds.${r.kind}.label`, v)} />
                    <DateCell value={r.issueDate} className="text-[11.5px]" />
                  </span>
                ) },
                { key: 'status', header: '', render: (v) => <StatusPill tone={CERTIFICATE_STATUS[v]?.tone}>{t(`certificates.status.${v}`)}</StatusPill> },
                { key: 'id', header: '', align: 'right', width: 44, render: (id) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('certificates.register.print')} onClick={() => printDocument('CERTIFICATE', id)} /> },
              ]}
            />
          )}
        </div>
      </div>
    </PageContainer>
  )
}
