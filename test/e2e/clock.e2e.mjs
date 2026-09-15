// E2E de los sets de reglas, el cronómetro de la ronda y los puntos combinables. El reloj
// del navegador lo controla Playwright: no se esperan cinco minutos de verdad.
//
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openApp, newTournament } from './app.mjs'

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser?.close() })

test('sets de reglas y por tiempo: al acabarse el cronómetro, el partido del marcador se guarda con lo que marca', async () => {
  const { ctx, page, errors } = await openApp(browser, { width: 1280, height: 800, clock: true })
  try {
    await newTournament(page, ['Ana', 'Luis', 'Pedro', 'Juan'])
    const chosen = page.locator('[data-testid="ruleset"][aria-checked="true"]')
    const option = name => page.locator('[data-testid="ruleset"]', { hasText: name })

    // Por defecto «Americano por tiempo», 20 minutos; el formulario de abajo parte de él.
    assert.equal(await chosen.count(), 1)
    assert.match(await chosen.textContent(), /Americano por tiempo[\s\S]*Por tiempo · 20 minutos/)
    assert.equal(await page.textContent('[data-testid="rule-rulesetName-text"]'), 'Americano por tiempo (copia)')
    assert.equal(await page.isVisible('[data-testid="update-ruleset"]'), false, 'built-in rules are not edited')
    assert.equal(await page.isVisible('[data-testid="matchMinutes-minus"]'), false, 'options stay closed until Edit')

    // Elegir es excluyente, y el formulario toma los valores del elegido.
    await option('Americano a 6 juegos').click()
    assert.equal(await chosen.count(), 1)
    assert.match(await chosen.textContent(), /Americano a 6 juegos/)
    assert.equal(await page.textContent('[data-testid="rule-matchEnd-text"]'), 'Por juegos · a 6 juegos')

    // A partir de «Americano por tiempo», un set nuevo de 10 minutos, que queda elegido…
    await option('Americano por tiempo').click()
    await page.click('[data-testid="edit-matchEnd"]')
    for (let i = 0; i < 2; i++) await page.click('[data-testid="matchMinutes-minus"]')
    await page.click('[data-testid="edit-rulesetName"]')
    await page.fill('[data-testid="ruleset-name"]', 'Rápido')
    await page.click('[data-testid="save-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Rápido")')
    assert.match(await chosen.textContent(), /Por tiempo · 10 minutos/)
    // …que después se edita a 5: se actualiza ese mismo, no aparece otro.
    await page.click('[data-testid="edit-matchEnd"]')
    await page.click('[data-testid="matchMinutes-minus"]')
    await page.click('[data-testid="update-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Por tiempo · 5 minutos")')
    assert.equal(await option('Rápido').count(), 1)
    // Guardarlo como nuevo con el mismo nombre no se deja.
    await page.click('[data-testid="save-ruleset"]')
    assert.match(await page.textContent('#toast'), /Ya hay unas reglas con ese nombre/)
    assert.equal(await option('Rápido').count(), 1)
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

test('puntos combinables: con sets, cada partido anota sets y juegos, la tabla suma lo encendido y las reglas quedan guardadas', async () => {
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
    await page.click('[data-testid="edit-rulesetName"]')
    await page.fill('[data-testid="ruleset-name"]', 'Por sets')
    await page.click('[data-testid="save-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Por sets")')
    await page.click('[data-testid="start-tournament"]')

    await page.fill('#matchesPage [data-testid="sets-a"]', '2')
    await page.fill('#matchesPage [data-testid="sets-b"]', '1')
    await page.fill('#matchesPage [data-testid="score-a"]', '10')
    await page.fill('#matchesPage [data-testid="score-b"]', '12')
    await page.click('[data-testid="tab-table"]')
    assert.equal(await page.textContent('[data-testid="scoring-summary"]'), 'Puntos: 3 por set · 3 por partido ganado')
    // Ganó a por sets aunque hizo menos juegos: 2 × 3 + 3 = 9 para cada uno de a; 1 × 3 = 3 para b.
    assert.deepEqual(await page.locator('.standings .pts').allTextContents(), ['9', '9', '3', '3'])

    // Las reglas quedan en tu almacén para reutilizarlas: siguen ahí al volver a abrir la app.
    await page.waitForTimeout(800) // lo último escrito sale del búfer de guardado
    await page.reload()
    await page.click('[data-testid="tab-setup"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Por sets")', { timeout: 30000 })
    assert.deepEqual(errors, [])
  } finally {
    await ctx.close()
  }
})
