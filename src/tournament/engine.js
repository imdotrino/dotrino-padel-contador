// Lógica pura del torneo: sin DOM ni almacén. Todo lo que la UI enseña de un torneo
// (rondas, descansos, clasificación, si ya terminó) sale de aquí, y por eso se prueba
// con `node --test` sin navegador.
//
// Modelo:
//   players: [{ id, name, active }]              todos los jugadores, en cualquier modo
//   teams:   [{ id, players: [pid, pid], active }] parejas fijas (solo cuentan en 'fixed')
//   rounds:  [{ id, matches, rest, clock }]
//     match: { id, court, a: [pid, pid], b: [pid, pid], teams: [tidA, tidB] | null,
//              score: { a, b } | null   (juegos),  sets: { a, b } | null }
//     rest:  ids de las UNIDADES que descansan (jugadores o parejas, según el modo)
//     clock: el cronómetro de la ronda cuando se juega por tiempo (ver «cronómetro»)
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
// 'everyone' no lleva número: sale de los jugadores. Si las parejas son fijas, cada pareja
// juega una vez contra cada otra (todos contra todos); si rotan, cada jugador hace pareja
// una vez con cada uno de los demás (con todos).
const LIMITS = ['perPlayer', 'rounds', 'matches', 'everyone']
const MATCH_ENDS = ['time', 'games']
const COURTS_MODES = ['auto', 'fixed']
export const SCORE_KINDS = ['games', 'sets', 'match']
const MINUTE = 60000

// Ajustes de un torneo nuevo. Es una función y no un objeto porque `scoring` va anidado:
// un objeto compartido se modificaría en todos los torneos a la vez.
export function defaultSettings () {
  return {
    partners: 'rotating',
    pairing: 'random',
    // Canchas: 'auto' (por defecto, dueño 2026-09-15) = una por cada 4 jugadores (2 parejas);
    // 'fixed' = las de `courts`, las que tiene el club.
    courtsMode: 'auto',
    courts: 2,
    // Por defecto «con todos» («todos contra todos» si las parejas son fijas): sale del
    // número de jugadores (dueño, 2026-09-15). `limitValue` queda para cuando se elija otra.
    limitType: 'everyone',
    limitValue: 3,
    // Qué suma en la tabla, cada cosa con sus puntos; se combinan. Al menos una encendida.
    // El empate no es «partido ganado»: no da puntos de partido.
    scoring: {
      games: { on: true, points: 1 },
      sets: { on: false, points: 2 },
      match: { on: true, points: 3 }
    },
    // Cómo termina un partido. 'time': el cronómetro de la ronda, y al acabarse vale el
    // marcador que haya. 'games': cuando un lado llega a `gamesPerMatch` (0 = libre).
    matchEnd: 'time',
    matchMinutes: 12, // dueño, 2026-09-15
    gamesPerMatch: 6
  }
}

// Repetir pareja pesa mucho más que repetir rival: lo primero es lo que el modo al
// azar promete evitar; lo segundo solo se procura.
const PARTNER_WEIGHT = 100
const RESTARTS = 24

const newId = () => crypto.randomUUID()
const key = (x, y) => (x < y ? x + '|' + y : y + '|' + x)
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1)
const count = (map, k) => map.get(k) || 0

