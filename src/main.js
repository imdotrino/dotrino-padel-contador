import './style.css'
// Barra superior estándar (§5): marca + volver + idioma + perfil + moneda. Va antes de
// leer el idioma: al registrarse lo resuelve y lo deja en <html lang>.
import '@dotrino/topbar'
// Botón «Instalar» PWA unificado (§3): importar registra <dotrino-install>.
import '@dotrino/install'
import { createBackNav, getBackNav } from '@dotrino/nav'
import { $ } from './dom.js'
import { initLang, getLang, setLang, t, applyStatic } from './i18n.js'
import { initDialog, toast } from './ui/dialog.js'
import * as scoreboard from './scoreboard.js'
import * as tournament from './tournament/view.js'
import * as repo from './tournament/repo.js'
import { getIdentity } from './services/identity.js'
import { getReputation } from './services/reputation.js'

initLang()

// Un fallo que nadie ve se convierte en un «no funciona» sin pista: se enseña.
window.addEventListener('error', e => toast(t('unexpectedError', { reason: e.message }), 'error'))
window.addEventListener('unhandledrejection', e =>
  toast(t('unexpectedError', { reason: e.reason?.message || String(e.reason) }), 'error'))

const topbar = document.querySelector('dotrino-topbar')
const install = topbar.querySelector('dotrino-install')

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
  try { sessionStorage.setItem(TAB_KEY, name) } catch { /* modo privado */ }
  if (name === 'score') {
    scoreboard.render()
    if (tabLayer) {
      const h = tabLayer
      tabLayer = null
      h.close()
    }
  } else {
    tournament.renderAll()
    if (!tabLayer) {
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
  linkedSaved: () => setTab('matches')
})
tournament.initTournamentViews({
  goTab: setTab,
  linkedMatchId: scoreboard.linkedMatchId,
  playMatch: async link => { if (await scoreboard.playLinked(link)) setTab('score') }
})
setTab(readTab())

repo.onSaveError(e => toast(t('saveFailed', { reason: e.message }), 'error'))
repo.load().then(() => { if (currentTab !== 'score') tournament.renderAll() })
// Lo que quedó sin escribir se escribe antes de que el navegador congele la página.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') repo.flush() })
window.addEventListener('pagehide', () => repo.flush())

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
