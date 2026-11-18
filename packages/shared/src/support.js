// Help & support: a school's staff ask the SchoolGiant team for help (Help & support page); the team answers from the
// platform console (Superadmin › Support). One request = one conversation.

/** What the request is about. */
export const SUPPORT_CATEGORIES = [
  { value: 'PROBLEM', label: 'Something isn’t working' },
  { value: 'HOW_TO', label: 'How do I…?' },
  { value: 'DATA', label: 'Data needs correcting' },
  { value: 'BILLING', label: 'Plan, billing or payment' },
  { value: 'IDEA', label: 'An idea or a new feature' },
  { value: 'OTHER', label: 'Something else' },
]
export const SUPPORT_CATEGORY_BY = Object.fromEntries(SUPPORT_CATEGORIES.map((c) => [c.value, c]))

/** Where a request is. WAITING: the team asked the school something. */
export const SUPPORT_STATUS = {
  OPEN: { label: 'Open', tone: 'warning' },
  IN_PROGRESS: { label: 'We’re working on it', tone: 'info' },
  WAITING: { label: 'Waiting for you', tone: 'warning' },
  SOLVED: { label: 'Solved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}
/** Still needs the team (an open request waits in the console's inbox). */
export const SUPPORT_ACTIVE = ['OPEN', 'IN_PROGRESS']

export const SUPPORT_PRIORITIES = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent — work has stopped' },
]

export const SUPPORT_MESSAGE_MAX = 5000
export const SUPPORT_FILES_MAX = 5 // per message
