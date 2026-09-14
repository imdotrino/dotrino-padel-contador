// Marcador táctil de un partido: puntos, juegos, sets, tie-break y saque.
// Juega un partido suelto o uno del torneo (`state.link`). En el segundo caso los
// juegos se acumulan sin cerrar sets, y el resultado vuelve al torneo.
import { $, cap, escapeHtml } from './dom.js'
import { t } from './i18n.js'
import { ask, toast } from './ui/dialog.js'
import { listDocs, putDoc, removeDoc } from './storage.js'

// El partido en curso es progreso volátil de este aparato (§4): localStorage.
const LIVE_KEY = 'padel.live'
const CONFIG_KEY = 'padel.config'
// Los resultados guardados son del usuario: store.
const RESULTS_THREAD = 'padel.results'

const SCORINGS = ['advantage', 'star', 'golden']
const SETS = [1, 3, 5]

// scoring: 'advantage' (ganar por 2) | 'star' (doble ventaja / Star Point FIP: dos
// ventajas y luego punto de oro) | 'golden' (punto de oro directo).
// sets: 1 (cuenta sin fin), 3 o 5. Solo cambia cómo se lee el marcador; el partido lo
// cierra el botón Nuevo, no un límite.
const config = { scoring: 'golden', sets: 3 }

// p = puntos del juego actual (0..40 / ventaja, o nº en tie-break),
// g = juegos del set actual, s = sets ganados.
const state = {
  left: { p: 0, g: 0, s: 0 },
  right: { p: 0, g: 0, s: 0 },
  server: 'left',
  gameNum: 0, // juegos jugados en el partido (rota el orden de saque P1/P2)
  tiebreak: false,
  setsHistory: [], // sets cerrados: [{ left, right }] (juegos)
  undo: [], // instantáneas para deshacer
  link: null // { tournamentId, tournamentName, matchId, round, court, target, left, right }
}

let hooks = null

const other = side => (side === 'left' ? 'right' : 'left')
const flipServer = () => { state.server = other(state.server) }
// A 1 set, o jugando un partido del torneo, los juegos se acumulan sin cerrar sets.
const endless = () => config.sets === 1 || state.link !== null

// ---------- persistencia local ----------

function readJson (key) {
  const raw = localStorage.getItem(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error(`[padel] discarding corrupt ${key}:`, e)
    localStorage.removeItem(key)
    return null
  }
}

function loadConfig () {
  const c = readJson(CONFIG_KEY)
  if (!c) return
  if (SCORINGS.includes(c.scoring)) config.scoring = c.scoring
  if (SETS.includes(c.sets)) config.sets = c.sets
}
const saveConfig = () => localStorage.setItem(CONFIG_KEY, JSON.stringify(config))

function snapshot () {
  return {
    left: { ...state.left },
    right: { ...state.right },
    server: state.server,
    gameNum: state.gameNum,
    tiebreak: state.tiebreak,
    setsHistory: state.setsHistory.map(s => ({ ...s }))
  }
}

function apply (s) {
  state.left = { ...s.left }
  state.right = { ...s.right }
  state.server = s.server
  state.gameNum = s.gameNum
  state.tiebreak = s.tiebreak
  state.setsHistory = s.setsHistory.map(x => ({ ...x }))
}

const pushUndo = () => state.undo.push(snapshot())

function saveLive () {
  localStorage.setItem(LIVE_KEY, JSON.stringify({
    ...snapshot(),
    undo: state.undo,
    link: state.link,
    names: { left: $('nameLeft').value, right: $('nameRight').value }
  }))
}

function loadLive () {
  const d = readJson(LIVE_KEY)
  if (!d) return
  apply(d)
  state.undo = d.undo
  state.link = d.link
  $('nameLeft').value = d.names.left
  $('nameRight').value = d.names.right
}

// ---------- puntuación ----------

// Puntos de diferencia para cerrar el juego según el modo:
//  · 'golden'    → 1: en 40-40 el siguiente punto define.
//  · 'advantage' → 2: hay que ganar por dos (la igualdad se repite sin fin).
//  · 'star'      → 2, pero a la 3.ª igualdad (ambos en 5 = se gastaron las dos
//                  ventajas) pasa a punto de oro = 1.
function diffNeeded (a, b) {
  if (config.scoring === 'golden') return 1
  if (config.scoring === 'star' && Math.min(a, b) >= 5) return 1
  return 2
}

