/**
 * Fotos de la mesa en un Chromium de verdad.
 *
 * Durante mucho tiempo esto no se pudo: a la máquina le faltaban libnspr4,
 * libnss3, libnssutil3 y libasound, y de ahí salió todo el arnés de jsdom. Ya
 * están, así que **sí se puede ver lo que se pinta** — que es lo único que
 * comprueba de verdad si la mesa se lee.
 *
 * No usa Playwright (no está instalado): habla el protocolo de DevTools a pelo
 * por el WebSocket que trae Node.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/foto.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { makePlayer, readCache } from './players.mjs'

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const SALIDA = process.env.SALIDA ?? '/tmp/fotos-mesa'
/** Un teléfono normal de pie, que es como se juega. */
const PANTALLA = { ancho: 390, alto: 844, escala: 3 }

mkdirSync(SALIDA, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9333',
  `--window-size=${PANTALLA.ancho},${PANTALLA.alto}`,
  'about:blank',
], { stdio: 'ignore' })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function conectar() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/list')
      const [pagina] = (await r.json()).filter((t) => t.type === 'page')
      if (pagina) return pagina.webSocketDebuggerUrl
    } catch { /* todavía no levanta */ }
    await esperar(250)
  }
  throw new Error('Chromium no abrió el puerto de depuración')
}

const ws = new WebSocket(await conectar())
await new Promise((r) => { ws.onopen = r })

let id = 0
const pendientes = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pendientes.has(m.id)) {
    const { ok, mal } = pendientes.get(m.id)
    pendientes.delete(m.id)
    m.error ? mal(new Error(m.error.message)) : ok(m.result)
  }
}
const cdp = (method, params = {}) =>
  new Promise((ok, mal) => {
    const n = ++id
    pendientes.set(n, { ok, mal })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

await cdp('Page.enable')
await cdp('Runtime.enable')
// Un teléfono de verdad: densidad 3 y eventos táctiles, no un escritorio angosto.
await cdp('Emulation.setDeviceMetricsOverride', {
  width: PANTALLA.ancho, height: PANTALLA.alto,
  deviceScaleFactor: PANTALLA.escala, mobile: true,
})
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

const evaluar = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página')
  return r.result.value
}

async function ir(url) {
  await cdp('Page.navigate', { url })
  await esperar(1200)
}

/*
 * Los jugadores por RPC no se suscriben al canal, así que Presence no los ve y
 * la mesa los da por caídos al instante (es lo que documenta `hacerSinSeñal`).
 * El overlay taparía justo lo que venimos a mirar, así que se aparta — el aviso
 * compacto se queda arriba, que es como lo vería alguien de verdad.
 */
async function apartarAviso() {
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Ver la mesa/i.test(x.textContent))
    if (b) b.click()
    return !!b
  })()`)
  await esperar(200)
}

async function foto(nombre) {
  await apartarAviso()
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
  const ruta = `${SALIDA}/${nombre}.png`
  writeFileSync(ruta, Buffer.from(data, 'base64'))
  console.log(`  📸 ${ruta}`)
  return ruta
}

async function hasta(que, expr, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await evaluar(expr)) return true
    await esperar(250)
  }
  console.log(`  (no llegó: ${que})`)
  return false
}

// --- montar una partida con bots, que es lo que fuerza pases y ráfagas ---
const rafa = await makePlayer('Rafa')
const { data: sala } = await rafa.sb.rpc('create_room', {
  p_max_size: 8, p_points_target: 100, p_capicua_doble: false,
})
console.log(`sala ${sala.code}`)
const otros = []
for (const [i, n] of ['Chuo', 'Marielba'].entries()) {
  const p = await makePlayer(n)
  await p.sb.rpc('join_room', { p_code: sala.code })
  await p.sb.rpc('take_seat', { p_room_id: sala.id, p_seat: i + 1 })
  otros.push(p)
}
await rafa.sb.rpc('add_bot', { p_room_id: sala.id, p_seat: 3 })
await rafa.sb.rpc('start_match', { p_room_id: sala.id })

/*
 * Los jugadores por RPC tienen que latir o la mesa los da por caídos a los 30s
 * y el overlay de "sin señal" tapa justo lo que veníamos a mirar. (Un bot no
 * late: el servidor lo exceptúa.)
 */
const latido = setInterval(() => {
  // El builder de supabase-js es un thenable, no una promesa: se envuelve.
  for (const p of otros) Promise.resolve(p.sb.rpc('heartbeat', { p_room_id: sala.id })).catch(() => {})
}, 8000)
for (const p of otros) await p.sb.rpc('heartbeat', { p_room_id: sala.id })

// La sesión de Rafa, sembrada antes de que arranque la app.
const sesion = JSON.stringify(readCache()['Rafa'].session)
await ir('http://localhost:4173/')
await evaluar(`localStorage.setItem('domino.auth', ${JSON.stringify(sesion)})`)
await ir(`http://localhost:4173/sala/${sala.code}/mesa`)
await hasta('la mesa', `/Puntas|Mesa limpia/.test(document.body.textContent)`)

const estado = async () => (await rafa.sb.rpc('get_game_state', {
  p_match_id: (await rafa.sb.rpc('get_room_state', { p_room_id: sala.id })).data.current_match_id,
})).data

let st = await estado()
const hitos = new Set([1, 4, 8, 12, 14, 16, 20, 24])
await foto('00-arranque')

let vuelta = 0
while (st.hand.status === 'active' && vuelta++ < 120) {
  const asiento = st.hand.current_seat
  if (asiento === 0) {
    await hasta('mi turno', `/Tu turno/.test(document.body.textContent)`, 8000)
    const jugó = await evaluar(`(() => {
      const b = [...document.querySelectorAll('button[class*="tile"]')].find((x) => !x.disabled)
      if (!b) return false
      b.click()
      return true
    })()`)
    if (!jugó) break
    await esperar(400)
    await evaluar(`(() => {
      const p = [...document.querySelectorAll('button')].find((b) => /^Punta \\d ▶$/.test(b.textContent))
      if (p) p.click()
      return true
    })()`)
  } else if (asiento === 1 || asiento === 2) {
    const p = otros[asiento - 1]
    const suyo = (await p.sb.rpc('get_game_state', { p_match_id: st.match.id })).data
    const opt = suyo.my_hand.find((t) => t.sides.length > 0)
    if (!opt) break
    await p.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
  }
  await esperar(1400)
  st = await estado()
  if (hitos.has(st.board.length)) {
    hitos.delete(st.board.length)
    await foto(`${String(st.board.length).padStart(2, '0')}-fichas`)
  }
}

await foto('99-final')
clearInterval(latido)
ws.close()
chrome.kill()
console.log(`\nfotos en ${SALIDA}`)
