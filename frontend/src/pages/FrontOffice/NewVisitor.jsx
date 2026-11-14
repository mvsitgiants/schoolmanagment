import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, ConciergeBell, DoorOpen, History, ListChecks } from 'lucide-react'
import { FO_ID_TYPES, FO_VISIT_PURPOSES, foDurationLabel } from '@schoolgiant/shared'
import { CodeBadge, FormField, FormPage, FormSection, Input, Note, Panel, PersonCell, SectionCard, Select, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { ChipPicker, Face, PhotoCapture, PurposeChip, StaffSelect, StudentFinder, useFoLabels } from '../../components/frontoffice/FoKit'
import { checkInVisitor, fetchVisitorDesk, fetchVisitors, lookupVisitor } from '../../api/frontOffice'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const EMPTY = { name: '', mobile: '', purpose: 'MEET_STAFF', purposeNote: '', from: '', people: 1, hostId: '', student: null, idType: '', idNumber: '', photo: '', badgeNo: '', vehicleNo: '', note: '' }
const GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'
const digits = (v) => String(v ?? '').replace(/\D/g, '')
const LONG_AGO = '2000-01-01'

/**
 * Right-hand panel: earlier visits on this mobile number (a returning visitor, or one still inside who never checked out).
 * The log is searched by the last five digits (numbers are saved with or without spaces) and matched in full here.
 */
function EarlierVisits({ mobile, today }) {
  const { t } = useTranslation('frontoffice')
  const { date } = useFormat()
  const ten = useDebouncedValue(digits(mobile).slice(-10), 350)
  const ready = ten.length === 10 && !!today
  const { data, isFetching } = useQuery({
    queryKey: ['frontoffice', 'visitors', 'earlier', ten],
    queryFn: () => fetchVisitors({ from: LONG_AGO, to: today, search: ten.slice(-5), pageSize: 25 }),
    enabled: ready,
    placeholderData: keepPreviousData,
  })
  const rows = ready ? (data?.rows ?? []).filter((v) => digits(v.mobile).endsWith(ten)).slice(0, 5) : []
  const inside = rows.find((v) => v.inside)

  if (!rows.length) {
    return (
      <Panel title={t('frontoffice.visitors.add.earlier.title')}>
        <p className="text-sm text-ink-muted">{!ready ? t('frontoffice.visitors.add.earlier.empty') : isFetching ? t('frontoffice.visitors.add.earlier.checking') : t('frontoffice.visitors.add.earlier.first')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={History} tone={inside ? 'warning' : 'brand'} title={t('frontoffice.visitors.add.earlier.title')} count={rows.length} flush>
      {inside && <Note tone="warning" className="mx-4 mt-3">{t('frontoffice.visitors.add.earlier.stillInside', { badge: inside.badgeNo ?? '—' })}</Note>}
      <ul className="divide-y divide-border">
        {rows.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <PersonCell name={v.name} sub={[date(v.date), v.hostName ? t('frontoffice.visitors.meeting', { name: v.hostName }) : v.studentName ?? v.from].filter(Boolean).join(' · ')} size={32} />
            {v.inside ? <StatusPill tone="warning">{t('frontoffice.visitors.inside')}</StatusPill> : <PurposeChip value={v.purpose} />}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Right-hand panel: who is in the building now, with the badge each one holds (so a badge is not handed out twice). */
function InsideNow({ rows }) {
  const { t } = useTranslation('frontoffice')
  if (!rows.length) {
    return (
      <Panel title={t('frontoffice.visitors.insideTitle')} icon={DoorOpen}>
        <p className="text-sm text-ink-muted">{t('frontoffice.visitors.nobodyInside')}</p>
      </Panel>
    )
  }
  const shown = rows.slice(0, 6)
  return (
    <SectionCard icon={DoorOpen} title={t('frontoffice.visitors.insideTitle')} count={rows.length} flush>
      <ul className="divide-y divide-border">
        {shown.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-4 py-2">
            <Face photo={v.photo} name={v.name} size={32} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-ink">{v.name}</span>
              <span className="block truncate text-[11.5px] text-ink-faint">{[v.hostName && t('frontoffice.visitors.meeting', { name: v.hostName }), foDurationLabel(v.minutes)].filter(Boolean).join(' · ')}</span>
            </span>
            <CodeBadge>{v.badgeNo ?? '—'}</CodeBadge>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <p className="px-4 py-2 text-xs text-ink-faint">{t('frontoffice.visitors.add.inside.more', { count: rows.length - shown.length })}</p>}
    </SectionCard>
  )
}

/** Front office › Visitor log › Check in: the mobile number first (a returning visitor fills in), then purpose and whom to meet. */
export default function NewVisitor() {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [known, setKnown] = useState(null)
  const looked = useRef('')
  const { data: desk } = useQuery({ queryKey: ['frontoffice', 'visitors', 'desk'], queryFn: fetchVisitorDesk, refetchInterval: 60_000 })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  // a returning visitor: fill the name, where from and ID from the last visit (once per number, as soon as it is complete)
  const lookup = async (mobile) => {
    const ten = digits(mobile)
    if (ten.length < 10 || looked.current === ten) return
    looked.current = ten
    try {
      const v = await lookupVisitor(mobile)
      setKnown(v)
      if (v) setF((x) => ({ ...x, name: x.name || v.name, from: x.from || v.from || '', idType: x.idType || v.idType || '', idNumber: x.idNumber || v.idNumber || '' }))
    } catch { /* a lookup is only a help */ }
  }
  const onMobile = (e) => {
    const value = e.target.value
    set('mobile', value)
    if (digits(value).length < 10) setKnown(null)
    else lookup(value)
  }

  const save = useMutation({
    mutationFn: () => checkInVisitor({
      name: f.name, mobile: f.mobile, purpose: f.purpose, purposeNote: f.purposeNote, from: f.from, people: Number(f.people) || 1,
      hostId: f.hostId || undefined, studentId: f.student?.id, idType: f.idType, idNumber: f.idNumber, photo: f.photo, badgeNo: f.badgeNo, vehicleNo: f.vehicleNo, note: f.note,
    }),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['frontoffice', 'visitors'] })
      showSuccess(t('frontoffice.visitors.checkedIn', { name: v.name, badge: v.badgeNo }))
      navigate('/frontoffice/visitors')
    },
    onError: (e) => { setErrors(e?.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const needsHost = ['MEET_STAFF', 'PARENT_MEETING'].includes(f.purpose)
  const ready = f.name.trim().length >= 2 && (f.purpose !== 'MEET_STAFF' || !!f.hostId)

  return (
    <FormPage
      icon={ConciergeBell} title={t('frontoffice.visitors.checkInTitle')} subtitle={t('frontoffice.visitors.checkInSubtitle')}
      headerActions={<Button to="/frontoffice/visitors" variant="secondary" icon={ListChecks}>{t('frontoffice.visitors.add.log')}</Button>}
      errors={errors}
      submitLabel={t('frontoffice.visitors.checkIn')} submitIcon={BadgeCheck} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={ready}
      onCancel={() => navigate('/frontoffice/visitors')}
      aside={<>
        <EarlierVisits mobile={f.mobile} today={desk?.date} />
        <InsideNow rows={desk?.inside ?? []} />
        <Note icon={BadgeCheck}>{t('frontoffice.visitors.add.requiredNote')}</Note>
      </>}
    >
      <FormSection title={t('frontoffice.visitors.add.who')} hint={t('frontoffice.visitors.add.whoHint')}>
        <div className="space-y-4">
          <div className={GRID}>
            <FormField label={t('frontoffice.visitors.mobile')} error={errors.mobile} hint={known ? t('frontoffice.visitors.knownVisitor', { count: known.visits, date: date(known.lastDate) }) : undefined}>
              <Input autoFocus inputMode="tel" value={f.mobile} onChange={onMobile} onBlur={() => lookup(f.mobile)} placeholder={t('frontoffice.visitors.mobilePlaceholder')} />
            </FormField>
            <div className="sm:col-span-2"><FormField label={t('frontoffice.visitors.name')} required error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></FormField></div>
            <FormField label={t('frontoffice.visitors.badge')} hint={t('frontoffice.visitors.badgeHint')} error={errors.badgeNo}><Input value={f.badgeNo} onChange={(e) => set('badgeNo', e.target.value)} /></FormField>
          </div>
          <ChipPicker label={t('frontoffice.visitors.purpose')} required options={FO_VISIT_PURPOSES.map((p) => ({ value: p.value, label: L.purpose(p.value) }))} value={f.purpose} onChange={(v) => set('purpose', v)} />
          {f.purpose === 'ADMISSION_ENQUIRY' && <Note tone="info">{t('frontoffice.visitors.enquiryHint')}</Note>}
          {(needsHost || f.purpose === 'OTHER' || f.purpose === 'VENDOR') && (
            <div className={GRID}>
              {needsHost && <div className="sm:col-span-2"><StaffSelect label={t('frontoffice.visitors.host')} required={f.purpose === 'MEET_STAFF'} error={errors.hostId} value={f.hostId} onChange={(v) => set('hostId', v)} /></div>}
              {f.purpose === 'PARENT_MEETING' && <div className="sm:col-span-2"><StudentFinder label={t('frontoffice.visitors.parentOf')} value={f.student} onChange={(s) => set('student', s)} /></div>}
              {(f.purpose === 'OTHER' || f.purpose === 'VENDOR') && <div className="sm:col-span-2"><FormField label={t('frontoffice.visitors.purposeNote')}><Input value={f.purposeNote} onChange={(e) => set('purposeNote', e.target.value)} /></FormField></div>}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title={t('frontoffice.visitors.add.more')} hint={t('frontoffice.visitors.add.moreHint')}>
        <div className="space-y-4">
          <div className={GRID}>
            <div className="sm:col-span-2"><FormField label={t('frontoffice.visitors.from')}><Input value={f.from} onChange={(e) => set('from', e.target.value)} placeholder={t('frontoffice.visitors.fromPlaceholder')} /></FormField></div>
            <FormField label={t('frontoffice.visitors.people')}><Input type="number" min={1} max={50} value={f.people} onChange={(e) => set('people', e.target.value)} /></FormField>
            <FormField label={t('frontoffice.visitors.vehicle')}><Input value={f.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())} /></FormField>
            <FormField label={t('frontoffice.visitors.idType')}>
              <Select value={f.idType} onChange={(e) => set('idType', e.target.value)}><option value="">{t('frontoffice.visitors.noId')}</option>{FO_ID_TYPES.map((x) => <option key={x.value} value={x.value}>{L.idType(x.value)}</option>)}</Select>
            </FormField>
            <FormField label={t('frontoffice.visitors.idNumber')}><Input value={f.idNumber} onChange={(e) => set('idNumber', e.target.value)} disabled={!f.idType} /></FormField>
            <div className="sm:col-span-2"><PhotoCapture value={f.photo} onChange={(v) => set('photo', v)} label={t('frontoffice.visitors.photo')} /></div>
            <div className="sm:col-span-2 xl:col-span-4"><FormField label={t('frontoffice.visitors.note')}><Textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} /></FormField></div>
          </div>
        </div>
      </FormSection>
    </FormPage>
  )
}
