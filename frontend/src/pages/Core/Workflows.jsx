import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trans, useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  GitPullRequestArrow,
  Inbox,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react'
import { APPROVAL_TYPE_BY, formatINR } from '@schoolgiant/shared'
import { EmptyState, FormField, Input, Note, PageContainer, PageHeader } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { fetchApprovalRules, saveApprovalRule } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const limitText = (t, limit, unit) =>
  limit === null || limit === undefined
    ? t('admin.workflows.noLimit')
    : t('admin.workflows.upTo', { value: unit === '%' ? `${limit}%` : formatINR(Number(limit) * 100) })

function RuleEditor({ type }) {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const canEdit = hasPermission('core.workflows.edit')

  const [form, setForm] = useState(type.rule)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    setForm(type.rule)
    setErrors({})
  }, [type.rule])

  const dirty = JSON.stringify(form) !== JSON.stringify(type.rule)

  const save = useMutation({
    mutationFn: () =>
      saveApprovalRule(type.type, {
        enabled: form.enabled,
        expiryHours: Number(form.expiryHours),
        steps: form.steps.map((s, i) => ({
          label: s.label?.trim() || `Step ${i + 1}`,
          roleIds: s.roleIds ?? [],
          minValue: i === 0 || s.minValue === '' || s.minValue === null ? null : Number(s.minValue),
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-rules'] })
      setErrors({})
      showSuccess(t('admin.workflows.saved', { name: typeLabel }))
    },
    onError: (e) => {
      setErrors(e.response?.data?.details?.fields ?? {})
      showError(e.message)
    },
  })

  const setStep = (i, patch) =>
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }))

  const roleName = (id) => type.approverRoles.find((r) => r.id === id)?.name
  const typeKey = type.type.replace(/\./g, '_')
  const typeLabel = t(`admin.workflows.types.${typeKey}.label`, { defaultValue: type.label })
  const typeHelp = t(`admin.workflows.types.${typeKey}.help`, { defaultValue: type.help })
  const limitKey = APPROVAL_TYPE_BY[type.type]?.limitKey
  const limitName = limitKey && type.limitLabel ? cl.limit({ key: limitKey, label: type.limitLabel }) : type.limitLabel

  return (
    <article className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden transition">
      {/* Rule Header Bar */}
      <div className="p-5 sm:p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <span
            className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              form.enabled
                ? 'bg-brand-50 text-brand-600 border border-brand-200'
                : 'bg-bg text-ink-faint border border-border'
            )}
          >
            <Workflow className="w-5 h-5" />
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-display text-base sm:text-lg font-bold text-ink">{typeLabel}</h2>
              <span
                className={clsx(
                  'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                  form.enabled
                    ? 'bg-success-50 text-success-700 border-success-200'
                    : 'bg-bg text-ink-faint border-border'
                )}
              >
                {form.enabled ? 'Active' : 'Off'}
              </span>
            </div>
            {typeHelp && (
              <p className="text-xs sm:text-sm text-ink-muted mt-1 leading-relaxed max-w-2xl">{typeHelp}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
          <span className="text-xs font-medium text-ink-muted">
            {form.enabled ? 'Approvals on' : 'Approvals off'}
          </span>
          {canEdit && (
            <Switch
              size="md"
              checked={form.enabled}
              onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              label={t('admin.workflows.approvalsOn')}
            />
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {/* Approver Eligibility Section */}
        <div className="rounded-xl border border-border/80 bg-bg/40 p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Eligible Approvers & Limits</span>
          </div>

          <p className="text-xs text-ink-muted leading-relaxed">
            <Trans
              t={t}
              i18nKey="admin.workflows.whoCanApprove"
              values={{ approver: type.approverText, limit: limitName?.toLowerCase() ?? '' }}
              components={{ b: <span className="font-semibold text-ink" /> }}
            />
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {type.approverRoles.length === 0 ? (
              <span className="text-xs text-danger-600 bg-danger-50 border border-danger-200 px-2.5 py-1 rounded-lg">
                {t('admin.workflows.noApprover', { approver: type.approverText })}
              </span>
            ) : (
              type.approverRoles.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-surface border border-border text-ink-muted"
                >
                  <span className="font-semibold text-ink">{r.name}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="text-brand-700 font-semibold">{limitText(t, r.limit, type.unit)}</span>
                </span>
              ))
            )}
          </div>
        </div>

        {/* Warning if Rule is Turned Off */}
        {!form.enabled ? (
          <Note tone="warning">{t('admin.workflows.offNote')}</Note>
        ) : (
          <>
            {/* Approval Steps Configuration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                    Approval Chain ({form.steps.length}/3 steps)
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Configure the sequential steps required before approval is granted.
                  </p>
                </div>

                {canEdit && form.steps.length < 3 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        steps: [...f.steps, { label: '', roleIds: [], minValue: '' }],
                      }))
                    }
                    className="text-xs"
                  >
                    {t('admin.workflows.addStep')}
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {form.steps.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border bg-surface p-4 sm:p-4.5 space-y-3.5 transition hover:border-brand-300"
                  >
                    {/* Step Title Row */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-lg bg-brand-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>

                        <Input
                          aria-label={t('admin.workflows.stepName')}
                          className="h-8 max-w-xs text-xs font-medium"
                          value={s.label ?? ''}
                          disabled={!canEdit}
                          placeholder={t('admin.workflows.stepNamePlaceholder')}
                          onChange={(e) => setStep(i, { label: e.target.value })}
                        />

                        {i === 0 ? (
                          <span className="text-xs text-ink-faint hidden sm:inline">
                            (Applies to all requests)
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-ink-muted">
                            <span>{t('admin.workflows.onlyAbove')}</span>
                            <Input
                              aria-label={t('admin.workflows.onlyAboveAria')}
                              type="number"
                              min="0"
                              className="h-8 w-24 text-xs font-bold"
                              value={s.minValue ?? ''}
                              disabled={!canEdit}
                              onChange={(e) => setStep(i, { minValue: e.target.value })}
                            />
                            <span className="font-bold text-ink">{type.unit}</span>
                          </div>
                        )}
                      </div>

                      {i > 0 && canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              steps: f.steps.filter((_, j) => j !== i),
                            }))
                          }
                          className="text-ink-faint hover:text-danger-600 transition p-1"
                          aria-label={t('admin.workflows.removeStep')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Step Approver Role Selector */}
                    <FormField
                      label={t('admin.workflows.whoDecides')}
                      hint={
                        s.roleIds?.length
                          ? t('admin.workflows.onlyRoles', {
                              roles: s.roleIds.map(roleName).filter(Boolean).join(t('admin.workflows.orSeparator')),
                            })
                          : t('admin.workflows.anyApprover')
                      }
                      error={errors[`steps.${i}.roleIds`] || errors[`steps.${i}.minValue`]}
                    >
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {type.approverRoles.map((r) => {
                          const on = s.roleIds?.includes(r.id)
                          return (
                            <button
                              key={r.id}
                              type="button"
                              disabled={!canEdit}
                              onClick={() =>
                                setStep(i, {
                                  roleIds: on
                                    ? s.roleIds.filter((x) => x !== r.id)
                                    : [...(s.roleIds ?? []), r.id],
                                })
                              }
                              className={clsx(
                                'text-xs px-3 py-1 rounded-full border transition font-medium',
                                on
                                  ? 'bg-brand-500 text-white border-brand-500 font-bold'
                                  : 'bg-surface border-border text-ink-muted hover:border-brand-400 hover:text-ink',
                                !canEdit && 'opacity-60 cursor-not-allowed'
                              )}
                            >
                              {r.name}
                            </button>
                          )
                        })}
                      </div>
                    </FormField>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeout & Expiry Hours */}
            <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <label className="block text-xs font-bold text-ink">
                  {type.mode === 'PERMIT'
                    ? t('admin.workflows.permitHours')
                    : t('admin.workflows.expiryHours')}
                </label>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  Unapproved requests automatically expire to prevent stale backlog.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  min="1"
                  max="168"
                  className="w-24 text-xs font-bold h-8"
                  value={form.expiryHours}
                  disabled={!canEdit}
                  onChange={(e) => setForm((f) => ({ ...f, expiryHours: e.target.value }))}
                />
                <span className="text-xs font-bold text-ink">hours</span>
              </div>
            </div>
          </>
        )}

        {/* Action Controls */}
        {canEdit && (
          <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
            <div className="text-xs text-ink-faint">
              {dirty ? (
                <span className="text-amber-600 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Unsaved changes
                </span>
              ) : (
                <span className="text-success-600 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Changes saved
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForm(type.rule)
                    setErrors({})
                  }}
                  className="text-xs"
                >
                  {t('admin.workflows.undoChanges')}
                </Button>
              )}

              <Button
                size="sm"
                icon={Check}
                disabled={!dirty}
                loading={save.isPending}
                onClick={() => save.mutate()}
                className="text-xs font-bold"
              >
                {t('admin.workflows.saveRule')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Administration › Workflows & approvals: who approves what.
 * Clean, standard SchoolGiant layout with enhanced rule cards and step builders.
 */
export default function Workflows() {
  const { t } = useTranslation('admin')
  const { data = [], isLoading } = useQuery({
    queryKey: ['approval-rules'],
    queryFn: fetchApprovalRules,
  })

  return (
    <PageContainer>
      <PageHeader
        icon={GitPullRequestArrow}
        title={t('admin.workflows.title')}
        subtitle={t('admin.workflows.subtitle')}
        actions={
          <Button to="/core/approvals" variant="secondary" icon={Inbox} className="text-xs sm:text-sm">
              Approvals Inbox
            </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-4 mt-6">
          <div className="h-44 rounded-2xl bg-black/5 animate-pulse" />
          <div className="h-44 rounded-2xl bg-black/5 animate-pulse" />
        </div>
      ) : data.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={GitPullRequestArrow}
            title={t('admin.workflows.emptyTitle')}
            hint={t('admin.workflows.emptyHint')}
          />
        </div>
      ) : (
        <div className="space-y-6 mt-6">
          {data.map((ty) => (
            <RuleEditor key={ty.type} type={ty} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
