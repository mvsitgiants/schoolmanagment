import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookMarked, Link2, Printer, XCircle } from 'lucide-react'
import { CERTIFICATE_KINDS, CERTIFICATE_STATUS } from '@schoolgiant/shared'
import { DateInput, CodeBadge, ControlChip, DataTable, DateCell, PageContainer, PageHeader, PersonCell, StackCell, StatusPill, Toolbar, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { cancelCertificate, fetchCertificates } from '../../api/certificates'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { KindChip } from '../../components/certificates/CertificateKit'

/** Every certificate issued: reprint, copy its verify link, cancel one issued by mistake. */
export default function Register() {
  const { t } = useTranslation('certificates')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, kind: kind || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['certificates', params], queryFn: () => fetchCertificates(params), placeholderData: keepPreviousData })
  const cancel = useMutation({
    mutationFn: ({ id, reason }) => cancelCertificate(id, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['certificates'] }); showSuccess(t('certificates.register.cancelled')) },
    onError: (e) => showError(e.message),
  })
  const kindLabel = (k) => (k ? t(`certificates.kinds.${k}.label`, CERTIFICATE_KINDS.find((x) => x.value === k)?.label) : t('certificates.all'))
  const statusLabel = (s) => (s ? t(`certificates.status.${s}`, CERTIFICATE_STATUS[s]?.label) : t('certificates.all'))
  const KINDS = ['', ...CERTIFICATE_KINDS.map((k) => k.value)]
  const STATUSES = ['', 'ISSUED', 'CANCELLED']
  const meta = data?.meta
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); showSuccess(t('certificates.register.copied')) } catch { showError(url) }
  }

  return (
    <PageContainer>
      <PageHeader icon={BookMarked} title={t('certificates.register.title')} subtitle={meta ? t('certificates.register.count', { count: meta.total }) : t('certificates.register.subtitle')} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable={hasPermission('certificates.register.export')} exportName="certificate-register"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('certificates.register.search')} right={<>
          <DateInput className="w-36" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label={t('certificates.register.from')} />
          <DateInput className="w-36" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label={t('certificates.register.to')} />
          <ControlChip label={t('certificates.register.kind')} value={kindLabel(kind)} active={!!kind} options={KINDS.map(kindLabel)} onChange={(v) => { setKind(KINDS.find((k) => kindLabel(k) === v) ?? ''); setPage(1) }} />
          <ControlChip label={t('certificates.register.status')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />
        </>} />}
        columns={[
          { key: 'certificateNo', header: t('certificates.register.no'), nowrap: true, render: (v, r) => <CodeBadge tone={r.status === 'CANCELLED' ? 'neutral' : 'success'} className={r.status === 'CANCELLED' ? 'line-through' : undefined}>{v}</CodeBadge> },
          { key: 'issueDate', header: t('certificates.register.date'), nowrap: true, render: (v) => <DateCell value={v} /> },
          { key: 'kind', header: t('certificates.register.kind'), render: (v) => <KindChip kind={v} label={kindLabel(v)} /> },
          { key: 'name', header: t('certificates.register.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.class, r.admissionNo].filter(Boolean).join(' · ')} size={34} /> },
          { key: 'purpose', header: t('certificates.register.purpose'), mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{v || r.snapshot?.event || '—'}</span> },
          { key: 'issuedBy', header: t('certificates.register.by'), mobileHidden: true, render: (v, r) => <StackCell title={v} sub={r.prints > 1 ? t('certificates.register.prints', { count: r.prints }) : undefined} /> },
          { key: 'status', header: t('certificates.register.status'), render: (v, r) => <div><StatusPill tone={CERTIFICATE_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill>{r.cancelReason && <p className="text-xs text-ink-faint mt-0.5 line-clamp-1" title={r.cancelledAt ? dateTime(r.cancelledAt) : undefined}>{r.cancelReason}</p>}</div> },
          { key: 'id', header: '', align: 'right', width: 130, render: (id, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('certificates.issue.print') && <Button size="sm" variant="ghost" icon={Printer} title={t('certificates.register.print')} aria-label={t('certificates.register.print')} onClick={() => printDocument('CERTIFICATE', id)} />}
              <Button size="sm" variant="ghost" icon={Link2} title={t('certificates.register.copyLink')} aria-label={t('certificates.register.copyLink')} onClick={() => copy(r.verifyUrl)} />
              {hasPermission('certificates.register.cancel') && r.status === 'ISSUED' && <Button size="sm" variant="ghost" icon={XCircle} title={t('certificates.register.cancel')} aria-label={t('certificates.register.cancel')}
                onClick={async () => {
                  const reason = await prompt({ title: t('certificates.register.cancelConfirm.title', { no: r.certificateNo }), message: t('certificates.register.cancelConfirm.message'), label: t('certificates.register.cancelReason'), required: true })
                  if (reason) cancel.mutate({ id, reason })
                }} />}
            </div>
          ) },
        ]}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={BookMarked} emptyTitle={q || kind || status || from || to ? t('certificates.register.noMatch') : t('certificates.register.empty')}
      />
    </PageContainer>
  )
}
