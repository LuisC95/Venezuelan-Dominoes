/**
 * Etapa 6 desde el navegador: la cola, el emparejamiento de sueltos, el fin de
 * partida y el rey de la cancha.
 *
 * Dos navegadores jsdom a la vez, porque las dos mitades de la etapa se ven
 * desde sitios distintos: Rafa juega y termina en la pantalla de resultado con
 * el botón del anfitrión; Gaby mira desde fuera, pide turno, se empareja y
 * entra a la mesa cuando la pareja perdedora sale.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-cola.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()

// --- Rafa: anfitrión y jugador -------------------------------------------
const rafa = await bootApp({ as: 'Rafa' })
await rafa.until('inicio', () => /Sala de juego/.test(rafa.text()))
rafa.type(rafa.doc.querySelector('#nombre'), 'Rafa')
await rafa.wait(150)
rafa.click(rafa.byText('button', /Crear sala/))
await rafa.until('lobby', () => /Mesa · parejas cruzadas/.test(rafa.text()))
const code = rafa.window.location.pathname.split('/').pop()

r.head(`Sala ${code}: 3 se sientan, 1 queda suelto`)
const sentados = []
for (const [i, n] of ['Chuo', 'Marielba', 'Kike'].entries()) {
  const p = await makePlayer(n)
  const { data: room } = await p.sb.rpc('join_room', { p_code: code })
  await p.sb.rpc('take_seat', { p_room_id: room.id, p_seat: i + 1 })
  sentados.push({ ...p, roomId: room.id })
}
const roomId = sentados[0].roomId

const yorman = await makePlayer('Yorman')
await yorman.sb.rpc('join_room', { p_code: code })
await yorman.sb.rpc('request_turn', { p_room_id: roomId })

r.check('la mesa se llenó en la pantalla de Rafa',
  await rafa.until('4/4', () => /4\/4/.test(rafa.text())))

// --- Gaby: entra por código y se queda de observadora ---------------------
r.head('Gaby entra por código, en otro navegador')
const gaby = await bootApp({ as: 'Gaby' })
await gaby.until('inicio', () => /Sala de juego/.test(gaby.text()))
gaby.type(gaby.doc.querySelector('#nombre'), 'Gaby')
gaby.type(gaby.doc.querySelector('input[placeholder="ABC-123"]'), code)
await gaby.wait(150)
gaby.click(gaby.byText('button', /Unirme/))
r.check('Gaby llega al lobby de la sala',
  await gaby.until('lobby de Gaby', () => /Mesa · parejas cruzadas/.test(gaby.text())))

r.head('Arranca la partida: cada quien a su pantalla')
rafa.click(rafa.byText('button', /^Iniciar partida$/))

r.check('Rafa, que está sentado, pasa a la mesa',
  await rafa.until('la mesa', () => /Mesa limpia|Puntas/.test(rafa.text())))
r.check('Gaby, que observa, pasa sola a la cola',
  await gaby.until('la cola', () => /Cola de parejas/.test(gaby.text()) && /Partida en curso/.test(gaby.text())))
r.check('la URL de Gaby es /sala/CODIGO/cola',
  /\/cola$/.test(gaby.window.location.pathname), gaby.window.location.pathname)

r.head('La cola en pantalla')
r.check('muestra el marcador de la partida en curso', /Partida en curso · mano 1/.test(gaby.text()))
r.check('Gaby aparece como observadora', /Observando/.test(gaby.text()))
r.check('Yorman aparece como suelto', /Yorman/.test(gaby.text()) && /Sueltos/.test(gaby.text()))

r.head('Sueltos: Gaby pide turno y se empareja con Yorman')
gaby.click(gaby.byText('button', /^Pedir turno$/))
r.check('Gaby queda marcada como suelta', await gaby.until('chip Suelto', () => /Suelto/.test(gaby.text())))

const emparejar = await gaby.until('el botón de emparejarse',
  () => !!gaby.byText('button', /Emparejarnos/))
r.check('aparece el botón de emparejarse con el otro suelto', emparejar)
if (emparejar) {
  gaby.click(gaby.byText('button', /Emparejarnos/))
  r.check('la pareja entra a la cola',
    await gaby.until('Gaby & Yorman en la cola',
      () => /En cola/.test(gaby.text()) && /Yorman/.test(gaby.text()) && /Gaby/.test(gaby.text())))
  r.check('la nota dice que entran al terminar', /entran al terminar/i.test(gaby.text()))
}

// --- Se juega hasta que la partida termine --------------------------------
r.head('Se juega la partida (Rafa toca, los otros tres por RPC)')
const espejo = sentados[0]
const leerSala = async () => (await espejo.sb.rpc('get_room_state', { p_room_id: roomId })).data
let matchId = (await leerSala()).current_match_id
const leer = async () => (await espejo.sb.rpc('get_game_state', { p_match_id: matchId })).data

let st = await leer()
let guard = 0
while (st.match.status === 'active' && guard++ < 900) {
  if (st.hand.status === 'finished') {
    // Rafa cierra la mano desde el botón de fin de mano.
    const seguir = await rafa.until('el botón de seguir',
      () => !!rafa.byText('button', /Siguiente mano|Ver resultado/), 8000)
    if (!seguir) break
    const btn = rafa.byText('button', /Siguiente mano|Ver resultado/)
    if (/Ver resultado/.test(btn.textContent)) break
    const mano = st.hand.hand_number
    rafa.click(btn)
    await rafa.until('la mano siguiente', async () => (await leer()).hand.hand_number > mano, 15000)
    st = await leer()
    continue
  }

  const seat = st.hand.current_seat
  if (seat === 0) {
    if (!(await rafa.until('el turno de Rafa', () => /Tu turno/.test(rafa.text()), 10000))) break
    const jugables = [...rafa.doc.querySelectorAll('button[class*="tile"]')].filter((b) => !b.disabled)
    if (jugables.length === 0) break
    const antes = st.board.length
    rafa.click(jugables[0])
    await rafa.wait(150)
    const punta = rafa.byText('button', /^Punta \d ▶$/)
    if (punta) rafa.click(punta)
    await rafa.until('la jugada de Rafa', async () => {
      st = await leer()
      return st.board.length > antes || st.hand.status === 'finished'
    }, 10000)
  } else {
    const p = sentados[seat - 1]
    const s = (await p.sb.rpc('get_game_state', { p_match_id: matchId })).data
    const opt = s.my_hand.find((t) => t.sides.length > 0)
    if (!opt) break
    await p.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
  }
  st = await leer()
}

r.check('la partida terminó', st.match.status === 'finished', `${st.match.score_a} — ${st.match.score_b}`)
r.check('hay pareja ganadora', !!st.match.winner_team_id)

// --- Fin de partida -------------------------------------------------------
r.head('Fin de partida')
r.check('Gaby ve desde la cola que la partida terminó',
  await gaby.until('el aviso de partida terminada', () => /La partida terminó/.test(gaby.text())))

const verResultado = await rafa.until('el botón de ver resultado',
  () => !!rafa.byText('button', /Ver resultado/))
r.check('la mesa de Rafa ofrece ver el resultado', verResultado)
if (verResultado) rafa.click(rafa.byText('button', /Ver resultado/))

r.check('Rafa llega a la pantalla de resultado',
  await rafa.until('fin de partida', () => /Fin de partida/.test(rafa.text())))
r.check('la URL lleva el id de la partida',
  rafa.window.location.pathname.endsWith(`/resultado/${matchId}`), rafa.window.location.pathname)
r.check('muestra el marcador final',
  rafa.text().includes(`${Math.max(st.match.score_a, st.match.score_b)}`))
r.check('muestra la rejilla de estadísticas',
  /Manos jugadas/.test(rafa.text()) && /Dominós/.test(rafa.text())
  && /Trancas/.test(rafa.text()) && /Capicúas/.test(rafa.text()))
r.check('el número de manos jugadas cuadra con el servidor',
  rafa.text().includes(String(st.match_stats.hands_played)), `${st.match_stats.hands_played} manos`)
r.check('el anfitrión ve el botón de arrancar la siguiente',
  !!rafa.byText('button', /Siguiente pareja|Revancha/))

// --- Rey de la cancha -----------------------------------------------------
r.head('Rey de la cancha')
const perdedores = st.match.winner_team_id === st.match.team_a_id ? [1, 3] : [0, 2]
const rafaSigue = !perdedores.includes(0)

rafa.click(rafa.byText('button', /Siguiente pareja|Revancha/))
const nuevoId = await (async () => {
  for (let i = 0; i < 60; i++) {
    const sala = await leerSala()
    if (sala.current_match_id && sala.current_match_id !== matchId) return sala.current_match_id
    await rafa.wait(250)
  }
  return null
})()
r.check('el anfitrión arranca la partida siguiente', !!nuevoId, nuevoId ?? 'no arrancó')

if (nuevoId) {
  matchId = nuevoId
  const sala = await leerSala()
  const sentadaGaby = sala.members.find((m) => m.display_name === 'Gaby')?.seat
  r.check('la pareja de la cola entra a la mesa', sentadaGaby !== null && sentadaGaby !== undefined,
    `Gaby en el asiento ${sentadaGaby}`)
  r.check('la pareja perdedora sale al final de la cola',
    sala.queue.length > 0, `${sala.queue.length} pareja(s) esperando`)

  r.check('a Gaby la lleva sola a la mesa',
    await gaby.until('la mesa de Gaby', () => /Mesa limpia|Puntas/.test(gaby.text()), 20000))

  r.check(
    rafaSigue
      ? 'la pareja ganadora se queda: a Rafa lo devuelve a la mesa'
      : 'la pareja perdedora sale: a Rafa lo manda a la cola',
    await rafa.until('el destino de Rafa', () =>
      rafaSigue
        ? /\/mesa$/.test(rafa.window.location.pathname)
        : /\/cola$/.test(rafa.window.location.pathname), 20000),
    rafa.window.location.pathname,
  )
}

saveBrowserSession(rafa.window, 'Rafa')
saveBrowserSession(gaby.window, 'Gaby')
rafa.window.close()
gaby.window.close()
r.done('sala de prueba: ' + code)
