// Las tres pestañas del torneo: Partidos, Tabla y Torneo (la configuración).
// Pinta con plantillas y delega los eventos en cada página, como el marcador.
//
// Torneo es una pantalla ADMINISTRATIVA (§5.1): sin párrafos de presentación. Arriba el
// nombre y los jugadores; después los sets de reglas para elegir uno; y al final el
// formulario para armar un set nuevo, donde cada regla se lee como texto y se edita aparte.
import { $, escapeHtml as esc } from '../dom.js'
import { t, tn, getLang } from '../i18n.js'
import { ask, toast } from '../ui/dialog.js'
import { prepareAlarm, ring, keepAwake } from '../ui/alarm.js'
import * as engine from './engine.js'
import * as repo from './repo.js'
import * as live from './live.js'

let ui = null // { goTab, playMatch, linkedMatchId, openShare, leaveWatch }
// Mirando un torneo ajeno (`#watch=…`): { state, status, reason }. Partidos y Tabla pintan
// el torneo que llegó, en solo lectura. null en la app normal.
let watching = null
let draft = null // torneo que se está creando: no existe en el store hasta «Empezar»
let openRule = null // la regla que se está editando, una a la vez
let ruleForm = null // { source, baseId, name, settings }: el formulario de abajo (editar el set elegido o crear uno a partir de él)

const RANGES = { courts: [1, 20], limitValue: [1, 99], gamesPerMatch: [0, 20], matchMinutes: [5, 120], points: [1, 10] }
const STEPS = { matchMinutes: 5 }
const LABELS = { name: 'name', rulesetName: 'rulesetName', partners: 'partners', pairing: 'pairing', courts: 'courts', limit: 'limit', scoring: 'scoring', matchEnd: 'matchEnd' }
const INFOS = new Set(['partners', 'pairing', 'limit', 'scoring', 'matchEnd'])
const PARTNER_LABELS = { rotating: 'partnersRotating', fixed: 'partnersFixed' }
const PAIRING_LABELS = { random: 'pairingRandom', ranked: 'pairingRanked' }

// ---------- nombres ----------

function playerName (tour, pid) {
  const p = tour.players.find(x => x.id === pid)
  if (!p) throw new Error(`unknown player ${pid}`)
  return p.name
}

const sideName = (tour, ids) => ids.map(id => playerName(tour, id)).join(' / ')

function unitName (tour, id) {
  if (!engine.isFixed(tour)) return playerName(tour, id)
  const team = tour.teams.find(x => x.id === id)
  if (!team) throw new Error(`unknown team ${id}`)
  return sideName(tour, team.players)
}

const formatDate = ts => new Intl.DateTimeFormat(getLang(), { day: '2-digit', month: '2-digit' }).format(ts)

const current = () => draft || repo.active()

// ---------- piezas comunes ----------

// Mientras el store no está listo, las páginas del torneo solo dicen eso.
function storeGate (page) {
  if (repo.state.status === 'ready') return false
  page.innerHTML = repo.state.status === 'error'
    ? `<div class="notice error"><p>${esc(t('storeFailed', { reason: repo.state.error.message }))}</p>
        <button type="button" class="btn" data-action="retry" data-testid="store-retry">${esc(t('retry'))}</button></div>`
    : `<div class="notice">${esc(t('storeLoading'))}</div>`
  return true
}

const emptyState = () => `<div class="empty-state">
  <p>${esc(t('noTournament'))}</p>
  <button type="button" class="btn-primary" data-action="new" data-testid="new-tournament">${esc(t('newTournament'))}</button>
</div>`

async function commonAction (action) {
  if (action === 'retry') {
    renderAll()
    await repo.load()
    renderAll()
    return true
  }
  if (action === 'new') { startDraft(); return true }
  if (action === 'go-setup') { ui.goTab('setup'); return true }
  if (action === 'see-table') { ui.goTab('table'); return true }
  return false
}

// Re-pintar reemplaza los inputs: se devuelve el foco al que lo tenía.
function withFocus (page, paint) {
  const el = document.activeElement
  const key = el && page.contains(el) ? el.dataset.focusKey : null
  const sel = key && typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null
  paint()
  if (!key) return
  const again = page.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)
  if (!again) return
  again.focus()
  if (sel && again.type === 'text') again.setSelectionRange(sel[0], sel[1])
}

// ---------- Partidos ----------

function matchHtml (tour, m) {
  const value = v => (Number.isInteger(v) ? String(v) : '')
  const linked = ui.linkedMatchId() === m.id
  const w = engine.outcome(m)
  // Con sets, cada lado anota sets y juegos; sin sets, solo juegos (y la fila entera es
  // la etiqueta de su casilla).
  const withSets = tour.settings.scoring.sets.on
  const tag = withSets ? 'div' : 'label'
  const input = (s, kind, v, label) => `<input class="score" type="number" inputmode="numeric" min="0" max="99"
    data-kind="${kind}" data-testid="${kind === 'sets' ? 'sets' : 'score'}-${s}" value="${value(v)}" aria-label="${esc(label)}">`
  return `<div class="match${linked ? ' linked' : ''}" data-match="${m.id}" data-testid="match">
    <div class="match-head">
      <span class="court">${esc(t('court', { n: m.court }))}</span>
      ${linked ? `<span class="in-board">● ${esc(t('inScoreboard'))}</span>` : ''}
      <button type="button" class="btn-play" data-action="play" data-testid="play-match">${esc(t('play'))}</button>
    </div>
    ${withSets ? `<div class="score-cols" aria-hidden="true"><span>${esc(t('setsShort'))}</span><span>${esc(t('gamesShort'))}</span></div>` : ''}
    ${['a', 'b'].map(s => `<${tag} class="side${w === s ? ' won' : ''}" data-side="${s}">
      <span class="side-name">${esc(sideName(tour, m[s]))}</span>
      ${withSets ? input(s, 'sets', m.sets?.[s], t('setsOf', { name: sideName(tour, m[s]) })) : ''}
      ${input(s, 'games', m.score?.[s], t('gamesOf', { name: sideName(tour, m[s]) }))}
    </${tag}>`).join('')}
  </div>`
}

// El cronómetro de la ronda en juego. Los botones dependen del estado; el tic cambia
// solo el tiempo mientras el estado no cambie (ver `tick`).
function clockHtml (tour, r) {
  const c = engine.clockOf(tour, r, Date.now())
  const btn = (action, label, { primary = false, disabled = false } = {}) =>
    `<button type="button" class="${primary ? 'btn-primary' : 'btn'}" data-action="${action}" data-testid="${action}"${disabled ? ' disabled' : ''}>${esc(t(label))}</button>`
  // Siempre dos botones: el principal cambia con el estado, y lo que no aplica se deshabilita.
  const main = {
    idle: btn('clock-start', 'clockStart', { primary: true }),
    running: btn('clock-pause', 'clockPause'),
    paused: btn('clock-resume', 'clockResume', { primary: true }),
    done: btn('clock-start', 'clockStart', { primary: true, disabled: true })
  }[c.state]
  if (!main) throw new Error(`unknown clock state: ${c.state}`)
  const actions = main + btn('clock-reset', 'clockReset', { disabled: c.state === 'idle' })
  return `<div class="clock ${c.state}" data-clock="${r.id}" data-state="${c.state}" role="timer" aria-label="${esc(t('clockAria'))}" data-testid="round-clock">
    <span class="clock-time" data-testid="clock-time">${esc(clockText(c))}</span>
    <span class="clock-actions">${actions}</span>
  </div>`
}

