// Catalog icons are stored by name (packages/shared) — this maps names to components.
// Explicit imports keep the bundle small (no `import * as Icons`).
import {
  Award, BadgeCheck, BarChart3, BedDouble, BookMarked, Boxes, Briefcase, Bus, CalendarCheck, CalendarDays, ClipboardCheck,
  ConciergeBell, FileBadge, FolderOpen, FileQuestion, FileText, FlaskConical, Globe, GraduationCap, HandHeart, HeartPulse,
  IndianRupee, Landmark, LayoutDashboard, Library, ListChecks, Megaphone, MessageSquareHeart, MonitorPlay,
  NotebookPen, PartyPopper, Plug, School, ScrollText, Settings2, Smartphone, Sparkles, Square, SquareParking, UserPlus,
  UsersRound, Utensils, Wallet,
} from 'lucide-react'

const ICONS = {
  Award, BadgeCheck, BarChart3, BedDouble, BookMarked, Boxes, Briefcase, Bus, CalendarCheck, CalendarDays, ClipboardCheck,
  ConciergeBell, FileBadge, FolderOpen, FileQuestion, FileText, FlaskConical, Globe, GraduationCap, HandHeart, HeartPulse,
  IndianRupee, Landmark, LayoutDashboard, Library, ListChecks, Megaphone, MessageSquareHeart, MonitorPlay,
  NotebookPen, PartyPopper, Plug, School, ScrollText, Settings2, Smartphone, Sparkles, SquareParking, UserPlus,
  UsersRound, Utensils, Wallet,
}

export const iconFor = (name) => ICONS[name] || Square
