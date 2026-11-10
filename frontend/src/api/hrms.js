import api from './client'

// Staff & HR API (/api/v1/hrms). Functions return the unwrapped `data`; paged lists return `{ data, meta }`.
const get = async (url, params) => (await api.get(url, { params })).data.data
const list = async (url, params) => (await api.get(url, { params })).data
const post = async (url, body) => (await api.post(url, body)).data.data
const put = async (url, body) => (await api.put(url, body)).data.data
const patch = async (url, body) => (await api.patch(url, body)).data.data
const del = async (url) => (await api.delete(url)).data.data
/** A CSV export, saved under its name. */
async function download(url, params, name) {
  const res = await api.get(url, { params, responseType: 'blob' })
  const href = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}

const BASE = '/v1/hrms'

export const fetchHrmsMeta = () => get(`${BASE}/meta`)

// staff
export const fetchEmployees = (params) => list(`${BASE}/employees`, params)
export const exportEmployees = (params) => download(`${BASE}/employees/export`, params, 'staff.csv')
export const fetchEmployee = (id) => get(`${BASE}/employees/${id}`)
export const createEmployee = (body) => post(`${BASE}/employees`, body)
export const updateEmployee = (id, body) => patch(`${BASE}/employees/${id}`, body)
export const importEmployees = (rows, dryRun) => post(`${BASE}/employees/import`, { rows, dryRun })
export const recordsFromLogins = () => post(`${BASE}/employees/from-logins`)
export const fetchEmployeeSensitive = (id) => get(`${BASE}/employees/${id}/sensitive`)
export const saveEmployeeSensitive = (id, body) => put(`${BASE}/employees/${id}/sensitive`, body)
export const saveEmployeeSalary = (id, body) => put(`${BASE}/employees/${id}/salary`, body)
export const linkEmployeeLogin = (id, userId) => put(`${BASE}/employees/${id}/login`, { userId })
export const createEmployeeLogin = (id, body) => post(`${BASE}/employees/${id}/login`, body)
export const exitEmployee = (id, body) => post(`${BASE}/employees/${id}/exit`, body)
export const cancelEmployeeExit = (id) => post(`${BASE}/employees/${id}/exit/cancel`)
export const fetchEmployeeLeave = (id) => get(`${BASE}/employees/${id}/leave`)
export const fetchEmployeeLedger = (id, leaveTypeId) => get(`${BASE}/employees/${id}/leave/ledger`, { leaveTypeId })
export const adjustEmployeeLeave = (id, body) => post(`${BASE}/employees/${id}/leave/adjust`, body)

// staff attendance
export const fetchStaffDay = (date, params) => get(`${BASE}/attendance/day`, { date, ...params })
export const saveStaffDay = (date, entries) => put(`${BASE}/attendance/day`, { date, entries })
export const fetchStaffMonth = (month, params) => get(`${BASE}/attendance/month`, { month, ...params })
export const exportStaffMonth = (month, params) => download(`${BASE}/attendance/month/export`, { month, ...params }, `staff-attendance-${month}.csv`)
export const importStaffAttendance = (rows) => post(`${BASE}/attendance/import`, { rows })

// leave
export const fetchLeaveTypes = () => get(`${BASE}/leave/types`)
export const createLeaveType = (body) => post(`${BASE}/leave/types`, body)
export const updateLeaveType = (id, body) => put(`${BASE}/leave/types/${id}`, body)
export const fetchLeaves = (params) => get(`${BASE}/leave`, params)
export const fetchLeaveBalances = (params) => get(`${BASE}/leave/balances`, params)
export const fetchLeave = (id) => get(`${BASE}/leave/${id}`)
export const fetchLeaveSummary = () => get(`${BASE}/leave/summary`)
export const fetchLeaveCalendar = (params) => get(`${BASE}/leave/calendar`, params)
export const previewLeaveFor = (body) => post(`${BASE}/leave/preview`, body)
export const applyLeaveFor = (body) => post(`${BASE}/leave`, body)
export const decideLeave = (id, body) => post(`${BASE}/leave/${id}/decide`, body)
export const cancelLeave = (id, reason) => post(`${BASE}/leave/${id}/cancel`, { reason })
export const creditCompOff = (body) => post(`${BASE}/leave/comp-off`, body)
// leave setup: approval chains, no-leave days and vacations, the year end
export const fetchLeaveChains = () => get(`${BASE}/leave/chains`)
export const fetchLeaveChainOptions = () => get(`${BASE}/leave/chains/options`)
export const createLeaveChain = (body) => post(`${BASE}/leave/chains`, body)
export const updateLeaveChain = (id, body) => put(`${BASE}/leave/chains/${id}`, body)
export const deleteLeaveChain = (id) => del(`${BASE}/leave/chains/${id}`)
export const fetchNoLeaveDays = (params) => get(`${BASE}/leave/no-leave-days`, params)
export const fetchNoLeaveSuggestions = () => get(`${BASE}/leave/no-leave-days/suggestions`)
export const createNoLeaveDay = (body) => post(`${BASE}/leave/no-leave-days`, body)
export const updateNoLeaveDay = (id, body) => put(`${BASE}/leave/no-leave-days/${id}`, body)
export const deleteNoLeaveDay = (id) => del(`${BASE}/leave/no-leave-days/${id}`)
export const fetchLeaveYearEnd = () => get(`${BASE}/leave/year-end`)
export const runLeaveYearEnd = () => post(`${BASE}/leave/year-end`)

