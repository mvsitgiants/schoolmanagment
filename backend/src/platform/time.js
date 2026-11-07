import { nowIn } from '@schoolgiant/shared'
import { Tenant } from '../models/platform.js'
import { getContext } from './context.js'

/** The institution's timezone (IANA name), from its profile. */
export const timeZoneOf = async () => (await Tenant.findById(getContext()?.tenantId).select('profile.timezone').lean())?.profile?.timezone || 'Asia/Kolkata'

/** Today's date and time on the institution's clock (its timezone, not the server's). */
export async function institutionNow(date = new Date()) {
  return nowIn(await timeZoneOf(), date)
}

/** YYYY-MM-DD and HH:MM (24 h) of an instant in a timezone. */
export const ymdIn = (d, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
export const hhmmIn = (d, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d))
