// Las tres pestañas del torneo: Partidos, Tabla y Torneo (la configuración).
// Pinta con plantillas y delega los eventos en cada página, como el marcador.
//
// Torneo es una pantalla ADMINISTRATIVA (§5.1): sin párrafos de presentación; lo que
// hace falta explicar va detrás de un botón (i).
import { $, escapeHtml as esc } from '../dom.js'
import { t, tn, getLang } from '../i18n.js'
import { ask, toast } from '../ui/dialog.js'
import { prepareAlarm, ring, keepAwake } from '../ui/alarm.js'
import * as engine from './engine.js'
import * as repo from './repo.js'

let ui = null // { goTab, playMatch, linkedMatchId }
let draft = null // torneo que se está creando: no existe en el store hasta «Empezar»
let openRule = null // la regla que se está editando, una a la vez

const RANGES = { limitValue: [1, 99], gamesPerMatch: [0, 20], matchMinutes: [5, 120], points: [1, 10] }
const STEPS = { matchMinutes: 5 }
const LABELS = { name: 'name', partners: 'partners', pairing: 'pairing', courts: 'courts', limit: 'limit', scoring: 'scoring', matchEnd: 'matchEnd' }
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
  const btn = (action, label, primary = false) =>
    `<button type="button" class="${primary ? 'btn-primary' : 'btn'}" data-action="${action}" data-testid="${action}">${esc(t(label))}</button>`
  const actions = {
    idle: btn('clock-start', 'clockStart', true),
    running: btn('clock-pause', 'clockPause') + btn('clock-reset', 'clockReset'),
    paused: btn('clock-resume', 'clockResume', true) + btn('clock-reset', 'clockReset'),
    done: btn('clock-reset', 'clockReset')
  }[c.state]
  return `<div class="clock ${c.state}" data-clock="${r.id}" data-state="${c.state}" role="timer" aria-label="${esc(t('clockAria'))}" data-testid="round-clock">
    <span class="clock-time" data-testid="clock-time">${esc(clockText(c))}</span>
    <span class="clock-actions">${actions}</span>
  </div>`
}

const clockText = c => (c.state === 'done' ? t('clockDone') : engine.formatClock(c.remainingMs))

const roundActions = tour => engine.canRedoLastRound(tour)
  ? `<button type="button" class="btn-small" data-action="redo" data-testid="redo-round">${esc(t('redo'))}</button>
     <button type="button" class="btn-small" data-action="drop" data-testid="drop-round">${esc(t('dropRound'))}</button>`
  : ''

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
  if (blocker === 'players') {
    box.innerHTML = `<div class="notice"><p>${esc(t(engine.isFixed(tour) ? 'needTeams' : 'needPlayers', { n: engine.minUnits(tour) }))}</p>
      <button type="button" class="btn" data-action="go-setup">${esc(t('goSetup'))}</button></div>`
    return
  }
  if (blocker === 'finished') {
    box.innerHTML = engine.status(tour).finished
      ? `<div class="finished" data-testid="finished"><strong>🏆 ${esc(t('finished'))}</strong>
          <button type="button" class="btn" data-action="see-table">${esc(t('seeTable'))}</button></div>`
      : ''
    return
  }
  const last = tour.rounds[tour.rounds.length - 1]
  const pending = tour.settings.pairing === 'ranked' && last && !last.matches.every(engine.hasScore)
  box.innerHTML = `<button type="button" class="btn-primary block" data-action="next" data-testid="next-round">${esc(t('nextRound', { n: tour.rounds.length + 1 }))}</button>
    ${pending ? `<p class="hint">${esc(t('rankedPending', { n: tour.rounds.length }))}</p>` : ''}`
}