// ¿El marcador a-b ya cierra el juego (o el tie-break) a favor del primero?
function closes (a, b) {
  if (state.tiebreak) return a >= 7 && a - b >= 2
  return a >= 4 && a - b >= diffNeeded(a, b)
}

function winPoint (side) {
  pushUndo()
  const A = state[side]
  const B = state[other(side)]
  A.p++
  let gameWon = false
  if (state.tiebreak) {
    // El saque pasa tras el 1.er punto y luego cada 2 puntos.
    if ((state.left.p + state.right.p) % 2 === 1) flipServer()
    if (closes(A.p, B.p)) closeSet(side, true)
  } else if (closes(A.p, B.p)) {
    winGame(side)
    gameWon = true
  }
  popTap(side)
  render()
  if (gameWon) checkLinkedTarget()
}

function winGame (side) {
  const o = other(side)
  state[side].g++
  state.left.p = 0
  state.right.p = 0
  state.gameNum++
  flipServer() // el saque cambia de pareja en cada juego
  if (endless()) return
  if (state[side].g >= 6 && state[side].g - state[o].g >= 2) closeSet(side, false)
  else if (state.left.g === 6 && state.right.g === 6) state.tiebreak = true
}

function closeSet (side, viaTie) {
  const o = other(side)
  if (viaTie) { state[side].g = 7; state[o].g = 6 }
  state.setsHistory.push({ left: state.left.g, right: state.right.g })
  state[side].s++
  state.left.g = 0
  state.right.g = 0
  state.left.p = 0
  state.right.p = 0
  state.tiebreak = false
}

// Ajuste manual de sets/games (+/−) para corregir el marcador.
function adjust (side, kind, delta) {
  const next = state[side][kind] + delta
  if (next < 0) return
  pushUndo()
  state[side][kind] = next
  if (kind === 'g') state.tiebreak = !endless() && state.left.g === 6 && state.right.g === 6
  render()
}

// Ajuste fino del punto (+/−): corrige el juego en curso sin deshacer jugadas. Nunca
// cierra el juego ni el set —para eso está tocar el panel—, así que se rechaza el
// ajuste que dejaría un juego ya ganado (y así el marcador sigue en 0/15/30/40/AD).
function canAdjustPoint (side, delta) {
  const a = state[side].p + delta
  const b = state[other(side)].p
  return a >= 0 && !closes(a, b) && !closes(b, a)
}

function adjustPoint (side, delta) {
  if (!canAdjustPoint(side, delta)) return
  pushUndo()
  state[side].p += delta
  render()
}

function displayPoint (side) {
  const a = state[side].p
  const b = state[other(side)].p
  if (state.tiebreak) return { txt: String(a), ad: false }
  if (a >= 3 && b >= 3) {
    if (a === b) return { txt: '40', ad: false }
    return a > b ? { txt: 'AD', ad: true } : { txt: '40', ad: false }
  }
  return { txt: ['0', '15', '30', '40'][a], ad: false }
}

// ---------- pintado ----------

export function render () {
  document.body.classList.toggle('tiebreak', state.tiebreak)
  // Lado R/L alterna en cada punto; el jugador rota P1,P1,P2,P2 por game.
  const courtSide = ((state.left.p + state.right.p) % 2) === 0 ? 'R' : 'L'
  const player = (Math.floor(state.gameNum / 2) % 2) === 0 ? 'P1' : 'P2'
  for (const side of ['left', 'right']) {
    const S = cap(side)
    const d = displayPoint(side)
    const pts = $('points' + S)
    pts.textContent = d.txt
    pts.classList.toggle('ad', d.ad)
    // El SET va en una fila más grande que el GAME: es la unidad mayor.
    const row = (kind, cls, value, label, total) =>
      `<div class="meta-row ${cls}">` +
        `<button class="adj" data-side="${side}" data-kind="${kind}" data-delta="-1"` +
          `${value > 0 ? '' : ' disabled'} aria-label="−1 ${label}">−</button>` +
        `<span class="n">${value}${total ? `<span class="tot">/${total}</span>` : ''}</span>` +
        `<span class="lbl">${label}</span>` +
        `<button class="adj" data-side="${side}" data-kind="${kind}" data-delta="1" aria-label="+1 ${label}">+</button>` +
      '</div>'
    // Sin sets que cerrar la fila de sets no dice nada; si quedó un set ganado de
    // antes, se queda para poder corregirlo.
    const showSets = !endless() || state[side].s > 0 || state[other(side)].s > 0
    $('meta' + S).innerHTML =
      (showSets ? row('s', 'row-sets', state[side].s, 'sets', endless() ? 0 : config.sets) : '') +
      row('g', 'row-games', state[side].g, 'games', 0)
    const pointBtn = delta =>
      `<button class="adj adj-points" data-side="${side}" data-kind="p" data-delta="${delta}"` +
        `${canAdjustPoint(side, delta) ? '' : ' disabled'}` +
        ` aria-label="${delta > 0 ? '+1' : '−1'} ${t('point')}">${delta > 0 ? '+' : '−'}</button>`
    $('pointsAdj' + S).innerHTML = pointBtn(-1) + pointBtn(1)
    $('serve' + S).textContent = state.server === side ? '● ' + t('serve') + ' ' + player : ''
  }
  $('serveCourt').innerHTML = courtSvg(state.server, courtSide)
  renderOptions()
  renderLink()
  saveLive()
}

