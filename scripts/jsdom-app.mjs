/**
 * Arranca la app compilada dentro de jsdom.
 *
 * Dos rarezas necesarias: jsdom no ejecuta <script type="module"> (evaluamos el
 * bundle a mano, neutralizando import.meta) y no trae APIs de red (le prestamos
 * las de Node). Es el sustituto de un navegador de verdad mientras a esta
 * máquina le falten libnspr4/libnss3 para Chromium.
 */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { readCache } from './players.mjs'

export { env, makePlayer, reporter, saveBrowserSession } from './players.mjs'

export async function bootApp({ url = 'http://localhost:4173/', as = 'Rafa', quiet = true, seed = {} } = {}) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!quiet) console.log('  [jsdom]', e.message) })
  vc.on('error', (...a) => console.log('  [app error]', ...a.map(String)))

  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  })
  const { window } = dom
  Object.assign(window, {
    fetch: (...a) => fetch(...a),
    Headers, Request, Response, FormData, Blob,
    WebSocket, AbortController, AbortSignal, structuredClone,
  })

  // Sembrar la sesión guardada antes de arrancar la app, para no gastar registros.
  const cached = readCache()[as]
  if (cached?.session) {
    window.localStorage.setItem('domino.auth', JSON.stringify(cached.session))
  }
  // Cada jsdom trae su propio localStorage, así que lo que la app guardó en otra
  // pestaña —el orden de tu mano, por ejemplo— hay que sembrarlo a mano para
  // poder comprobar que sobrevive a recargar.
  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v)

  const bundle = readdirSync('dist/assets').find((f) => /^index-.*\.js$/.test(f))
  window.eval(
    readFileSync('dist/assets/' + bundle, 'utf8').replaceAll('import.meta', '({url:location.href,env:{}})')
  )

  const doc = window.document
  const text = () => doc.body.textContent ?? ''
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  // fn puede ser async: sin el await, una promesa siempre es truthy y el check
  // pasaba sin comprobar nada.
  async function until(label, fn, ms = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await fn()) return true
      await wait(150)
    }
    console.log(`  (timeout esperando: ${label})`)
    return false
  }

  const byText = (sel, re) => [...doc.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ''))
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  function type(input, value) {
    // React intercepta el setter de value; hay que llamar al nativo.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  }

  return { dom, window, doc, text, wait, until, byText, click, type }
}

