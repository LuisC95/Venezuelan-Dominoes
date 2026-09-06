/**
 * Los tres gestos de la mano con DEDOS de verdad.
 *
 * Es lo único que no cubría nada: jsdom dispara eventos de PUNTERO sintéticos, y
 * en un teléfono lo que llega primero es un evento TÁCTIL del que el navegador
 * deriva el de puntero — y por el camino puede cancelarlo, robarlo para hacer
 * scroll, o abrir el menú de selección de texto. Aquí se disparan eventos
 * táctiles de verdad contra un Chromium con emulación móvil.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-tacto.mjs
 *
 * Con BASE=http://<ip-de-la-lan>:4173 se prueba además desde un origen NO
 * seguro, que es lo que ve un teléfono por WiFi: ahí no existen
 * `navigator.locks`, `serviceWorker` ni `crypto.subtle`.
 */
import { spawn } from 'node:child_process'
import { makePlayer, readCache } from './players.mjs'

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const BASE = process.env.BASE ?? 'http://localhost:4173'
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9555', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' })
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let url
for (let i = 0; i < 60 && !url; i++) {
  try { url = (await (await fetch('http://127.0.0.1:9555/json/list')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch {}
  if (!url) await esperar(250)
}
const ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r })
let id = 0; const pend = new Map(); const problemas = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.mal(new Error(m.error.message)) : p.ok(m.result) }
  else if (m.method === 'Runtime.exceptionThrown') problemas.push(m.params.exceptionDetails.exception?.description?.split('\n')[0])
}
const cdp = (m, p = {}) => new Promise((ok, mal) => { const n = ++id; pend.set(n, { ok, mal }); ws.send(JSON.stringify({ id: n, method: m, params: p })) })
const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value

await cdp('Runtime.enable'); await cdp('Page.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await cdp('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })

const rafa = await makePlayer('Rafa')
const { data: sala } = await rafa.sb.rpc('create_room', { p_max_size: 8, p_points_target: 100, p_capicua_doble: false })
const otrosJug = []
for (const [i, n] of ['Chuo', 'Marielba', 'Kike'].entries()) {
  const p = await makePlayer(n)
  await p.sb.rpc('join_room', { p_code: sala.code })
  await p.sb.rpc('take_seat', { p_room_id: sala.id, p_seat: i + 1 })
  otrosJug.push(p)
}
await rafa.sb.rpc('start_match', { p_room_id: sala.id })

await cdp('Page.navigate', { url: `${BASE}/` }); await esperar(1200)
await ev(`localStorage.setItem('domino.auth', ${JSON.stringify(JSON.stringify(readCache()['Rafa'].session))})`)
await cdp('Page.navigate', { url: `${BASE}/sala/${sala.code}/mesa` }); await esperar(2500)

