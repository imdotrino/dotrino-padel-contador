// E2E de «compartir en vivo»: el organizador comparte el torneo y otra persona, con el
// enlace, lo mira en solo lectura y ve llegar los resultados. Va por la red de Dotrino de
// verdad —el proxio y la bóveda de producción—, con dos navegadores y dos identidades.
//
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openApp, newTournament } from './app.mjs'

let browser
before(async () => { browser = await chromium.launch() })
after(async () => { await browser?.close() })

const NET = { timeout: 60000 } // proxio y bóveda de verdad: los tiempos son de red

test('compartir en vivo: con el enlace se mira en solo lectura, llegan los resultados y dejar de compartir lo corta', async () => {
  const org = await openApp(browser, { width: 1280, height: 800 })
  const fan = await openApp(browser, { width: 390, height: 844, mobile: true })
  try {
    await newTournament(org.page, ['Ana', 'Luis', 'Pedro', 'Juan'])
    await org.page.click('[data-testid="start-tournament"]')
    await org.page.waitForSelector('#view-matches:not([hidden])')
    const name = (await org.page.textContent('#matchesPage .t-name')).trim()

    // Antes de compartir, «Dejar de compartir» está y no se puede usar.
    assert.equal(await org.page.isDisabled('[data-testid="live-stop"]'), true)
    await org.page.click('[data-testid="live-share"]')
    const link = await (await org.page.waitForFunction(() => document.getElementById('shareModal').url, null, NET)).jsonValue()
    assert.match(link, /^https:\/\/padel\.dotrino\.com\/#watch=[\w-]+\.[\w-]+\.[\w-]+\.[\w-]+$/)
    await org.page.evaluate(() => { document.getElementById('shareModal').open = false })
    await org.page.waitForSelector('[data-testid="live-bar"].on')
    assert.equal(await org.page.isEnabled('[data-testid="live-stop"]'), true)

    // Quien tiene el enlace: el torneo, en solo lectura.
    await fan.page.goto(link)
    await fan.page.reload()
    // El aviso está en las tres páginas del torneo: se mira el de la que está a la vista.
    await fan.page.waitForSelector('#matchesPage [data-testid="watch-status"][data-status="live"]', NET)
    assert.equal((await fan.page.textContent('#matchesPage .t-name')).trim(), name)
    assert.equal(await fan.page.isDisabled('[data-testid="tab-score"]'), true, 'the scoreboard is not theirs')
    assert.equal(await fan.page.isDisabled('[data-testid="tab-setup"]'), true, 'nor the settings')
    const fanScore = '#matchesPage [data-testid="match"] >> nth=0 >> [data-testid="score-a"]'
    assert.equal(await fan.page.isDisabled(fanScore), true, 'results are read-only')
    await org.page.waitForSelector('[data-testid="live-state"]:has-text("1")', NET)

    // El organizador anota un resultado y le llega a quien mira.
    await org.page.fill('#matchesPage [data-testid="match"] >> nth=0 >> [data-testid="score-a"]', '6')
    await org.page.fill('#matchesPage [data-testid="match"] >> nth=0 >> [data-testid="score-b"]', '3')
    await fan.page.waitForFunction(() => {
      const inputs = document.querySelectorAll('#matchesPage [data-testid="match"]')[0]?.querySelectorAll('input.score')
      return inputs && inputs[0].value === '6' && inputs[1].value === '3'
    }, null, NET)
    await fan.page.click('[data-testid="tab-table"]')
    await fan.page.waitForSelector('#tablePage [data-testid="standings"] tbody tr')

    // Dejar de compartir: quien mira se queda con lo último que le llegó.
    await org.page.click('[data-testid="live-stop"]')
    await org.page.click('[data-testid="dialog-ok"]')
    await fan.page.waitForSelector('#tablePage [data-testid="watch-status"][data-status="host-offline"]', NET)
    assert.equal(await org.page.isDisabled('[data-testid="live-stop"]'), true)
    await fan.page.click('[data-testid="tab-matches"]')
    assert.equal(await fan.page.inputValue(fanScore), '6')

    assert.deepEqual(org.errors, [], 'the organizer page threw')
    assert.deepEqual(fan.errors, [], 'the viewer page threw')
  } finally {
    await org.ctx.close()
    await fan.ctx.close()
  }
})

test('un enlace incompleto lo dice, y no deja la app a medias', async () => {
  const fan = await openApp(browser, { width: 390, height: 844, mobile: true })
  try {
    await fan.page.goto('https://padel.dotrino.com/#watch=solo-una-parte')
    await fan.page.reload()
    await fan.page.waitForSelector('#matchesPage [data-testid="watch-status"][data-status="bad-link"]')
    assert.equal(await fan.page.isDisabled('[data-testid="tab-score"]'), true)
    await fan.page.click('[data-testid="watch-leave"]')
    await fan.page.waitForSelector('#view-score:not([hidden])')
    assert.equal(new URL(fan.page.url()).hash, '')
    assert.deepEqual(fan.errors, [])
  } finally {
    await fan.ctx.close()
  }
})
