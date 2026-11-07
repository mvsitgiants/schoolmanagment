import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { PROMOTION_OUTCOMES } from '@schoolgiant/shared'
import { ControlChip, DataTable, Note, PageContainer, PageHeader, Select, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { fetchPromotion, runPromotion } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * Year end, one section at a time: each student is promoted, kept in the same class, passed out
 * or leaves; promoted and kept students go to a section of next year (set it up in Academic setup first).
 */
export default function Promotion() {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const sections = lookup?.sections ?? []
  const [fromId, setFromId] = useState('')
  const { data: p, isLoading } = useQuery({ queryKey: ['promotion', fromId], queryFn: () => fetchPromotion(fromId), enabled: !!fromId })
  const [decisions, setDecisions] = useState({})
  const [nextTo, setNextTo] = useState('')
  const [sameTo, setSameTo] = useState('')

  useEffect(() => {
    if (!p) return
    setNextTo(p.nextClass?.suggested ?? '')
    setSameTo(p.sameClass?.suggested ?? '')
    setDecisions(Object.fromEntries(p.students.map((s) => [s.id, p.nextClass ? 'PROMOTE' : 'PASS_OUT'])))
  }, [p])

  const counts = useMemo(() => Object.values(decisions).reduce((m, o) => ({ ...m, [o]: (m[o] ?? 0) + 1 }), {}), [decisions])
  const outcomeLabel = (v) => t(`students.promotion.outcomes.${v}`, PROMOTION_OUTCOMES.find((o) => o.value === v)?.label ?? v)
  const missingTarget = (counts.PROMOTE && !nextTo) || (counts.DETAIN && !sameTo)
  const run = useMutation({
    mutationFn: () => runPromotion({
      fromSectionId: fromId,
      decisions: Object.entries(decisions).map(([studentId, outcome]) => ({ studentId, outcome, toSectionId: outcome === 'PROMOTE' ? nextTo : outcome === 'DETAIN' ? sameTo : null })),
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['promotion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['academic-classes'] })
      showSuccess(t('students.promotion.done', { promoted: r.PROMOTE, detained: r.DETAIN, passed: r.PASS_OUT, left: r.LEAVE }))
    },
    onError: (e) => showError(e.message),
  })
  const canRun = hasPermission('students.promotion.promote')

  return (
    <PageContainer>
      <PageHeader icon={ArrowUpRight} title={t('students.promotion.title')} subtitle={t('students.promotion.subtitle')} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ControlChip label={t('students.promotion.from')} value={sections.find((s) => s.id === fromId)?.label ?? t('students.promotion.pick')} active={!!fromId}
          options={sections.map((s) => s.label)} onChange={(v) => setFromId(sections.find((s) => s.label === v)?.id ?? '')} />
        {p && <span className="text-sm text-ink-muted">{t('students.promotion.into', { year: p.toYear?.name ?? '—' })}</span>}
      </div>

      {!fromId && <Note>{t('students.promotion.intro')}</Note>}
      {p && !p.toYear && <Note tone="warning">{t('students.promotion.noNextYear', { year: p.from.yearName })}</Note>}
      {p && p.toYear && (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-1">{t('students.promotion.promoteInto')}</p>
              {p.nextClass?.sections.length
                ? <Select value={nextTo} onChange={(e) => setNextTo(e.target.value)}>{p.nextClass.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
                : <p className="text-sm text-ink-faint">{p.nextClass ? t('students.promotion.noSections', { name: p.nextClass.name, year: p.toYear.name }) : t('students.promotion.finalClass')}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-1">{t('students.promotion.detainInto')}</p>
              {p.sameClass.sections.length
                ? <Select value={sameTo} onChange={(e) => setSameTo(e.target.value)}>{p.sameClass.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
                : <p className="text-sm text-ink-faint">{t('students.promotion.noSections', { name: p.sameClass.name, year: p.toYear.name })}</p>}
            </div>
          </div>
          <DataTable
            rows={p.students}
            loading={isLoading}
            columns={[
              { key: 'rollNo', header: t('students.promotion.roll'), width: 70, render: (v) => v ?? '—' },
              { key: 'name', header: t('students.directory.student'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.admissionNo}</p></div> },
              { key: 'id', header: t('students.promotion.outcome'), width: 260, render: (id) => (
                <Select value={decisions[id] ?? ''} disabled={!canRun} onChange={(e) => setDecisions((d) => ({ ...d, [id]: e.target.value }))} aria-label={t('students.promotion.outcome')}>
                  {PROMOTION_OUTCOMES.filter((o) => o.value !== 'PROMOTE' || p.nextClass).map((o) => <option key={o.value} value={o.value}>{outcomeLabel(o.value)}</option>)}
                </Select>
              ) },
            ]}
            emptyIcon={ArrowUpRight} emptyTitle={t('students.promotion.empty', { section: p.from.label })}
          />
          {canRun && p.students.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-3 mt-4">
              <span className="text-sm text-ink-muted">{PROMOTION_OUTCOMES.filter((o) => counts[o.value]).map((o) => `${outcomeLabel(o.value)}: ${counts[o.value]}`).join(' · ')}</span>
              <Button icon={ArrowUpRight} loading={run.isPending} disabled={!!missingTarget}
                onClick={async () => { if (await confirm({ title: t('students.promotion.confirm.title', { section: p.from.label }), message: t('students.promotion.confirm.message', { year: p.toYear.name }), confirmLabel: t('students.promotion.run') })) run.mutate() }}>
                {t('students.promotion.run')}
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
