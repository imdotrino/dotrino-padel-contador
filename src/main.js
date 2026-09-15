import './style.css'
// Barra superior estándar (§5): marca + volver + idioma + perfil + moneda. Va antes de
// leer el idioma: al registrarse lo resuelve y lo deja en <html lang>.
import '@dotrino/topbar'
// Botón «Instalar» PWA unificado (§3): importar registra <dotrino-install>.
import '@dotrino/install'
// Modal de compartir del ecosistema (enlace + QR hecho en el aparato): el enlace para mirar.
import '@dotrino/share'
import { createBackNav, getBackNav } from '@dotrino/nav'
import { $ } from './dom.js'
import { initLang, getLang, setLang, t, applyStatic } from './i18n.js'
import { initDialog, toast } from './ui/dialog.js'
import * as scoreboard from './scoreboard.js'
import * as tournament from './tournament/view.js'
import * as repo from './tournament/repo.js'
import * as live from './tournament/live.js'
import { getIdentity } from './services/identity.js'
import { getReputation } from './services/reputation.js'

initLang()

// Un fallo que nadie ve se convierte en un «no funciona» sin pista: se enseña.
window.addEventListener('error', e => toast(t('unexpectedError', { reason: e.message }), 'error'))
window.addEventListener('unhandledrejection', e =>
  toast(t('unexpectedError', { reason: e.reason?.message || String(e.reason) }), 'error'))

const topbar = document.querySelector('dotrino-topbar')
const install = topbar.querySelector('dotrino-install')

// ¿Se abrió un enlace para mirar un torneo ajeno (`#watch=…`)? Entonces la app es solo
// eso: Partidos y Tabla de ese torneo, en solo lectura; Marcador y Torneo, deshabilitados.
let watchRef = null
let watchBad = false
try {
  watchRef = live.watchRefFromHash()
} catch (e) {
  if (e.code !== 'bad-ref') throw e
  watchBad = true
}
const viewer = Boolean(watchRef) || watchBad

// ---------- pestañas ----------

const TABS = ['score', 'matches', 'table', 'setup']
// La pestaña sobrevive a un refresco, pero abrir la app de cero vuelve al marcador (§4).
const TAB_KEY = 'padel.tab'

// El controlador de «volver» ya lo instaló el topbar: se reusa ese.
const nav = getBackNav() || createBackNav()
// El marcador es la portada; las pestañas del torneo son una capa sobre él, así que
// «volver» (botón físico, gesto, chevron) regresa al marcador.
let tabLayer = null
let currentTab = null

function readTab () {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return TABS.includes(v) ? v : 'score'
  } catch {
    return 'score' // sin sessionStorage (modo privado): la pestaña por defecto
  }
}

function setTab (name) {
  if (!TABS.includes(name)) throw new Error(`unknown tab: ${name}`)
  currentTab = name
  for (const tab of TABS) {
    $('tab-' + tab).setAttribute('aria-selected', String(tab === name))
    $('view-' + tab).hidden = tab !== name
  }
  if (!viewer) {
    try { sessionStorage.setItem(TAB_KEY, name) } catch { /* modo privado */ }
  }
  if (name === 'score') {
    scoreboard.render()
    if (tabLayer) {
      const h = tabLayer
      tabLayer = null
      h.close()
    }
  } else {
    tournament.renderAll()
    // Mirando, no hay marcador al que volver: «volver» sale de la app.
    if (!tabLayer && !viewer) {
      tabLayer = nav.open(() => {
        if (!tabLayer) return
        tabLayer = null
        setTab('score')
      })
    }
  }
}

for (const tab of TABS) $('tab-' + tab).addEventListener('click', () => setTab(tab))

// ---------- arranque ----------

initDialog()
applyStatic()
install.setAttribute('lang', getLang())

scoreboard.initScoreboard({
  saveLinked: tournament.saveLinkedResult,
  linkedSaved: () => setTab('matches'),
  linkedClock: tournament.clockForLink
})
const shareModal = $('shareModal')
shareModal.addEventListener('cc-share-close', () => { shareModal.open = false })
function openShare (url, name) {
  shareModal.setAttribute('lang', getLang())
  shareModal.heading = t('liveShareHeading')
  shareModal.text = t('liveShareText', { name })
  shareModal.url = url
  shareModal.open = true
}

tournament.initTournamentViews({
  goTab: setTab,
  linkedMatchId: scoreboard.linkedMatchId,
  playMatch: async link => { if (await scoreboard.playLinked(link)) setTab('score') },
  openShare,
  // Salir de mirar: la misma dirección sin el enlace, y la app normal.
  leaveWatch: () => {
    history.replaceState(null, '', location.pathname)
    location.reload()
  }
})

if (viewer) {
  const watching = { state: null, status: watchBad ? 'bad-link' : 'connecting', reason: null }
  tournament.setWatching(watching)
  for (const tab of ['score', 'setup']) $('tab-' + tab).disabled = true
  setTab('matches')
  if (watchRef) {
    live.watch(watchRef).then(broadcast => {
      watching.state = broadcast.state
      watching.status = broadcast.status
      broadcast.on('state', state => { watching.state = state; tournament.renderAll() })
      broadcast.on('status', ({ status, reason }) => { watching.status = status; watching.reason = reason; tournament.renderAll() })
      tournament.renderAll()
    }).catch(e => {
      console.error('[padel] could not watch the tournament:', e)
      watching.status = 'error'
      watching.reason = e.message
      tournament.renderAll()
    })
  }
} else {
  setTab(readTab())
}

repo.onSaveError(e => toast(t('saveFailed', { reason: e.message }), 'error'))
// Compartir en vivo: cada cambio del torneo compartido sale para los que miran.
repo.onSaved(tour => live.publishSoon(tour))
live.onHostChange(() => tournament.refreshLive())
live.onPublishError(e => toast(t('liveFailed', { reason: e.message }), 'error'))
repo.load().then(() => {
  tournament.resumeLive()
  if (currentTab !== 'score') tournament.renderAll()
})
// Lo que quedó sin escribir se escribe antes de que el navegador congele la página.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') repo.flush() })
window.addEventListener('pagehide', () => repo.flush())

// Un solo reloj para los cronómetros: el de la ronda en Partidos y la cuenta atrás del
// partido en el marcador.
setInterval(() => {
  const now = Date.now()
  tournament.tick(now)
  scoreboard.tick(now)
}, 500)

topbar.addEventListener('dotrino-lang', e => {
  setLang(e.detail.lang)
  applyStatic()
  install.setAttribute('lang', e.detail.lang)
  scoreboard.applyLang()
  tournament.renderAll()
})

// Capa de «volver» por modal (se abren y cierran con la clase `open`).
function bindModal (id) {
  const el = $(id)
  let handle = null
  const sync = () => {
    const open = el.classList.contains('open')
    if (open && !handle) handle = nav.open(() => el.classList.remove('open'))
    else if (!open && handle) {
      const h = handle
      handle = null
      h.close()
    }
  }
  new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] })
  sync()
}
for (const id of ['modalResults', 'modalOptions', 'modalDialog']) bindModal(id)

// Identidad (§6.1), después del primer pintado: el avatar del topbar no debe retrasar
// el marcador.
getIdentity().then(async id => {
  if (!id) return
  topbar.identity = id
  topbar.reputation = await getReputation()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.error('[padel] service worker:', e))
  })
}
