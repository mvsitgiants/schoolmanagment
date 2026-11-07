import { createContext, useContext, useEffect, useMemo } from 'react'
import { syncCurrentUser } from '../api/auth'
import useAuthUser from '../hooks/useAuthUser'
import {
  configureFormat, formatDate, formatDateTime, formatTime, formatNumber, formatCurrency, currencySymbol,
} from '../utils/format'
import { applyBrandRamp } from '../utils/brandRamp'
import { applySidebarTheme } from '../utils/sidebarTheme'
import { setBaseTitle } from '../utils/tabBadge'

// Branding and formats come from the institution's profile (part of /auth/me).
export const BRAND_DEFAULTS = {
  companyName: 'SchoolGiant',
  logoUrl: null,
  primaryColor: '#0E7C86',
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const user = useAuthUser()
  const tenant = user?.tenant
  const p = tenant?.profile ?? {}

  const brand = {
    companyName: tenant?.name || BRAND_DEFAULTS.companyName,
    logoUrl: p.logoUrl || null,
    primaryColor: p.primaryColor || BRAND_DEFAULTS.primaryColor,
    sidebarColor: p.sidebarColor || null,
  }
  const dateFormat = p.dateFormat || 'DD/MM/YYYY'
  const timezone = p.timezone || 'Asia/Kolkata'
  const currency = p.currency || 'INR'
  configureFormat({ dateFormat, timezone, currency })

  useEffect(() => {
    setBaseTitle(tenant?.name ? `${tenant.name} · SchoolGiant` : 'SchoolGiant')
    applyBrandRamp(p.primaryColor || null)
    applySidebarTheme(p.sidebarColor || null)
  }, [tenant?.name, p.primaryColor, p.sidebarColor])

  const value = useMemo(() => ({
    brand,
    format: {
      dateFormat, timezone, currency,
      date: formatDate, dateTime: formatDateTime, time: formatTime,
      number: formatNumber, currencyValue: formatCurrency, currencySymbol: () => currencySymbol(currency),
    },
    refresh: syncCurrentUser,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

const FALLBACK = {
  brand: { ...BRAND_DEFAULTS, sidebarColor: null },
  format: {
    dateFormat: 'DD/MM/YYYY', timezone: 'Asia/Kolkata', currency: 'INR',
    date: formatDate, dateTime: formatDateTime, time: formatTime,
    number: formatNumber, currencyValue: formatCurrency, currencySymbol: () => currencySymbol('INR'),
  },
  refresh: () => Promise.resolve(),
}

export function useSettings() {
  return useContext(SettingsContext) || FALLBACK
}

export const useBrand = () => useSettings().brand
export const useFormat = () => useSettings().format