export function checkSettings (s) {
  if (!PARTNERS.includes(s.partners)) throw new Error(`unknown partners mode: ${s.partners}`)
  if (!PAIRINGS.includes(s.pairing)) throw new Error(`unknown pairing mode: ${s.pairing}`)
  if (!LIMITS.includes(s.limitType)) throw new Error(`unknown limit type: ${s.limitType}`)
  if (!COURTS_MODES.includes(s.courtsMode)) throw new Error(`unknown courts mode: ${s.courtsMode}`)
  if (!Number.isInteger(s.courts) || s.courts < 1) throw new Error(`invalid courts: ${s.courts}`)
  if (!Number.isInteger(s.limitValue) || s.limitValue < 1) throw new Error(`invalid limit: ${s.limitValue}`)
  for (const k of SCORE_KINDS) {
    const x = s.scoring?.[k]
    if (!x || typeof x.on !== 'boolean' || !Number.isInteger(x.points) || x.points < 1) {
      throw new Error(`invalid scoring.${k}: ${JSON.stringify(x)}`)
    }
  }
  if (!SCORE_KINDS.some(k => s.scoring[k].on)) throw new Error('scoring needs at least one kind turned on')
  if (!MATCH_ENDS.includes(s.matchEnd)) throw new Error(`unknown match end: ${s.matchEnd}`)
  if (!Number.isInteger(s.matchMinutes) || s.matchMinutes < 1) throw new Error(`invalid match minutes: ${s.matchMinutes}`)
  if (!Number.isInteger(s.gamesPerMatch) || s.gamesPerMatch < 0) throw new Error(`invalid games per match: ${s.gamesPerMatch}`)
  const conflicts = settingsConflicts(s)
  if (conflicts.length) throw new Error(`conflicting rules: ${conflicts.join(', ')}`)
}

// Reglas que no se combinan, por la clave de cada regla que choca. «Por puntaje» empareja
// por la tabla (1.º+4.º contra 2.º+3.º), así que los de arriba y los de abajo casi no se
// cruzan: con «todos contra todos» / «con todos» el torneo no terminaría.
export function settingsConflicts (s) {
  return s.pairing === 'ranked' && s.limitType === 'everyone' ? ['pairing', 'limit'] : []
}

// ---------- construcción ----------

// La regla de fábrica: una sola, «Default» (el nombre va tal cual en los dos idiomas). Los
// sets del usuario viven en el store. Función y no constante: cada llamada da objetos
// nuevos, que nadie puede modificar por error.
export function builtinRulesets () {
  return [{ id: 'builtin-default', builtin: true, name: 'Default', settings: defaultSettings() }]
}

// rulesetId: de qué set salieron las reglas (null si no salieron de ninguno).
export function createTournament ({ name = '', settings = {}, players = [], teams = [], rulesetId = null } = {}) {
  const now = Date.now()
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    rulesetId,
    settings: { ...defaultSettings(), ...structuredClone(settings) },
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

// Canchas que caben: cuatro jugadores por cancha (dos parejas si son fijas).
export const maxCourts = t => Math.floor(activeUnits(t).length / slotsPerMatch(t))

// Las canchas que salen, y pueden ser cero si no se llena ninguna. En «auto», las que caben
// (jugadores/4, parejas/2): más jugadores, más canchas. En «fixed», las que tiene el club
// (`settings.courts`), nunca más de las que caben; si faltan jugadores se usan menos, y si
// vuelven, vuelven a caber.
const courtsFor = t => (t.settings.courtsMode === 'auto' ? maxCourts(t) : Math.min(t.settings.courts, maxCourts(t)))

// Las canchas que se usan al armar una ronda: las que salen, y al menos una.
export const courtsInUse = t => Math.max(1, courtsFor(t))

export const hasScore = m =>
  m.score != null && Number.isInteger(m.score.a) && Number.isInteger(m.score.b)

export const hasSets = m =>
  m.sets != null && Number.isInteger(m.sets.a) && Number.isInteger(m.sets.b)

// Quién ganó: mandan los sets si están y no empatan; si no, los juegos. null sin
// resultado de juegos (sin juegos no hay partido jugado).
export function outcome (m) {
  if (!hasScore(m)) return null
  const [x, y] = hasSets(m) && m.sets.a !== m.sets.b ? [m.sets.a, m.sets.b] : [m.score.a, m.score.b]
  return x === y ? 'draw' : (x > y ? 'a' : 'b')
}

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
  if (limitType === 'everyone') return pendingPairs(t, h).length === 0
  throw new Error(`unknown limit type: ${limitType}`)
}