// Los jugadores por RPC no hacen Presence, así que la mesa los da por caídos y
// el overlay tapa la mano. Se aparta, como haría cualquiera.
const apartar = async () => {
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Ver la mesa/i.test(x.textContent))
    if (b) b.click()
    return !!b
  })()`)
  await esperar(250)
}

const mano = async () => ev(`(() => {
  const slots = [...document.querySelectorAll('[data-mano] > *')]
  return slots.map((sl) => {
    const r = sl.getBoundingClientRect()
    const mitades = [...(sl.querySelector('button > div')?.children ?? [])].filter((h) => h.children.length === 9)
    return {
      cara: mitades.map((m) => [...m.children].filter((h) => h.children.length).length).join('-'),
      x: r.x + r.width / 2, y: r.y + r.height / 2,
    }
  })
})()`)

const toca = (tipo, x, y) => cdp('Input.dispatchTouchEvent', {
  type: tipo,
  touchPoints: tipo === 'touchEnd' ? [] : [{ x, y, id: 1 }],
})

await apartar()
let fallos = 0
let antes = await mano()
console.log('mano al empezar:', antes.map((f) => f.cara).join(' '))
if (antes.length < 3) { console.log('no hay mano que probar'); process.exit(1) }


// --- SONDA: ¿qué hay bajo el dedo y qué eventos llegan? ---
{
  const f = antes[0]
  console.log('\n--- sonda ---')
  console.log('elemento bajo el dedo:', await ev(
    `(() => { const e = document.elementFromPoint(${f.x}, ${f.y}); return e ? e.tagName + '.' + e.className : 'nada' })()`))
  console.log('touch-action del slot:', await ev(
    `getComputedStyle(document.querySelector('[data-mano] > *')).touchAction`))
  console.log('pointer-events del botón:', await ev(
    `getComputedStyle(document.querySelector('[data-mano] button')).pointerEvents`))
  await ev(`window.__ev = []; for (const t of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','click','contextmenu']) {
    document.addEventListener(t, (e) => window.__ev.push(t + '@' + (e.target.tagName || '?')), true)
  }; true`)
  await toca('touchStart', f.x, f.y)
  await esperar(60)
  await toca('touchMove', f.x + 60, f.y)
  await esperar(60)
  await toca('touchEnd', f.x + 60, f.y)
  await esperar(300)
  console.log('eventos vistos:', JSON.stringify(await ev('window.__ev')))
}

// --- arrastrar la primera al tercer puesto, con el dedo ---
const desde = antes[0]
const hasta = antes[2]
await toca('touchStart', desde.x, desde.y)
for (let k = 1; k <= 8; k++) {
  await toca('touchMove', desde.x + (hasta.x - desde.x) * k / 8, desde.y)
  await esperar(25)
}
await toca('touchEnd', hasta.x, desde.y)
await esperar(400)
let ahora = await mano()
console.log('tras arrastrar:  ', ahora.map((f) => f.cara).join(' '))
const arrastro = antes.map((f) => f.cara).join(' ') !== ahora.map((f) => f.cara).join(' ')
if (!arrastro) fallos++
console.log(arrastro ? '✓ ARRASTRAR funciona con el dedo' : '✗ ARRASTRAR no hizo nada con el dedo')

// --- pulsación larga para voltear ---
antes = await mano()
const i = antes.findIndex((f) => f.cara.split('-')[0] !== f.cara.split('-')[1])
if (i >= 0) {
  await toca('touchStart', antes[i].x, antes[i].y)
  await esperar(700)
  await toca('touchEnd', antes[i].x, antes[i].y)
  await esperar(400)
  ahora = await mano()
  const alReves = antes[i].cara.split('-').reverse().join('-')
  console.log(`voltear ${antes[i].cara} → ${ahora[i]?.cara}`)
  if (ahora[i]?.cara !== alReves) fallos++
  console.log(ahora[i]?.cara === alReves
    ? '✓ PULSACIÓN LARGA voltea con el dedo' : '✗ PULSACIÓN LARGA no volteó con el dedo')
}

// --- toque corto para jugar ---
// Hay que esperar al turno propio: es la única forma de probar el gesto que de
// verdad importa. Los otros tres juegan por RPC hasta que toque.
for (let intento = 0; intento < 40; intento++) {
  if (await ev(`/Tu turno/.test(document.body.textContent)`)) break
  const st = (await rafa.sb.rpc('get_game_state', { p_match_id:
    (await rafa.sb.rpc('get_room_state', { p_room_id: sala.id })).data.current_match_id })).data
  const asiento = st.hand?.current_seat
  if (asiento === null || asiento === undefined || asiento === 0) { await esperar(500); continue }
  const p = otrosJug[asiento - 1]
  const suyo = (await p.sb.rpc('get_game_state', { p_match_id: st.match.id })).data
  const opt = suyo.my_hand.find((t) => t.sides.length > 0)
  if (!opt) break
  await p.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
  await esperar(600)
}
await apartar()
antes = await mano()
const jugable = await ev(`(() => {
  const b = [...document.querySelectorAll('[data-mano] button')].find((x) => !x.disabled)
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
const tablero = async () => ev(`document.querySelectorAll('[class*="boardInner"] > *').length`)
if (jugable) {
  const n0 = await tablero()
  await toca('touchStart', jugable.x, jugable.y)
  await esperar(90)
  await toca('touchEnd', jugable.x, jugable.y)
  await esperar(2000)
  let n1 = await tablero()
  // Si la ficha calza por las dos puntas, el toque abre el selector en vez de
  // jugarla: hay que tocar también la punta.
  const punta = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Punta \\d ▶$/.test(x.textContent))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  console.log('¿apareció el selector de puntas?:', punta ? 'sí' : 'no')
  if (punta) {
    await toca('touchStart', punta.x, punta.y)
    await esperar(90)
    await toca('touchEnd', punta.x, punta.y)
    await esperar(2000)
    n1 = await tablero()
  }
  console.log(`tablero ${n0} → ${n1}`)
  if (n1 <= n0) fallos++
  console.log(n1 > n0
    ? '✓ TOQUE CORTO juega con el dedo' : '✗ TOQUE CORTO no jugó con el dedo')
} else {
  console.log('(no era mi turno: no se probó el toque corto)')
}

// --- ¿se selecciona texto al mantener pulsado? ---
console.log('selección de texto tras pulsación larga:',
  JSON.stringify((await ev('String(getSelection())')) ?? ''))

if (problemas.length) { console.log('\n--- excepciones ---'); for (const p of [...new Set(problemas)]) console.log(' ', p) }
ws.close(); chrome.kill()
process.exit(fallos ? 1 : 0)