const clockText = c => (c.state === 'done' ? t('clockDone') : engine.formatClock(c.remainingMs))

// Solo la última ronda se rehace o se quita, y solo sin resultados: con resultados, los
// botones se ven deshabilitados.
const roundActions = tour => {
  const off = engine.canRedoLastRound(tour) ? '' : ' disabled'
  return `<button type="button" class="btn-small" data-action="redo" data-testid="redo-round"${off}>${esc(t('redo'))}</button>
     <button type="button" class="btn-small" data-action="drop" data-testid="drop-round"${off}>${esc(t('dropRound'))}</button>`
}

function roundHtml (tour, r, i) {
  const last = i === tour.rounds.length - 1
  const rest = r.rest.length
    ? `<p class="rest">${esc(t('resting', { names: r.rest.map(id => unitName(tour, id)).join(', ') }))}</p>`
    : ''
  return `<section class="round" data-round="${r.id}" data-testid="round">
    <div class="round-head">
      <h3>${esc(t('round', { n: i + 1 }))}</h3>
      <div class="round-actions" data-round-actions>${last ? roundActions(tour) : ''}</div>
    </div>
    ${last && (tour.settings.matchEnd === 'time' || r.clock) ? clockHtml(tour, r) : ''}
    <div class="round-matches">${r.matches.map(m => matchHtml(tour, m)).join('')}</div>
    ${rest}
  </section>`
}

function paintProgress (tour) {
  const st = engine.status(tour)
  const est = engine.estimate(tour)
  const total = Math.max(est ? est.matches : 0, st.scheduled)
  const approx = est && !est.exact && !st.reached
  $('matchesProgress').textContent = t(approx ? 'progressApprox' : 'progress', { scored: st.scored, total })
}

function paintNext (tour) {
  const box = $('nextBlock')
  const blocker = engine.nextRoundBlocker(tour)
  // «Armar ronda» siempre está; si no toca otra ronda, deshabilitado y con el porqué.
  const next = `<button type="button" class="btn-primary block" data-action="next" data-testid="next-round"${blocker ? ' disabled' : ''}>${esc(t('nextRound', { n: tour.rounds.length + 1 }))}</button>`
  if (blocker === 'players') {
    box.innerHTML = next + `<div class="notice"><p>${esc(t(engine.isFixed(tour) ? 'needTeams' : 'needPlayers', { n: engine.minUnits(tour) }))}</p>
      <button type="button" class="btn" data-action="go-setup">${esc(t('goSetup'))}</button></div>`
    return
  }
  if (blocker === 'finished') {
    box.innerHTML = (engine.status(tour).finished
      ? `<div class="finished" data-testid="finished"><strong>🏆 ${esc(t('finished'))}</strong>
          <button type="button" class="btn" data-action="see-table">${esc(t('seeTable'))}</button></div>`
      : '') + next
    return
  }
  const last = tour.rounds[tour.rounds.length - 1]
  const pending = tour.settings.pairing === 'ranked' && last && !last.matches.every(engine.hasScore)
  box.innerHTML = `${next}
    ${pending ? `<p class="hint">${esc(t('rankedPending', { n: tour.rounds.length }))}</p>` : ''}`
}

function renderMatches () {
  const page = $('matchesPage')
  if (watching) return renderWatched(page, paintMatches)
  if (storeGate(page)) return
  const tour = repo.active()
  if (!tour) { page.innerHTML = emptyState(); return }
  paintMatches(page, tour)
}

function paintMatches (page, tour) {
  // Las rondas en orden y «Armar ronda» debajo: cada ronda nueva se suma al final.
  page.innerHTML = `
    ${watching ? watchBanner() : liveBar(tour)}
    <header class="t-head"><h2 class="t-name">${esc(tour.name)}</h2><p class="t-sub" id="matchesProgress"></p></header>
    <div class="rounds">${tour.rounds.map((r, i) => roundHtml(tour, r, i)).join('')}</div>
    <div id="nextBlock"></div>`
  paintProgress(tour)
  paintNext(tour)
}

// ---------- en vivo ----------

// El organizador: compartir el torneo para que otros lo miren. Los dos botones están
// siempre; «Dejar de compartir», deshabilitado mientras no se comparte.
function liveBar (tour) {
  const on = live.isSharing(tour)
  const n = live.viewersOf(tour)
  return `<div class="live-bar${on ? ' on' : ''}" data-testid="live-bar">
    <span class="live-state" data-testid="live-state">${esc(on ? t(n === 1 ? 'liveOn_one' : 'liveOn', { n }) : t('liveOff'))}</span>
    <button type="button" class="btn-small" data-action="live-share" data-testid="live-share">${esc(t('liveShare'))}</button>
    <button type="button" class="btn-small" data-action="live-stop" data-testid="live-stop"${on ? '' : ' disabled'}>${esc(t('liveStop'))}</button>
  </div>`
}

async function shareLive (tour) {
  let url
  try {
    url = await live.share(tour)
  } catch (e) {
    console.error('[padel] could not share the tournament:', e)
    toast(t('liveFailed', { reason: e.message }), 'error')
    return
  }
  // La clave del enlace se guarda con el torneo: así sobrevive a recargar.
  repo.save(tour)
  renderMatches()
  ui.openShare(url, tour.name)
}

async function stopLive (tour) {
  const yes = await ask({ title: t('liveStopTitle'), text: t('liveStopText'), ok: t('liveStop'), danger: true })
  if (!yes) return
  await live.stop(tour)
  repo.save(tour)
  renderMatches()
}

const WATCH_TEXT = { connecting: 'watchConnecting', live: 'watchLive', denied: 'watchDenied', 'bad-link': 'watchBadLink', error: 'watchFailed', closed: 'watchClosed' }

// Quien mira: en qué está la conexión, y la salida a la app normal.
function watchBanner () {
  const { status, reason, state } = watching
  const key = status === 'host-offline' ? (state ? 'watchWaiting' : 'watchWaitingEmpty') : WATCH_TEXT[status]
  if (!key) throw new Error(`unknown watch status: ${status}`)
  return `<div class="notice watch-bar ${status}" data-testid="watch-status" data-status="${status}">
    <p>${esc(t(key, { reason: reason || '' }))}</p>
    <button type="button" class="btn-small" data-watch-action="leave" data-testid="watch-leave">${esc(t('watchLeave'))}</button>
  </div>`
}

// El torneo que llegó, con todo lo que se toca deshabilitado: es de otro, y solo se mira.
function renderWatched (page, paint) {
  if (!watching.state) { page.innerHTML = watchBanner(); return }
  paint(page, watching.state)
  for (const el of page.querySelectorAll('button:not([data-watch-action]), input')) el.disabled = true
}