// Para 'everyone': los pares de unidades activas que todavía no coincidieron. Si las
// parejas rotan, coincidir es haber jugado JUNTOS; si son fijas, haberse ENFRENTADO.
function pendingPairs (t, h) {
  const units = activeUnits(t)
  const met = isFixed(t) ? h.opponents : h.partners
  const out = []
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (!count(met, key(units[i], units[j]))) out.push([units[i], units[j]])
    }
  }
  return out
}

// Partidos que le tocan a cada uno con 'everyone' y las unidades de ahora: uno por cada
// otro jugador (o pareja). null si no hay con quién.
export function everyoneMatchesEach (t) {
  const n = activeUnits(t).length
  return n >= 2 ? n - 1 : null
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
  const courts = courtsFor(t)
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
  else if (limitType === 'everyone') {
    // Un partido cubre un par si las parejas son fijas (el enfrentamiento) y dos si rotan
    // (las dos parejas). Es el mínimo: si no encajan justos, alguien repite.
    left = Math.ceil(pendingPairs(t, history(t)).length / (isFixed(t) ? 1 : 2))
  } else {
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
    id: u.id, active: u.active, played: 0, won: 0, drawn: 0, lost: 0,
    setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0, points: 0
  }]))
  const tally = (side, result, games, sets) => {
    for (const u of side) {
      const row = rows.get(u)
      if (!row) throw new Error(`match references unknown unit ${u}`)
      row.played++
      row.gamesFor += games[0]
      row.gamesAgainst += games[1]
      row.setsFor += sets[0]
      row.setsAgainst += sets[1]
      row[result]++
    }
  }
  for (const r of t.rounds) {
    for (const m of r.matches) {
      if (!hasScore(m)) continue
      const [sa, sb] = unitSides(m, fixed)
      const o = outcome(m)
      // Sin sets anotados, cada lado ganó cero sets: es lo que pasó en el marcador.
      const sets = hasSets(m) ? [m.sets.a, m.sets.b] : [0, 0]
      tally(sa, o === 'a' ? 'won' : o === 'b' ? 'lost' : 'drawn', [m.score.a, m.score.b], sets)
      tally(sb, o === 'b' ? 'won' : o === 'a' ? 'lost' : 'drawn', [m.score.b, m.score.a], [sets[1], sets[0]])
    }
  }
  const sc = t.settings.scoring
  for (const row of rows.values()) {
    row.points = (sc.games.on ? row.gamesFor * sc.games.points : 0) +
      (sc.sets.on ? row.setsFor * sc.sets.points : 0) +
      (sc.match.on ? row.won * sc.match.points : 0)
  }
  const setDiff = x => x.setsFor - x.setsAgainst
  const gameDiff = x => x.gamesFor - x.gamesAgainst
  return [...rows.values()].sort((x, y) =>
    y.points - x.points || y.won - x.won || setDiff(y) - setDiff(x) || gameDiff(y) - gameDiff(x) || y.gamesFor - x.gamesFor)
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
  if (t.settings.limitType === 'everyone') return everyoneRound(t, h, rng)
  const units = activeUnits(t)
  const slots = slotsPerMatch(t)
  const courts = courtsInUse(t)
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
  return makeRound(groups, rest)
}

function makeRound (groups, rest) {
  return {
    id: newId(),
    matches: groups.map((g, i) => ({ id: newId(), court: i + 1, ...g, score: null, sets: null })),
    rest,
    clock: null
  }
}

// ---------- todos contra todos / con todos ----------

const PLAN_BUDGET = 60000 // pasos de búsqueda por ronda; agotados, la ronda se arma a lo voraz
const PLAN_EXTRA_ROUNDS = 2 // rondas de más que se prueban antes de rendirse

