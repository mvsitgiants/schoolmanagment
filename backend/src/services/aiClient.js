import Anthropic from '@anthropic-ai/sdk'
import { aiMonthOf } from '@schoolgiant/shared'
import { AiUsage } from '../models/ai.js'
import { isOid } from '../platform/db.js'
import { AppError } from '../platform/errors.js'
import { logger } from '../platform/logger.js'
import { institutionNow } from '../platform/time.js'
import { getConfig, secretOf } from './integrationsCommon.js'

// The one door to Claude for the AI module (services/ai*.js).
//
// Key: the platform's ANTHROPIC_API_KEY (environment). An institution can bring its own key through an
// IntegrationConfig with provider "ANTHROPIC" (secret `apiKey`, switched on) — that wins when present. With
// neither, every AI call answers 409 AI_UNAVAILABLE and the screens say "AI is not set up yet".
//
// Models: Claude Sonnet 5.5 for the assistant and question papers, Claude Haiku 5.5 for bulk remarks. Sonnet
// requests carry the server-side refusal fallback ("default" routing). Every call is logged in AiUsage; an
// optional monthly cap per institution (AI_MONTHLY_TOKEN_CAP, input + output tokens) stops calls once reached.
//
// Tests (and anything else that must not call out) install a driver with setAiDriver({ create(params) }) —
// it answers in place of the API and counts as "configured".

export const AI_MODELS = { main: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5' }
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

const env = {
  apiKey: () => (process.env.ANTHROPIC_API_KEY || '').trim(),
  monthlyCap: () => Math.max(0, Math.floor(Number(process.env.AI_MONTHLY_TOKEN_CAP) || 0)),
}

let driver = null
/** Tests: answer model calls with `d.create(params)` (a Message-shaped object) instead of the API. null to undo. */
export function setAiDriver(d) { driver = d }

const clients = new Map() // api key → Anthropic client
function clientFor(apiKey) {
  if (!clients.has(apiKey)) clients.set(apiKey, new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 }))
  return clients.get(apiKey)
}

/** Where this institution's key comes from: { apiKey, source: INSTITUTION | PLATFORM | TEST } or null. */
async function resolveKey() {
  if (driver) return { apiKey: null, source: 'TEST' }
  try {
    const cfg = await getConfig('ANTHROPIC')
    const own = cfg?.enabled ? secretOf(cfg, 'apiKey') : null
    if (own) return { apiKey: own, source: 'INSTITUTION' }
  } catch (err) {
    logger.warn({ err }, 'ai: could not read the institution key')
  }
  const platform = env.apiKey()
  return platform ? { apiKey: platform, source: 'PLATFORM' } : null
}

export const aiUnavailable = () => new AppError(409, 'AI is not set up for this institution yet.', { code: 'AI_UNAVAILABLE' })

const month = async () => aiMonthOf((await institutionNow()).date)

/** This month's use: calls and tokens, in all and by feature, and the cap (0 = none). */
export async function usageThisMonth() {
  const m = await month()
  const rows = await AiUsage.aggregate([
    { $match: { month: m } },
    { $group: { _id: '$feature', calls: { $sum: 1 }, inputTokens: { $sum: { $add: ['$inputTokens', '$cacheReadTokens', '$cacheWriteTokens'] } }, outputTokens: { $sum: '$outputTokens' } } },
  ])
  const byFeature = Object.fromEntries(rows.map((r) => [r._id, { calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens }]))
  const total = rows.reduce((t, r) => ({ calls: t.calls + r.calls, inputTokens: t.inputTokens + r.inputTokens, outputTokens: t.outputTokens + r.outputTokens }), { calls: 0, inputTokens: 0, outputTokens: 0 })
  const cap = env.monthlyCap()
  return { month: m, ...total, byFeature, cap, capReached: !!cap && total.inputTokens + total.outputTokens >= cap }
}

/** Is AI usable here, and where the key comes from (never the key itself). */
export async function aiStatus() {
  const key = await resolveKey()
  return { configured: !!key, source: key?.source ?? null, models: AI_MODELS, usage: await usageThisMonth() }
}

