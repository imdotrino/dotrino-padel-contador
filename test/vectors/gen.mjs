// Casos de oro del motor del torneo para las versiones NATIVAS (CONVENCIONES §16): la PWA va
// delante, y Android e iOS tienen que armar EXACTAMENTE las mismas rondas. Cada caso es un
// torneo de partida más una lista de operaciones; se ejecutan aquí con el motor de la PWA,
// con azar de semilla fija y ids de contador, y se guarda lo que sale después de cada una.
//
//   node test/vectors/gen.mjs        → test/vectors/engine.json
//
// Lo leen android/app/src/test (EngineVectorsTest.kt) e ios/PadelTests (EngineVectorsTests).
import { writeFileSync } from 'node:fs'
import * as E from '../../src/tournament/engine.js'

// Azar con semilla (mulberry32): el mismo en Kotlin y en Swift.
export function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// Ids de contador y un reloj fijo: lo único del motor que no depende de las entradas.
let nextId = 0
globalThis.crypto.randomUUID = () => `id${++nextId}`
const NOW = 1790000000000
Date.now = () => NOW

// Resultados que dan una tabla con diferencias (para que «por puntaje» tenga qué ordenar).
const SCORERS = {
  fixed: () => [6, 3],
  cycle: (m, i) => [6, (i * 5) % 7],
  draws: (m, i) => (i % 3 === 0 ? [4, 4] : [6, i % 5])
}

function scoreRound (t, r, scorer, withSets) {
  r.matches.forEach((m, i) => {
    const [a, b] = SCORERS[scorer](m, i + t.rounds.length * 3)
    E.setScore(t, m.id, a, b)
    if (withSets) E.setSets(t, m.id, a > b ? 2 : a < b ? 0 : 1, a > b ? 0 : a < b ? 2 : 1)
  })
}

const OPS = {
  generate (t, rng) {
    const r = E.generateRound(t, rng)
    if (r) t.rounds.push(r)
  },
  scoreLast (t, rng, o) { scoreRound(t, t.rounds[t.rounds.length - 1], o.scorer, o.sets) },
  playAll (t, rng, o) {
    for (let guard = 0; guard < 60; guard++) {
      const r = E.generateRound(t, rng)
      if (!r) return
      t.rounds.push(r)
      scoreRound(t, r, o.scorer, o.sets)
    }
    throw new Error('tournament never ended')
  },
  addPlayer (t, rng, o) { E.addPlayer(t, o.name) },
  addTeam (t, rng, o) { E.addTeam(t, o.a, o.b) },
  removePlayer (t, rng, o) { E.removePlayer(t, t.players[o.index].id) },
  removeTeam (t, rng, o) { E.removeTeam(t, t.teams[o.index].id) },
  restore (t, rng, o) { E.restoreUnit(t, o.team ? t.teams[o.index].id : t.players[o.index].id) },
  redo (t, rng) { E.redoLastRound(t, rng) },
  dropLast (t) { E.removeLastRound(t) },
  applyRules (t, rng, o) { E.applyRules(t, { ...E.defaultSettings(), ...o.settings }, rng) },
  toggleScoring (t, rng, o) { E.toggleScoring(t, o.kind, o.on) },
  startClock (t, rng, o) { E.startClock(t, t.rounds[o.round].id, o.now) },
  pauseClock (t, rng, o) { E.pauseClock(t, t.rounds[o.round].id, o.now) },
  resumeClock (t, rng, o) { E.resumeClock(t, t.rounds[o.round].id, o.now) },
  resetClock (t, rng, o) { E.resetClock(t, t.rounds[o.round].id) }
}

// Lo que la pantalla lee de un torneo, después de cada operación.
function observe (t, o) {
  const out = {
    status: E.status(t),
    estimate: E.estimate(t),
    blocker: E.nextRoundBlocker(t),
    everyoneMatchesEach: E.everyoneMatchesEach(t),
    maxCourts: E.maxCourts(t),
    canRedo: E.canRedoLastRound(t),
    standings: E.standings(t)
  }
  if (o.clockAt) out.clock = t.rounds.map(r => E.clockOf(t, r, o.clockAt))
  return out
}

