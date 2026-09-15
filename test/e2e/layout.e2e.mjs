// E2E de maquetación: que nada se encime en el marcador (con el marcador más ancho,
// 40–AD) y que las pestañas del torneo usen el ancho en escritorio sin romper el móvil.
//
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openApp, newTournament } from './app.mjs'

const PLAYERS = ['Ana', 'Luis', 'Pedro', 'Juan', 'Sofía', 'Carla', 'Diego', 'María', 'Valentina Rodríguez']
const DESKTOP = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768]]
const MOBILE = [[390, 844], [360, 640], [768, 1024], [844, 390]]

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser?.close() })

// Un torneo con dos rondas (la primera con resultados) y el marcador en 40–AD.
async function seed (page) {
  await newTournament(page, PLAYERS)
  // Canchas en «Auto» por defecto: 9 jugadores / 4 = 2, sin tocar nada. En «Fijo» se pueden
  // poner 3, pero la regla va en rojo y dice que se juega en 2.
  const courts = page.locator('[data-testid="rule-courts"]')
  assert.equal(await page.textContent('[data-testid="rule-courts-text"]'), 'Auto · jugadores/4 · 2 canchas')
  await page.click('[data-testid="edit-courts"]')
  assert.equal(await courts.getAttribute('class'), 'rule open')
  assert.equal(await page.isDisabled('[data-testid="courts-plus"]'), true, 'in auto the number is not set by hand')
  await page.click('[data-testid="courtsMode-fixed"]')
  await page.click('[data-testid="courts-plus"]')
  assert.equal(await page.textContent('[data-testid="rule-courts-text"]'), '3 canchas')
  assert.match(await courts.getAttribute('class'), /\bwarn\b/)
  assert.equal(await page.textContent('[data-testid="rule-courts-note"]'), 'Con 9 jugadores solo se llenan 2 canchas: se juega en 2.')
  await page.click('[data-testid="courts-minus"]')
  assert.doesNotMatch(await courts.getAttribute('class'), /\bwarn\b/)
  await page.click('[data-testid="edit-name"]')
  await page.fill('[data-testid="tournament-name"]', 'Torneo de los jueves del club de pádel')
  assert.equal(await page.textContent('[data-testid="rule-name-text"]'), 'Torneo de los jueves del club de pádel')
  await page.click('[data-testid="edit-name"]')
  await page.click('[data-testid="start-tournament"]')
  const a = await page.locator('#matchesPage [data-testid="score-a"]').all()
  const b = await page.locator('#matchesPage [data-testid="score-b"]').all()
  for (let i = 0; i < a.length; i++) {
    await a[i].fill('6')
    await b[i].fill(String(i + 2))
  }
  await page.click('[data-testid="next-round"]')
  // Las rondas en orden, y «Armar ronda» debajo de la última.
  assert.deepEqual(await page.locator('#matchesPage .round h3').allTextContents(), ['Ronda 1', 'Ronda 2'])
  assert.ok(await page.evaluate(() => {
    const last = document.querySelector('#matchesPage .rounds > .round:last-child')
    return !!(last.compareDocumentPosition(document.getElementById('nextBlock')) & Node.DOCUMENT_POSITION_FOLLOWING)
  }), '«Armar ronda» should go below the rounds')

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
    choice: document.querySelector('#setupPage [data-testid="rules-choice"]') && r(document.querySelector('#setupPage [data-testid="rules-choice"]')).toJSON()
  }
})

async function checkTabs (page, wide) {
  for (const tab of ['matches', 'table', 'setup']) {
    await page.click(`[data-testid="tab-${tab}"]`)
    const l = await tournamentLayout(page)
    assert.equal(l.overflowX, false, `${tab}: horizontal overflow`)
    if (tab === 'matches' && wide) assert.equal(new Set(l.matchTops).size, 1, `matches of a round should share a row: ${l.matchTops}`)
    if (tab === 'matches' && !wide) assert.equal(new Set(l.matchTops).size, l.matchTops.length, `matches should stack on mobile: ${l.matchTops}`)
    if (tab === 'setup') assert.ok(l.roster && l.choice, 'setup: players or rules missing')
    if (tab === 'setup' && wide) assert.ok(l.choice.left >= l.roster.right, 'the rules should sit beside the players')
    if (tab === 'setup' && !wide) assert.ok(l.choice.top >= l.roster.bottom, 'the rules should go below the players on mobile')
  }
}

// Cada tamaño empieza en el marcador: si el anterior falló a mitad, no arrastra su pestaña.
async function checkSize (page, [width, height]) {
  await page.setViewportSize({ width, height })
  await page.click('[data-testid="tab-score"]')
  assert.deepEqual(await scoreProblems(page), [])
  await checkTabs(page, width >= 900)
}

test('escritorio: el marcador no se encima y el torneo usa el ancho', async t => {
  const { ctx, page, errors } = await openApp(browser, { width: 1440, height: 900 })
  try {
    await seed(page)
    for (const size of DESKTOP) await t.test(size.join('×'), () => checkSize(page, size))
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})

test('móvil: el marcador no se encima y el torneo va en una columna', async t => {
  const { ctx, page, errors } = await openApp(browser, { width: 390, height: 844, mobile: true })
  try {
    await seed(page)
    for (const size of MOBILE) await t.test(size.join('×'), () => checkSize(page, size))
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})

test('Mis torneos: arriba de todo, el más nuevo primero aunque se juegue en uno viejo, y elegir uno se queda en Torneo', async () => {
  const { ctx, page, errors } = await openApp(browser, { width: 390, height: 844, mobile: true })
  try {
    const make = async name => {
      await newTournament(page, ['Ana', 'Luis', 'Pedro', 'Juan'])
      await page.click('[data-testid="edit-name"]')
      await page.fill('[data-testid="tournament-name"]', name)
      await page.click('[data-testid="edit-name"]')
      await page.click('[data-testid="start-tournament"]')
      await page.waitForSelector('#view-matches:not([hidden])')
    }
    await make('Primero')
    await make('Segundo')
    // Anotar en el viejo lo guarda después del nuevo, pero no lo sube: manda cuándo se creó.
    await page.click('[data-testid="tab-setup"]')
    // Elegirlo no lleva a Partidos: se queda en Torneo, donde se edita.
    await page.locator('[data-testid="open-tournament"]', { hasText: 'Primero' }).click()
    await page.waitForSelector('#setupPage .history-row.current:has-text("Primero")')
    assert.equal(await page.isVisible('#view-setup'), true, 'choosing a tournament stays on the tournament tab')
    assert.equal(await page.textContent('[data-testid="rule-name-text"]'), 'Primero')
    await page.click('[data-testid="tab-matches"]')
    await page.fill('#matchesPage [data-testid="score-a"]', '6')
    await page.click('[data-testid="tab-setup"]')
    assert.deepEqual(await page.locator('#setupPage .history .h-name').allTextContents(), ['Segundo', 'Primero'])
    assert.equal(await page.evaluate(() => document.getElementById('setupPage').firstElementChild.className), 'history')
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})
