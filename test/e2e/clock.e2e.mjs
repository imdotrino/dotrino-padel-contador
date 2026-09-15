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
    // Por el nombre EXACTO: «Rápido» también está dentro de «Rápido (copia)».
    const exact = name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    const option = name => page.locator('[data-testid="ruleset"]', { has: page.locator('.ruleset-name', { hasText: exact(name) }) })

    // Una sola regla de fábrica, «Default» (20 minutos): un torneo nuevo arranca con ella, el
    // formulario lleva su nombre sin «(copia)», y no se guarda ni se borra, y se dice por qué.
    const del = name => page.locator('.ruleset-row', { has: option(name) }).locator('[data-testid="delete-ruleset"]')
    assert.equal(await chosen.count(), 1)
    assert.equal(await page.locator('[data-testid="ruleset"]').count(), 1, 'one built-in')
    assert.match(await chosen.textContent(), /Default[\s\S]*Por tiempo · 20 minutos/)
    assert.equal(await page.textContent('[data-testid="rule-rulesetName-text"]'), 'Default')
    assert.equal(await page.isDisabled('[data-testid="update-ruleset"]'), true, 'the built-in is not edited')
    assert.equal(await page.isEnabled('[data-testid="save-ruleset"]'), true)
    assert.equal(await del('Default').isDisabled(), true, 'the built-in is not deleted')
    assert.equal(await page.isVisible('[data-testid="builtin-note"]'), true)
    assert.equal(await page.isVisible('[data-testid="matchMinutes-minus"]'), false, 'options stay closed until Edit')

    // Un set «Rápido» de 10 minutos, que queda elegido…
    await page.click('[data-testid="edit-matchEnd"]')
    for (let i = 0; i < 2; i++) await page.click('[data-testid="matchMinutes-minus"]')
    await page.click('[data-testid="edit-rulesetName"]')
    await page.fill('[data-testid="ruleset-name"]', 'Rápido')
    await page.click('[data-testid="save-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Rápido")')
    assert.match(await chosen.textContent(), /Por tiempo · 10 minutos/)
    // …y otro «Por juegos», a partir de él.
    await page.click('[data-testid="edit-matchEnd"]')
    await page.click('[data-testid="matchEnd-games"]')
    await page.click('[data-testid="edit-rulesetName"]')
    await page.fill('[data-testid="ruleset-name"]', 'Por juegos')
    await page.click('[data-testid="save-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Por juegos · a 6 juegos")')

    // Elegir es excluyente, y el formulario toma los valores del elegido.
    await option('Rápido').click()
    assert.equal(await chosen.count(), 1)
    assert.match(await chosen.textContent(), /Rápido/)
    assert.equal(await page.textContent('[data-testid="rule-matchEnd-text"]'), 'Por tiempo · 10 minutos')
    // Editarlo a 5 y «Guardar»: se actualiza ese mismo, no aparece otro.
    await page.click('[data-testid="edit-matchEnd"]')
    await page.click('[data-testid="matchMinutes-minus"]')
    await page.click('[data-testid="update-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Por tiempo · 5 minutos")')
    assert.equal(await option('Rápido').count(), 1)
    // Guardarlo como nueva sin cambiar el nombre la clona como «Rápido (copia)», que queda
    // elegida; «Rápido» sigue ahí.
    await page.click('[data-testid="save-ruleset"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Rápido (copia)")')
    assert.equal(await option('Rápido').count(), 1)
    assert.equal(await option('Rápido (copia)').count(), 1)
    assert.equal(await page.textContent('[data-testid="rule-rulesetName-text"]'), 'Rápido (copia)')
    // Reglas que chocan: «Por puntaje» con «Con todos» se marcan en rojo y no se guarda.
    await page.click('[data-testid="edit-pairing"]')
    await page.click('[data-testid="pairing-ranked"]')
    await page.click('[data-testid="edit-limit"]')
    await page.click('[data-testid="limitType-everyone"]')
    assert.equal(await page.locator('[data-testid="rule-pairing"].warn').count(), 1)
    assert.equal(await page.locator('[data-testid="rule-limit"].warn').count(), 1)
    assert.equal(await page.isDisabled('[data-testid="update-ruleset"]'), true, 'conflicting rules are not saved')
    assert.equal(await page.isDisabled('[data-testid="save-ruleset"]'), true, 'conflicting rules are not saved as new')
    assert.match(await page.textContent('[data-testid="rules-conflict"]'), /no se combinan/)
    await page.click('[data-testid="limitType-perPlayer"]')
    await page.click('[data-testid="edit-pairing"]')
    await page.click('[data-testid="pairing-random"]')
    assert.equal(await page.locator('[data-testid="rules-conflict"]').count(), 0)
    // Cada set guardado se borra con su ✕ de la lista (deshabilitado si no hay set que
    // borrar): el torneo conserva sus reglas (5 minutos) como propias, que se pueden guardar.
    // Uno que no está elegido se borra, y lo elegido no cambia.
    await del('Por juegos').click()
    await page.click('[data-testid="dialog-ok"]')
    await page.waitForFunction(() => ![...document.querySelectorAll('.ruleset-name')].some(n => n.textContent === 'Por juegos'))
    assert.match(await chosen.textContent(), /Rápido \(copia\)/)
    await del('Rápido (copia)').click()
    await page.click('[data-testid="dialog-ok"]')
    await page.waitForSelector('[data-testid="ruleset"][aria-checked="true"]:has-text("Reglas de este torneo")')
    assert.equal(await option('Rápido (copia)').count(), 0)
    assert.equal(await option('Rápido').count(), 1, 'only the deleted set goes')
    assert.match(await chosen.textContent(), /Por tiempo · 5 minutos/)
    assert.equal(await del('Reglas de este torneo').isDisabled(), true, 'own rules have no set to delete')
    await page.click('[data-testid="update-ruleset"]')
    assert.match(await page.textContent('#toast'), /Reglas de este torneo actualizadas/)
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
