// E2E de maquetación: que nada se encime en el marcador (con el marcador más ancho,
// 40–AD) y que las pestañas del torneo usen el ancho en escritorio sin romper el móvil.
//
// Sirve el build (`dist/`) bajo https://padel.dotrino.com: así el store y la identidad
// (iframes de *.dotrino.com) contestan como en producción. Necesita red.
//
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ORIGIN = 'https://padel.dotrino.com'
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json'
}
const PLAYERS = ['Ana', 'Luis', 'Pedro', 'Juan', 'Sofía', 'Carla', 'Diego', 'María', 'Valentina Rodríguez']

const DESKTOP = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768]]
const MOBILE = [[390, 844], [360, 640], [768, 1024], [844, 390]]

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser?.close() })

async function openApp ({ width, height, mobile }) {
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
  await page.goto(`${ORIGIN}/`)
  return { ctx, page, errors }
}

// Un torneo con dos rondas (la primera con resultados) y el marcador en 40–AD.
async function seed (page) {
  await page.click('[data-testid="tab-setup"]')
  await page.click('#setupPage [data-testid="new-tournament"]', { timeout: 30000 })
  await page.fill('[data-testid="tournament-name"]', 'Torneo de los jueves del club de pádel')
  for (const name of PLAYERS) {
    await page.fill('[data-testid="add-player"]', name)
    await page.press('[data-testid="add-player"]', 'Enter')
  }
  await page.click('[data-testid="start-tournament"]')
  const a = await page.locator('#matchesPage [data-testid="score-a"]').all()
  const b = await page.locator('#matchesPage [data-testid="score-b"]').all()
  for (let i = 0; i < a.length; i++) {
    await a[i].fill('6')
    await b[i].fill(String(i + 2))
  }
  await page.click('[data-testid="next-round"]')

  await page.click('[data-testid="options-btn"]')
  await page.click('#scoringGroup [data-scoring="advantage"]')
  await page.click('#btnCloseOptions')
  await page.click('[data-testid="tab-score"]')
  for (let i = 0; i < 3; i++) await page.click('#pointsLeft')
  for (let i = 0; i < 4; i++) await page.click('#pointsRight')
  assert.equal(await page.textContent('#pointsRight'), 'AD')
}

// Lo que se encima o se sale en el marcador, como lista legible.
const scoreProblems = page => page.evaluate(() => {
  const box = el => {
    const r = el?.getBoundingClientRect()
    return r && r.width && r.height ? r : null
  }
  const cross = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1
  const out = []
  const board = box(document.querySelector('.board'))
  const court = box(document.querySelector('#serveCourt svg'))
  if (!board || !court) return ['scoreboard not visible']
  if (!inside(court, board)) out.push('court outside the board')
  for (const side of ['Left', 'Right']) {
    const team = box(document.getElementById('team' + side))
    const parts = {
      name: box(document.querySelector(`#team${side} .name-wrap`)),
      meta: box(document.getElementById('meta' + side)),
      points: box(document.getElementById('points' + side)),
      adjust: box(document.getElementById('pointsAdj' + side)),
      serve: box(document.getElementById('serve' + side))
    }
    const names = Object.keys(parts).filter(k => parts[k])
    for (const k of names) {
      if (!inside(parts[k], team)) out.push(`${k}${side} outside its panel`)
      if (cross(parts[k], court)) out.push(`${k}${side} under the court`)
    }
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        if (cross(parts[names[i]], parts[names[j]])) out.push(`${names[i]}${side} over ${names[j]}${side}`)
      }
    }
  }
  return out
})

const tournamentLayout = page => page.evaluate(() => {
  const r = el => el.getBoundingClientRect()
  const view = document.querySelector('.view:not([hidden])')
  return {
    overflowX: view.scrollWidth > view.clientWidth + 1,
    matchTops: [...document.querySelectorAll('#matchesPage .round:first-child .match')].map(m => Math.round(r(m).top)),
    roster: document.querySelector('#setupPage .field-roster') && r(document.querySelector('#setupPage .field-roster')).toJSON(),
    name: document.getElementById('tourName') && r(document.getElementById('tourName')).toJSON()
  }
})

async function checkTabs (t, page, wide) {
  for (const tab of ['matches', 'table', 'setup']) {
    await page.click(`[data-testid="tab-${tab}"]`)
    const l = await tournamentLayout(page)
    assert.equal(l.overflowX, false, `${tab}: horizontal overflow`)
    if (tab === 'matches' && wide) assert.equal(new Set(l.matchTops).size, 1, `matches of a round should share a row: ${l.matchTops}`)
    if (tab === 'matches' && !wide) assert.equal(new Set(l.matchTops).size, l.matchTops.length, `matches should stack on mobile: ${l.matchTops}`)
    if (tab === 'setup') assert.ok(l.roster && l.name, 'setup: players field or tournament name missing')
    if (tab === 'setup' && wide) assert.ok(l.roster.left >= l.name.right, 'players should sit beside the settings')
    if (tab === 'setup' && !wide) assert.ok(l.roster.top >= l.name.bottom, 'players should go below the settings on mobile')
  }
}

// Cada tamaño empieza en el marcador: si el anterior falló a mitad, no arrastra su pestaña.
async function checkSize (t, page, [width, height]) {
  await page.setViewportSize({ width, height })
  await page.click('[data-testid="tab-score"]')
  assert.deepEqual(await scoreProblems(page), [])
  await checkTabs(t, page, width >= 900)
}

test('escritorio: el marcador no se encima y el torneo usa el ancho', async t => {
  const { ctx, page, errors } = await openApp({ width: 1440, height: 900, mobile: false })
  try {
    await seed(page)
    for (const size of DESKTOP) await t.test(size.join('×'), () => checkSize(t, page, size))
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})

test('móvil: el marcador no se encima y el torneo va en una columna', async t => {
  const { ctx, page, errors } = await openApp({ width: 390, height: 844, mobile: true })
  try {
    await seed(page)
    for (const size of MOBILE) await t.test(size.join('×'), () => checkSize(t, page, size))
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})