// holidays
export const fetchHolidays = (year) => get(`${BASE}/holidays`, { year })
export const createHoliday = (body) => post(`${BASE}/holidays`, body)
export const addHolidays = (rows) => post(`${BASE}/holidays/bulk`, { rows })
export const updateHoliday = (id, body) => put(`${BASE}/holidays/${id}`, body)
export const deleteHoliday = (id) => del(`${BASE}/holidays/${id}`)

// recruitment
export const fetchRequisitions = (status) => get(`${BASE}/requisitions`, { status })
export const createRequisition = (body) => post(`${BASE}/requisitions`, body)
export const updateRequisition = (id, body) => put(`${BASE}/requisitions/${id}`, body)
export const setRequisitionStatus = (id, body) => post(`${BASE}/requisitions/${id}/status`, body)
export const fetchCandidates = (params) => get(`${BASE}/candidates`, params)
export const fetchCandidate = (id) => get(`${BASE}/candidates/${id}`)
export const createCandidate = (body) => post(`${BASE}/candidates`, body)
export const updateCandidate = (id, body) => put(`${BASE}/candidates/${id}`, body)
export const moveCandidate = (id, body) => post(`${BASE}/candidates/${id}/move`, body)
export const evaluateCandidate = (id, body) => post(`${BASE}/candidates/${id}/evaluate`, body)
export const offerCandidate = (id, body) => post(`${BASE}/candidates/${id}/offer`, body)
export const hireCandidate = (id, body) => post(`${BASE}/candidates/${id}/hire`, body)

// appraisal
export const fetchCycles = () => get(`${BASE}/appraisals/cycles`)
export const createCycle = (body) => post(`${BASE}/appraisals/cycles`, body)
export const updateCycle = (id, body) => put(`${BASE}/appraisals/cycles/${id}`, body)
export const launchCycle = (id) => post(`${BASE}/appraisals/cycles/${id}/launch`)
export const closeCycle = (id) => post(`${BASE}/appraisals/cycles/${id}/close`)
export const fetchCycleReviews = (id) => get(`${BASE}/appraisals/cycles/${id}/reviews`)
export const setReviewer = (id, userId) => put(`${BASE}/appraisals/${id}/reviewer`, { userId })
export const rateAsHr = (id, body) => post(`${BASE}/appraisals/${id}/manager`, body)

// my workspace
export const fetchMyRecord = () => get(`${BASE}/me`)
export const updateMyRecord = (body) => patch(`${BASE}/me`, body)
export const fetchMyLeave = () => get(`${BASE}/me/leave`)
export const applyMyLeave = (body) => post(`${BASE}/me/leave`, body)
export const previewMyLeave = (body) => post(`${BASE}/me/leave/preview`, body)
export const cancelMyLeave = (id, reason) => post(`${BASE}/me/leave/${id}/cancel`, { reason })
export const fetchMyAttendance = (month) => get(`${BASE}/me/attendance`, { month })
export const fetchMyApprovals = () => get(`${BASE}/me/approvals`)
export const decideAsManager = (id, body) => post(`${BASE}/me/approvals/${id}`, body)
export const fetchMyApproval = (id) => get(`${BASE}/me/approvals/${id}`)
export const fetchMyReviews = () => get(`${BASE}/me/reviews`)
export const fetchMyReview = (id) => get(`${BASE}/me/reviews/${id}`)
export const submitSelfReview = (id, body) => post(`${BASE}/me/reviews/${id}/self`, body)
export const submitManagerReview = (id, body) => post(`${BASE}/me/reviews/${id}/rate`, body)
