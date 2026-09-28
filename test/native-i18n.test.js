// Los textos de las apps nativas salen de src/i18n.js: si alguien cambia un texto y no los
// regenera, Android e iOS dirían otra cosa. `node scripts/native-i18n.mjs` los rehace.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build, TARGETS } from '../scripts/native-i18n.mjs'

test('native i18n.json is up to date with src/i18n.js (node scripts/native-i18n.mjs)', () => {
  const want = build()
  for (const t of TARGETS) {
    assert.ok(readFileSync(new URL(t, new URL('../scripts/', import.meta.url)), 'utf8') === want, `${t} is stale`)
  }
})
