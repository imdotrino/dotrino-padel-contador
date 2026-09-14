// Lo que es del usuario —los resultados y los torneos— vive en @dotrino/store (§4).
// El store guarda hilos de entradas; aquí cada documento es UNA entrada del hilo con
// su propio id. Guardar otra vez con el mismo id la reemplaza en el sitio (el store
// deduplica por id), así que no hay un «borrar y volver a escribir» con una ventana
// en la que el documento no existe.
//
// Sin repliegue a localStorage: si el store no abre, se dice. Guardar en otro sitio
// en silencio haría que los torneos «desaparecieran» al volver la conexión.
import { Store } from '@dotrino/store'

let connecting = null

export function openStore () {
  if (!connecting) {
    connecting = Store.connect().catch(e => {
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
