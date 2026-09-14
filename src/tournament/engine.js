// Lógica pura del torneo: sin DOM ni almacén. Todo lo que la UI enseña de un torneo
// (rondas, descansos, clasificación, si ya terminó) sale de aquí, y por eso se prueba
// con `node --test` sin navegador.
//
// Modelo:
//   players: [{ id, name, active }]              todos los jugadores, en cualquier modo
//   teams:   [{ id, players: [pid, pid], active }] parejas fijas (solo cuentan en 'fixed')
//   rounds:  [{ id, matches, rest }]
//     match: { id, court, a: [pid, pid], b: [pid, pid], teams: [tidA, tidB] | null,
//              score: { a, b } | null }
//     rest:  ids de las UNIDADES que descansan (jugadores o parejas, según el modo)
//
// La «unidad» es lo que se programa y se clasifica: el jugador cuando las parejas
// rotan, la pareja cuando son fijas.
//
// Una ronda ya generada NO se toca al editar la configuración ni un resultado: esos
// cambios solo cuentan para las rondas que se generen después. Es lo que pidió el
// dueño: editar en cualquier momento sin alterar el orden ni los resultados.

export const MIN_PLAYERS = 4 // parejas que rotan: una cancha necesita cuatro
export const MIN_TEAMS = 3 // parejas fijas: con dos no hay torneo, hay un partido

const PARTNERS = ['rotating', 'fixed']
const PAIRINGS = ['random', 'ranked']
const LIMITS = ['perPlayer', 'rounds', 'matches']
const SCORINGS = ['games', 'match']

export const DEFAULT_SETTINGS = Object.freeze({
  partners: 'rotating',
  pairing: 'random',
  courts: 2,
  limitType: 'perPlayer',
  limitValue: 3,
  scoring: 'games', // 'games': un punto por juego ganado · 'match': 3 por partido ganado, 1 por empate
  gamesPerMatch: 6 // 0 = libre: el marcador no propone cerrar el partido
})

// Repetir pareja pesa mucho más que repetir rival: lo primero es lo que el modo al
// azar promete evitar; lo segundo solo se procura.
const PARTNER_WEIGHT = 100
const RESTARTS = 24

const newId = () => crypto.randomUUID()
const key = (x, y) => (x < y ? x + '|' + y : y + '|' + x)
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1)
const count = (map, k) => map.get(k) || 0

function checkSettings (s) {
  if (!PARTNERS.includes(s.partners)) throw new Error(`unknown partners mode: ${s.partners}`)
  if (!PAIRINGS.includes(s.pairing)) throw new Error(`unknown pairing mode: ${s.pairing}`)
  if (!LIMITS.includes(s.limitType)) throw new Error(`unknown limit type: ${s.limitType}`)
  if (!SCORINGS.includes(s.scoring)) throw new Error(`unknown scoring: ${s.scoring}`)
  if (!Number.isInteger(s.courts) || s.courts < 1) throw new Error(`invalid courts: ${s.courts}`)
  if (!Number.isInteger(s.limitValue) || s.limitValue < 1) throw new Error(`invalid limit: ${s.limitValue}`)
}

// ---------- construcción ----------

export function createTournament ({ name = '', settings = {}, players = [], teams = [] } = {}) {
  const now = Date.now()
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players,
    teams,
    rounds: []
  }
}

export function addPlayer (t, name) {
  const p = { id: newId(), name, active: true }
  t.players.push(p)
  return p
}

export function addTeam (t, nameA, nameB) {
  const a = addPlayer(t, nameA)
  const b = addPlayer(t, nameB)
  const team = { id: newId(), players: [a.id, b.id], active: true }
  t.teams.push(team)
  return team
}

// ---------- consultas ----------

export const isFixed = t => t.settings.partners === 'fixed'
export const slotsPerMatch = t => (isFixed(t) ? 2 : 4)
export const minUnits = t => (isFixed(t) ? MIN_TEAMS : MIN_PLAYERS)

export function activeUnits (t) {
  return (isFixed(t) ? t.teams : t.players).filter(u => u.active).map(u => u.id)
}

export const hasScore = m =>
  m.score != null && Number.isInteger(m.score.a) && Number.isInteger(m.score.b)

export const hasResults = t => t.rounds.some(r => r.matches.some(hasScore))

export const countMatches = t => t.rounds.reduce((n, r) => n + r.matches.length, 0)

export function findMatch (t, matchId) {
  for (const r of t.rounds) {
    const m = r.matches.find(x => x.id === matchId)
    if (m) return m
  }
  return null
}

export const playerScheduled = (t, pid) =>
  t.rounds.some(r => r.matches.some(m => m.a.includes(pid) || m.b.includes(pid)))

