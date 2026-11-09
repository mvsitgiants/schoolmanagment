// Surveys & feedback (module `surveys`): a survey sends a form-builder questionnaire (FormTemplate, use SURVEY) to an
// audience; each answer keeps the form version it was filled on. Tenant-scoped.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose
const ObjectId = Schema.Types.ObjectId
const Mixed = Schema.Types.Mixed

const surveySchema = new Schema({
  title: { type: String, required: true, trim: true },
  intro: { type: String, trim: true }, // shown above the questions
  formId: { type: ObjectId, required: true }, // FormTemplate
  formName: String,
  formVersion: { type: Number, default: 0 }, // frozen when the survey is published
  audience: { type: String, required: true }, // SURVEY_AUDIENCES
  classIds: { type: [ObjectId], default: [] }, // PARENTS / STUDENTS: empty = everyone
  sectionIds: { type: [ObjectId], default: [] },
  anonymous: { type: Boolean, default: false },
  publicToken: { type: String }, // PUBLIC: the link's secret part
  opensOn: String, // YYYY-MM-DD
  closesOn: String,
  publishedAt: Date,
  publishedBy: String,
  closedAt: Date, // closed early by hand
  remindedAt: Date,
  responses: { type: Number, default: 0 },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true })
surveySchema.plugin(tenantPlugin)
surveySchema.index({ tenantId: 1, createdAt: -1 })
surveySchema.index({ publicToken: 1 }, { unique: true, sparse: true })

export const Survey = model('Survey', surveySchema, 'surveys')

/**
 * One filled survey. `respondentKey` keeps it to one per person: `S:<studentId>` (parents, per child) ·
 * `T:<studentId>` (a student) · `U:<userId>` (staff) · `P:<random>` (public link). An anonymous survey stores only
 * a hash of the key and the class, never who answered.
 */
const responseSchema = new Schema({
  surveyId: { type: ObjectId, required: true },
  formVersion: Number,
  respondentKey: { type: String, required: true },
  kind: String, // PARENT · STUDENT · STAFF · PUBLIC
  studentId: ObjectId,
  userId: ObjectId,
  name: String, // not kept for anonymous surveys
  classId: ObjectId, // for the response rate by class (kept even when anonymous)
  sectionId: ObjectId,
  values: { type: Mixed, default: {} },
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true, minimize: false })
responseSchema.plugin(tenantPlugin)
responseSchema.index({ tenantId: 1, surveyId: 1, respondentKey: 1 }, { unique: true })
responseSchema.index({ tenantId: 1, surveyId: 1, sectionId: 1 })

export const SurveyResponse = model('SurveyResponse', responseSchema, 'survey_responses')
