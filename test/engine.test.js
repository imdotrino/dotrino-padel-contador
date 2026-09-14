import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTournament, addPlayer, addTeam, generateRound, standings, status, estimate,
  setScore, nextRoundBlocker, redoLastRound, setPartners, removePlayer, removeTeam,
  appearances, hasResults
} from '../src/tournament/engine.js'

// Azar con semilla, para que un fallo se pueda repetir.
function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function withPlayers (n, settings) {
  const t = createTournament({ name: 'test', settings })
  for (let i = 0; i < n; i++) addPlayer(t, 'P' + i)
  return t
}

function playAll (t, rng, scorer = () => [6, 3]) {
  for (let guard = 0; guard < 200; guard++) {
    const r = generateRound(t, rng)
    if (!r) return
    t.rounds.push(r)
    for (const m of r.matches) {
      const [a, b] = scorer(m)
      setScore(t, m.id, a, b)
    }
  }
  throw new Error('tournament never ended')
}

const partnerCounts = t => {
  const c = new Map()
  for (const r of t.rounds) {
    for (const m of r.matches) {
      for (const [x, y] of [m.a, m.b]) {
        const k = [x, y].sort().join('|')
        c.set(k, (c.get(k) || 0) + 1)
      }
    }
  }
  return c
}

test('random rotating: 8 players, 2 courts, 3 matches each, no partner repeats', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = withPlayers(8, { courts: 2, limitType: 'perPlayer', limitValue: 3 })
    playAll(t, seeded(seed))
    const ap = appearances(t)
    assert.equal(t.rounds.length, 3)
    for (const p of t.players) assert.equal(ap.get(p.id), 3)
    assert.ok([...partnerCounts(t).values()].every(n => n === 1), `seed ${seed} repeated a partner`)
    assert.equal(status(t).finished, true)
  }
})

test('random rotating: 5 players on 1 court rest in turns and play the same', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = withPlayers(5, { courts: 1, limitType: 'perPlayer', limitValue: 4 })
    playAll(t, seeded(seed))
    const ap = appearances(t)
    assert.equal(t.rounds.length, 5)
    for (const p of t.players) assert.equal(ap.get(p.id), 4)
    const rests = new Map()
    for (const r of t.rounds) {
      assert.equal(r.rest.length, 1)
      rests.set(r.rest[0], (rests.get(r.rest[0]) || 0) + 1)
    }
    assert.equal(rests.size, 5, 'everyone rests exactly once')
  }
})

test('perPlayer with slots that do not divide: someone plays one extra, nobody plays less', () => {
  const t = withPlayers(5, { courts: 1, limitType: 'perPlayer', limitValue: 3 })
  playAll(t, seeded(7))
  const ap = appearances(t)
  const values = t.players.map(p => ap.get(p.id))
  assert.ok(values.every(v => v >= 3))
  assert.equal(values.reduce((a, b) => a + b, 0) % 4, 0)
})

test('limit by rounds and by total matches', () => {
  const byRounds = withPlayers(9, { courts: 2, limitType: 'rounds', limitValue: 4 })
  playAll(byRounds, seeded(3))
  assert.equal(byRounds.rounds.length, 4)
  assert.equal(byRounds.rounds.every(r => r.matches.length === 2 && r.rest.length === 1), true)

  const byMatches = withPlayers(8, { courts: 2, limitType: 'matches', limitValue: 5 })
  playAll(byMatches, seeded(3))
  assert.deepEqual(byMatches.rounds.map(r => r.matches.length), [2, 2, 1])
  assert.equal(nextRoundBlocker(byMatches), 'finished')
})

test('needs 4 players to rotate, 3 teams when fixed', () => {
  assert.equal(nextRoundBlocker(withPlayers(3, {})), 'players')
  assert.equal(nextRoundBlocker(withPlayers(4, {})), null)
  const fixed = createTournament({ settings: { partners: 'fixed' } })
  addTeam(fixed, 'a', 'b')
  addTeam(fixed, 'c', 'd')
  assert.equal(nextRoundBlocker(fixed), 'players')
  addTeam(fixed, 'e', 'f')
  assert.equal(nextRoundBlocker(fixed), null)
})

test('fixed pairs, random: 4 teams, 3 rounds is a full round robin', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = createTournament({ settings: { partners: 'fixed', courts: 2, limitType: 'rounds', limitValue: 3 } })
    for (let i = 0; i < 4; i++) addTeam(t, 'A' + i, 'B' + i)
    playAll(t, seeded(seed))
    const faced = new Set()
    for (const r of t.rounds) {
      for (const m of r.matches) {
        const k = m.teams.slice().sort().join('|')
        assert.ok(!faced.has(k), `seed ${seed} repeated a matchup`)
        faced.add(k)
      }
    }
    assert.equal(faced.size, 6)
  }
})

test('fixed pairs with an odd count: one team rests each round, in turns', () => {
  const t = createTournament({ settings: { partners: 'fixed', courts: 2, limitType: 'perPlayer', limitValue: 4 } })
  for (let i = 0; i < 5; i++) addTeam(t, 'A' + i, 'B' + i)
  playAll(t, seeded(11))
  const ap = appearances(t)
  for (const team of t.teams) assert.equal(ap.get(team.id), 4)
})

