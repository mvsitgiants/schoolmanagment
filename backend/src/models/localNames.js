// Names in other languages: one glossary per language of the institution's own texts, keyed by the English as saved
// (shared localKey). The records keep their English; documents printed in the language look their texts up here.
import mongoose from 'mongoose'
import { tenantPlugin } from '../platform/db.js'

const { Schema, model } = mongoose

const localTextSchema = new Schema({
  lang: { type: String, required: true }, // SUPPORTED_LANGUAGES code, not 'en'
  key: { type: String, required: true }, // localKey(english)
  english: { type: String, required: true, trim: true }, // as it was when the local text was saved
  value: { type: String, required: true, trim: true },
  kind: { type: String, default: 'phrases' }, // LOCAL_NAME_KINDS — where it was entered (a phrase is listed from here)
  suggested: { type: Boolean, default: false }, // filled by the AI and saved without a change
  updatedBy: String,
}, { timestamps: true })
localTextSchema.plugin(tenantPlugin)
localTextSchema.index({ tenantId: 1, lang: 1, key: 1 }, { unique: true })

export const LocalText = model('LocalText', localTextSchema, 'local_texts')