const correctionNoted = new Set() // torneos en los que ya se avisó, en esta sesión

function parseScore (v) {
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(99, Math.max(0, Math.trunc(n))) : null
}

// Escribir un resultado NO re-pinta la página (se perdería el foco del teclado en el
// móvil): se toca solo lo que cambia.
function onScoreInput (input) {
  const tour = repo.active()
  const el = input.closest('[data-match]')
  const kind = input.dataset.kind
  const [a, b] = [...el.querySelectorAll(`input.score[data-kind="${kind}"]`)].map(x => parseScore(x.value))
  if (kind === 'sets') engine.setSets(tour, el.dataset.match, a, b)
  else if (kind === 'games') engine.setScore(tour, el.dataset.match, a, b)
  else throw new Error(`unknown score kind: ${kind}`)
  repo.save(tour)
  const m = engine.findMatch(tour, el.dataset.match)
  const w = engine.outcome(m)
  // Corregir una ronda que ya tiene otras después: esas no se vuelven a sortear, y se
  // dice una vez para que nadie espere que cambien.
  if (tour.rounds.findIndex(r => r.matches.includes(m)) < tour.rounds.length - 1 && !correctionNoted.has(tour.id)) {
    correctionNoted.add(tour.id)
    toast(t('correctionNote'))
  }
  for (const side of el.querySelectorAll('.side')) side.classList.toggle('won', w === side.dataset.side)
  paintProgress(tour)
  paintNext(tour)
  const latest = $('matchesPage').querySelector('.rounds > .round:last-child [data-round-actions]')
  if (latest) latest.innerHTML = roundActions(tour)
  renderTable()
}

