// Puente al registro de reputación (@dotrino/reputation) para el topbar (§6.1).
import { createVaultReputation } from '@dotrino/reputation'
import { getIdentity } from './identity.js'

let reputation = null

export async function getReputation () {
  if (reputation) return reputation
  const id = await getIdentity()
  if (!id) return null
  reputation = createVaultReputation(id)
  return reputation
}
