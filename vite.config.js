import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import prerender from '@dotrino/prerender/vite'

// base './' → rutas relativas, para servir bajo padel.dotrino.com y bajo el mirror
// dotrino.github.io/dotrino-padel-contador/. Los assets PWA viven en public/.
// <meta name="commit"> con el hash del commit del build (CONVENCIONES-APPS §3).
function commitMeta () {
  let hash = 'dev'
  try { hash = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* sin git */ }
  return {
    name: 'commit-meta',
    transformIndexHtml: (html) =>
      html.replace('</head>', `  <meta name="commit" content="${hash}" />
  </head>`),
  }
}

export default defineConfig({
  plugins: [
    // El HTML llega con contenido para quien lo lee sin ejecutar JavaScript.
    prerender(), commitMeta()],
  base: './',
  server: { port: 3210, host: true },
})
