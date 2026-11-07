import { createContext, useContext, useMemo } from 'react'
import useAuthUser from '../hooks/useAuthUser'

// Modules switched on for the tenant come with the signed-in profile (/auth/me),
// so there is no separate fetch — and a plan change reaches this tab with the
// next profile sync.
const ModuleContext = createContext({ enabledModules: new Set(), isEnabled: () => false, loading: false, refresh: () => {} })

export function ModuleProvider({ children }) {
  const user = useAuthUser()
  const value = useMemo(() => {
    const enabledModules = new Set(user?.enabledModules ?? [])
    return { enabledModules, isEnabled: (id) => !!user?.superadmin || enabledModules.has(id), loading: false, refresh: () => {} }
  }, [user])
  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
}

export const useModules = () => useContext(ModuleContext)
