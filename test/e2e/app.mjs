// Arranque común de los E2E: abre la app servida desde el build (`dist/`) bajo
// https://padel.dotrino.com, así el store y la identidad (iframes de *.dotrino.com)
// contestan como en producción. Necesita red.
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ORIGIN = 'https://padel.dotrino.com'
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json'
}

// clock: el reloj del navegador lo controla el test (`page.clock.fastForward`). Se
// instala antes de cargar, para que la app entera, iframes incluidos, use el mismo.
export async function openApp (browser, { width, height, mobile = false, clock = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', locale: 'es-ES'
  })
  await ctx.route(`${ORIGIN}/**`, async route => {
    let path = new URL(route.request().url()).pathname
    if (!extname(path)) path = '/index.html'
    let body
    try {
      body = await readFile(join(DIST, path))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      return route.fulfill({ status: 404, body: 'not found' })
    }
    return route.fulfill({ status: 200, contentType: TYPES[extname(path)] || 'application/octet-stream', body })
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (clock) await page.clock.install()
  await page.goto(`${ORIGIN}/`)
  return { ctx, page, errors }
}

// Un torneo nuevo, sin empezar, con esos jugadores; la página queda en «Torneo».
export async function newTournament (page, players) {
  await page.click('[data-testid="tab-setup"]')
  await page.click('#setupPage [data-testid="new-tournament"]', { timeout: 30000 })
  for (const name of players) {
    await page.fill('[data-testid="add-player"]', name)
    await page.press('[data-testid="add-player"]', 'Enter')
  }
}