function renderMatches () {
  const page = $('matchesPage')
  if (storeGate(page)) return
  const tour = repo.active()
  if (!tour) { page.innerHTML = emptyState(); return }
  // Las rondas en orden y «Armar ronda» debajo: cada ronda nueva se suma al final.
  page.innerHTML = `
    <header class="t-head"><h2 class="t-name">${esc(tour.name)}</h2><p class="t-sub" id="matchesProgress"></p></header>
    <div class="rounds">${tour.rounds.map((r, i) => roundHtml(tour, r, i)).join('')}</div>
    <div id="nextBlock"></div>`
  paintProgress(tour)
  paintNext(tour)
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
  const b = e.target.closest('[data-action]')
  if (!b || await commonAction(b.dataset.action)) return
  const tour = repo.active()
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
  if (storeGate(page)) return
  const tour = repo.active()
  if (!tour) { page.innerHTML = emptyState(); return }
  const rows = engine.standings(tour)
  const finished = engine.status(tour).finished
  const sets = tour.settings.scoring.sets.on
  const rank = i => (finished && i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1))
  const head = (label, title) => `<th scope="col"><abbr title="${esc(t(title))}">${esc(t(label))}</abbr></th>`
  page.innerHTML = `
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
  const b = e.target.closest('[data-action]')
  if (b && !(await commonAction(b.dataset.action))) throw new Error(`unknown action: ${b.dataset.action}`)
}

// ---------- Torneo (configuración) ----------

// Una regla del torneo se LEE como texto, con «Editar» al lado; al pulsarlo aparecen sus
// opciones y su explicación. `editor` es una función: solo se pinta la que está abierta.
function rule (key, text, editor, { editable = true, note = '' } = {}) {
  const open = editable && openRule === key
  const label = t(LABELS[key])
  return `<div class="rule${open ? ' open' : ''}" data-rule="${key}" data-testid="rule-${key}">
    <div class="rule-line">
      <div class="rule-main">
        <span class="label">${esc(label)}</span>
        <p class="rule-text" data-testid="rule-${key}-text">${esc(text)}</p>
        ${note ? `<p class="hint">${esc(note)}</p>` : ''}
      </div>
      ${editable
        ? `<button type="button" class="btn-small rule-edit" data-edit="${key}" aria-expanded="${open}"
            aria-label="${esc(t(open ? 'ruleDoneAria' : 'ruleEditAria', { rule: label }))}" data-testid="edit-${key}">${esc(t(open ? 'ruleDone' : 'ruleEdit'))}</button>`
        : ''}
    </div>
    ${open ? `<div class="rule-editor">${INFOS.has(key) ? `<p class="info-text">${esc(t('info_' + key))}</p>` : ''}${editor()}</div>` : ''}
  </div>`
}

const seg = (name, options, value, disabled = false) => `<div class="seg" role="group">${options.map(([v, label]) =>
  `<button type="button" class="seg-btn${v === value ? ' on' : ''}" data-seg="${name}" data-value="${v}"
    aria-pressed="${v === value}"${disabled ? ' disabled' : ''} data-testid="${name}-${v}">${esc(t(label))}</button>`).join('')}</div>`

function stepper (name, value, shown, [min, max] = RANGES[name], step = STEPS[name] || 1) {
  return `<div class="stepper">
    <button type="button" class="step" data-step="${name}" data-delta="${-step}"${value <= min ? ' disabled' : ''} aria-label="−${step}" data-testid="${name}-minus">−</button>
    <output data-testid="${name}-value">${esc(shown)}</output>
    <button type="button" class="step" data-step="${name}" data-delta="${step}"${value >= max ? ' disabled' : ''} aria-label="+${step}" data-testid="${name}-plus">+</button>
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
      ${x.on ? `<span class="scoring-amount">${stepper('points-' + k, x.points, String(x.points), RANGES.points)}<span class="unit">${esc(t('unit_points'))}</span></span>` : ''}
    </div>`
  }).join('')}</div>`
}

function matchEndBody (s) {
  const time = s.matchEnd === 'time'
  const amount = time
    ? stepper('matchMinutes', s.matchMinutes, String(s.matchMinutes)) + `<span class="unit">${esc(t('unit_minutes'))}</span>`
    : stepper('gamesPerMatch', s.gamesPerMatch, s.gamesPerMatch ? String(s.gamesPerMatch) : t('free')) + `<span class="unit">${esc(tn('unit_games', s.gamesPerMatch))}</span>`
  return seg('matchEnd', [['time', 'matchEndTime'], ['games', 'matchEndGames']], s.matchEnd) + `<div class="row">${amount}</div>`
}

function matchEndSummary (s) {
  if (s.matchEnd === 'time') return t('matchEndSummaryTime', { n: s.matchMinutes })
  if (s.matchEnd === 'games') return s.gamesPerMatch ? tn('matchEndSummaryGames', s.gamesPerMatch) : t('matchEndSummaryFree')
  throw new Error(`unknown match end: ${s.matchEnd}`)
}

// Las canchas: el tope son las que caben con los jugadores de ahora, y se dice cuántas.
function courtsEditor (tour) {
  const inUse = engine.courtsInUse(tour)
  const max = engine.maxCourts(tour)
  const fixed = engine.isFixed(tour)
  const hint = max < 1
    ? t(fixed ? 'needTeams' : 'needPlayers', { n: engine.minUnits(tour) })
    : tn(fixed ? 'courtsMaxTeams' : 'courtsMaxPlayers', max, { units: engine.activeUnits(tour).length, n: max })
  return stepper('courts', inUse, String(inUse), [1, Math.max(1, max)]) + `<p class="hint" data-testid="courts-hint">${esc(hint)}</p>`
}

