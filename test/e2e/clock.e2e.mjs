// E2E del cronómetro de la ronda y de los puntos combinables. El reloj del navegador lo
// controla Playwright: no se esperan cinco minutos de verdad.
//
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openApp, newTournament } from './app.mjs'

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser?.close() })

test('por tiempo: al acabarse el cronómetro, el partido del marcador se guarda con lo que marca', async () => {
  const { ctx, page, errors } = await openApp(browser, { width: 1280, height: 800, clock: true })
  try {
    await newTournament(page, ['Ana', 'Luis', 'Pedro', 'Juan'])
    // Por defecto se juega por tiempo, 20 minutos: se lee como texto y se baja a 5.
    assert.equal(await page.textContent('[data-testid="rule-matchEnd-text"]'), 'Por tiempo · 20 minutos')
    assert.equal(await page.isVisible('[data-testid="matchMinutes-minus"]'), false, 'options stay closed until Edit')
    await page.click('[data-testid="edit-matchEnd"]')
    assert.equal(await page.getAttribute('[data-testid="matchEnd-time"]', 'aria-pressed'), 'true')
    for (let i = 0; i < 3; i++) await page.click('[data-testid="matchMinutes-minus"]')
    assert.equal(await page.textContent('[data-testid="rule-matchEnd-text"]'), 'Por tiempo · 5 minutos')
    await page.click('[data-testid="start-tournament"]')

    assert.equal(await page.textContent('[data-testid="clock-time"]'), '5:00')
    await page.click('[data-testid="clock-start"]')
    await page.waitForSelector('.clock.running')
    await page.click('[data-testid="play-match"]')
    // La izquierda gana un juego (punto de oro por defecto) y va 30–0 en el siguiente.
    for (let i = 0; i < 6; i++) await page.click('#pointsLeft')
    assert.match(await page.textContent('#linkedLabel'), /⏱ [45]:\d\d/)

    await page.clock.fastForward('05:01')
    // Se guardó solo, con el marcador que había, y volvió a Partidos.
    await page.waitForSelector('#view-matches:not([hidden])')
    assert.equal(await page.inputValue('#matchesPage [data-testid="score-a"]'), '1')
    assert.equal(await page.inputValue('#matchesPage [data-testid="score-b"]'), '0')
    assert.equal(await page.textContent('[data-testid="clock-time"]'), '¡Tiempo!')
    assert.match(await page.textContent('#toast'), /Se acabó el tiempo/)
    assert.equal(await page.isVisible('#linkedBar'), false)
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})

test('puntos combinables: con sets, cada partido anota sets y juegos, y la tabla suma lo encendido', async () => {
  const { ctx, page, errors } = await openApp(browser, { width: 390, height: 844, mobile: true })
  try {
    await newTournament(page, ['Ana', 'Luis', 'Pedro', 'Juan'])
    // Por defecto: juego y partido encendidos; set apagado. Se lee como texto.
    assert.equal(await page.textContent('[data-testid="rule-scoring-text"]'), '1 por juego · 3 por partido ganado')
    // Una regla abierta a la vez: abrir otra cierra la anterior.
    await page.click('[data-testid="edit-matchEnd"]')
    await page.click('[data-testid="edit-scoring"]')
    assert.equal(await page.isVisible('[data-testid="matchEnd-time"]'), false)
    for (const [kind, on] of [['games', 'true'], ['sets', 'false'], ['match', 'true']]) {
      assert.equal(await page.getAttribute(`[data-testid="scoring-${kind}"]`, 'aria-pressed'), on, kind)
    }
    await page.click('[data-testid="scoring-sets"]')
    await page.click('[data-testid="points-sets-plus"]') // 2 → 3
    await page.click('[data-testid="scoring-games"]') // se apaga
    // Queda la última encendida sin poder apagarse: se apaga «partido» y «sets» se bloquea.
    await page.click('[data-testid="scoring-match"]')
    assert.equal(await page.isDisabled('[data-testid="scoring-sets"]'), true)
    await page.click('[data-testid="scoring-match"]')
    assert.equal(await page.textContent('[data-testid="rule-scoring-text"]'), '3 por set · 3 por partido ganado')
    await page.click('[data-testid="start-tournament"]')

    await page.fill('#matchesPage [data-testid="sets-a"]', '2')
    await page.fill('#matchesPage [data-testid="sets-b"]', '1')
    await page.fill('#matchesPage [data-testid="score-a"]', '10')
    await page.fill('#matchesPage [data-testid="score-b"]', '12')
    await page.click('[data-testid="tab-table"]')
    assert.equal(await page.textContent('[data-testid="scoring-summary"]'), 'Puntos: 3 por set · 3 por partido ganado')
    // Ganó a por sets aunque hizo menos juegos: 2 × 3 + 3 = 9 para cada uno de a; 1 × 3 = 3 para b.
    assert.deepEqual(await page.locator('.standings .pts').allTextContents(), ['9', '9', '3', '3'])
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})
