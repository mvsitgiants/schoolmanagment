import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { config } from '../config.js'

// Field-level protection for sensitive identifiers (docs/00 §8.5):
//   encrypt()     AES-256-GCM, random IV — stored as "v1:<iv>:<tag>:<ciphertext>" (base64url)
//   blindIndex()  keyed HMAC — lets us find "this Aadhaar again" without storing it readable

const encKey = createHash('sha256').update(`enc:${config.dataKey}`).digest()
const macKey = createHash('sha256').update(`mac:${config.dataKey}`).digest()

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey, iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':')
}

export function decrypt(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('v1:')) return null
  try {
    const [, iv, tag, data] = token.split(':')
    const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const blindIndex = (value) => createHmac('sha256', macKey).update(String(value)).digest('base64url').slice(0, 32)

/** XXXX XXXX 1234 style mask keeping the last 4 characters. */
export const maskTail = (last4, total = 12) => `${'•'.repeat(Math.max(0, total - 4))}${last4}`
