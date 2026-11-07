import { Info } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { FormField, Input, Note, Select } from '../system'
import { Switch } from '../app/Controls'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { moduleKeys } from './catalogUtils'
import { useFormat } from '../../context/SettingsContext'
import { getCurrentUser } from '../../api/auth'

const ALL = ['OWN', 'DEPARTMENT', 'WARD', 'BRANCH', 'ALL']

/**
 * Which records a role sees per module, money limits that send bigger actions to
 * approval, and session rules (docs/04 §4.4).
 */
export default function ScopeLimits({ catalog, selected, fullAccess, dataScopes, onScopes, limits, onLimits, security, onSecurity, readOnly }) {
  const { t } = useTranslation('admin')
  const { currencySymbol } = useFormat()
  const cl = useCatalogLabel()
  const labels = Object.fromEntries(Object.keys(catalog.scopeLabels ?? {}).map((s) => [s, cl.scope(s)]))
  const scoped = catalog.modules.filter((m) => m.enabled && m.scopes?.length && (fullAccess || moduleKeys(m).some((k) => selected.has(k))))
  const setScope = (mod, v) => onScopes({ ...dataScopes, [mod]: v || undefined })
  const def = dataScopes.default || 'BRANCH'

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-base font-semibold text-ink">{t('admin.scopeLimits.recordsTitle')}</h3>
        <p className="text-sm text-ink-muted mt-0.5"><Trans t={t} i18nKey="admin.scopeLimits.recordsIntro" components={{ em: <em /> }} /></p>
        {fullAccess ? (
          <Note className="mt-3">{t('admin.scopeLimits.fullAccessRecords')}</Note>
        ) : (
          <div className="mt-4 rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-bg/70 border-b border-border">
              <span className="flex-1 text-sm font-medium text-ink">{t('admin.scopeLimits.defaultForAll')}</span>
              <div className="w-48">
                <Select value={def} disabled={readOnly} onChange={(e) => onScopes({ ...dataScopes, default: e.target.value })}>
                  {['OWN', 'DEPARTMENT', 'BRANCH', 'ALL'].map((s) => <option key={s} value={s}>{labels[s]}</option>)}
                </Select>
              </div>
            </div>
            {scoped.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-faint">{t('admin.scopeLimits.tickFirst')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {scoped.map((m) => {
                  const Icon = iconFor(m.icon)
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                      <Icon className="w-4 h-4 text-ink-faint shrink-0" />
                      <span className="flex-1 text-sm text-ink">{cl.module(m)}</span>
                      <div className="w-48">
                        <Select value={dataScopes[m.id] || ''} disabled={readOnly} onChange={(e) => setScope(m.id, e.target.value)}>
                          <option value="">{t('admin.scopeLimits.defaultOption', { scope: labels[m.scopes.includes(def) ? def : m.scopes[m.scopes.length - 1]] })}</option>
                          {ALL.filter((s) => m.scopes.includes(s)).map((s) => <option key={s} value={s}>{labels[s]}</option>)}
                        </Select>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-faint flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> {t('admin.scopeLimits.fromProfile')}</p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink">{t('admin.scopeLimits.limitsTitle')}</h3>
        <p className="text-sm text-ink-muted mt-0.5">{t('admin.scopeLimits.limitsIntro')}</p>
        {fullAccess ? (
          <Note className="mt-3">{t('admin.scopeLimits.fullAccessLimits')}</Note>
        ) : catalog.limits.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{t('admin.scopeLimits.noLimitModules')}</p>
        ) : (
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            {catalog.limits.map((l) => (
              <FormField key={l.key} label={cl.limit(l)} hint={l.unit === '%' ? t('admin.scopeLimits.percentOfBill') : t('admin.scopeLimits.currencyAmount', 'Amount ({{cur}})', { cur: currencySymbol() })}>
                <div className="relative">
                  {l.unit === '₹' && <span className="absolute start-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">{currencySymbol()}</span>}
                  <Input type="number" min="0" max={l.unit === '%' ? 100 : undefined} disabled={readOnly}
                    className={l.unit === '₹' ? 'ps-7' : 'pe-8'}
                    value={limits[l.key] ?? ''} placeholder={t('admin.scopeLimits.noLimit')}
                    onChange={(e) => onLimits({ ...limits, [l.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  {l.unit === '%' && <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">%</span>}
                </div>
              </FormField>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink">{t('admin.scopeLimits.sessionTitle')}</h3>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <FormField label={t('admin.scopeLimits.idle')} hint={t('admin.scopeLimits.idleHint')}>
            <Select value={String(security.idleMinutes ?? '')} disabled={readOnly} onChange={(e) => onSecurity({ ...security, idleMinutes: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('admin.scopeLimits.idleDefault')}</option>
              {[10, 15, 30, 60, 120, 480].map((m) => <option key={m} value={m}>{m < 60 ? t('admin.scopeLimits.minutes', { count: m }) : t('admin.scopeLimits.hours', { count: m / 60 })}</option>)}
            </Select>
          </FormField>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink">{t('admin.scopeLimits.require2fa')}</p>
              <p className="text-xs text-ink-muted">{t('admin.scopeLimits.require2faHint')}</p>
              {security.require2fa && !getCurrentUser()?.features?.email && <p className="text-xs text-amber-600 mt-1">{t('admin.scopeLimits.require2faNoEmail')}</p>}
            </div>
            <Switch checked={!!security.require2fa} disabled={readOnly} onChange={(v) => onSecurity({ ...security, require2fa: v })} label={t('admin.scopeLimits.require2fa')} />
          </div>
        </div>
      </section>
    </div>
  )
}