function renderOptions () {
  for (const b of document.querySelectorAll('#scoringGroup .seg-btn')) b.classList.toggle('on', b.dataset.scoring === config.scoring)
  for (const b of document.querySelectorAll('#setsGroup .seg-btn')) b.classList.toggle('on', Number(b.dataset.sets) === config.sets)
  $('scoringDesc').innerHTML = t('desc_' + config.scoring)
  $('setsDesc').innerHTML = t('desc_sets' + config.sets)
}

function renderLink () {
  const l = state.link
  $('linkedBar').hidden = !l
  $('btnNew').textContent = l ? t('saveResult') : t('newMatch')
  for (const b of document.querySelectorAll('.edit-name')) b.hidden = !!l
  if (l) {
    $('linkedLabel').textContent = t('linkedLabel', { name: l.tournamentName, round: l.round, court: l.court }) +
      ' · ' + (l.target ? t('toGames', { n: l.target }) : t('freeGames'))
  }
  $('nameLeft').placeholder = t('teamA')
  $('nameRight').placeholder = t('teamB')
}

// Mini cancha landscape (vista superior): red vertical en el centro, mitad izquierda =
// pareja izquierda. El que saca está en SU mitad y sirve cruzado a la caja del rival.
// R/L = derecha/izquierda del servidor mirando a la red.
function courtSvg (side, courtSide) {
  const left = side === 'left'
  // left mira a la derecha: R = abajo, L = arriba. right mira a la izquierda: R = arriba, L = abajo.
  const srvTop = left ? courtSide === 'L' : courtSide === 'R'
  const srvLeft = left
  const recLeft = !srvLeft
  const recTop = !srvTop
  const boxX = l => (l ? 28 : 50)
  const centerX = l => (l ? 39 : 61)
  const centerY = top => (top ? 18 : 46)
  const line = 'stroke="rgba(255,255,255,.85)" fill="none"'
  const ax = centerX(srvLeft)
  const ay = centerY(srvTop)
  const ex = centerX(recLeft)
  const ey = centerY(recTop)
  const markerId = 'arrow-' + side
  return `<svg viewBox="0 0 100 64" aria-hidden="true">
    <defs><marker id="${markerId}" markerWidth="6" markerHeight="6" refX="4" refY="3"
      orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#fde047"/></marker></defs>
    <rect x="4" y="4" width="92" height="56" ${line} stroke-width="2"/>
    <line x1="50" y1="0" x2="50" y2="64" ${line} stroke-width="2.6"/>
    <line x1="28" y1="4" x2="28" y2="60" ${line} stroke-width="1"/>
    <line x1="72" y1="4" x2="72" y2="60" ${line} stroke-width="1"/>
    <line x1="28" y1="32" x2="72" y2="32" ${line} stroke-width="1"/>
    <rect x="${boxX(recLeft)}" y="${recTop ? 4 : 32}" width="22" height="28" fill="rgba(255,255,255,.18)" stroke="none"/>
    <rect x="${boxX(srvLeft)}" y="${srvTop ? 4 : 32}" width="22" height="28" fill="rgba(253,224,71,.55)" stroke="none"/>
    <line x1="${ax}" y1="${ay}" x2="${ex}" y2="${ey}" stroke="#fde047"
      stroke-width="2.4" marker-end="url(#${markerId})"/>
    <circle cx="${ax}" cy="${ay}" r="2.8" fill="#fff"/>
  </svg>`
}

