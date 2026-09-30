// Lo que es del usuario —los resultados y los torneos— vive en @dotrino/store (§4).
// El store guarda hilos de entradas; aquí cada documento es UNA entrada del hilo con
// su propio id. Guardar otra vez con el mismo id la reemplaza en el sitio (el store
// deduplica por id), así que no hay un «borrar y volver a escribir» con una ventana
// en la que el documento no existe.
//
// Sin repliegue a localStorage: si el store no abre, se dice. Guardar en otro sitio
// en silencio haría que los torneos «desaparecieran» al volver la conexión.
import { Store } from '@dotrino/store'
import { getIdentity } from './services/identity.js'

let connecting = null

export function openStore () {
  if (!connecting) {
    // Atado al PERFIL (respaldo en la bóveda, sin mezclar cuentas). Hasta 2026-09-30 conectaba
    // sin identidad y todo quedaba en el espacio común del navegador; `adoptCommon` lo trae al
    // perfil una vez, sin borrar el original.
    connecting = getIdentity().then(identity => {
      if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' })
      return Store.connect({ identity, adoptCommon: ['padel.'] })
    }).catch(e => {
      connecting = null // el siguiente intento vuelve a probar
      throw e
    })
  }
  return connecting
}

export async function listDocs (thread) {
  const store = await openStore()
  const entries = await store.listThread(thread)
  return entries.map(e => {
    if (!e.doc) throw new Error(`entry ${e.id} in ${thread} has no document`)
    return e.doc
  })
}

export async function putDoc (thread, id, doc) {
  const store = await openStore()
  await store.appendMessage(thread, { id, ts: Date.now(), doc })
}

export async function removeDoc (thread, id) {
  const store = await openStore()
  await store.removeMessage(thread, id)
}
