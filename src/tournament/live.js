// VER EL TORNEO EN VIVO, en solo lectura, por la red de Dotrino.
//
// Es la «emisión» de @dotrino/lobby: el organizador emite el torneo y quien abre el enlace
// (`#watch=…`) lo mira. Lo que viaja va sellado a cada uno y firmado por el organizador,
// y entra solo quien tiene el enlace (lleva un secreto). La clave y el secreto se guardan
// en el torneo (`tour.share`), así el enlace sigue sirviendo aunque el organizador recargue.
//
// Nada se guarda en la red: si el organizador cierra la app, quien mira conserva lo último
// que le llegó y vuelve a recibir cuando la abre otra vez.
import { createLobby, encodeBroadcastRef, decodeBroadcastRef } from '@dotrino/lobby'
import { getIdentity } from '../services/identity.js'

const GAME_ID = 'padel'
const PUBLISH_DELAY = 800 // escribir un resultado dígito a dígito: una sola publicación
const WATCH_PREFIX = '#watch='

let lobbyPromise = null

// Sin identidad no hay con qué sellar ni firmar: se para y se dice.
function lobby () {
  if (!lobbyPromise) {
    lobbyPromise = (async () => {
      const identity = await getIdentity()
      if (!identity) throw Object.assign(new Error('the vault did not load: nothing can be sealed'), { code: 'no-identity' })
      return createLobby({ gameId: GAME_ID, identity })
    })().catch(e => {
      lobbyPromise = null // el siguiente intento vuelve a probar
      throw e
    })
  }
  return lobbyPromise
}

// ---------- el organizador ----------

const hosts = new Map() // tournament.id → { broadcast, timer, tour }
const opening = new Map() // tournament.id → promesa de la emisión que se está abriendo
const hostListeners = new Set()
let onError = e => console.error('[padel] live publish failed:', e)

export function onHostChange (fn) { hostListeners.add(fn); return () => hostListeners.delete(fn) }
export function onPublishError (fn) { onError = fn }
const emitHost = () => { for (const fn of hostListeners) fn() }

export const isSharing = tour => Boolean(tour && tour.share)
export const viewersOf = tour => (hosts.get(tour.id)?.broadcast.viewers ?? 0)

// Lo que ven los demás: el torneo tal cual, sin la clave del enlace.
function snapshot (tour) {
  const { share, ...rest } = tour
  return structuredClone(rest)
}

const linkOf = broadcast => `${location.origin}${location.pathname}${WATCH_PREFIX}${encodeBroadcastRef(broadcast.ref)}`

async function hostFor (tour) {
  const ya = hosts.get(tour.id)
  if (ya) return ya
  if (!opening.has(tour.id)) {
    opening.set(tour.id, (async () => {
      const l = await lobby()
      const broadcast = await l.openBroadcast(tour.share ? { ref: tour.share } : {})
      const entry = { broadcast, timer: null, tour }
      broadcast.on('viewers', emitHost)
      broadcast.on('status', emitHost)
      hosts.set(tour.id, entry)
      return entry
    })().finally(() => opening.delete(tour.id)))
  }
  return opening.get(tour.id)
}

/**
 * Empieza a compartir, o retoma lo que ya se compartía (mismo enlace). Si el torneo no
 * tenía enlace, deja la clave en `tour.share`: quien llama tiene que guardarlo.
 * @returns {Promise<string>} el enlace para mirar
 */
export async function share (tour) {
  const entry = await hostFor(tour)
  if (!tour.share) tour.share = { key: entry.broadcast.ref.key, secret: entry.broadcast.ref.secret }
  entry.tour = tour
  await entry.broadcast.publish(snapshot(tour))
  emitHost()
  return linkOf(entry.broadcast)
}

/** Un cambio del torneo: si se comparte, sale en un momento (se agrupan los seguidos). */
export function publishSoon (tour) {
  const entry = hosts.get(tour.id)
  if (!entry) return
  entry.tour = tour
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.broadcast.publish(snapshot(entry.tour)).catch(e => onError(e))
  }, PUBLISH_DELAY)
}

/**
 * Dejar de compartir. El enlace deja de servir: si se vuelve a compartir, la clave es
 * otra. Quien lo tenga abierto se queda con lo último que le llegó.
 */
export async function stop (tour) {
  const entry = hosts.get(tour.id)
  hosts.delete(tour.id)
  tour.share = null
  if (entry) {
    clearTimeout(entry.timer)
    await entry.broadcast.close()
  }
  emitHost()
}

// ---------- quien mira ----------

/**
 * La referencia del enlace (`#watch=…`), o null si la dirección no es un enlace para mirar.
 * Lanza con `code: 'bad-ref'` si lo es pero está incompleto.
 */
export function watchRefFromHash (hash = location.hash) {
  if (!hash.startsWith(WATCH_PREFIX)) return null
  return decodeBroadcastRef(decodeURIComponent(hash.slice(WATCH_PREFIX.length)))
}

/** Mirar un torneo ajeno. Devuelve la emisión (eventos 'state' y 'status'). */
export async function watch (ref) {
  const l = await lobby()
  return l.watchBroadcast(ref)
}