function popTap (side) {
  const el = $('pop' + cap(side))
  el.classList.remove('anim')
  void el.offsetWidth
  el.classList.add('anim')
}

// ---------- partido ----------

function undo () {
  const prev = state.undo.pop()
  if (!prev) return
  apply(prev)
  render()
}

function switchServer () {
  pushUndo()
  flipServer()
  render()
}

function currentSets () {
  const sets = state.setsHistory.map(s => ({ ...s }))
  if (state.left.g > 0 || state.right.g > 0 || state.left.p > 0 || state.right.p > 0) {
    sets.push({ left: state.left.g, right: state.right.g })
  }
  return sets
}

export function hasProgress () {
  return state.left.s > 0 || state.right.s > 0 ||
    state.left.g > 0 || state.right.g > 0 ||
    state.left.p > 0 || state.right.p > 0 ||
    state.setsHistory.length > 0
}

function resetMatch () {
  state.left = { p: 0, g: 0, s: 0 }
  state.right = { p: 0, g: 0, s: 0 }
  state.server = 'left'
  state.gameNum = 0
  state.tiebreak = false
  state.setsHistory = []
  state.undo = []
  render()
}

async function newMatch () {
  if (state.link) return saveLinked()
  if (hasProgress()) {
    const yes = await ask({ title: t('newMatchTitle'), text: t('confirmNew'), ok: t('newMatchOk') })
    if (!yes) return
    const sets = currentSets()
    let setsLeft = 0
    let setsRight = 0
    for (const s of sets) {
      if (s.left > s.right) setsLeft++
      else if (s.right > s.left) setsRight++
    }
    const id = crypto.randomUUID()
    try {
      await putDoc(RESULTS_THREAD, id, {
        id,
        date: Date.now(),
        left: $('nameLeft').value || t('teamA'),
        right: $('nameRight').value || t('teamB'),
        sets,
        setsLeft,
        setsRight
      })
    } catch (e) {
      // Sin guardar no se reinicia: el marcador sigue ahí para no perder el partido.
      console.error('[padel] could not save result:', e)
      toast(t('resultSaveFailed', { reason: e.message }), 'error')
      return
    }
  }
  resetMatch()
}

// ---------- partido del torneo ----------

export const linkedMatchId = () => (state.link ? state.link.matchId : null)

export async function playLinked (link) {
  if (state.link && state.link.matchId === link.matchId) return true
  if (hasProgress() || state.link) {
    const yes = await ask({ title: t('replaceMatchTitle'), text: t('replaceMatchText'), ok: t('replace'), danger: true })
    if (!yes) return false
  }
  state.link = link
  $('nameLeft').value = link.left
  $('nameRight').value = link.right
  resetMatch()
  return true
}

function checkLinkedTarget () {
  const l = state.link
  if (l && l.target && (state.left.g >= l.target || state.right.g >= l.target)) saveLinked()
}

async function saveLinked () {
  const l = state.link
  const yes = await ask({
    title: t('saveResultTitle'),
    text: `${l.left}  ${state.left.g} – ${state.right.g}  ${l.right}`,
    ok: t('save'),
    cancel: t('keepPlaying')
  })
  if (!yes) return
  if (!hooks.saveLinked({ link: l, left: state.left.g, right: state.right.g })) return
  // Primero se suelta el partido y después se avisa: si se avisara antes, la lista de
  // partidos se pintaría con este todavía «en el marcador».
  unlink()
  hooks.linkedSaved()
}

function unlink () {
  state.link = null
  $('nameLeft').value = ''
  $('nameRight').value = ''
  resetMatch()
}

async function leaveLinked () {
  const yes = await ask({ title: t('leaveLinkedTitle'), text: t('leaveLinkedText'), ok: t('leave'), danger: true })
  if (yes) unlink()
}

// ---------- resultados guardados ----------

const isOpen = id => $(id).classList.contains('open')

