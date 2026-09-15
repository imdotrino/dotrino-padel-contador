// El aviso de fin de tiempo: pitidos (Web Audio, sin archivos) y vibración. Y la
// pantalla encendida mientras corre un cronómetro: con la pantalla apagada el navegador
// congela la página y el aviso no sonaría.
import { t } from '../i18n.js'
import { toast } from './dialog.js'

let audio = null

// El navegador solo deja sonar audio que arrancó un gesto: se prepara al pulsar
// «Empezar» o «Seguir». Si la app se abre con un cronómetro ya en marcha no hubo gesto,
// y al acabarse solo vibra y avisa en pantalla.
export function prepareAlarm () {
  if (!audio) audio = new AudioContext()
  if (audio.state === 'suspended') audio.resume()
}

export function ring () {
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 900])
  if (!audio) return
  const start = audio.currentTime
  for (let i = 0; i < 3; i++) {
    const at = start + i * 0.6
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
    osc.connect(gain).connect(audio.destination)
    osc.start(at)
    osc.stop(at + 0.5)
  }
}

let lock = null
let wanted = false
let requesting = false
let warned = false

// Se llama en cada tic con «¿hay algún cronómetro corriendo?»: solo actúa al cambiar.
export function keepAwake (on) {
  if (on === wanted) return
  wanted = on
  sync()
}

async function sync () {
  if (wanted && !lock && !requesting && document.visibilityState === 'visible') {
    if (!('wakeLock' in navigator)) return warn(new Error('Screen Wake Lock API not available'))
    requesting = true
    try {
      lock = await navigator.wakeLock.request('screen')
      lock.addEventListener('release', () => { lock = null })
    } catch (e) {
      warn(e)
    } finally {
      requesting = false
    }
    if (!wanted) sync() // se paró mientras se pedía
  } else if (!wanted && lock) {
    const l = lock
    lock = null
    await l.release()
  }
}

// Una vez por sesión: sin la pantalla encendida el aviso puede no sonar, y eso se dice.
function warn (e) {
  console.error('[padel] wake lock:', e)
  if (warned) return
  warned = true
  toast(t('wakeLockFailed'), 'error')
}

// El sistema suelta el bloqueo al ocultar la pestaña: se vuelve a pedir al volver.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync()
})