export const teamScheduled = (t, tid) =>
  t.rounds.some(r => r.matches.some(m => m.teams && m.teams.includes(tid)))

// Lados de un partido expresados en unidades del modo vigente.
function unitSides (m, fixed) {
  if (!fixed) return [m.a, m.b]
  if (!m.teams) throw new Error(`match ${m.id} has no teams but the tournament uses fixed pairs`)
  return [[m.teams[0]], [m.teams[1]]]
}

// Lo que ya pasó: cuántas veces jugó y descansó cada unidad, cuándo jugó por última
// vez, y cuántas veces coincidieron dos jugadores (o parejas) como compañeros o rivales.
// Cuenta los partidos PROGRAMADOS, con o sin resultado: la ronda que ya se anunció se
// va a jugar.
function history (t) {
  const fixed = isFixed(t)
  const h = { appearances: new Map(), rests: new Map(), lastPlayed: new Map(), partners: new Map(), opponents: new Map() }
  t.rounds.forEach((r, ri) => {
    for (const u of r.rest) bump(h.rests, u)
    for (const m of r.matches) {
      const [sa, sb] = unitSides(m, fixed)
      for (const u of [...sa, ...sb]) {
        bump(h.appearances, u)
        h.lastPlayed.set(u, ri)
      }
      bump(h.partners, key(m.a[0], m.a[1]))
      bump(h.partners, key(m.b[0], m.b[1]))
      for (const x of sa) for (const y of sb) bump(h.opponents, key(x, y))
    }
  })
  return h
}

export function appearances (t) {
  return history(t).appearances
}

export function limitReached (t, h = history(t)) {
  const { limitType, limitValue } = t.settings
  if (limitType === 'rounds') return t.rounds.length >= limitValue
  if (limitType === 'matches') return countMatches(t) >= limitValue
  if (limitType === 'perPlayer') {
    const units = activeUnits(t)
    return units.length > 0 && units.every(u => count(h.appearances, u) >= limitValue)
  }
  throw new Error(`unknown limit type: ${limitType}`)
}

// Por qué no se puede generar otra ronda, o null si se puede.
export function nextRoundBlocker (t) {
  if (activeUnits(t).length < minUnits(t)) return 'players'
  if (limitReached(t)) return 'finished'
  return null
}

export function status (t) {
  const scheduled = countMatches(t)
  const scored = t.rounds.reduce((n, r) => n + r.matches.filter(hasScore).length, 0)
  const reached = limitReached(t)
  return { scheduled, scored, reached, finished: reached && scheduled > 0 && scored === scheduled }
}

// Cuántos partidos y rondas tendrá el torneo con la configuración y los jugadores de
// ahora. Exacto por rondas o partidos totales; aproximado por jugador, porque cuando
// los que faltan no llenan una cancha alguien juega uno de más para completarla.
export function estimate (t) {
  const units = activeUnits(t)
  const slots = slotsPerMatch(t)
  const courts = Math.min(t.settings.courts, Math.floor(units.length / slots))
  if (courts < 1) return null
  const { limitType, limitValue } = t.settings
  const done = countMatches(t)
  const doneRounds = t.rounds.length
  if (limitType === 'rounds') {
    const left = Math.max(0, limitValue - doneRounds)
    return { matches: done + left * courts, rounds: doneRounds + left, exact: true }
  }
  let left
  if (limitType === 'matches') left = Math.max(0, limitValue - done)
  else {
    const h = history(t)
    const deficit = units.reduce((n, u) => n + Math.max(0, limitValue - count(h.appearances, u)), 0)
    left = Math.ceil(deficit / slots)
  }
  return { matches: done + left, rounds: doneRounds + Math.ceil(left / courts), exact: limitType === 'matches' }
}

// ---------- clasificación ----------

export function standings (t) {
  checkSettings(t.settings)
  const fixed = isFixed(t)
  const rows = new Map((fixed ? t.teams : t.players).map(u => [u.id, {
    id: u.id, active: u.active, played: 0, won: 0, drawn: 0, lost: 0, gamesFor: 0, gamesAgainst: 0, points: 0
  }]))
  const tally = (side, own, other) => {
    for (const u of side) {
      const row = rows.get(u)
      if (!row) throw new Error(`match references unknown unit ${u}`)
      row.played++
      row.gamesFor += own
      row.gamesAgainst += other
      if (own > other) row.won++
      else if (own < other) row.lost++
      else row.drawn++
    }
  }
  for (const r of t.rounds) {
    for (const m of r.matches) {
      if (!hasScore(m)) continue
      const [sa, sb] = unitSides(m, fixed)
      tally(sa, m.score.a, m.score.b)
      tally(sb, m.score.b, m.score.a)
    }
  }
  const byMatch = t.settings.scoring === 'match'
  for (const row of rows.values()) row.points = byMatch ? row.won * 3 + row.drawn : row.gamesFor
  const diff = x => x.gamesFor - x.gamesAgainst
  const tie = byMatch
    ? (x, y) => diff(y) - diff(x) || y.gamesFor - x.gamesFor
    : (x, y) => y.won - x.won || diff(y) - diff(x)
  return [...rows.values()].sort((x, y) => y.points - x.points || tie(x, y))
}

