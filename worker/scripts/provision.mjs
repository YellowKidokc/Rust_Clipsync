import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const archive = args.includes('--archive')
const [credentialsFile, sqlFile, rawCount = '2', existingFile] = args.filter(arg => arg !== '--archive')
const count = Number(rawCount)
if (!credentialsFile || !sqlFile || !Number.isInteger(count) || count < 1 || count > 32) {
  throw new Error('Usage: node scripts/provision.mjs <credentials.json> <devices.sql> [count] [existing-credentials.json] [--archive]')
}
const syncKey = existingFile
  ? JSON.parse(readFileSync(existingFile, 'utf8')).syncKey
  : 'cskey_' + randomBytes(32).toString('hex')
if (!/^cskey_[a-f0-9]{64}$/.test(syncKey)) throw new Error('Invalid existing sync key')
const account = createHash('sha256')
  .update('clipsync-account-v1:')
  .update(Buffer.from(syncKey.slice(6), 'hex'))
  .digest('hex')

function ulid() {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  let value = BigInt(`0x${bytes.toString('hex')}`)
  let output = ''
  for (let i = 0; i < 26; i += 1) {
    output = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Number(value & 31n)] + output
    value >>= 5n
  }
  return output
}

const devices = Array.from({ length: count }, () => ({ id: ulid(), token: 'csdev_' + randomBytes(32).toString('hex') }))
const sql = devices.map(({ id, token }) => {
  const hash = createHash('sha256').update(token).digest('hex')
  if (archive) return `INSERT INTO devices (account,device,token_hash,archive_only) VALUES ('${account}','${id}','${hash}',1);`
  return `INSERT INTO devices (account,device,token_hash) VALUES ('${account}','${id}','${hash}');`
}).join('\n')

writeFileSync(credentialsFile, JSON.stringify({ account, syncKey, devices }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
writeFileSync(sqlFile, sql + '\n', { flag: 'wx', mode: 0o600 })
console.log(`Created credentials and D1 enrollment SQL for ${count} device(s).`)