// Reparte los pares pendientes en rondas de a lo sumo `cap` pares, buscando terminar en el
// mínimo de rondas, y devuelve los pares de la PRIMERA. Las siguientes se vuelven a calcular
// cuando toquen: entre medias pueden cambiar jugadores o canchas.
//
// La poda que lo hace posible: nadie cubre más de un par por ronda, así que quien tiene
// tantos pendientes como rondas quedan juega esta sí o sí, y quien tiene más ya no llega.
function planFirstRound (units, pending, cap, rng) {
  const adj = new Map(units.map(u => [u, new Set()]))
  for (const [x, y] of pending) { adj.get(x).add(y); adj.get(y).add(x) }
  const degree = u => adj.get(u).size
  let edgesLeft = pending.length
  let budget = PLAN_BUDGET

  function fill (rounds, used, chosen) {
    if (--budget < 0) return null
    const free = u => !used.has(u)
    if (units.some(u => free(u) && degree(u) > rounds)) return null
    const mustPlay = units.filter(u => free(u) && degree(u) === rounds)
    const open = units.filter(u => free(u) && [...adj.get(u)].some(free))
    if (chosen.length === cap || !open.length) {
      if (mustPlay.length) return null
      if (edgesLeft === 0) return chosen.slice()
      if (rounds === 1 || edgesLeft > (rounds - 1) * cap) return null
      return fill(rounds - 1, new Set(), []) ? chosen.slice() : null
    }
    // El más apretado primero: alguien que tiene que jugar, o el de más pendientes.
    const v = shuffle(mustPlay.length ? mustPlay : open, rng).reduce((a, b) => (degree(b) > degree(a) ? b : a))
    const partners = shuffle([...adj.get(v)].filter(free), rng).sort((a, b) => degree(b) - degree(a))
    for (const w of partners) {
      adj.get(v).delete(w); adj.get(w).delete(v); edgesLeft--
      used.add(v); used.add(w); chosen.push([v, w])
      const res = fill(rounds, used, chosen)
      chosen.pop(); used.delete(v); used.delete(w)
      adj.get(v).add(w); adj.get(w).add(v); edgesLeft++
      if (res) return res
      if (budget < 0) return null
    }
    // Que v no juegue esta ronda, si no está obligado.
    if (degree(v) === rounds) return null
    used.add(v)
    const res = fill(rounds, used, chosen)
    used.delete(v)
    return res
  }

  const lower = Math.max(Math.ceil(pending.length / cap), ...units.map(degree))
  for (let rounds = lower; rounds <= lower + PLAN_EXTRA_ROUNDS && budget > 0; rounds++) {
    const first = fill(rounds, new Set(), [])
    if (first) return first
  }
  return greedyPairs(units, adj, cap, rng)
}

// Sin plan a tiempo: los pares de la ronda a lo voraz, empezando por quien más pendientes
// tiene. El torneo termina igual (cada ronda cubre al menos un par), con alguna ronda de más.
function greedyPairs (units, adj, cap, rng) {
  const used = new Set()
  const out = []
  const degree = u => adj.get(u).size
  const most = list => list.reduce((a, b) => (degree(b) > degree(a) ? b : a))
  while (out.length < cap) {
    const open = shuffle(units.filter(u => !used.has(u) && [...adj.get(u)].some(w => !used.has(w))), rng)
    if (!open.length) break
    const v = most(open)
    const w = most(shuffle([...adj.get(v)].filter(x => !used.has(x)), rng))
    used.add(v); used.add(w); out.push([v, w])
  }
  return out
}

function opponentCost (arr, h) {
  let c = 0
  for (let i = 0; i < arr.length; i += 2) {
    for (const x of arr[i]) {
      for (const y of arr[i + 1]) {
        const o = count(h.opponents, key(x, y))
        c += o * o
      }
    }
  }
  return c
}

