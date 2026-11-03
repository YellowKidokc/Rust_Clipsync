import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSecrets } from '../src/secrets.js'

test('masks keys, passwords and connection strings', () => {
  const r = maskSecrets('k=sk-ant-api03-abcdefghijklmnopqrstuvwxyz\npassword: hunter22\npostgres://u:pw123@h:5432/db\nAKIAABCDEFGHIJKLMNOP')
  assert.ok(!r.text.includes('abcdefghijklmnop'))
  assert.ok(r.text.includes('password: [REDACTED]'))
  assert.ok(r.text.includes('postgres://u:[REDACTED]@h:5432/db'))
  assert.ok(r.text.includes('[REDACTED:aws_access_key]'))
  assert.equal(r.masked, true)
})

test('leaves ordinary text alone', () => {
  const s = 'The token of grace is not a password, just a sentence.'
  assert.deepEqual(maskSecrets(s), { text: s, found: [], masked: false })
})
