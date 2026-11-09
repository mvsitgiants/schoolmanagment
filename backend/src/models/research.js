// Research (module `research`). Tenant-scoped.
//
//   ResearchPublication  a journal article, conference paper, book, chapter or patent — authors from the staff (linked to
//                        their login) and from outside (names only), venue, year, DOI / ISSN / ISBN, indexing, impact, citations
//   ResearchProject      a funded project or grant: PI and co-PIs (staff), agency, sanctioned / received / utilised (paise)
//   ResearchScholar      a Ph.D. scholar with a guide (staff), registered on a date, moving through coursework to the award
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const ymd = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }

const authorSchema = new Schema({
  userId: { type: ObjectId, ref: 'User' }, // a staff member; none → someone from outside
  name: { type: String, required: true, trim: true },
}, { _id: false })

const publicationSchema = new Schema({
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, default: 'JOURNAL' }, // RESEARCH_PUB_TYPES
  authors: { type: [authorSchema], default: [] },
  venue: { type: String, trim: true }, // journal, conference, publisher, patent office
  year: { type: Number, required: true },
  volume: { type: String, trim: true },
  issue: { type: String, trim: true },
  pages: { type: String, trim: true },
  doi: { type: String, trim: true, lowercase: true },
  issn: { type: String, trim: true },
  isbn: { type: String, trim: true },
  patentNo: { type: String, trim: true },
  indexing: { type: [String], default: [] }, // RESEARCH_INDEXING
  impactFactor: Number,
  citations: { type: Number, default: 0 },
  departmentId: { type: ObjectId, ref: 'Department' },
  url: { type: String, trim: true },
  createdBy: String,
}, { timestamps: true })
publicationSchema.plugin(tenantPlugin)
publicationSchema.index({ tenantId: 1, year: -1, departmentId: 1 })
publicationSchema.index({ tenantId: 1, 'authors.userId': 1 })
publicationSchema.index({ tenantId: 1, doi: 1 }, { unique: true, partialFilterExpression: { doi: { $type: 'string' } } })
export const ResearchPublication = model('ResearchPublication', publicationSchema, 'research_publications')

const projectSchema = new Schema({
  title: { type: String, required: true, trim: true },
  piId: { type: ObjectId, ref: 'User', required: true },
  coPiIds: { type: [{ type: ObjectId, ref: 'User' }], default: [] },
  agency: { type: String, required: true }, // RESEARCH_AGENCIES
  agencyName: { type: String, trim: true }, // the company / scheme when it says more than the agency
  scheme: { type: String, trim: true },
  referenceNo: { type: String, trim: true }, // sanction order number
  departmentId: { type: ObjectId, ref: 'Department' },
  sanctioned: { type: Number, default: 0 }, // paise
  received: { type: Number, default: 0 }, // paise
  utilised: { type: Number, default: 0 }, // paise
  appliedOn: ymd,
  sanctionedOn: ymd,
  startDate: ymd,
  endDate: ymd,
  status: { type: String, default: 'APPLIED' }, // RESEARCH_PROJECT_STATUS
  notes: String,
  createdBy: String,
}, { timestamps: true })
projectSchema.plugin(tenantPlugin)
projectSchema.index({ tenantId: 1, status: 1, sanctionedOn: -1 })
projectSchema.index({ tenantId: 1, piId: 1 })
export const ResearchProject = model('ResearchProject', projectSchema, 'research_projects')

const scholarSchema = new Schema({
  name: { type: String, required: true, trim: true },
  enrolmentNo: { type: String, trim: true, uppercase: true },
  email: { type: String, trim: true, lowercase: true },
  guideId: { type: ObjectId, ref: 'User', required: true },
  coGuideId: { type: ObjectId, ref: 'User' },
  departmentId: { type: ObjectId, ref: 'Department' },
  topic: { type: String, trim: true },
  mode: { type: String, default: 'FULL_TIME' }, // RESEARCH_SCHOLAR_MODES
  registrationDate: { ...ymd, required: true },
  status: { type: String, default: 'REGISTERED' }, // RESEARCH_SCHOLAR_STATUS
  awardedOn: ymd,
  fellowship: { type: String, trim: true }, // JRF, SRF, institute fellowship …
  createdBy: String,
}, { timestamps: true })
scholarSchema.plugin(tenantPlugin)
scholarSchema.index({ tenantId: 1, guideId: 1, status: 1 })
export const ResearchScholar = model('ResearchScholar', scholarSchema, 'research_scholars')
