import { useTranslation } from 'react-i18next'
import { AlertTriangle, ClipboardList, HeartPulse, Ruler, Stethoscope, Syringe } from 'lucide-react'
import { BMI_BANDS, INCIDENT_SEVERITY, VISIT_OUTCOMES, bmiBand } from '@schoolgiant/shared'
import { StatusPill, Tag } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyHealth } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** The family app › Health: a read-only card — blood group, growth, allergies, vaccinations, recent sick-room visits. */
export default function FamilyHealth() {
  const { t } = useTranslation('health')
  const { slug, studentId } = useFamily()
  const { date, time } = useFormat()
  const { data: d, isLoading, error } = useFamilyQuery(['health'], () => familyHealth(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const band = d.latest?.bmi ? bmiBand(d.latest.bmi) : null
  const maxH = Math.max(1, ...d.growth.map((g) => g.heightCm ?? 0))
  return (
    <>
      <FCard title={t('health.family.card')}>
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 font-display text-xl font-bold text-rose-700">{d.bloodGroup ?? '—'}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-ink-muted">{t('health.family.bloodGroup')}</p>
            {d.latest ? (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                <Ruler className="h-4 w-4 text-ink-faint" />
                {[d.latest.heightCm && t('health.records.cm', { n: d.latest.heightCm }), d.latest.weightKg && t('health.records.kg', { n: d.latest.weightKg })].filter(Boolean).join(' · ')}
                {d.latest.bmi && <Tag size="xs" tone={BMI_BANDS[band]?.tone}>{t('health.family.bmi', { bmi: d.latest.bmi })}</Tag>}
              </p>
            ) : <p className="text-sm text-ink-faint">{t('health.family.noMeasure')}</p>}
            {d.latest && <p className="text-xs text-ink-faint">{t('health.family.measuredOn', { date: date(d.latest.date) })}</p>}
          </div>
        </div>
        {d.growth.length > 1 && (
          <div className="mt-4 flex items-end gap-2 overflow-x-auto">
            {d.growth.map((g) => (
              <div key={g.date} className="flex min-w-[40px] flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-ink-muted">{g.heightCm ?? '—'}</span>
                <span className="flex h-16 w-5 items-end overflow-hidden rounded bg-black/[0.05]"><span className="block w-full rounded bg-brand-500" style={{ height: `${((g.heightCm ?? 0) / maxH) * 100}%` }} /></span>
                <span className="text-[10px] text-ink-faint">{g.date.slice(2, 7)}</span>
              </div>
            ))}
          </div>
        )}
      </FCard>
      <FCard title={t('health.family.allergies')}>
        {d.allergies.length ? (
          <div className="flex flex-wrap gap-1.5">{d.allergies.map((a) => <Tag key={a} tone="danger" icon={AlertTriangle}>{a}</Tag>)}</div>
        ) : <p className="text-sm text-ink-muted">{t('health.family.noAllergies')}</p>}
        <p className="mt-3 text-xs text-ink-faint">{t('health.family.tellSchool')}</p>
      </FCard>
      <FCard title={t('health.family.vaccinations')}>
        {d.vaccinations.length ? (
          <div className="divide-y divide-border">
            {d.vaccinations.map((v, i) => (
              <div key={`${v.name}-${i}`} className="flex items-center gap-3 py-2">
                <Syringe className="h-5 w-5 shrink-0 text-success-600" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{v.name}</p>{v.dose && <p className="text-xs text-ink-muted">{t('health.records.doseN', { dose: v.dose })}</p>}</div>
                <span className="text-xs text-ink-muted">{v.date ? date(v.date) : '—'}</span>
              </div>
            ))}
          </div>
        ) : <FEmpty icon={Syringe} title={t('health.family.noVaccines')} />}
      </FCard>
      <FCard title={t('health.family.visits')}>
        {d.visits.length ? (
          <div className="divide-y divide-border">
            {d.visits.map((v) => (
              <div key={v.id} className="flex items-start gap-3 py-2.5">
                <Stethoscope className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t(`health.complaints.${v.complaint}`)}{v.tempC ? ` · ${Number(v.tempC).toFixed(1)}°C` : ''}</p>
                  <p className="text-xs text-ink-muted">{date(v.date)} · {time(v.inAt)}{v.outAt ? `–${time(v.outAt)}` : ''}</p>
                  {v.treatment && <p className="text-xs text-ink-muted break-words">{v.treatment}</p>}
                </div>
                <StatusPill tone={VISIT_OUTCOMES[v.outcome]?.tone}>{t(`health.outcomes.${v.outcome}`)}</StatusPill>
              </div>
            ))}
          </div>
        ) : <FEmpty icon={HeartPulse} title={t('health.family.noVisits')} />}
      </FCard>
      {d.incidents.length > 0 && (
        <FCard title={t('health.family.incidents')}>
          <div className="divide-y divide-border">
            {d.incidents.map((i) => (
              <div key={i.id} className="flex items-start gap-3 py-2.5">
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t(`health.incidentKinds.${i.kind}`)}{i.place ? ` · ${i.place}` : ''}</p>
                  <p className="text-xs text-ink-muted">{date(i.date)}</p>
                  {i.firstAid && <p className="text-xs text-ink-muted break-words">{t('health.family.firstAid', { text: i.firstAid })}</p>}
                </div>
                <Tag size="xs" tone={INCIDENT_SEVERITY[i.severity]?.tone}>{t(`health.severity.${i.severity}`)}</Tag>
              </div>
            ))}
          </div>
        </FCard>
      )}
    </>
  )
}
