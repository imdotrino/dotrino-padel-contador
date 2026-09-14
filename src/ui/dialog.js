// Confirmaciones y avisos propios: nunca alert()/confirm() del navegador (§5).
import { $ } from '../dom.js'
import { t } from '../i18n.js'

let resolver = null
let toastTimer = null

function settle (value) {
  const r = resolver
  resolver = null
  $('modalDialog').classList.remove('open')
  if (r) r(value)
}

export function initDialog () {
  $('dialogOk').addEventListener('click', () => settle(true))
  $('dialogCancel').addEventListener('click', () => settle(false))
  $('modalDialog').addEventListener('click', e => { if (e.target === $('modalDialog')) settle(false) })
  // Cerrarlo con «volver» (botón físico, gesto) quita la clase: cuenta como cancelar.
  new MutationObserver(() => {
    if (resolver && !$('modalDialog').classList.contains('open')) settle(false)
  }).observe($('modalDialog'), { attributes: true, attributeFilter: ['class'] })
}

export function ask ({ title, text = '', ok, cancel = t('cancel'), danger = false }) {
  if (resolver) settle(false)
  $('dialogTitle').textContent = title
  $('dialogText').textContent = text
  $('dialogText').hidden = !text
  $('dialogOk').textContent = ok
  $('dialogOk').classList.toggle('danger', danger)
  $('dialogCancel').textContent = cancel
  $('modalDialog').classList.add('open')
  return new Promise(resolve => { resolver = resolve })
}

export function toast (message, kind = 'info') {
  const el = $('toast')
  el.textContent = message
  el.classList.toggle('error', kind === 'error')
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3000)
}
