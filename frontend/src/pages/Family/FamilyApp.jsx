import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Home as HomeIcon, Menu, School, Smartphone } from 'lucide-react'
import { ChildSwitcher, FSkeleton, FamilyContext, FamilyShell, useFamily } from '../../components/family/FamilyKit'
import { BAR_SLOTS, familySections } from '../../components/family/sections'
import { familyInfo, familyLogout, familyManifestUrl, familyMe } from '../../api/family'
import { applyBrandRamp } from '../../utils/brandRamp'
import { configureFormat } from '../../utils/format'
import FamilyLogin from './Login'
import FamilyHome from './Home'
import FamilyAttendance from './Attendance'
import FamilyHomework from './Homework'
import FamilyLearning from './Learning'
import FamilyTests from './Tests'
import FamilyBus from './Bus'
import FamilyLibrary from './Library'
import FamilyCalendar from './Calendar'
import FamilyMeetings from './Meetings'
import FamilyPhotos from './Photos'
import FamilyFees from './Fees'
import FamilyResults from './Results'
import FamilyMore from './More'
import FamilyNotices from './Notices'
import FamilyChat from './Chat'

const childKey = (slug) => `sg_family_child:${slug}`
const readChild = (slug) => { try { return localStorage.getItem(childKey(slug)) || '' } catch { return '' } }
const rememberChild = (slug, id) => { try { localStorage.setItem(childKey(slug), id) } catch { /* private mode */ } }

/** Point "Add to home screen" at this school's app: its own manifest, name and colour. */
function useInstallable(slug, school) {
  useEffect(() => {
    if (!school) return undefined
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = familyManifestUrl(slug)
    const theme = document.createElement('meta')
    theme.name = 'theme-color'
    theme.content = school.primaryColor || '#0E7C86'
    const apple = document.createElement('meta')
    apple.name = 'apple-mobile-web-app-capable'
    apple.content = 'yes'
    document.head.append(link, theme, apple)
    return () => { link.remove(); theme.remove(); apple.remove() }
  }, [slug, school])
}

/**
 * The parent & student app of one school (/app/:slug). Families sign in with the mobile number on the
 * student's record and an SMS code; a parent with several children at the school switches between them.
 */
export default function FamilyApp() {
  const { t } = useTranslation('family')
  const { slug } = useParams()
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['family-info', slug], queryFn: () => familyInfo(slug), retry: false, staleTime: 300_000 })
  const me = useQuery({ queryKey: ['family-me', slug], queryFn: () => familyMe(slug), retry: false, enabled: !!info.data })
  const [studentId, setStudentIdState] = useState(() => readChild(slug))
  const school = info.data?.school
  useInstallable(slug, school)

  useEffect(() => {
    if (!school) return undefined
    applyBrandRamp(school.primaryColor || null)
    configureFormat({ timezone: school.timezone })
    document.title = `${school.name} · ${t('family.title')}`
    return () => applyBrandRamp(null)
  }, [school, t])

  const value = useMemo(() => {
    const m = me.data
    const students = m?.students ?? []
    const picked = students.some((s) => s.id === studentId) ? studentId : students[0]?.id ?? ''
    const features = m?.features ?? info.data?.features ?? []
    return {
      slug, info: info.data, me: m, students, features, studentId: picked,
      student: students.find((s) => s.id === picked) ?? null,
      setStudentId: (id) => { setStudentIdState(id); rememberChild(slug, id) },
      has: (f) => features.includes(f),
      signedIn: (data) => qc.setQueryData(['family-me', slug], data),
      signOut: async () => {
        try { await familyLogout(slug) } catch { /* the session is gone either way */ }
        qc.removeQueries({ queryKey: ['family', slug] })
        qc.setQueryData(['family-me', slug], null)
      },
    }
  }, [slug, info.data, me.data, studentId, qc])

  if (info.isLoading) return <FamilyShell><FSkeleton className="h-20" /><FSkeleton className="h-64" /></FamilyShell>
  if (info.error || !info.data) {
    return (
      <FamilyShell>
        <div className="mt-16 rounded-2xl border border-border bg-surface p-6 text-center">
          <Smartphone className="w-10 h-10 mx-auto text-ink-faint" />
          <p className="mt-3 text-base font-semibold text-ink">{t('family.notAvailable')}</p>
          <p className="mt-1 text-sm text-ink-muted break-words">{info.error?.message ?? t('family.contactSchool')}</p>
        </div>
      </FamilyShell>
    )
  }
  const signedIn = me.data && !me.error
  return (
    <FamilyContext.Provider value={value}>
      <FamilyShell>
        <Header school={school} />
        {me.isLoading ? <FSkeleton className="h-64" /> : !signedIn ? <FamilyLogin /> : (
          <>
            <ChildSwitcher students={value.students} value={value.studentId} onChange={value.setStudentId} />
            <Routes>
              <Route index element={<FamilyHome />} />
              <Route path="attendance" element={<FamilyAttendance />} />
              <Route path="homework" element={<FamilyHomework />} />
              <Route path="learning" element={<FamilyLearning />} />
              <Route path="tests" element={<FamilyTests />} />
              <Route path="bus" element={<FamilyBus />} />
              <Route path="library" element={<FamilyLibrary />} />
              <Route path="calendar" element={<FamilyCalendar />} />
              <Route path="meetings" element={<FamilyMeetings />} />
              <Route path="photos" element={<FamilyPhotos />} />
              <Route path="fees" element={<FamilyFees />} />
              <Route path="results" element={<FamilyResults />} />
              <Route path="notices" element={<FamilyNotices />} />
              <Route path="chat" element={<FamilyChat />} />
              <Route path="more" element={<FamilyMore />} />
              <Route path="*" element={<FamilyHome />} />
            </Routes>
            <BottomNav />
          </>
        )}
      </FamilyShell>
    </FamilyContext.Provider>
  )
}

function Header({ school: s }) {
  const { t } = useTranslation('family')
  return (
    <header className="flex items-center gap-3 min-w-0">
      {s.logoUrl ? <img src={s.logoUrl} alt="" className="w-11 h-11 rounded-xl object-contain bg-surface border border-border" /> : <span className="w-11 h-11 rounded-xl bg-brand-500 flex items-center justify-center shrink-0"><School className="w-6 h-6 text-white" /></span>}
      <div className="min-w-0">
        <p className="font-display font-semibold text-lg text-ink leading-tight truncate">{s.name}</p>
        <p className="text-[13px] text-ink-muted truncate">{t('family.title')}{s.city ? ` · ${s.city}` : ''}</p>
      </div>
    </header>
  )
}

function BottomNav() {
  const { t } = useTranslation('family')
  const { slug, has } = useFamily()
  const items = [
    { to: `/app/${slug}`, end: true, label: t('family.nav.home'), icon: HomeIcon },
    ...familySections(slug, has, t).slice(0, BAR_SLOTS),
    { to: `/app/${slug}/more`, label: t('family.nav.more'), icon: Menu },
  ]
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label={t('family.nav.label')}>
      <div className="max-w-lg md:max-w-2xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => clsx('flex min-w-0 min-h-[60px] flex-col items-center justify-center gap-1 px-1 text-xs', isActive ? 'text-brand-600 font-semibold' : 'text-ink-muted font-medium hover:text-ink')}>
            <it.icon className="w-6 h-6 shrink-0" aria-hidden /><span className="max-w-full truncate">{it.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