function limitEditor (s, estimateText) {
  return seg('limitType', [['perPlayer', 'limitPerPlayer'], ['rounds', 'limitRounds'], ['matches', 'limitMatches']], s.limitType) +
    `<div class="row">${stepper('limitValue', s.limitValue, String(s.limitValue))}<span class="unit">${esc(tn('unit_' + s.limitType, s.limitValue))}</span></div>` +
    `<p class="hint" data-testid="estimate">${esc(estimateText)}</p>`
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

function formHtml (tour) {
  const s = tour.settings
  const isDraft = tour === draft
  const locked = engine.hasResults(tour)
  const est = engine.estimate(tour)
  const blocker = engine.nextRoundBlocker(tour)
  const estimateText = est
    ? t(est.exact ? 'estimateExact' : 'estimate', est) + (s.matchEnd === 'time' ? ' · ' + t('estimateMinutes', { n: est.rounds * s.matchMinutes }) : '')
    : ''
  const limitText = tn('unit_' + s.limitType, s.limitValue, { n: s.limitValue })
  return `
    <header class="t-head"><h2>${esc(t(isDraft ? 'newTournamentH' : 'tournamentH'))}</h2></header>
    <div class="setup-form">
    ${rule('name', tour.name, () => `<input id="tourName" class="input" data-field="name" data-focus-key="name" maxlength="40"
        autocomplete="off" value="${esc(tour.name)}" aria-label="${esc(t('name'))}" data-testid="tournament-name">`)}
    ${rule('partners', t(PARTNER_LABELS[s.partners]),
      () => seg('partners', [['rotating', 'partnersRotating'], ['fixed', 'partnersFixed']], s.partners),
      { editable: !locked, note: locked ? t('partnersLocked') : '' })}
    ${rule('pairing', t(PAIRING_LABELS[s.pairing]),
      () => seg('pairing', [['random', 'pairingRandom'], ['ranked', 'pairingRanked']], s.pairing))}
    ${rosterHtml(tour)}
    ${rule('courts', tn('courtsCount', engine.courtsInUse(tour)), () => courtsEditor(tour))}
    ${rule('limit', `${s.limitValue} ${limitText}${estimateText ? ' · ' + estimateText : ''}`, () => limitEditor(s, estimateText))}
    ${rule('scoring', scoringSummary(s), () => scoringBody(s))}
    ${rule('matchEnd', matchEndSummary(s), () => matchEndBody(s))}
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
  if (storeGate(page)) return
  const tour = current()
  withFocus(page, () => { page.innerHTML = (tour ? formHtml(tour) : emptyState()) + historyHtml() })
}

// El borrador solo re-pinta su página; un torneo abierto se guarda y re-pinta todo.
function commit (tour) {
  if (tour === draft) return renderSetup()
  repo.save(tour)
  renderAll()
}

function startDraft () {
  draft = engine.createTournament({ name: t('defaultTournamentName', { date: formatDate(Date.now()) }) })
  openRule = null
  ui.goTab('setup')
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
  await repo.remove(tour.id)
  renderAll()
}

async function onSeg (name, value) {
  const tour = current()
  if (name === 'partners') {
    if (value === tour.settings.partners) return
    if (tour.rounds.length) {
      const yes = await ask({ title: t('partnersChangeTitle'), text: t('partnersChangeText'), ok: t('change') })
      if (!yes) return
    }
    engine.setPartners(tour, value)
  } else {
    tour.settings[name] = value
  }
  commit(tour)
}

function onStep (name, delta) {
  const tour = current()
  const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v))
  if (name.startsWith('points-')) {
    const kind = tour.settings.scoring[name.slice('points-'.length)]
    kind.points = clamp(kind.points + delta, RANGES.points)
  } else if (name === 'courts') {
    // Se cuenta desde las que se usan: con 9 jugadores y 3 guardadas, «−» deja 1, no 2.
    tour.settings.courts = clamp(engine.courtsInUse(tour) + delta, [1, Math.max(1, engine.maxCourts(tour))])
  } else {
    tour.settings[name] = clamp(tour.settings[name] + delta, RANGES[name])
  }
  commit(tour)
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
    return
  }
  const toggle = e.target.closest('[data-toggle-scoring]')
  if (toggle) {
    const tour = current()
    const kind = toggle.dataset.toggleScoring
    engine.toggleScoring(tour, kind, !tour.settings.scoring[kind].on)
    return commit(tour)
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
    case 'open':
      draft = null
      await repo.setActive(b.closest('[data-tournament]').dataset.tournament)
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
  if (repo.state.status !== 'ready') return
  const tour = repo.active()
  let running = false
  tour?.rounds.forEach((r, i) => {
    if (!r.clock) return
    const c = engine.clockOf(tour, r, now)
    const before = seenClock.get(r.id)
    seenClock.set(r.id, c.state)
    if (c.state === 'running') running = true
    if (before === 'running' && c.state === 'done') {
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
  keepAwake(running)
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