async function onMatchesClick (e) {
  if (e.target.closest('[data-watch-action]')) return ui.leaveWatch()
  const b = e.target.closest('[data-action]')
  if (!b || await commonAction(b.dataset.action)) return
  const tour = repo.active()
  if (b.dataset.action === 'live-share') return shareLive(tour)
  if (b.dataset.action === 'live-stop') return stopLive(tour)
  switch (b.dataset.action) {
    case 'next': {
      const r = engine.generateRound(tour)
      if (!r) throw new Error(`no round to generate: ${engine.nextRoundBlocker(tour)}`)
      tour.rounds.push(r)
      break
    }
    case 'redo':
      engine.redoLastRound(tour)
      break
    case 'drop':
      engine.removeLastRound(tour)
      break
    case 'clock-start':
      prepareAlarm()
      engine.startClock(tour, b.closest('[data-round]').dataset.round, Date.now())
      break
    case 'clock-resume':
      prepareAlarm()
      engine.resumeClock(tour, b.closest('[data-round]').dataset.round, Date.now())
      break
    case 'clock-pause':
      engine.pauseClock(tour, b.closest('[data-round]').dataset.round, Date.now())
      break
    case 'clock-reset': {
      const id = b.closest('[data-round]').dataset.round
      if (engine.clockOf(tour, engine.findRound(tour, id), Date.now()).state === 'running') {
        const yes = await ask({ title: t('clockResetTitle'), text: t('clockResetText'), ok: t('clockResetOk'), danger: true })
        if (!yes) return
      }
      engine.resetClock(tour, id)
      break
    }
    case 'play': {
      const m = engine.findMatch(tour, b.closest('[data-match]').dataset.match)
      const index = tour.rounds.findIndex(r => r.matches.includes(m))
      const s = tour.settings
      await ui.playMatch({
        tournamentId: tour.id,
        tournamentName: tour.name,
        matchId: m.id,
        roundId: tour.rounds[index].id,
        round: index + 1,
        court: m.court,
        timed: s.matchEnd === 'time',
        target: s.matchEnd === 'games' ? s.gamesPerMatch : 0,
        sets: s.scoring.sets.on,
        left: sideName(tour, m.a),
        right: sideName(tour, m.b)
      })
      return
    }
    default:
      throw new Error(`unknown action: ${b.dataset.action}`)
  }
  repo.save(tour)
  renderAll()
  // La ronda nueva queda al final: se baja hasta ella.
  if (b.dataset.action === 'next') {
    $('matchesPage').querySelector('.rounds > .round:last-child').scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
}

// ---------- Tabla ----------

const signed = n => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0')

function renderTable () {
  const page = $('tablePage')
  if (watching) return renderWatched(page, paintTable)
  if (storeGate(page)) return
  const tour = repo.active()
  if (!tour) { page.innerHTML = emptyState(); return }
  paintTable(page, tour)
}

function paintTable (page, tour) {
  const rows = engine.standings(tour)
  const finished = engine.status(tour).finished
  const sets = tour.settings.scoring.sets.on
  const rank = i => (finished && i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1))
  const head = (label, title) => `<th scope="col"><abbr title="${esc(t(title))}">${esc(t(label))}</abbr></th>`
  page.innerHTML = `${watching ? watchBanner() : ''}
    <header class="t-head"><h2 class="t-name">${esc(tour.name)}</h2>
      <p class="t-sub" data-testid="scoring-summary">${esc(t('scoring'))}: ${esc(scoringSummary(tour.settings))}</p></header>
    <div class="table-wrap"><table class="standings" data-testid="standings">
      <thead><tr>
        <th scope="col">#</th>
        <th scope="col" class="col-name">${esc(t(engine.isFixed(tour) ? 'colTeam' : 'colPlayer'))}</th>
        ${head('colPlayed', 'colPlayedTitle')}${head('colWon', 'colWonTitle')}${sets ? head('colSetDiff', 'colSetDiffTitle') : ''}${head('colDiff', 'colDiffTitle')}${head('colPoints', 'colPointsTitle')}
      </tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.active ? '' : 'retired'}" data-unit="${r.id}">
        <td class="rank">${rank(i)}</td>
        <td class="col-name">${esc(unitName(tour, r.id))}${r.active ? '' : ` <span class="tag">${esc(t('retired'))}</span>`}</td>
        <td>${r.played}</td><td>${r.won}</td>${sets ? `<td>${signed(r.setsFor - r.setsAgainst)}</td>` : ''}<td>${signed(r.gamesFor - r.gamesAgainst)}</td>
        <td class="pts">${r.points}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
}

// «1 por juego · 3 por partido ganado»: lo encendido, con sus puntos.
const scoringSummary = s => engine.SCORE_KINDS
  .filter(k => s.scoring[k].on)
  .map(k => t('pointsPer_' + k, { n: s.scoring[k].points }))
  .join(' · ')

async function onTableClick (e) {
  if (e.target.closest('[data-watch-action]')) return ui.leaveWatch()
  const b = e.target.closest('[data-action]')
  if (b && !(await commonAction(b.dataset.action))) throw new Error(`unknown action: ${b.dataset.action}`)
}

// ---------- Torneo (configuración) ----------

// Una regla del torneo se LEE como texto, con «Editar» al lado; al pulsarlo aparecen sus
// opciones y su explicación. `editor` es una función: solo se pinta la que está abierta.
// `warn`: la regla se puede guardar así, pero no se va a cumplir tal cual; va en rojo y
// `note` dice qué pasará.
function rule (key, text, editor, { editable = true, note = '', warn = false } = {}) {
  const open = editable && openRule === key
  const label = t(LABELS[key])
  return `<div class="rule${open ? ' open' : ''}${warn ? ' warn' : ''}" data-rule="${key}" data-testid="rule-${key}">
    <div class="rule-line">
      <div class="rule-main">
        <span class="label">${esc(label)}</span>
        <p class="rule-text" data-testid="rule-${key}-text">${esc(text)}</p>
        ${note ? `<p class="hint" data-testid="rule-${key}-note">${esc(note)}</p>` : ''}
      </div>
      <button type="button" class="btn-small rule-edit" data-edit="${key}" aria-expanded="${open}"
        aria-label="${esc(t(open ? 'ruleDoneAria' : 'ruleEditAria', { rule: label }))}" data-testid="edit-${key}"${editable ? '' : ' disabled'}>${esc(t(open ? 'ruleDone' : 'ruleEdit'))}</button>
    </div>
    ${open ? `<div class="rule-editor">${INFOS.has(key) ? `<p class="info-text">${esc(t('info_' + key))}</p>` : ''}${editor()}</div>` : ''}
  </div>`
}

const seg = (name, options, value, disabled = false) => `<div class="seg" role="group">${options.map(([v, label]) =>
  `<button type="button" class="seg-btn${v === value ? ' on' : ''}" data-seg="${name}" data-value="${v}"
    aria-pressed="${v === value}"${disabled ? ' disabled' : ''} data-testid="${name}-${v}">${esc(t(label))}</button>`).join('')}</div>`

// `disabled`: el contador se ve pero no se toca (su valor no aplica ahora).
function stepper (name, value, shown, [min, max] = RANGES[name], step = STEPS[name] || 1, disabled = false) {
  return `<div class="stepper${disabled ? ' off' : ''}">
    <button type="button" class="step" data-step="${name}" data-delta="${-step}"${disabled || value <= min ? ' disabled' : ''} aria-label="−${step}" data-testid="${name}-minus">−</button>
    <output data-testid="${name}-value">${esc(shown)}</output>
    <button type="button" class="step" data-step="${name}" data-delta="${step}"${disabled || value >= max ? ' disabled' : ''} aria-label="+${step}" data-testid="${name}-plus">+</button>
  </div>`
}

// Lo que suma en la tabla: interruptores que se combinan, cada uno con sus puntos. La
// última encendida no se puede apagar (queda deshabilitada).
function scoringBody (s) {
  const on = engine.SCORE_KINDS.filter(k => s.scoring[k].on)
  return `<div class="scoring">${engine.SCORE_KINDS.map(k => {
    const x = s.scoring[k]
    const last = x.on && on.length === 1
    return `<div class="scoring-row">
      <button type="button" class="seg-btn toggle${x.on ? ' on' : ''}" data-toggle-scoring="${k}" aria-pressed="${x.on}"${last ? ' disabled' : ''} data-testid="scoring-${k}">${esc(t('scoring_' + k))}</button>
      <span class="scoring-amount">${stepper('points-' + k, x.points, String(x.points), RANGES.points, undefined, !x.on)}<span class="unit">${esc(t('unit_points'))}</span></span>
    </div>`
  }).join('')}</div>`
}

// Los dos valores a la vista; el del modo que no está elegido, deshabilitado.
function matchEndBody (s) {
  const time = s.matchEnd === 'time'
  return seg('matchEnd', [['time', 'matchEndTime'], ['games', 'matchEndGames']], s.matchEnd) +
    `<div class="row">${stepper('matchMinutes', s.matchMinutes, String(s.matchMinutes), undefined, undefined, !time)}<span class="unit">${esc(t('unit_minutes'))}</span></div>` +
    `<div class="row">${stepper('gamesPerMatch', s.gamesPerMatch, s.gamesPerMatch ? String(s.gamesPerMatch) : t('free'), undefined, undefined, time)}<span class="unit">${esc(tn('unit_games', s.gamesPerMatch))}</span></div>`
}

function matchEndSummary (s) {
  if (s.matchEnd === 'time') return t('matchEndSummaryTime', { n: s.matchMinutes })
  if (s.matchEnd === 'games') return s.gamesPerMatch ? tn('matchEndSummaryGames', s.gamesPerMatch) : t('matchEndSummaryFree')
  throw new Error(`unknown match end: ${s.matchEnd}`)
}

// Más canchas de las que llenan los jugadores se pueden poner (son las del club), pero
// se juega en las que caben: se marca en rojo y se dice. '' si no sobran. Con menos de
// una cancha llena no se avisa aquí: ya lo dice «Empezar».
function courtsOver (tour, s) {
  const probe = { ...tour, settings: s }
  const max = engine.maxCourts(probe)
  if (max < 1 || s.courts <= max) return ''
  return tn(engine.isFixed(probe) ? 'courtsOverTeams' : 'courtsOverPlayers', max, { units: engine.activeUnits(probe).length, n: max })
}

// «≈ 7 partidos · 4 rondas · 80 min» con estas reglas y los jugadores de este torneo.
function estimateText (tour, s) {
  const est = engine.estimate({ ...tour, settings: s })
  if (!est) return ''
  return t(est.exact ? 'estimateExact' : 'estimate', est) + (s.matchEnd === 'time' ? ' · ' + t('estimateMinutes', { n: est.rounds * s.matchMinutes }) : '')
}

// «Con todos» / «Todos contra todos» no lleva número: sale de los jugadores del torneo, así
// que el contador se ve deshabilitado con los partidos que le tocan a cada uno.
function limitEditor (tour, s, estimateText) {
  const everyone = s.limitType === 'everyone'
  const each = everyone ? engine.everyoneMatchesEach({ ...tour, settings: s }) : null
  const value = everyone ? (each ?? 0) : s.limitValue
  return seg('limitType', [['perPlayer', 'limitPerPlayer'], ['rounds', 'limitRounds'], ['matches', 'limitMatches'], ['everyone', 'limitEveryone_' + s.partners]], s.limitType) +
    `<div class="row">${stepper('limitValue', value, everyone && each == null ? '—' : String(value), undefined, undefined, everyone)}<span class="unit">${esc(tn(everyone ? 'unit_perPlayer' : 'unit_' + s.limitType, value))}</span></div>` +
    `<p class="hint" data-testid="estimate">${esc(estimateText)}</p>`
}

// La duración en una frase: «3 partidos cada uno», «Con todos · 7 partidos cada uno».
function limitSummary (tour, s) {
  if (s.limitType !== 'everyone') return `${s.limitValue} ${tn('unit_' + s.limitType, s.limitValue)}`
  const name = t('limitEveryone_' + s.partners)
  const each = engine.everyoneMatchesEach({ ...tour, settings: s })
  return each == null ? name : `${name} · ${each} ${tn('unit_perPlayer', each)}`
}

const nameInput = (tour, pid) => `<input class="input roster-name" data-rename="${pid}" data-focus-key="rename-${pid}"
  maxlength="24" autocomplete="off" value="${esc(playerName(tour, pid))}" aria-label="${esc(t('playerPlaceholder'))}">`

const unitButton = (u, kind) => u.active
  ? `<button type="button" class="icon-btn" data-action="remove-${kind}" aria-label="${esc(t('remove'))}" data-testid="remove-${kind}">✕</button>`
  : `<span class="tag">${esc(t('retired'))}</span>
     <button type="button" class="btn-small" data-action="restore" data-testid="restore">${esc(t('restore'))}</button>`

function rosterHtml (tour) {
  const addInput = (name, key) => `<input class="input" name="${name}" data-focus-key="${key}" placeholder="${esc(t('playerPlaceholder'))}"
    maxlength="24" autocomplete="off" enterkeyhint="next" data-testid="${key}">`
  if (engine.isFixed(tour)) {
    return `<div class="field field-roster">
      <div class="field-head"><span class="label">${esc(t('teams', { n: tour.teams.filter(x => x.active).length }))}</span></div>
      <ul class="roster roster-teams">${tour.teams.map(team => `<li class="roster-row team${team.active ? '' : ' retired'}" data-team="${team.id}">
        ${team.players.map(pid => nameInput(tour, pid)).join('<span class="sep">/</span>')}
        ${unitButton(team, 'team')}
      </li>`).join('')}</ul>
      <form class="roster-add" data-form="team">
        ${addInput('a', 'add-team-a')}<span class="sep">/</span>${addInput('b', 'add-team-b')}
        <button type="submit" class="btn" data-testid="add-team">${esc(t('add'))}</button>
      </form>
    </div>`
  }
  return `<div class="field field-roster">
    <div class="field-head"><span class="label">${esc(t('players', { n: tour.players.filter(p => p.active).length }))}</span></div>
    <ul class="roster roster-players">${tour.players.map(p => `<li class="roster-row${p.active ? '' : ' retired'}" data-player="${p.id}">
      ${nameInput(tour, p.id)}${unitButton(p, 'player')}
    </li>`).join('')}</ul>
    <form class="roster-add" data-form="player">
      ${addInput('name', 'add-player')}
      <button type="submit" class="btn" data-testid="add-player">${esc(t('add'))}</button>
    </form>
  </div>`
}

// ---------- sets de reglas ----------

// Los de la app primero y después los del usuario, en el orden en que se crearon.
const rulesets = () => [...engine.builtinRulesets(), ...repo.state.rulesets.slice().sort((a, b) => a.createdAt - b.createdAt)]
const rulesetName = set => (set.builtin ? t(set.nameKey) : set.name)

// Lo que activa un set, en fichas cortas. La de canchas va en rojo si con los jugadores
// de este torneo sobran canchas.
function rulesChips (tour, s) {
  const over = Boolean(courtsOver(tour, s))
  return [
    [t('partnersSummary_' + s.partners)],
    [t('pairingSummary_' + s.pairing)],
    [tn('courtsCount', s.courts), over],
    [limitSummary(tour, s)],
    [scoringSummary(s)],
    [matchEndSummary(s)]
  ].map(([text, warn]) => `<span${warn ? ' class="warn-text"' : ''}>${esc(text)}</span>`).join('')
}

function rulesetOption (tour, set, selected) {
  const blocked = !selected && !engine.canApplyRules(tour, set.settings)
  const name = rulesetName(set)
  return `<div class="ruleset-row">
    <button type="button" role="radio" class="ruleset${selected ? ' on' : ''}" aria-checked="${selected}"
      data-ruleset="${esc(set.id)}"${blocked ? ' disabled' : ''} data-testid="ruleset">
      <span class="ruleset-name">${esc(name)}</span>
      <span class="ruleset-rules">${rulesChips(tour, set.settings)}</span>
      ${blocked ? `<span class="hint">${esc(t('rulesetBlocked'))}</span>` : ''}
    </button>
    <button type="button" class="icon-btn" data-action="delete-ruleset" data-ruleset-id="${esc(set.id)}"
      aria-label="${esc(t('rulesetDelete', { name }))}" data-testid="delete-ruleset"${set.builtin || !set.id ? ' disabled' : ''}>✕</button>
  </div>`
}

// Elegir uno solo. Un torneo cuyo set ya no existe (se borró, o es de antes de los sets)
// conserva sus reglas: aparecen como una opción más, la elegida.
function rulesChoiceHtml (tour) {
  const sets = rulesets()
  const own = sets.some(x => x.id === tour.rulesetId)
    ? ''
    : rulesetOption(tour, { id: '', name: t('rulesetOwn'), settings: tour.settings }, true)
  const over = courtsOver(tour, tour.settings)
  const est = estimateText(tour, tour.settings)
  return `<section class="field rules-choice" data-testid="rules-choice">
    <div class="field-head"><span class="label" id="rulesChoiceLabel">${esc(t('rulesH'))}</span></div>
    <div class="rulesets" role="radiogroup" aria-labelledby="rulesChoiceLabel">
      ${own}${sets.map(set => rulesetOption(tour, set, set.id === tour.rulesetId)).join('')}
    </div>
    ${est ? `<p class="hint" data-testid="estimate">${esc(est)}</p>` : ''}
    ${over ? `<p class="hint warn-text" data-testid="courts-warning">${esc(over)}</p>` : ''}
  </section>`
}

// El formulario parte de las reglas elegidas, y `source` dice de dónde salen:
//   'set'     un set del usuario: «Guardar» lo edita; lleva su nombre.
//   'own'     las reglas propias del torneo (su set ya no existe): «Guardar» las cambia en
//             el torneo.
//   'builtin' de fábrica: no se editan, solo se guardan como nuevas.
// Borrar no es cosa del formulario: cada set guardado lleva su ✕ en la lista.
// «Guardar como nueva» sirve siempre. El nombre es el de las reglas elegidas, tal cual: lo
// que se está haciendo es editarlas. Solo al guardarlas como nueva, si el nombre no se
// cambió, se le añade «(copia)» (ver `saveRuleset`).
function formFrom (set, settings) {
  const source = !set ? 'own' : set.builtin ? 'builtin' : 'set'
  const name = set ? rulesetName(set) : t('rulesetOwn')
  return {
    source,
    baseId: source === 'set' ? set.id : null,
    baseName: name,
    name,
    settings: structuredClone(settings)
  }
}

// «Nombre (copia)», o «Nombre (copia 2)», «(copia 3)»… si esa ya existe.
function copyName (base) {
  const taken = n => rulesets().some(x => rulesetName(x).toLowerCase() === n.toLowerCase())
  let name = t('rulesetCopyName', { name: base })
  for (let n = 2; taken(name); n++) name = t('rulesetCopyNameN', { name: base, n })
  return name
}

function formFor (tour) {
  if (!ruleForm) ruleForm = formFrom(rulesets().find(x => x.id === tour.rulesetId), tour.settings)
  return ruleForm
}

function rulesFormHtml (tour) {
  const f = formFor(tour)
  const s = f.settings
  const est = estimateText(tour, s)
  const over = courtsOver(tour, s)
  const builtin = f.source === 'builtin'
  // Reglas que chocan: se pueden elegir, pero se marcan en rojo con el porqué y no se guarda.
  const conflicts = engine.settingsConflicts(s)
  const clash = key => (conflicts.includes(key)
    ? { note: t('conflictRankedEveryone', { limit: t('limitEveryone_' + s.partners) }), warn: true }
    : {})
  return `<section class="rules-form" data-testid="rules-form">
    <h3>${esc(t('rulesFormEditH'))}</h3>
    ${rule('rulesetName', f.name, () => `<input id="rulesetName" class="input" data-field="rulesetName" data-focus-key="rulesetName"
        maxlength="40" autocomplete="off" value="${esc(f.name)}" aria-label="${esc(t('rulesetName'))}" data-testid="ruleset-name">`)}
    ${rule('partners', t(PARTNER_LABELS[s.partners]), () => seg('partners', [['rotating', 'partnersRotating'], ['fixed', 'partnersFixed']], s.partners))}
    ${rule('pairing', t(PAIRING_LABELS[s.pairing]), () => seg('pairing', [['random', 'pairingRandom'], ['ranked', 'pairingRanked']], s.pairing), clash('pairing'))}
    ${rule('courts', tn('courtsCount', s.courts), () => stepper('courts', s.courts, String(s.courts)), { note: over, warn: Boolean(over) })}
    ${rule('limit', `${limitSummary(tour, s)}${est ? ' · ' + est : ''}`, () => limitEditor(tour, s, est), clash('limit'))}
    ${rule('scoring', scoringSummary(s), () => scoringBody(s))}
    ${rule('matchEnd', matchEndSummary(s), () => matchEndBody(s))}
    ${conflicts.length ? `<p class="hint warn-text" data-testid="rules-conflict">${esc(t('rulesConflictSave'))}</p>` : ''}
    ${builtin ? `<p class="hint" data-testid="builtin-note">${esc(t('rulesetBuiltinNote'))}</p>` : ''}
    <div class="actions">
      <button type="button" class="btn-primary" data-action="update-ruleset" data-testid="update-ruleset"${builtin || conflicts.length ? ' disabled' : ''}>${esc(t('rulesetUpdate'))}</button>
      <button type="button" class="btn" data-action="save-ruleset" data-testid="save-ruleset"${conflicts.length ? ' disabled' : ''}>${esc(t('rulesetSaveNew'))}</button>
    </div>
  </section>`
}

function formHtml (tour) {
  const isDraft = tour === draft
  const blocker = engine.nextRoundBlocker(tour)
  return `
    <header class="t-head"><h2>${esc(t(isDraft ? 'newTournamentH' : 'tournamentH'))}</h2></header>
    <div class="setup-form">
    <div class="setup-col">
    ${rule('name', tour.name, () => `<input id="tourName" class="input" data-field="name" data-focus-key="name" maxlength="40"
        autocomplete="off" value="${esc(tour.name)}" aria-label="${esc(t('name'))}" data-testid="tournament-name">`)}
    ${rosterHtml(tour)}
    </div>
    <div class="setup-col">
    ${rulesChoiceHtml(tour)}
    ${isDraft
      ? `<div class="actions">
          <button type="button" class="btn-primary" data-action="start" data-testid="start-tournament"${blocker ? ' disabled' : ''}>${esc(t('start'))}</button>
          <button type="button" class="btn" data-action="cancel-draft" data-testid="cancel-draft">${esc(t('cancel'))}</button>
        </div>
        ${blocker === 'players' ? `<p class="hint">${esc(t(engine.isFixed(tour) ? 'needTeams' : 'needPlayers', { n: engine.minUnits(tour) }))}</p>` : ''}`
      : `<div class="actions">
          <button type="button" class="btn" data-action="new" data-testid="new-tournament">${esc(t('newTournament'))}</button>
          <button type="button" class="btn danger" data-action="delete" data-testid="delete-tournament">${esc(t('deleteTournament'))}</button>
        </div>`}
    </div>
    </div>`
}

function historyHtml () {
  if (!repo.state.list.length) return ''
  const list = repo.state.list.slice().sort((x, y) => y.updatedAt - x.updatedAt)
  return `<section class="history"><h3>${esc(t('myTournaments'))}</h3><ul>${list.map(tour => {
    const st = engine.status(tour)
    const size = engine.isFixed(tour)
      ? t('teamsCount', { n: tour.teams.filter(x => x.active).length })
      : t('playersCount', { n: tour.players.filter(p => p.active).length })
    const phase = st.finished ? t('stateFinished') : tour.rounds.length ? t('stateRound', { n: tour.rounds.length }) : t('stateNotStarted')
    const isCurrent = tour.id === repo.state.activeId
    return `<li class="history-row${isCurrent ? ' current' : ''}" data-tournament="${tour.id}">
      <button type="button" class="history-open" data-action="open"${isCurrent ? ' aria-current="true"' : ''} data-testid="open-tournament">
        <span class="h-name">${esc(tour.name)}</span>
        <span class="h-meta">${esc(formatDate(tour.createdAt))} · ${esc(size)} · ${esc(phase)}</span>
      </button>
      <button type="button" class="icon-btn" data-action="delete-other" aria-label="${esc(t('deleteTournament'))}">✕</button>
    </li>`
  }).join('')}</ul></section>`
}

function renderSetup () {
  const page = $('setupPage')
  if (watching) { page.innerHTML = watchBanner(); return }
  if (storeGate(page)) return
  const tour = current()
  // El formulario de reglas va debajo de todo.
  withFocus(page, () => { page.innerHTML = (tour ? formHtml(tour) : emptyState()) + historyHtml() + (tour ? rulesFormHtml(tour) : '') })
}

// El borrador solo re-pinta su página; un torneo abierto se guarda y re-pinta todo.
function commit (tour) {
  if (tour === draft) return renderSetup()
  repo.save(tour)
  renderAll()
}

function startDraft () {
  const base = engine.builtinRulesets()[0]
  draft = engine.createTournament({ name: t('defaultTournamentName', { date: formatDate(Date.now()) }), settings: base.settings, rulesetId: base.id })
  openRule = null
  ruleForm = null
  ui.goTab('setup')
}

// Pone unas reglas en el torneo. Si cambian el tipo de parejas y ya hay rondas, se
// pregunta (se vuelven a sortear). false si no se aplicaron.
async function useRules (tour, settings, rulesetId) {
  if (!engine.canApplyRules(tour, settings)) return false
  if (settings.partners !== tour.settings.partners && tour.rounds.length) {
    const yes = await ask({ title: t('partnersChangeTitle'), text: t('partnersChangeText'), ok: t('change') })
    if (!yes) return false
  }
  engine.applyRules(tour, settings)
  tour.rulesetId = rulesetId
  return true
}

// Elegir un set: sus reglas se copian al torneo, y el formulario de abajo lo carga para
// editarlo o armar otro a partir de él. Volver a pulsar el elegido solo carga el formulario.
async function selectRuleset (tour, id) {
  const set = id ? rulesets().find(x => x.id === id) : null
  if (id && !set) throw new Error(`unknown ruleset ${id}`)
  ruleForm = formFrom(set, set ? set.settings : tour.settings)
  if (set && set.id !== tour.rulesetId) await useRules(tour, set.settings, set.id)
  commit(tour)
}

// El nombre hace falta y no se repite: en la lista, dos opciones iguales no se distinguen.
function nameProblem (name, exceptId) {
  if (!name) return 'rulesetNeedsName'
  const taken = rulesets().some(x => x.id !== exceptId && rulesetName(x).toLowerCase() === name.toLowerCase())
  return taken ? 'rulesetNameTaken' : null
}

function showNameProblem (key) {
  openRule = 'rulesetName'
  renderSetup()
  $('rulesetName').focus()
  toast(t(key), 'error')
}

async function storeRuleset (set) {
  try {
    await repo.saveRuleset(set)
    return true
  } catch (e) {
    console.error('[padel] could not save the rules:', e)
    toast(t('saveFailed', { reason: e.message }), 'error')
    return false
  }
}

// Guardar como set nuevo, y elegirlo para este torneo si se puede.
async function saveRuleset (tour) {
  const f = ruleForm
  // Se clona ahora: si el nombre sigue siendo el de las reglas de las que partió, la nueva
  // lleva «(copia)» para no confundirse con ellas.
  const typed = f.name.trim()
  const name = typed === f.baseName ? copyName(f.baseName) : typed
  const problem = nameProblem(name, null)
  if (problem) return showNameProblem(problem)
  const set = { id: crypto.randomUUID(), name, createdAt: Date.now(), settings: structuredClone(f.settings) }
  if (!(await storeRuleset(set))) return
  const chosen = await useRules(tour, set.settings, set.id)
  ruleForm = formFrom(set, set.settings)
  openRule = null
  commit(tour)
  toast(t(chosen ? 'rulesetSavedChosen' : 'rulesetSaved', { name }))
  $('setupPage').querySelector('[data-testid="rules-choice"]').scrollIntoView({ block: 'start', behavior: 'smooth' })
}

// Guardar los cambios en las reglas de las que partió el formulario. Si es un set y este
// torneo lo usa, sus reglas cambian con él; los demás torneos conservan su copia. Si son
// las reglas propias del torneo, cambian solo en el torneo.
async function updateRuleset (tour) {
  const f = ruleForm
  if (f.source === 'builtin') throw new Error('built-in rules cannot be changed')
  if (f.source === 'own') {
    if (!engine.canApplyRules(tour, f.settings)) return toast(t('rulesetBlocked'), 'error')
    if (!(await useRules(tour, f.settings, tour.rulesetId))) return
    openRule = null
    commit(tour)
    return toast(t('rulesetOwnUpdated'))
  }
  const set = repo.state.rulesets.find(x => x.id === f.baseId)
  if (!set) throw new Error(`unknown ruleset ${f.baseId}`)
  const name = f.name.trim()
  const problem = nameProblem(name, set.id)
  if (problem) return showNameProblem(problem)
  const next = { ...set, name, settings: structuredClone(f.settings) }
  const inUse = tour.rulesetId === set.id
  if (inUse && !engine.canApplyRules(tour, next.settings)) return toast(t('rulesetBlocked'), 'error')
  if (!(await storeRuleset(next))) return
  if (inUse) await useRules(tour, next.settings, next.id)
  openRule = null
  commit(tour)
  toast(t('rulesetUpdated', { name }))
}

async function deleteRuleset (id) {
  const set = repo.state.rulesets.find(x => x.id === id)
  if (!set) throw new Error(`unknown ruleset ${id}`)
  const yes = await ask({ title: t('rulesetDeleteTitle'), text: t('rulesetDeleteText', { name: set.name }), ok: t('delete'), danger: true })
  if (!yes) return
  try {
    await repo.removeRuleset(id)
  } catch (e) {
    console.error('[padel] could not delete the rules:', e)
    toast(t('saveFailed', { reason: e.message }), 'error')
    return
  }
  // Si el formulario estaba sobre ese set, vuelve a partir de las reglas del torneo: si no,
  // «Guardar» apuntaría a un set que ya no existe.
  if (ruleForm?.baseId === id) ruleForm = null
  renderSetup()
}

async function startTournament () {
  const tour = draft
  const r = engine.generateRound(tour)
  if (!r) throw new Error(`cannot start the tournament: ${engine.nextRoundBlocker(tour)}`)
  tour.rounds.push(r)
  draft = null
  repo.save(tour)
  await repo.setActive(tour.id)
  renderAll()
  ui.goTab('matches')
}

async function deleteTournament (tour) {
  const yes = await ask({
    title: t('deleteTournamentTitle'),
    text: t('deleteTournamentText', { name: tour.name }),
    ok: t('delete'),
    danger: true
  })
  if (!yes) return
  // Un torneo borrado no se sigue emitiendo.
  if (live.isSharing(tour)) await live.stop(tour)
  await repo.remove(tour.id)
  renderAll()
}

// Las opciones de las reglas editan el FORMULARIO (el set nuevo), nunca el torneo: al
// torneo solo llegan reglas eligiendo un set.
function onSeg (name, value) {
  formFor(current()).settings[name] = value
  renderSetup()
}

function onStep (name, delta) {
  const s = formFor(current()).settings
  const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v))
  if (name.startsWith('points-')) {
    const kind = s.scoring[name.slice('points-'.length)]
    kind.points = clamp(kind.points + delta, RANGES.points)
  } else {
    s[name] = clamp(s[name] + delta, RANGES[name])
  }
  renderSetup()
}

function onAdd (form) {
  const tour = current()
  const page = $('setupPage')
  if (form.dataset.form === 'player') {
    const name = form.elements.name.value.trim()
    if (!name) return form.elements.name.focus()
    engine.addPlayer(tour, name)
    commit(tour)
    page.querySelector('[data-focus-key="add-player"]').focus()
    return
  }
  const a = form.elements.a.value.trim()
  const b = form.elements.b.value.trim()
  if (!a) return form.elements.a.focus()
  if (!b) return form.elements.b.focus()
  engine.addTeam(tour, a, b)
  commit(tour)
  page.querySelector('[data-focus-key="add-team-a"]').focus()
}

async function onSetupClick (e) {
  const edit = e.target.closest('[data-edit]')
  if (edit) {
    openRule = openRule === edit.dataset.edit ? null : edit.dataset.edit
    renderSetup()
    if (openRule === 'name') $('tourName').focus()
    if (openRule === 'rulesetName') $('rulesetName').focus()
    return
  }
  const option = e.target.closest('[data-ruleset]')
  if (option) return selectRuleset(current(), option.dataset.ruleset)
  const toggle = e.target.closest('[data-toggle-scoring]')
  if (toggle) {
    // toggleScoring trabaja sobre un torneo; el formulario tiene la misma forma de ajustes.
    const f = formFor(current())
    const kind = toggle.dataset.toggleScoring
    engine.toggleScoring({ settings: f.settings }, kind, !f.settings.scoring[kind].on)
    return renderSetup()
  }
  const segBtn = e.target.closest('[data-seg]')
  if (segBtn) return onSeg(segBtn.dataset.seg, segBtn.dataset.value)
  const step = e.target.closest('[data-step]')
  if (step) return onStep(step.dataset.step, Number(step.dataset.delta))
  const b = e.target.closest('[data-action]')
  if (!b || await commonAction(b.dataset.action)) return
  const tour = current()
  switch (b.dataset.action) {
    case 'start': return startTournament()
    case 'cancel-draft':
      draft = null
      return renderSetup()
    case 'delete': return deleteTournament(repo.active())
    case 'delete-other':
      return deleteTournament(repo.state.list.find(x => x.id === b.closest('[data-tournament]').dataset.tournament))
    case 'save-ruleset': return saveRuleset(tour)
    case 'update-ruleset': return updateRuleset(tour)
    case 'delete-ruleset': return deleteRuleset(b.dataset.rulesetId)
    case 'open':
      draft = null
      ruleForm = null
      await repo.setActive(b.closest('[data-tournament]').dataset.tournament)
      resumeLive()
      renderAll()
      return ui.goTab('matches')
    case 'remove-player':
      engine.removePlayer(tour, b.closest('[data-player]').dataset.player)
      return commit(tour)
    case 'remove-team':
      engine.removeTeam(tour, b.closest('[data-team]').dataset.team)
      return commit(tour)
    case 'restore': {
      const row = b.closest('[data-player], [data-team]')
      engine.restoreUnit(tour, row.dataset.player || row.dataset.team)
      return commit(tour)
    }
    default:
      throw new Error(`unknown action: ${b.dataset.action}`)
  }
}

// Nombres: se guardan al escribir, sin re-pintar (re-pintar movería el foco).
function onSetupInput (e) {
  const el = e.target
  const tour = current()
  if (el.dataset.field === 'rulesetName') {
    formFor(tour).name = el.value
    $('setupPage').querySelector('[data-testid="rule-rulesetName-text"]').textContent = el.value
    return
  }
  if (el.dataset.field === 'name') {
    tour.name = el.value
    // Sin re-pintar (se perdería el foco): se actualiza a mano el texto de la regla.
    $('setupPage').querySelector('[data-testid="rule-name-text"]').textContent = el.value
  } else if (el.dataset.rename) {
    const name = el.value.trim()
    if (!name) return // vacío mientras se reescribe: se queda el nombre anterior
    tour.players.find(p => p.id === el.dataset.rename).name = name
  } else {
    return
  }
  if (tour !== draft) repo.save(tour)
}

function onSetupChange (e) {
  const el = e.target
  if (!el.dataset.rename) return
  if (!el.value.trim()) el.value = playerName(current(), el.dataset.rename)
}

// ---------- API ----------

/** Entrar en modo «mirar» (lo llama el arranque con un enlace `#watch=`). */
export function setWatching (w) { watching = w }

/**
 * El organizador: si el torneo abierto se estaba compartiendo, se vuelve a emitir con el
 * mismo enlace (tras recargar, o al abrirlo desde «Mis torneos»).
 */
export function resumeLive () {
  const tour = repo.active()
  if (watching || !live.isSharing(tour)) return
  live.share(tour).then(() => refreshLive()).catch(e => {
    console.error('[padel] could not resume sharing:', e)
    toast(t('liveFailed', { reason: e.message }), 'error')
  })
}

/** Cuántos miran cambió: se repinta solo la barra, sin tocar lo que se está escribiendo. */
export function refreshLive () {
  if (watching || repo.state.status !== 'ready') return
  const tour = repo.active()
  const el = $('matchesPage').querySelector('[data-testid="live-bar"]')
  if (tour && el) el.outerHTML = liveBar(tour)
}

export function renderAll () {
  renderMatches()
  renderTable()
  renderSetup()
}

// games: [izquierda, derecha]; sets: igual, o null si el partido no contaba sets.
export function saveLinkedResult ({ link, games, sets }) {
  if (repo.state.status !== 'ready') {
    toast(t('storeNotReady'), 'error')
    return false
  }
  const tour = repo.state.list.find(x => x.id === link.tournamentId)
  const m = tour && engine.findMatch(tour, link.matchId)
  if (!m) {
    toast(t('linkedGone'), 'error')
    return false
  }
  engine.setScore(tour, m.id, games[0], games[1])
  if (sets) engine.setSets(tour, m.id, sets[0], sets[1])
  repo.save(tour)
  return true
}

// El cronómetro del partido que está en el marcador. null mientras el almacén no está
// listo o si la ronda ya no existe: el marcador no enseña cuenta atrás.
export function clockForLink (link, now) {
  if (repo.state.status !== 'ready') return null
  const tour = repo.state.list.find(x => x.id === link.tournamentId)
  const round = tour && tour.rounds.find(r => r.id === link.roundId)
  return round ? engine.clockOf(tour, round, now) : null
}

// El tic de los cronómetros. Pinta el tiempo sin re-pintar la página (se perdería el foco
// de un resultado a medio escribir) y avisa UNA vez cuando uno llega a cero con la app
// abierta: si ya estaba a cero al abrirla, no suena.
const seenClock = new Map() // round.id → último estado visto

export function tick (now) {
  // Quien mira ve correr el cronómetro del torneo que llegó, pero no le suena ni le deja
  // la pantalla encendida: eso es del organizador.
  const tour = watching ? watching.state : (repo.state.status === 'ready' ? repo.active() : null)
  let running = false
  tour?.rounds.forEach((r, i) => {
    if (!r.clock) return
    const c = engine.clockOf(tour, r, now)
    const before = seenClock.get(r.id)
    seenClock.set(r.id, c.state)
    if (c.state === 'running') running = true
    if (before === 'running' && c.state === 'done' && !watching) {
      ring()
      toast(t('timeUp', { n: i + 1 }))
    }
    const el = $('matchesPage').querySelector(`[data-clock="${CSS.escape(r.id)}"]`)
    if (!el) return
    if (el.dataset.state !== c.state) {
      el.outerHTML = clockHtml(tour, r)
      return
    }
    const time = el.querySelector('.clock-time')
    const text = clockText(c)
    if (time.textContent !== text) time.textContent = text
  })
  if (!watching) keepAwake(running)
}

export function initTournamentViews (options) {
  ui = options
  $('matchesPage').addEventListener('click', onMatchesClick)
  $('matchesPage').addEventListener('input', e => {
    if (e.target.matches('input.score')) onScoreInput(e.target)
  })
  $('tablePage').addEventListener('click', onTableClick)
  $('setupPage').addEventListener('click', onSetupClick)
  $('setupPage').addEventListener('input', onSetupInput)
  $('setupPage').addEventListener('change', onSetupChange)
  $('setupPage').addEventListener('submit', e => {
    e.preventDefault()
    onAdd(e.target)
  })
}