function run (c) {
  nextId = 0
  const t = E.createTournament({ name: c.name, settings: c.settings || {} })
  for (const n of c.players || []) E.addPlayer(t, n)
  for (const [a, b] of c.teams || []) E.addTeam(t, a, b)
  const rng = seeded(c.seed)
  const initial = structuredClone(t)
  const steps = c.ops.map(o => {
    OPS[o.op](t, rng, o)
    return { ...observe(t, o), tournament: structuredClone(t) }
  })
  return { name: c.name, seed: c.seed, initial, ops: c.ops, steps }
}

const names = n => Array.from({ length: n }, (_, i) => 'P' + i)
const pairs = n => Array.from({ length: n }, (_, i) => ['A' + i, 'B' + i])
const fixedCourts = extra => ({ courtsMode: 'fixed', ...extra })

const CASES = [
  // Al azar, parejas que rotan
  ...[1, 2, 3].map(seed => ({ name: `rotating 8p perPlayer 3 s${seed}`, seed, players: names(8), settings: fixedCourts({ courts: 2, limitType: 'perPlayer', limitValue: 3 }), ops: [{ op: 'playAll', scorer: 'cycle' }] })),
  { name: 'rotating 5p 1 court perPlayer 4', seed: 4, players: names(5), settings: fixedCourts({ courts: 1, limitType: 'perPlayer', limitValue: 4 }), ops: [{ op: 'playAll', scorer: 'fixed' }] },
  { name: 'rotating 7p perPlayer 3', seed: 7, players: names(7), settings: fixedCourts({ courts: 2, limitType: 'perPlayer', limitValue: 3 }), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'rotating 9p auto rounds 4', seed: 3, players: names(9), settings: { limitType: 'rounds', limitValue: 4 }, ops: [{ op: 'playAll', scorer: 'draws' }] },
  { name: 'rotating 8p matches 5', seed: 5, players: names(8), settings: fixedCourts({ courts: 2, limitType: 'matches', limitValue: 5 }), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  // Parejas fijas
  { name: 'fixed 4 teams rounds 3', seed: 2, teams: pairs(4), settings: fixedCourts({ partners: 'fixed', courts: 2, limitType: 'rounds', limitValue: 3 }), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'fixed 5 teams perPlayer 2', seed: 11, teams: pairs(5), settings: fixedCourts({ partners: 'fixed', courts: 2, limitType: 'perPlayer', limitValue: 2 }), ops: [{ op: 'playAll', scorer: 'fixed' }] },
  // Por puntaje
  { name: 'ranked rotating 8p perPlayer 4', seed: 5, players: names(8), settings: fixedCourts({ pairing: 'ranked', courts: 2, limitType: 'perPlayer', limitValue: 4 }), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'ranked fixed 6 teams rounds 4', seed: 6, teams: pairs(6), settings: fixedCourts({ partners: 'fixed', pairing: 'ranked', courts: 3, limitType: 'rounds', limitValue: 4 }), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  // Todos contra todos / con todos
  ...[1, 2].map(seed => ({ name: `everyone rotating 8p s${seed}`, seed, players: names(8), settings: fixedCourts({ courts: 2 }), ops: [{ op: 'playAll', scorer: 'cycle' }] })),
  { name: 'everyone rotating 6p auto', seed: 3, players: names(6), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'everyone rotating 5p auto', seed: 4, players: names(5), ops: [{ op: 'playAll', scorer: 'fixed' }] },
  { name: 'everyone rotating 9p auto', seed: 9, players: names(9), ops: [{ op: 'playAll', scorer: 'draws' }] },
  { name: 'everyone rotating 12p auto', seed: 12, players: names(12), ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'everyone fixed 5 teams', seed: 5, teams: pairs(5), settings: { partners: 'fixed' }, ops: [{ op: 'playAll', scorer: 'cycle' }] },
  { name: 'everyone fixed 6 teams', seed: 6, teams: pairs(6), settings: { partners: 'fixed' }, ops: [{ op: 'playAll', scorer: 'cycle' }] },
  // Ediciones a mitad del torneo
  {
    name: 'edits mid tournament', seed: 8, players: names(8), settings: fixedCourts({ courts: 2, limitType: 'perPlayer', limitValue: 4 }),
    ops: [
      { op: 'generate' }, { op: 'scoreLast', scorer: 'cycle' },
      { op: 'removePlayer', index: 2 }, { op: 'generate' }, { op: 'redo' }, { op: 'scoreLast', scorer: 'fixed' },
      { op: 'addPlayer', name: 'Late' }, { op: 'restore', index: 2 }, { op: 'generate' }, { op: 'dropLast' },
      { op: 'applyRules', settings: { courtsMode: 'fixed', courts: 1, limitType: 'rounds', limitValue: 5 } },
      { op: 'playAll', scorer: 'draws' }
    ]
  },
  {
    name: 'switch to fixed before results', seed: 10, players: names(8), settings: fixedCourts({ courts: 2, limitType: 'rounds', limitValue: 2 }),
    ops: [
      { op: 'generate' },
      { op: 'applyRules', settings: { partners: 'fixed', courtsMode: 'fixed', courts: 2, limitType: 'rounds', limitValue: 2 } },
      { op: 'playAll', scorer: 'cycle' }
    ]
  },
  {
    name: 'fixed teams removed and restored', seed: 13, teams: pairs(5), settings: fixedCourts({ partners: 'fixed', courts: 2, limitType: 'rounds', limitValue: 4 }),
    ops: [
      { op: 'generate' }, { op: 'scoreLast', scorer: 'cycle' }, { op: 'removeTeam', index: 1 }, { op: 'removeTeam', index: 4 },
      { op: 'addTeam', a: 'X', b: 'Y' }, { op: 'restore', index: 1, team: true }, { op: 'playAll', scorer: 'fixed' }
    ]
  },
  // Sets, empates y puntos combinables
  {
    name: 'sets and draws', seed: 14, players: names(8),
    settings: fixedCourts({ courts: 2, limitType: 'rounds', limitValue: 3, scoring: { games: { on: true, points: 1 }, sets: { on: true, points: 2 }, match: { on: true, points: 3 } } }),
    ops: [{ op: 'playAll', scorer: 'draws', sets: true }, { op: 'toggleScoring', kind: 'games', on: false }]
  },
  // Cronómetro de la ronda
  {
    name: 'round clock', seed: 15, players: names(4), settings: fixedCourts({ courts: 1, limitType: 'rounds', limitValue: 2, matchMinutes: 10 }),
    ops: [
      { op: 'generate', clockAt: NOW },
      { op: 'startClock', round: 0, now: NOW, clockAt: NOW + 60000 },
      { op: 'pauseClock', round: 0, now: NOW + 125500, clockAt: NOW + 900000 },
      { op: 'resumeClock', round: 0, now: NOW + 200000, clockAt: NOW + 400000 },
      { op: 'resetClock', round: 0, clockAt: NOW + 400000 },
      { op: 'startClock', round: 0, now: NOW, clockAt: NOW + 700000 }
    ]
  }
]

/** Los casos, como quedan en engine.json. */
export function build () {
  return JSON.stringify({
    note: 'Generado por test/vectors/gen.mjs desde src/tournament/engine.js; no se edita a mano.',
    cases: CASES.map(run)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL('./engine.json', import.meta.url)
  writeFileSync(out, build())
  console.log(`${CASES.length} cases → ${out.pathname}`)
}
