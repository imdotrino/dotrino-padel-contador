import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTournament, addPlayer, addTeam, generateRound, standings, status, estimate,
  setScore, nextRoundBlocker, redoLastRound, setPartners, removePlayer, removeTeam,
  appearances, hasResults, defaultSettings, SCORE_KINDS, setSets, outcome, toggleScoring,
  clockOf, startClock, pauseClock, resumeClock, resetClock, formatClock, migrateTournament,
  maxCourts, courtsInUse, builtinRulesets, applyRules, canApplyRules, checkSettings
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

test('standings: games and match points, alone or added up', () => {
  const t = withPlayers(4, { courts: 1, limitType: 'rounds', limitValue: 2 })
  const [p0, p1, p2, p3] = t.players.map(p => p.id)
  t.rounds.push({ id: 'r1', rest: [], clock: null, matches: [{ id: 'm1', court: 1, a: [p0, p1], b: [p2, p3], teams: null, score: { a: 6, b: 4 }, sets: null }] })
  t.rounds.push({ id: 'r2', rest: [], clock: null, matches: [{ id: 'm2', court: 1, a: [p0, p2], b: [p1, p3], teams: null, score: { a: 2, b: 6 }, sets: null }] })
  const only = kind => { for (const k of SCORE_KINDS) t.settings.scoring[k].on = k === kind }

  only('games')
  const games = standings(t)
  // p1: 6+6=12, p3: 4+6=10, p0: 6+2=8, p2: 4+2=6
  assert.deepEqual(games.map(r => r.id), [p1, p3, p0, p2])
  assert.equal(games[0].points, 12)

  only('match')
  const match = standings(t)
  // p1 ganó 2 (6 pts); p0 y p3 ganaron 1 (3 pts): desempata la diferencia de juegos
  // (p3: 10-8=+2, p0: 8-10=-2).
  assert.deepEqual(match.map(r => r.id), [p1, p3, p0, p2])
  assert.equal(match[0].points, 6)

  // Por defecto se suman juego (1) y partido (3): p1 = 12 + 6.
  t.settings.scoring = defaultSettings().scoring
  assert.equal(standings(t)[0].points, 18)
})

test('sets decide the winner and add their own points; a draw gives no match points', () => {
  const t = withPlayers(4, { courts: 1, limitType: 'rounds', limitValue: 1 })
  const r = generateRound(t, seeded(1))
  t.rounds.push(r)
  const m = r.matches[0]
  const row = id => standings(t).find(x => x.id === id)
  // Más juegos para b, pero a ganó 2 sets a 1: gana a.
  setScore(t, m.id, 13, 15)
  setSets(t, m.id, 2, 1)
  assert.equal(outcome(m), 'a')
  toggleScoring(t, 'sets', true)
  // a: 13 juegos × 1 + 2 sets × 2 + partido 3 = 20 · b: 15 + 1 × 2 = 17
  assert.equal(row(m.a[0]).points, 20)
  assert.equal(row(m.b[0]).points, 17)
  // Sets empatados: deciden los juegos.
  setSets(t, m.id, 1, 1)
  assert.equal(outcome(m), 'b')
  // Sin sets y con los juegos empatados: empate, y nadie suma el partido.
  setSets(t, m.id, null, null)
  setScore(t, m.id, 4, 4)
  assert.equal(outcome(m), 'draw')
  assert.ok(standings(t).every(x => x.won === 0 && x.drawn === 1 && x.points === 4))
})

test('the last scoring kind turned on cannot be turned off', () => {
  const t = withPlayers(4, {})
  toggleScoring(t, 'games', false)
  assert.throws(() => toggleScoring(t, 'match', false), /at least one/)
  toggleScoring(t, 'sets', true)
  toggleScoring(t, 'match', false)
  assert.deepEqual(SCORE_KINDS.filter(k => t.settings.scoring[k].on), ['sets'])
})

test('matches end on time by default; the round clock runs, pauses and ends on instants', () => {
  const t = withPlayers(4, { courts: 1 })
  assert.equal(t.settings.matchEnd, 'time')
  const r = generateRound(t, seeded(1))
  t.rounds.push(r)
  const T = 1_000_000
  const MIN = 60000
  assert.deepEqual(clockOf(t, r, T), { state: 'idle', remainingMs: 20 * MIN, minutes: 20 })
  t.settings.matchMinutes = 10 // antes de empezar: cuenta
  startClock(t, r.id, T)
  t.settings.matchMinutes = 30 // ya empezado: no cuenta
  assert.deepEqual(clockOf(t, r, T + MIN), { state: 'running', remainingMs: 9 * MIN, minutes: 10 })
  pauseClock(t, r.id, T + MIN)
  assert.deepEqual(clockOf(t, r, T + 10 * MIN), { state: 'paused', remainingMs: 9 * MIN, minutes: 10 })
  resumeClock(t, r.id, T + 10 * MIN)
  assert.equal(clockOf(t, r, T + 19 * MIN - 1).state, 'running')
  assert.deepEqual(clockOf(t, r, T + 19 * MIN), { state: 'done', remainingMs: 0, minutes: 10 })
  assert.deepEqual(clockOf(t, r, T + 99 * MIN), { state: 'done', remainingMs: 0, minutes: 10 })
  assert.throws(() => startClock(t, r.id, T), /already started/)
  assert.throws(() => pauseClock(t, r.id, T + 99 * MIN), /not running/)
  resetClock(t, r.id)
  assert.equal(clockOf(t, r, T).state, 'idle')
  t.settings.matchEnd = 'games'
  assert.throws(() => startClock(t, r.id, T), /does not play on time/)
  assert.equal(formatClock(9 * MIN + 1), '9:01')
  assert.equal(formatClock(MIN - 1), '1:00')
  assert.equal(formatClock(0), '0:00')
})

