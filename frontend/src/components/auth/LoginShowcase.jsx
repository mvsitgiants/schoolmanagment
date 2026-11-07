import { useTranslation } from 'react-i18next'
import { CalendarCheck, ClipboardCheck, GraduationCap, IndianRupee, Megaphone, Smartphone } from 'lucide-react'
import { MODULES as CATALOG } from '@schoolgiant/shared'

// The sign-in page's left side: what SchoolGiant runs. Product screenshots join here once the
// Phase 1 screens exist (frontend/public/login/).
const MODULES = [
  { key: 'students', icon: GraduationCap, label: 'Students' },
  { key: 'attendance', icon: CalendarCheck, label: 'Attendance' },
  { key: 'exams', icon: ClipboardCheck, label: 'Exams & report cards' },
  { key: 'fees', icon: IndianRupee, label: 'Fees' },
  { key: 'communication', icon: Megaphone, label: 'Notices & messages' },
  { key: 'portal', icon: Smartphone, label: 'Parent app' },
]

/** Light tiles naming the main modules. */
export function KeyModules() {
  const { t } = useTranslation('common')
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800 mb-3">{t('auth.showcase.keyModules', 'Key modules')}</p>
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
        {MODULES.map(({ key, icon: Icon, label }) => (
          <div key={key} className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-brand-50/70 ring-1 ring-brand-100 py-4 px-2 hover:bg-brand-50 hover:-translate-y-0.5 transition-all">
            <span className="w-10 h-10 rounded-xl bg-white ring-1 ring-brand-200 flex items-center justify-center">
              <Icon className="w-5 h-5 text-brand-600" strokeWidth={1.75} />
            </span>
            <span className="text-xs text-slate-600 text-center">{t(`auth.showcase.modules.${key}`, label)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-slate-400">{t('auth.showcase.more', { count: CATALOG.length - MODULES.length, defaultValue: '…and {{count}} more, from timetable and transport to hostel, placements and accreditation.' })}</p>
    </div>
  )
}
