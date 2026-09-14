// Identidad = vault id.dotrino.com (@dotrino/identity), única fuente de identidad del
// ecosistema. Solo se cachea la conexión para no abrir dos iframes. El marcador y el
// torneo funcionan igual sin ella: lo único que se pierde es el avatar del topbar.
import { Identity } from '@dotrino/identity'

let identity = null

export async function getIdentity () {
  if (identity) return identity
  try {
    identity = await Identity.connect()
  } catch (e) {
    console.warn('[padel] vault unreachable:', e?.message || e)
    identity = null
  }
  return identity
}
