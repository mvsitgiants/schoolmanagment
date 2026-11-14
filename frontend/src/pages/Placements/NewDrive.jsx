import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, History, Info, Rocket } from 'lucide-react'
import { FormPage, Note, Panel, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import { DriveFields, driveBody, driveFormValues, driveReady } from '../../components/placements/DriveForm'
import { DriveStatusPill, ctcRange, usePlacementLabels, usePlacementsMeta } from '../../components/placements/PlacementsKit'
import { fetchDrives, saveDrive } from '../../api/placements'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

/** One drive as a line: company or name, dates, status and how it went. */
function DriveLine({ d, showCompany = false }) {
  const { t } = useTranslation('placements')
  const { date } = useFormat()
  const when = d.startDate ? `${date(d.startDate)}${d.endDate && d.endDate !== d.startDate ? ` – ${date(d.endDate)}` : ''}` : null
  return (
    <li className="px-4 py-2.5 space-y-1">
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-ink truncate">{showCompany ? d.company?.name ?? d.title : d.title}</span>
        <DriveStatusPill status={d.status} />
      </span>
      <span className="block text-xs text-ink-muted">
        {[showCompany && d.title, when, (d.ctcMin || d.ctcMax) && ctcRange(d.ctcMin, d.ctcMax),
          d.counts?.registered ? t('placements.newDrive.history.outcome', { selected: d.counts.selected, count: d.counts.registered }) : null].filter(Boolean).join(' · ')}
      </span>
    </li>
  )
}

/** Right-hand panel: the company's earlier drives — how many registered, how many were picked, the package. */
function CompanyHistory({ companyId, drives }) {
  const { t } = useTranslation('placements')
  const { data: meta } = usePlacementsMeta()
  const company = (meta?.companies ?? []).find((c) => c.id === companyId)
  if (!companyId) {
    return (
      <Panel title={t('placements.newDrive.history.title')}>
        <p className="text-sm text-ink-muted">{t('placements.newDrive.history.pick')}</p>
      </Panel>
    )
  }
  const rows = drives.filter((d) => d.companyId === companyId)
  return (
    <SectionCard icon={History} title={t('placements.newDrive.history.with', { company: company?.name ?? '' })} count={rows.length || undefined} flush>
      {!rows.length ? <p className="px-4 py-3 text-sm text-ink-muted">{t('placements.newDrive.history.first')}</p> : (
        <ul className="divide-y divide-border">{rows.slice(0, 5).map((d) => <DriveLine key={d.id} d={d} />)}</ul>
      )}
    </SectionCard>
  )
}

/** Right-hand panel: other drives on the same days — two companies on campus at once is worth knowing early. */
function SameDays({ startDate, endDate, drives }) {
  const { t } = useTranslation('placements')
  if (!startDate) return null
  const end = endDate && endDate >= startDate ? endDate : startDate
  const rows = drives.filter((d) => d.status !== 'CANCELLED' && d.startDate && d.startDate <= end && (d.endDate || d.startDate) >= startDate)
  if (!rows.length) {
    return <Note icon={CalendarDays}>{t('placements.newDrive.sameDays.none')}</Note>
  }
  return (
    <SectionCard icon={CalendarDays} tone="warning" title={t('placements.newDrive.sameDays.title')} count={rows.length} flush>
      <ul className="divide-y divide-border">{rows.slice(0, 5).map((d) => <DriveLine key={d.id} d={d} showCompany />)}</ul>
    </SectionCard>
  )
}

/** Placements › New drive: a full page; the drive is saved as a draft and opens on the Drives page. */
export default function NewDrive() {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => driveFormValues(null, L))
  const [errors, setErrors] = useState({})
  // every drive once — the panels on the right filter it by company and by dates
  const { data } = useQuery({ queryKey: ['placements', 'drives', {}], queryFn: () => fetchDrives({}) })
  const drives = data?.data ?? []
  const save = useMutation({
    mutationFn: () => saveDrive(null, driveBody(form)),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['placements'] })
      showSuccess(t('placements.drives.saved'))
      navigate(`/placements/drives?drive=${d.id}`)
    },
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })

  return (
    <FormPage
      icon={Rocket} title={t('placements.driveForm.newTitle')} subtitle={t('placements.newDrive.subtitle')}
      headerActions={<Button to="/placements/drives" variant="secondary" icon={Rocket}>{t('placements.newDrive.allDrives')}</Button>}
      errors={errors}
      submitLabel={t('placements.newDrive.save')} submitIcon={Rocket} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={driveReady(form)}
      onCancel={() => navigate('/placements/drives')}
      aside={<>
        <CompanyHistory companyId={form.companyId} drives={drives} />
        <SameDays startDate={form.startDate} endDate={form.endDate} drives={drives} />
        <Note icon={Info}>{t('placements.newDrive.requiredNote')}</Note>
      </>}
    >
      <DriveFields value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