test('ranked rotating: court 1 gets the top four, 1st+4th against 2nd+3rd', () => {
  const t = withPlayers(8, { courts: 2, pairing: 'ranked', limitType: 'rounds', limitValue: 5 })
  const r1 = generateRound(t, seeded(5))
  t.rounds.push(r1)
  // Cancha 1 gana 6-0 y cancha 2 gana 6-4: queda un orden estricto por puntos.
  setScore(t, r1.matches[0].id, 6, 0)
  setScore(t, r1.matches[1].id, 5, 1)
  const table = standings(t).map(row => row.id)
  const r2 = generateRound(t, seeded(5))
  const top = table.slice(0, 4)
  const court1 = r2.matches[0]
  assert.deepEqual([...court1.a, ...court1.b].sort(), top.slice().sort())
  // En la ronda 1, 1.º y 2.º fueron pareja (ganaron 6-0): no se repite.
  const first = new Set(court1.a)
  assert.ok(!(first.has(table[0]) && first.has(table[1])))
})

test('standings by games and by match', () => {
  const t = withPlayers(4, { courts: 1, limitType: 'rounds', limitValue: 2 })
  const [p0, p1, p2, p3] = t.players.map(p => p.id)
  t.rounds.push({ id: 'r1', rest: [], matches: [{ id: 'm1', court: 1, a: [p0, p1], b: [p2, p3], teams: null, score: { a: 6, b: 4 } }] })
  t.rounds.push({ id: 'r2', rest: [], matches: [{ id: 'm2', court: 1, a: [p0, p2], b: [p1, p3], teams: null, score: { a: 2, b: 6 } }] })

  const games = standings(t)
  // p1: 6+6=12, p3: 4+6=10, p0: 6+2=8, p2: 4+2=6
  assert.deepEqual(games.map(r => r.id), [p1, p3, p0, p2])
  assert.equal(games[0].points, 12)

  t.settings.scoring = 'match'
  const match = standings(t)
  // p1 ganó 2 (6 pts); p0 y p3 ganaron 1 (3 pts): desempata la diferencia de juegos
  // (p3: 10-8=+2, p0: 8-10=-2).
  assert.deepEqual(match.map(r => r.id), [p1, p3, p0, p2])
  assert.equal(match[0].points, 6)
})

test('a partial score does not count', () => {
  const t = withPlayers(4, { courts: 1 })
  const r = generateRound(t, seeded(1))
  t.rounds.push(r)
  setScore(t, r.matches[0].id, 6, null)
  assert.equal(hasResults(t), false)
  assert.equal(standings(t).every(row => row.played === 0), true)
})

test('editing after round 1 only affects the rounds generated later', () => {
  const t = withPlayers(8, { courts: 2, limitType: 'perPlayer', limitValue: 3 })
  const r1 = generateRound(t, seeded(9))
  t.rounds.push(r1)
  const snapshot = JSON.stringify(r1)
  const late = addPlayer(t, 'Late')
  t.settings.courts = 1
  const r2 = generateRound(t, seeded(9))
  assert.equal(JSON.stringify(t.rounds[0]), snapshot)
  assert.equal(r2.matches.length, 1)
  const inR2 = [...r2.matches[0].a, ...r2.matches[0].b]
  assert.ok(inR2.includes(late.id), 'the new player has played least, so plays first')
})

test('removing a scheduled player retires them; an unscheduled one is deleted', () => {
  const t = withPlayers(5, { courts: 1 })
  const r = generateRound(t, seeded(2))
  t.rounds.push(r)
  assert.equal(removePlayer(t, r.matches[0].a[0]), 'retired')
  assert.equal(t.players.length, 5)
  assert.equal(removePlayer(t, r.rest[0]), 'deleted')
  assert.equal(t.players.length, 4)
  assert.equal(nextRoundBlocker(t), 'players')
})

test('removing a team with matches retires it', () => {
  const t = createTournament({ settings: { partners: 'fixed', courts: 1 } })
  for (let i = 0; i < 3; i++) addTeam(t, 'A' + i, 'B' + i)
  const r = generateRound(t, seeded(4))
  t.rounds.push(r)
  assert.equal(removeTeam(t, r.matches[0].teams[0]), 'retired')
  assert.equal(removeTeam(t, r.rest[0]), 'deleted')
  assert.equal(t.teams.length, 2)
  assert.equal(t.players.length, 4)
})

test('redo only while the last round has no results; partners mode locks with results', () => {
  const t = withPlayers(8, { courts: 2 })
  t.rounds.push(generateRound(t, seeded(1)))
  const before = t.rounds[0].id
  redoLastRound(t, seeded(2))
  assert.notEqual(t.rounds[0].id, before)

  setPartners(t, 'fixed', seeded(3))
  assert.equal(t.teams.length, 4)
  assert.ok(t.rounds[0].matches.every(m => m.teams))

  setScore(t, t.rounds[0].matches[0].id, 6, 2)
  assert.throws(() => redoLastRound(t), /already has results/)
  assert.throws(() => setPartners(t, 'rotating'), /locked/)
})

test('estimate', () => {
  assert.deepEqual(estimate(withPlayers(8, { courts: 2, limitType: 'perPlayer', limitValue: 3 })), { matches: 6, rounds: 3, exact: false })
  assert.deepEqual(estimate(withPlayers(9, { courts: 4, limitType: 'rounds', limitValue: 4 })), { matches: 8, rounds: 4, exact: true })
  assert.equal(estimate(withPlayers(3, {})), null)
})

test('unknown settings fail loudly', () => {
  const t = withPlayers(4, { limitType: 'forever' })
  assert.throws(() => generateRound(t), /unknown limit type/)
})
