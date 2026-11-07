// Catalog icons are stored by name (packages/shared) — this maps names to components.
// Explicit imports keep the bundle small (no `import * as Icons`).
import {
  BadgeCheck, BarChart3, BedDouble, BookMarked, Boxes, Briefcase, Bus, CalendarCheck, CalendarDays, ClipboardCheck,
  ConciergeBell, FileBadge, FileQuestion, FileText, FlaskConical, Globe, GraduationCap, HandHeart, HeartPulse,
  IndianRupee, Landmark, LayoutDashboard, Library, ListChecks, Megaphone, MessageSquareHeart, MonitorPlay,
  NotebookPen, PartyPopper, Plug, School, ScrollText, Settings2, Smartphone, Sparkles, Square, UserPlus,
  UsersRound, Utensils, Wallet,
} from 'lucide-react'

const ICONS = {
  BadgeCheck, BarChart3, BedDouble, BookMarked, Boxes, Briefcase, Bus, CalendarCheck, CalendarDays, ClipboardCheck,
  ConciergeBell, FileBadge, FileQuestion, FileText, FlaskConical, Globe, GraduationCap, HandHeart, HeartPulse,
  IndianRupee, Landmark, LayoutDashboard, Library, ListChecks, Megaphone, MessageSquareHeart, MonitorPlay,
  NotebookPen, PartyPopper, Plug, School, ScrollText, Settings2, Smartphone, Sparkles, UserPlus,
  UsersRound, Utensils, Wallet,
}

export const iconFor = (name) => ICONS[name] || Square