test('MIGRACIÓN (se quita el 2026-10-15): a tournament saved before keeps playing as it did', () => {
  const old = withPlayers(4, { courts: 1 })
  old.rounds.push(generateRound(old, seeded(1)))
  // Lo que traía un torneo guardado antes del cronómetro y de los puntos combinables.
  old.settings.scoring = 'match'
  delete old.settings.matchEnd
  delete old.settings.matchMinutes
  delete old.rounds[0].clock
  delete old.rounds[0].matches[0].sets
  delete old.rulesetId
  migrateTournament(old)
  assert.equal(old.rulesetId, null)
  assert.equal(old.settings.matchEnd, 'games')
  assert.deepEqual(SCORE_KINDS.filter(k => old.settings.scoring[k].on), ['match'])
  assert.equal(old.settings.scoring.match.points, 3)
  assert.equal(old.rounds[0].clock, null)
  assert.equal(old.rounds[0].matches[0].sets, null)
  old.settings.scoring = 'weird'
  assert.throws(() => migrateTournament(old), /at least one/)
})

test('correcting a result of an earlier round never changes the rounds already created (by score)', () => {
  const t = withPlayers(8, { courts: 2, pairing: 'ranked', limitType: 'rounds', limitValue: 5 })
  const r1 = generateRound(t, seeded(3))
  t.rounds.push(r1)
  setScore(t, r1.matches[0].id, 6, 1)
  setScore(t, r1.matches[1].id, 6, 2)
  t.rounds.push(generateRound(t, seeded(3)))
  const snapshot = JSON.stringify(t.rounds[1])
  const table = standings(t).map(x => x.id)
  // Corrección: el resultado de la cancha 1 era al revés.
  setScore(t, r1.matches[0].id, 1, 6)
  assert.equal(JSON.stringify(t.rounds[1]), snapshot, 'round 2 stays as it was drawn')
  assert.notDeepEqual(standings(t).map(x => x.id), table, 'the table does change')
})

test('courts in use never exceed players / 4 (pairs / 2), and are at least one', () => {
  const t = withPlayers(9, { courts: 3 })
  assert.equal(maxCourts(t), 2)
  assert.equal(courtsInUse(t), 2)
  for (const name of ['X', 'Y', 'Z']) addPlayer(t, name)
  assert.equal(courtsInUse(t), 3, 'with 12 players the 3 courts fit again')
  assert.equal(generateRound(t, seeded(1)).matches.length, 3)
  assert.equal(courtsInUse(withPlayers(2, { courts: 2 })), 1)
  const fixed = createTournament({ settings: { partners: 'fixed', courts: 4 } })
  for (let i = 0; i < 5; i++) addTeam(fixed, 'A' + i, 'B' + i)
  assert.equal(courtsInUse(fixed), 2)
})

test('rule sets: built-ins are valid; applying copies the rules and never half-applies', () => {
  const [time, games] = builtinRulesets()
  for (const set of builtinRulesets()) checkSettings(set.settings)
  assert.equal(time.settings.matchEnd, 'time')
  assert.deepEqual([games.settings.matchEnd, games.settings.gamesPerMatch], ['games', 6])
  assert.notEqual(builtinRulesets()[0].settings, time.settings, 'each call gives fresh objects')

  const t = withPlayers(8, { courts: 2 })
  applyRules(t, games.settings)
  assert.equal(t.settings.matchEnd, 'games')
  games.settings.gamesPerMatch = 9 // editar el set después no toca el torneo
  games.settings.scoring.sets.on = true
  assert.equal(t.settings.gamesPerMatch, 6)
  assert.equal(t.settings.scoring.sets.on, false)

  t.rounds.push(generateRound(t, seeded(1)))
  setScore(t, t.rounds[0].matches[0].id, 6, 2)
  const fixed = { ...defaultSettings(), partners: 'fixed', matchEnd: 'time' }
  assert.equal(canApplyRules(t, fixed), false)
  assert.throws(() => applyRules(t, fixed), /locked/)
  assert.deepEqual([t.settings.partners, t.settings.matchEnd], ['rotating', 'games'], 'nothing half-applied')
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