// Una ronda de 'everyone'. Juegan los pares que el plan pone en la primera ronda. Si las
// parejas rotan, cada par es una pareja, y las parejas se enfrentan repitiendo rival lo
// menos posible; una pareja sin rival se completa con dos de los que descansarían, de los
// que menos jugaron.
function everyoneRound (t, h, rng) {
  const units = activeUnits(t)
  const fixed = isFixed(t)
  const courts = courtsInUse(t)
  const pairs = planFirstRound(units, pendingPairs(t, h), fixed ? courts : courts * 2, rng)
  let groups
  if (fixed) {
    const team = id => t.teams.find(x => x.id === id)
    groups = pairs.map(([x, y]) => ({ a: team(x).players.slice(), b: team(y).players.slice(), teams: [x, y] }))
  } else {
    const teams = pairs.map(p => p.slice())
    if (teams.length % 2) {
      const used = new Set(teams.flat())
      const free = shuffle(units.filter(u => !used.has(u)), rng)
        .sort((x, y) => count(h.appearances, x) - count(h.appearances, y))
      // Con a lo sumo dos parejas por cancha nunca faltan: si falta, el cálculo está mal.
      if (free.length < 2) throw new Error('no players left to complete the last match')
      const [f1, ...others] = free
      const f2 = others.reduce((a, b) => (count(h.partners, key(f1, b)) < count(h.partners, key(f1, a)) ? b : a))
      teams.push([f1, f2])
    }
    const arr = bestArrangement(teams, a => opponentCost(a, h), rng)
    groups = []
    for (let i = 0; i < arr.length; i += 2) groups.push({ a: arr[i], b: arr[i + 1], teams: null })
  }
  const playing = new Set(groups.flatMap(g => (fixed ? g.teams : [...g.a, ...g.b])))
  return makeRound(shuffle(groups, rng), units.filter(u => !playing.has(u)))
}

// ---------- ediciones ----------

export function setScore (t, matchId, a, b) {
  const m = findMatch(t, matchId)
  if (!m) throw new Error(`unknown match ${matchId}`)
  m.score = a == null && b == null ? null : { a, b }
}

export function setSets (t, matchId, a, b) {
  const m = findMatch(t, matchId)
  if (!m) throw new Error(`unknown match ${matchId}`)
  m.sets = a == null && b == null ? null : { a, b }
}

// Encender o apagar lo que suma en la tabla. La última encendida no se apaga: sin nada
// que sume, la tabla no ordena a nadie.
export function toggleScoring (t, kind, on) {
  if (!SCORE_KINDS.includes(kind)) throw new Error(`unknown scoring kind: ${kind}`)
  if (!on && SCORE_KINDS.every(k => k === kind || !t.settings.scoring[k].on)) {
    throw new Error('at least one scoring kind must stay on')
  }
  t.settings.scoring[kind].on = on
}

const lastRoundScored = t => t.rounds.length > 0 &&
  t.rounds[t.rounds.length - 1].matches.some(m => m.score != null || m.sets != null)

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

// Aplicar un set de reglas a un torneo: las reglas se COPIAN, así que editar o borrar el
// set después no toca los torneos que ya lo usan. Cambiar el tipo de parejas con
// resultados no se puede, y se comprueba ANTES de tocar nada: nada queda a medio aplicar.
export const canApplyRules = (t, settings) => settings.partners === t.settings.partners || !hasResults(t)