/** 409 AI_UNAVAILABLE when there is no key (every AI endpoint but the status starts with this). */
export async function ensureConfigured() {
  if (!await resolveKey()) throw aiUnavailable()
}

/** The key, or a 409 the screens turn into "not set up"; also the monthly cap. */
export async function requireAi() {
  const key = await resolveKey()
  if (!key) throw aiUnavailable()
  const cap = env.monthlyCap()
  if (cap) {
    const used = await usageThisMonth()
    if (used.capReached) throw new AppError(429, 'This month’s AI allowance is used up. It starts again next month.', { code: 'AI_CAP_REACHED' })
  }
  return key
}

async function record(feature, model, msg, auth, ok) {
  try {
    const u = msg?.usage ?? {}
    await AiUsage.create({
      feature, model: msg?.model || model, ok, stopReason: msg?.stop_reason ?? undefined, month: await month(),
      inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      userId: isOid(auth?.userId) ? auth.userId : undefined, userName: auth?.user?.name,
    })
  } catch (err) {
    logger.warn({ err }, 'ai: usage not recorded')
  }
}

/** An SDK failure as an API error the screen can show. */
function asAppError(err) {
  if (err instanceof AppError) return err
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    logger.warn({ status: err.status }, 'ai: the key was refused')
    return new AppError(409, 'The AI service refused the key. Ask the platform team to check it.', { code: 'AI_UNAVAILABLE' })
  }
  if (err instanceof Anthropic.RateLimitError) return new AppError(429, 'The AI service is busy. Try again in a minute.', { code: 'AI_BUSY' })
  if (err instanceof Anthropic.APIUserAbortError) return new AppError(499, 'Stopped.', { code: 'AI_ABORTED' })
  if (err instanceof Anthropic.APIConnectionError) return new AppError(502, 'Could not reach the AI service. Try again.', { code: 'AI_ERROR' })
  if (err instanceof Anthropic.APIError) {
    logger.warn({ status: err.status, message: err.message }, 'ai: call failed')
    return new AppError(502, 'The AI service could not answer. Try again.', { code: 'AI_ERROR' })
  }
  return err
}

/** Sonnet requests go through the beta surface with the server-side refusal fallback. */
function requestFor(params) {
  if (params.model !== AI_MODELS.main) return { beta: false, body: params }
  return { beta: true, body: { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } }
}

/**
 * One model call (streamed, so long answers don't time out), logged in AiUsage. `onText` gets the text as it
 * arrives. Returns the final Message. A refusal is a 422 AI_REFUSED unless `allowRefusal`.
 */
export async function callModel(feature, params, auth, { onText, signal, allowRefusal = false } = {}) {
  const key = await requireAi()
  let msg
  try {
    if (driver) {
      msg = await driver.create(params, { feature })
      if (onText) for (const b of msg.content ?? []) if (b.type === 'text' && b.text) onText(b.text)
    } else {
      const { beta, body } = requestFor(params)
      const cl = clientFor(key.apiKey)
      const stream = beta ? cl.beta.messages.stream(body, { signal }) : cl.messages.stream(body, { signal })
      if (onText) stream.on('text', (t) => onText(t))
      msg = await stream.finalMessage()
    }
  } catch (err) {
    await record(feature, params.model, null, auth, false)
    throw asAppError(err)
  }
  await record(feature, params.model, msg, auth, msg.stop_reason !== 'refusal')
  if (msg.stop_reason === 'refusal' && !allowRefusal) throw new AppError(422, 'The AI declined this request. Try rewording it.', { code: 'AI_REFUSED' })
  return msg
}

/** The text of a Message (all text blocks joined). */
export const textOf = (msg) => (msg?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')

/** A structured-output answer: the JSON the schema asked for, or a 502 when it can't be read. */
export function jsonOf(msg) {
  if (msg?.stop_reason === 'max_tokens') throw new AppError(502, 'The AI answer was cut short. Ask for fewer at a time.', { code: 'AI_ERROR' })
  try {
    return JSON.parse(textOf(msg))
  } catch {
    throw new AppError(502, 'The AI answer could not be read. Try again.', { code: 'AI_ERROR' })
  }
}

/** Structured output: `output_config.format` with a JSON schema. */
export const jsonFormat = (schema) => ({ type: 'json_schema', schema })
