// Los textos de las versiones NATIVAS salen de los de la PWA (src/i18n.js), que va delante
// (CONVENCIONES §16.1): una sola fuente, y ninguna traducción copiada a mano en dos sitios.
// Escribe el mismo i18n.json para Android (assets) y para iOS (recurso del bundle). Lo que en
// la web es HTML (<b>…</b>) se quita: en nativo es texto.
//
//   node scripts/native-i18n.mjs
import { writeFileSync } from 'node:fs'
import { DICT } from '../src/i18n.js'

export const TARGETS = ['../android/app/src/main/assets/i18n.json', '../ios/Padel/i18n.json']

export function build () {
  const plain = s => s.replace(/<\/?[a-z]+>/g, '')
  const out = {}
  for (const [lang, dict] of Object.entries(DICT)) {
    out[lang] = Object.fromEntries(Object.entries(dict).map(([k, v]) => [k, plain(v)]))
  }
  return JSON.stringify(out, null, 1) + '\n'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = build()
  for (const t of TARGETS) writeFileSync(new URL(t, import.meta.url), text)
  console.log(`i18n.json → ${TARGETS.join(', ')}`)
}
