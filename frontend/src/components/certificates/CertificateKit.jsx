import { BadgeCheck, BookOpen, HandHeart, ReceiptIndianRupee, Trophy } from 'lucide-react'
import { ColorChip } from '../system'

// each kind's icon and colour, here and on the issue screen
const KIND_LOOK = {
  BONAFIDE: { icon: BadgeCheck, tone: 'brand' },
  CHARACTER: { icon: HandHeart, tone: 'pink' },
  STUDY: { icon: BookOpen, tone: 'info' },
  FEE: { icon: ReceiptIndianRupee, tone: 'teal' },
  MERIT: { icon: Trophy, tone: 'orange' },
}
/** A certificate kind as a coloured chip with its icon. */
export function KindChip({ kind, label }) {
  return <ColorChip label={label} icon={KIND_LOOK[kind]?.icon} tone={KIND_LOOK[kind]?.tone} seed={kind} />
}

