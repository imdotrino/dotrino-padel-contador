// Los torneos del usuario en el store: un documento por torneo en `padel.tournaments`
// y cuál está abierto en `padel.meta`. En memoria se trabaja sobre los mismos objetos;
// guardar agrupa los cambios seguidos (escribir un marcador dígito a dígito) en una
// sola escritura.
import { listDocs, putDoc, removeDoc } from '../storage.js'

const THREAD = 'padel.tournaments'
const META_THREAD = 'padel.meta'
const SAVE_DELAY = 400

export const state = {
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  error: null,
  list: [],
  activeId: null
}

let onError = e => { throw e }
export function onSaveError (fn) { onError = fn }

export async function load () {
  state.status = 'loading'
  state.error = null
  try {
    const [docs, meta] = await Promise.all([listDocs(THREAD), listDocs(META_THREAD)])
    state.list = docs
    const activeId = meta.length ? meta[meta.length - 1].activeId : null
    state.activeId = docs.some(d => d.id === activeId) ? activeId : null
    state.status = 'ready'
  } catch (e) {
    console.error('[padel] could not load tournaments:', e)
    state.status = 'error'
    state.error = e
  }
}

export const active = () => state.list.find(x => x.id === state.activeId) || null

const pending = new Map()
let timer = null

export function save (tournament) {
  if (state.status !== 'ready') throw new Error(`cannot save a tournament while the store is ${state.status}`)
  tournament.updatedAt = Date.now()
  if (!state.list.includes(tournament)) state.list.push(tournament)
  pending.set(tournament.id, tournament)
  clearTimeout(timer)
  timer = setTimeout(flush, SAVE_DELAY)
}

export async function flush () {
  clearTimeout(timer)
  timer = null
  const batch = [...pending.values()]
  pending.clear()
  for (const doc of batch) {
    try {
      await putDoc(THREAD, doc.id, doc)
    } catch (e) {
      console.error(`[padel] could not save tournament ${doc.id}:`, e)
      pending.set(doc.id, doc) // se reintenta con el próximo guardado
      onError(e)
    }
  }
}

export async function setActive (id) {
  state.activeId = id
  try {
    await putDoc(META_THREAD, 'meta', { activeId: id })
  } catch (e) {
    console.error('[padel] could not save the open tournament:', e)
    onError(e)
  }
}

export async function remove (id) {
  pending.delete(id)
  state.list = state.list.filter(x => x.id !== id)
  if (state.activeId === id) await setActive(null)
  try {
    await removeDoc(THREAD, id)
  } catch (e) {
    console.error(`[padel] could not delete tournament ${id}:`, e)
    onError(e)
  }
}