// ---------- generación de rondas ----------

function shuffle (items, rng) {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const swap = (a, i, j) => { [a[i], a[j]] = [a[j], a[i]] }

function rotatingCost (arr, h) {
  let c = 0
  for (let i = 0; i < arr.length; i += 4) {
    const [p0, p1, p2, p3] = [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]]
    const pa = count(h.partners, key(p0, p1))
    const pb = count(h.partners, key(p2, p3))
    c += PARTNER_WEIGHT * (pa * pa + pb * pb)
    for (const [x, y] of [[p0, p2], [p0, p3], [p1, p2], [p1, p3]]) {
      const o = count(h.opponents, key(x, y))
      c += o * o
    }
  }
  return c
}

function teamCost (arr, h) {
  let c = 0
  for (let i = 0; i < arr.length; i += 2) {
    const o = count(h.opponents, key(arr[i], arr[i + 1]))
    c += o * o
  }
  return c
}

// Busca el reparto que menos repite: varios arranques al azar y, en cada uno,
// intercambios de dos posiciones mientras el coste baje.
function bestArrangement (items, cost, rng) {
  let best = null
  let bestCost = Infinity
  for (let r = 0; r < RESTARTS && bestCost > 0; r++) {
    const arr = shuffle(items, rng)
    let c = cost(arr)
    let improved = true
    while (improved && c > 0) {
      improved = false
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          swap(arr, i, j)
          const nc = cost(arr)
          if (nc < c) { c = nc; improved = true } else swap(arr, i, j)
        }
      }
    }
    if (c < bestCost) { best = arr.slice(); bestCost = c }
  }
  return best
}

function byStanding (t, ids) {
  const rank = new Map(standings(t).map((row, i) => [row.id, i]))
  return ids.slice().sort((x, y) => rank.get(x) - rank.get(y))
}

// Por puntaje, parejas que rotan: de cuatro en cuatro según la tabla, y en cada
// cancha 1.º+4.º contra 2.º+3.º. Si esa pareja ya jugó junta, la opción que menos repita.
function rankedPlayers (t, playing, h) {
  const order = byStanding(t, playing)
  const out = []
  for (let i = 0; i < order.length; i += 4) {
    const [p1, p2, p3, p4] = order.slice(i, i + 4)
    const options = [[p1, p4, p2, p3], [p1, p3, p2, p4], [p1, p2, p3, p4]]
    let best = options[0]
    let bestCost = Infinity
    for (const o of options) {
      const c = count(h.partners, key(o[0], o[1])) + count(h.partners, key(o[2], o[3]))
      if (c < bestCost) { best = o; bestCost = c }
    }
    out.push(...best)
  }
  return out
}

// Por puntaje, parejas fijas: 1.º contra 2.º, 3.º contra 4.º… Si ya se enfrentaron y
// cambiar al rival por el siguiente de la tabla repite menos, se cambia.
function rankedTeams (t, playing, h) {
  const order = byStanding(t, playing)
  for (let i = 0; i + 3 < order.length; i += 2) {
    if (count(h.opponents, key(order[i], order[i + 1])) > count(h.opponents, key(order[i], order[i + 2]))) {
      swap(order, i + 1, i + 2)
    }
  }
  return order
}

