import { BookOpenCheck, Bus, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, Images, GraduationCap, IndianRupee, Library, Megaphone, MessagesSquare, Trophy } from 'lucide-react'

/** The app's sections in order of use; the bar shows the first three the school has on (with Home and More), the rest are under More. */
export function familySections(slug, has, t) {
  return [
    has('ATTENDANCE') && { key: 'attendance', to: `/app/${slug}/attendance`, label: t('family.nav.attendance'), icon: CalendarCheck },
    has('HOMEWORK') && { key: 'homework', to: `/app/${slug}/homework`, label: t('family.nav.homework'), icon: BookOpenCheck },
    has('TESTS') && { key: 'tests', to: `/app/${slug}/tests`, label: t('family.nav.tests'), icon: ClipboardCheck },
    has('LEARNING') && { key: 'learning', to: `/app/${slug}/learning`, label: t('family.nav.learning'), icon: GraduationCap },
    has('BUS') && { key: 'bus', to: `/app/${slug}/bus`, label: t('family.nav.bus'), icon: Bus },
    has('LIBRARY') && { key: 'library', to: `/app/${slug}/library`, label: t('family.nav.library'), icon: Library },
    has('EVENTS') && { key: 'calendar', to: `/app/${slug}/calendar`, label: t('family.nav.calendar'), icon: CalendarDays },
    has('EVENTS') && { key: 'meetings', to: `/app/${slug}/meetings`, label: t('family.nav.meetings'), icon: CalendarClock },
    has('EVENTS') && { key: 'photos', to: `/app/${slug}/photos`, label: t('family.nav.photos'), icon: Images },
    has('NOTICES') && { key: 'notices', to: `/app/${slug}/notices`, label: t('family.nav.notices'), icon: Megaphone },
    has('CHAT') && { key: 'chat', to: `/app/${slug}/chat`, label: t('family.nav.chat'), icon: MessagesSquare },
    has('FEES') && { key: 'fees', to: `/app/${slug}/fees`, label: t('family.nav.fees'), icon: IndianRupee },
    has('RESULTS') && { key: 'results', to: `/app/${slug}/results`, label: t('family.nav.results'), icon: Trophy },
  ].filter(Boolean)
}
export const BAR_SLOTS = 3
