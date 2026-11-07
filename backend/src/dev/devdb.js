// Embedded MongoDB replica set for local development — no Docker needed.
//   npm run dev:db        (keep it running in its own terminal)
// Data persists in <repo>/.data/mongo. Transactions need a replica set, hence rs0.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dbPath = resolve(root, '.data/mongo')
mkdirSync(dbPath, { recursive: true })
const port = Number(process.env.MONGO_PORT) || 27017

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
})
await replSet.waitUntilRunning()

console.log('\nMongoDB replica set is running')
console.log(`  MONGO_URL=mongodb://127.0.0.1:${port}/schoolgiant?replicaSet=rs0`)
console.log(`  data: ${dbPath}`)
console.log('  Ctrl+C to stop\n')

const stop = async () => {
  await replSet.stop({ doCleanup: false })
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
