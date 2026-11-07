import api from './client'

// Public endpoints (no sign-in): plans for the sign-up page and the platform's notice banner.
// Public pages for families (report card / receipt links, online admission form) join here as
// their modules are built.

export async function fetchPublicPlans() {
  const res = await api.get('/v1/public/plans')
  return { plans: res.data.data, signupEnabled: res.data.meta?.signupEnabled !== false }
}

/** The maintenance / announcement banner (Superadmin › Settings), or null. */
export const fetchNotice = async () => (await api.get('/v1/public/notice')).data.data
