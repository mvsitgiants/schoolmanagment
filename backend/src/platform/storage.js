import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from '../config.js'

// File storage for attachments (E15) and imaging (radiology images). Keys are always made by the
// server ("<tenant>/<yyyy>/<mm>/<uuid>.<ext>"), never by a user. Two backends, same calls:
//   STORAGE=disk (default) — under UPLOAD_DIR; dev machines and single-server installs.
//   STORAGE=s3             — an S3 bucket (or any S3-compatible store via S3_ENDPOINT), encrypted
//                            at rest, shared by every API instance and outside the containers.
// Both refuse to overwrite an existing file, and both serve byte ranges (DICOM viewers need them).

const checkKey = (key) => {
  const k = String(key)
  if (!k || k.startsWith('/') || k.split('/').some((p) => p === '..' || p === '.' || p === '')) throw new Error('Invalid storage key')
  return k
}

// ───────────────────────────────────────────────────────── local disk

function diskBackend() {
  const root = resolve(config.uploadDir)
  const pathOf = (key) => {
    const p = resolve(join(root, checkKey(key)))
    if (!p.startsWith(root + sep)) throw new Error('Invalid storage key')
    return p
  }
  return {
    async putFile(key, buffer) {
      const p = pathOf(key)
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, buffer, { flag: 'wx' })
    },
    writeStream(key) {
      const p = pathOf(key)
      mkdirSync(dirname(p), { recursive: true })
      return createWriteStream(p, { flags: 'wx' })
    },
    readStream: (key, range) => createReadStream(pathOf(key), range ? { start: range.start, end: range.end } : undefined),
    async readHead(key, bytes) {
      const fh = await open(pathOf(key), 'r')
      try {
        const buf = Buffer.alloc(bytes)
        const { bytesRead } = await fh.read(buf, 0, bytes, 0)
        return buf.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
    },
    fileSize: async (key) => (await stat(pathOf(key))).size,
    removeFile: async (key) => { await rm(pathOf(key), { force: true }) },
  }
}

// ───────────────────────────────────────────────────────── S3

async function s3Backend() {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const { Upload } = await import('@aws-sdk/lib-storage')
  const { bucket, prefix, region, endpoint, forcePathStyle } = config.s3
  // credentials: the SDK's usual chain — an IAM role on the server, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  const client = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle } : {}) })
  const Key = (key) => `${prefix}${checkKey(key)}`
  const SSE = endpoint ? {} : { ServerSideEncryption: 'AES256' } // S3-compatible stores may not take the header
  const notFound = (err) => err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404
  const asFsError = (err, key) => (notFound(err) ? Object.assign(new Error(`No such file: ${key}`), { code: 'ENOENT' }) : err)

  return {
    async putFile(key, buffer) {
      // IfNoneMatch: like the disk's "wx" — a key that already exists is never replaced
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: Key(key), Body: buffer, IfNoneMatch: '*', ...SSE }))
    },
    /** A writable that finishes only once S3 has the whole object — callers' pipelines resolve after it is stored. */
    writeStream(key) {
      const body = new PassThrough()
      const upload = new Upload({ client, params: { Bucket: bucket, Key: Key(key), Body: body, IfNoneMatch: '*', ...SSE }, queueSize: 4, partSize: 8 * 1024 * 1024 })
      const done = upload.done()
      done.catch(() => {}) // surfaced through final() below
      return new Writable({
        write(chunk, enc, cb) { if (body.write(chunk, enc)) cb(); else body.once('drain', cb) },
        final(cb) { body.end(); done.then(() => cb(), cb) },
        destroy(err, cb) { if (err) { body.destroy(err); upload.abort().catch(() => {}) } cb(err) },
      })
    },
    /** A stream right away (callers pipe it at once); the object's bytes flow in when S3 answers. */
    readStream(key, range) {
      const out = new PassThrough()
      client.send(new GetObjectCommand({ Bucket: bucket, Key: Key(key), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }))
        .then((r) => pipeline(r.Body, out))
        .catch((err) => out.destroy(asFsError(err, key)))
      return out
    },
    async readHead(key, bytes) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: Key(key), Range: `bytes=0-${Math.max(0, bytes - 1)}` }))
        return Buffer.from(await r.Body.transformToByteArray())
      } catch (err) { throw asFsError(err, key) }
    },
    async fileSize(key) {
      try { return (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: Key(key) }))).ContentLength ?? 0 } catch (err) { throw asFsError(err, key) }
    },
    async removeFile(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: Key(key) })) // deleting a missing key is not an error on S3
    },
  }
}

const backend = config.storage === 's3' ? await s3Backend() : diskBackend()

export const putFile = (key, buffer) => backend.putFile(key, buffer)

/** Stream into a new file (never overwrites). Resolves once every byte is stored. */
export const putStream = (key, readable) => pipeline(readable, backend.writeStream(key))

/** A writable for a new file, for callers that build their own pipeline. */
export const writeStream = (key) => backend.writeStream(key)

/** The whole file, or bytes start..end (inclusive) of it. */
export const readStream = (key, range) => backend.readStream(key, range)

/** The first `bytes` bytes of a file (fewer when it is shorter). */
export const readHead = (key, bytes) => backend.readHead(key, bytes)

export const fileSize = (key) => backend.fileSize(key)

/** Ranged reads are supported by both backends (local disk; S3 Range requests). */
export const supportsRange = true

export const removeFile = (key) => backend.removeFile(key)
