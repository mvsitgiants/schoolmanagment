import { useEffect, useState } from 'react'
import { getCurrentUser, USER_CHANGED_EVENT } from '../api/auth'

/**
 * The signed-in user (role + permissions), re-rendering whenever the server-side
 * role changes — see syncCurrentUser in api/auth.js. Mount it high in the tree
 * (AppLayout does) so permission-gated UI everywhere below follows the live role.
 */
export default function useAuthUser() {
  const [user, setUser] = useState(getCurrentUser)
  useEffect(() => {
    const onChange = () => setUser(getCurrentUser())
    window.addEventListener(USER_CHANGED_EVENT, onChange)
    // another tab signed in as someone else / changed the stored user
    const onStorage = (e) => { if (e.key === 'erp_user') onChange() }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(USER_CHANGED_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return user
}