// Genera la ronda siguiente sin tocar las anteriores, o null si no toca otra.
// Juegan primero los que menos partidos llevan (y, a igualdad, los que más
// descansaron y los que hace más que no juegan); el resto descansa.
export function generateRound (t, rng = Math.random) {
  checkSettings(t.settings)
  if (nextRoundBlocker(t)) return null
  const h = history(t)
  const units = activeUnits(t)
  const slots = slotsPerMatch(t)
  const courts = Math.min(t.settings.courts, Math.floor(units.length / slots))
  const { limitType, limitValue } = t.settings
  let size = courts
  if (limitType === 'matches') size = Math.min(courts, limitValue - countMatches(t))
  if (limitType === 'perPlayer') {
    const short = units.filter(u => count(h.appearances, u) < limitValue).length
    size = Math.min(courts, Math.ceil(short / slots))
  }

  const order = shuffle(units, rng).sort((x, y) =>
    count(h.appearances, x) - count(h.appearances, y) ||
    count(h.rests, y) - count(h.rests, x) ||
    (h.lastPlayed.get(x) ?? -1) - (h.lastPlayed.get(y) ?? -1))
  const playing = order.slice(0, size * slots)
  const rest = order.slice(size * slots)
  // La primera ronda por puntaje no tiene puntaje del que partir: va al azar.
  const ranked = t.settings.pairing === 'ranked' && hasResults(t)

  let groups
  if (isFixed(t)) {
    const arr = ranked ? rankedTeams(t, playing, h) : bestArrangement(playing, a => teamCost(a, h), rng)
    const team = id => t.teams.find(x => x.id === id)
    groups = []
    for (let i = 0; i < arr.length; i += 2) {
      groups.push({ a: team(arr[i]).players.slice(), b: team(arr[i + 1]).players.slice(), teams: [arr[i], arr[i + 1]] })
    }
  } else {
    const arr = ranked ? rankedPlayers(t, playing, h) : bestArrangement(playing, a => rotatingCost(a, h), rng)
    groups = []
    for (let i = 0; i < arr.length; i += 4) {
      groups.push({ a: [arr[i], arr[i + 1]], b: [arr[i + 2], arr[i + 3]], teams: null })
    }
  }
  return {
    id: newId(),
    matches: groups.map((g, i) => ({ id: newId(), court: i + 1, ...g, score: null })),
    rest
  }
}

// ---------- ediciones ----------

export function setScore (t, matchId, a, b) {
  const m = findMatch(t, matchId)
  if (!m) throw new Error(`unknown match ${matchId}`)
  m.score = a == null && b == null ? null : { a, b }
}

const lastRoundScored = t => t.rounds.length > 0 && t.rounds[t.rounds.length - 1].matches.some(m => m.score != null)

export const canRedoLastRound = t => t.rounds.length > 0 && !lastRoundScored(t)

export function redoLastRound (t, rng = Math.random) {
  if (!canRedoLastRound(t)) throw new Error('the last round already has results')
  t.rounds.pop()
  const r = generateRound(t, rng)
  if (r) t.rounds.push(r)
  return r
}

export function removeLastRound (t) {
  if (!canRedoLastRound(t)) throw new Error('the last round already has results')
  t.rounds.pop()
}

// Cambiar entre parejas fijas y rotativas cambia qué se programa y qué se clasifica,
// así que solo se permite mientras no haya resultados. Las rondas sin resultados se
// rehacen con el modo nuevo.
export function setPartners (t, mode, rng = Math.random) {
  if (!PARTNERS.includes(mode)) throw new Error(`unknown partners mode: ${mode}`)
  if (hasResults(t)) throw new Error('partners mode is locked once there are results')
  t.settings.partners = mode
  if (mode === 'fixed' && !t.teams.some(x => x.active)) {
    const free = t.players.filter(p => p.active)
    for (let i = 0; i + 1 < free.length; i += 2) {
      t.teams.push({ id: newId(), players: [free[i].id, free[i + 1].id], active: true })
    }
  }
  const had = t.rounds.length > 0
  t.rounds = []
  if (had) {
    const r = generateRound(t, rng)
    if (r) t.rounds.push(r)
  }
}

// Quitar a quien ya tiene partidos programados lo RETIRA (sigue en la tabla y en sus
// partidos, pero no entra en las rondas nuevas). A quien no jugó nada se le borra.
export function removePlayer (t, pid) {
  const p = t.players.find(x => x.id === pid)
  if (!p) throw new Error(`unknown player ${pid}`)
  if (playerScheduled(t, pid)) { p.active = false; return 'retired' }
  t.players = t.players.filter(x => x.id !== pid)
  t.teams = t.teams.filter(team => !team.players.includes(pid))
  return 'deleted'
}

export function removeTeam (t, tid) {
  const team = t.teams.find(x => x.id === tid)
  if (!team) throw new Error(`unknown team ${tid}`)
  if (teamScheduled(t, tid)) { team.active = false; return 'retired' }
  t.teams = t.teams.filter(x => x.id !== tid)
  t.players = t.players.filter(p => !team.players.includes(p.id) || playerScheduled(t, p.id))
  return 'deleted'
}

export function restoreUnit (t, id) {
  const u = t.players.find(x => x.id === id) || t.teams.find(x => x.id === id)
  if (!u) throw new Error(`unknown unit ${id}`)
  u.active = true
}
