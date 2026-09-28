// Los casos de oro de las versiones nativas (test/vectors/engine.json) tienen que salir del
// motor de AHORA: si alguien cambia el motor y no los regenera, Android e iOS pasarían sus
// pruebas contra un motor viejo. `node test/vectors/gen.mjs` los rehace.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('engine.json is up to date with the engine (node test/vectors/gen.mjs)', async () => {
  // gen.mjs cambia crypto.randomUUID y Date.now para ser determinista: se restauran después.
  const uuid = globalThis.crypto.randomUUID
  const now = Date.now
  try {
    const { build } = await import('./vectors/gen.mjs')
    const onDisk = readFileSync(new URL('./vectors/engine.json', import.meta.url), 'utf8')
    assert.ok(build() === onDisk, 'test/vectors/engine.json is stale: run node test/vectors/gen.mjs')
  } finally {
    globalThis.crypto.randomUUID = uuid
    Date.now = now
  }
})