function formatDate (ts) {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function openResults () {
  $('modalResults').classList.add('open')
  await paintResults()
}

async function paintResults () {
  const list = $('resultsList')
  list.innerHTML = `<div class="empty">${escapeHtml(t('loading'))}</div>`
  let results
  try {
    results = await listDocs(RESULTS_THREAD)
  } catch (e) {
    console.error('[padel] could not read results:', e)
    list.innerHTML = `<div class="empty">${escapeHtml(t('resultsLoadFailed', { reason: e.message }))}</div>`
    return
  }
  if (!results.length) {
    list.innerHTML = `<div class="empty">${escapeHtml(t('noResults'))}</div>`
    return
  }
  results.sort((x, y) => y.date - x.date)
  list.innerHTML = results.map(r => {
    const leftWins = r.setsLeft > r.setsRight
    const rightWins = r.setsRight > r.setsLeft
    const setsTxt = r.sets.map(s => `${s.left}-${s.right}`).join('  ')
    return `<div class="result" data-id="${r.id}">
      <div class="result-info">
        <div class="result-date">${formatDate(r.date)}</div>
        <div class="result-score">
          <span class="${leftWins ? 'winner' : ''}">${leftWins ? '🏆 ' : ''}${escapeHtml(r.left)} ${r.setsLeft}</span>
          —
          <span class="${rightWins ? 'winner' : ''}">${r.setsRight} ${escapeHtml(r.right)}${rightWins ? ' 🏆' : ''}</span>
        </div>
        <div class="result-sets">${setsTxt}</div>
      </div>
      <button class="btn-danger" data-delete="${r.id}">${escapeHtml(t('delete'))}</button>
    </div>`
  }).join('')
}

async function deleteResult (id) {
  try {
    await removeDoc(RESULTS_THREAD, id)
  } catch (e) {
    console.error('[padel] could not delete result:', e)
    toast(t('resultDeleteFailed', { reason: e.message }), 'error')
    return
  }
  await paintResults()
}

// ---------- arranque ----------

export function applyLang () {
  render()
  if (isOpen('modalResults')) paintResults()
}

export function initScoreboard (h) {
  hooks = h
  loadConfig()
  loadLive()

  const tapPanel = side => e => {
    if (e.target.closest('.name-wrap') || e.target.closest('.adj')) return
    winPoint(side)
  }
  $('teamLeft').addEventListener('click', tapPanel('left'))
  $('teamRight').addEventListener('click', tapPanel('right'))

  // Botones +/− de punto, sets y games (delegado: se recrean en cada render).
  document.querySelector('.board').addEventListener('click', e => {
    const b = e.target.closest('.adj')
    if (!b) return
    const delta = Number(b.dataset.delta)
    if (b.dataset.kind === 'p') adjustPoint(b.dataset.side, delta)
    else adjust(b.dataset.side, b.dataset.kind, delta)
  })

  const editName = input => {
    if (state.link || !input.readOnly) return
    input.readOnly = false
    input.focus()
    input.select()
  }
  for (const b of document.querySelectorAll('.edit-name')) {
    b.addEventListener('click', e => { e.stopPropagation(); editName($(b.dataset.target)) })
  }
  for (const input of document.querySelectorAll('.board .name')) {
    input.addEventListener('click', e => { e.stopPropagation(); editName(input) })
    input.addEventListener('blur', () => { input.readOnly = true; saveLive() })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur() } })
  }

  $('btnServe').addEventListener('click', switchServer)
  $('btnUndo').addEventListener('click', undo)
  $('btnNew').addEventListener('click', newMatch)
  $('btnLeaveLinked').addEventListener('click', leaveLinked)

  $('btnResults').addEventListener('click', openResults)
  $('btnCloseResults').addEventListener('click', () => $('modalResults').classList.remove('open'))
  $('modalResults').addEventListener('click', e => { if (e.target === $('modalResults')) $('modalResults').classList.remove('open') })
  $('resultsList').addEventListener('click', e => {
    const b = e.target.closest('[data-delete]')
    if (b) deleteResult(b.dataset.delete)
  })

  $('btnOptions').addEventListener('click', () => $('modalOptions').classList.add('open'))
  $('btnCloseOptions').addEventListener('click', () => $('modalOptions').classList.remove('open'))
  $('modalOptions').addEventListener('click', e => { if (e.target === $('modalOptions')) $('modalOptions').classList.remove('open') })

  // Se aplican al instante, sin tocar el marcador.
  for (const b of document.querySelectorAll('#setsGroup .seg-btn')) {
    b.addEventListener('click', () => {
      config.sets = Number(b.dataset.sets)
      // Sin fin no hay tie-break; al volver a 3/5 un 6-6 en curso sí lo es.
      state.tiebreak = !endless() && state.left.g === 6 && state.right.g === 6
      saveConfig()
      render()
    })
  }
  for (const b of document.querySelectorAll('#scoringGroup .seg-btn')) {
    b.addEventListener('click', () => {
      config.scoring = b.dataset.scoring
      saveConfig()
      render()
    })
  }

  render()
}