export function applyRules (t, settings, rng = Math.random) {
  checkSettings(settings)
  if (!canApplyRules(t, settings)) throw new Error('partners mode is locked once there are results')
  const { partners, ...rest } = structuredClone(settings)
  Object.assign(t.settings, rest)
  if (partners !== t.settings.partners) setPartners(t, partners, rng)
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

// ---------- cronómetro de la ronda ----------
//
// Por tiempo, la ronda entera juega a la vez con un cronómetro:
//   round.clock = { minutes, runningSince: ms | null, elapsedMs }
// Guarda INSTANTES y no un contador que avanza: sobrevive a recargar, a que el móvil
// congele la pestaña y a abrir el torneo en otro aparato. Los minutos se fijan al
// EMPEZAR, no al generar la ronda: cambiar la duración antes de arrancar sí cuenta.

export function findRound (t, roundId) {
  const r = t.rounds.find(x => x.id === roundId)
  if (!r) throw new Error(`unknown round ${roundId}`)
  return r
}

// { state: 'idle' | 'running' | 'paused' | 'done', remainingMs, minutes }
export function clockOf (t, round, now) {
  const c = round.clock
  if (!c) return { state: 'idle', remainingMs: t.settings.matchMinutes * MINUTE, minutes: t.settings.matchMinutes }
  const elapsed = c.elapsedMs + (c.runningSince == null ? 0 : now - c.runningSince)
  const remainingMs = Math.max(0, c.minutes * MINUTE - elapsed)
  const state = remainingMs === 0 ? 'done' : (c.runningSince == null ? 'paused' : 'running')
  return { state, remainingMs, minutes: c.minutes }
}

export function startClock (t, roundId, now) {
  if (t.settings.matchEnd !== 'time') throw new Error('this tournament does not play on time')
  const r = findRound(t, roundId)
  if (r.clock) throw new Error(`the clock of round ${roundId} already started`)
  r.clock = { minutes: t.settings.matchMinutes, runningSince: now, elapsedMs: 0 }
}

export function pauseClock (t, roundId, now) {
  const r = findRound(t, roundId)
  if (clockOf(t, r, now).state !== 'running') throw new Error(`the clock of round ${roundId} is not running`)
  r.clock.elapsedMs += now - r.clock.runningSince
  r.clock.runningSince = null
}

export function resumeClock (t, roundId, now) {
  const r = findRound(t, roundId)
  if (clockOf(t, r, now).state !== 'paused') throw new Error(`the clock of round ${roundId} is not paused`)
  r.clock.runningSince = now
}

export function resetClock (t, roundId) {
  findRound(t, roundId).clock = null
}

// m:ss, redondeando hacia arriba: marca 0:00 solo cuando de verdad se acabó.
export function formatClock (ms) {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- migración ----------
//
// MIGRACIÓN DECLARADA: añadida el 2026-09-15, se quita el 2026-10-15. Los torneos
// guardados antes del cronómetro y de los puntos combinables traen `scoring: 'games' |
// 'match'` y no traen `matchEnd`, `matchMinutes`, `sets` ni `clock`. Se convierten a lo
// que ya hacían: terminaban por juegos y puntuaban por juego (1) o por partido (3). Lo
// que no cuadre lo para `checkSettings`. Cubierta por test.
// Ajustes guardados antes de que existiera alguno de sus campos (en un torneo o en un set de
// reglas). Lo que se añade conserva el comportamiento que tenían al guardarse.
export function migrateSettings (s) {
  if (typeof s.scoring === 'string') {
    const was = s.scoring
    s.scoring = {
      games: { on: was === 'games', points: 1 },
      sets: { on: false, points: 2 },
      match: { on: was === 'match', points: 3 }
    }
  }
  if (s.matchEnd === undefined) s.matchEnd = 'games'
  if (s.matchMinutes === undefined) s.matchMinutes = defaultSettings().matchMinutes
  // MIGRACIÓN (se quita el 2026-10-15): antes de «auto» las canchas eran siempre un número
  // fijo, y lo guardado lo sigue siendo. Prueba: «settings saved before auto courts…».
  if (s.courtsMode === undefined) s.courtsMode = 'fixed'
  checkSettings(s)
  return s
}

export function migrateTournament (t) {
  migrateSettings(t.settings)
  if (t.rulesetId === undefined) t.rulesetId = null
  for (const r of t.rounds) {
    if (r.clock === undefined) r.clock = null
    for (const m of r.matches) if (m.sets === undefined) m.sets = null
  }
  return t
}
