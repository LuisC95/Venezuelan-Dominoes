/**
 * Etapa 9: chat y emotes en la mesa.
 *
 * Rafa juega desde el navegador; Chuo escribe por RPC, que es la forma de
 * comprobar que el mensaje de otro llega por Realtime sin recargar. También se
 * verifica el freno del servidor (8 mensajes por 10s) y que un no miembro no
 * puede leer el chat de la sala.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-chat.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()
/** Los cuatro del prototipo, tal cual. */
const EMOTES = ['¡Ahí va!', '¡Data!', 'Tranquilo', '¡Se pegó!']
/** Lo que tarda en apagarse la burbuja de un chat (la del emote, menos). */
const VISIBLE_CHAT_MS = 12_000

const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app
const burbujas = () => [...doc.querySelectorAll('[class*="burbuja"]')]

await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
click(byText('button', /Crear sala/))
await until('lobby', () => /Mesa · parejas cruzadas/.test(text()))
const code = window.location.pathname.split('/').pop()

r.head(`Sala ${code}: mesa lista`)
const otros = []
for (const [i, n] of ['Chuo', 'Marielba', 'Kike'].entries()) {
  const p = await makePlayer(n)
  const { data: room } = await p.sb.rpc('join_room', { p_code: code })
  await p.sb.rpc('take_seat', { p_room_id: room.id, p_seat: i + 1 })
  otros.push({ ...p, roomId: room.id })
}
const roomId = otros[0].roomId
await until('4/4', () => /4\/4/.test(text()))
click(byText('button', /^Iniciar partida$/))
r.check('Rafa entra a la mesa', await until('la mesa', () => /Mesa limpia|Puntas/.test(text())))

const chuo = otros[0]
const leerChat = async () => (await chuo.sb.rpc('get_messages', { p_room_id: roomId, p_limit: 30 })).data

r.head('Los emotes del prototipo')
for (const e of EMOTES) {
  r.check(`está el emote "${e}"`, !!byText('button', new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)))
}

r.head('Rafa manda un emote')
click(byText('button', /^¡Data!$/))
r.check('la burbuja aparece en su pantalla',
  await until('la burbuja', () => burbujas().some((b) => /¡Data!/.test(b.textContent))))
let chat = await until('el emote en el servidor', async () => {
  const c = await leerChat()
  return c.messages.some((m) => m.body === '¡Data!' && m.kind === 'emote')
})
r.check('el servidor lo guarda como emote', chat)

r.head('Lo que escribe otro llega solo, por Realtime')
await chuo.sb.rpc('send_message', { p_room_id: roomId, p_body: 'esa mano está fea', p_kind: 'chat' })
r.check('la burbuja del otro aparece sin recargar',
  await until('la burbuja de Chuo', () => burbujas().some((b) => /esa mano está fea/.test(b.textContent))))
r.check('la burbuja dice quién lo dijo',
  burbujas().some((b) => /Chuo/.test(b.textContent) && /esa mano está fea/.test(b.textContent)))

r.head('Rafa escribe')
click(byText('button', /^Escribir$/))
const caja = await until('la caja de texto', () => !!doc.querySelector('#mensaje'))
r.check('se abre la caja de escribir', caja)
r.check('al abrirla se ve el historial', /esa mano está fea/.test(text()) && /¡Data!/.test(text()))

type(doc.querySelector('#mensaje'), 'tranquilo que ahí viene')
await wait(150)
click(byText('button', /^Enviar$/))
r.check('el mensaje propio entra al historial',
  await until('el mensaje propio', () => /tranquilo que ahí viene/.test(text())))
r.check('la caja queda vacía para el siguiente',
  await until('la caja vacía', () => doc.querySelector('#mensaje')?.value === ''))
const st = await leerChat()
const mio = st.messages.find((m) => m.body === 'tranquilo que ahí viene')
r.check('el servidor lo guarda como chat', mio?.kind === 'chat', mio?.kind)
r.check('el servidor sabe que es de Rafa', mio?.display_name === 'Rafa', mio?.display_name)

r.head('Al cerrar la caja vuelven los emotes')
click(byText('button', /^✕$/))
r.check('se cierra la caja de escribir',
  await until('sin caja', () => !doc.querySelector('#mensaje')))
r.check('los emotes vuelven a estar a mano', !!byText('button', /^¡Data!$/))

r.head('El freno del servidor cuando alguien se emociona')
// send_message corta a los 8 mensajes en 10s. Se toca hasta que avise.
let avisó = false
for (let i = 0; i < 12 && !avisó; i++) {
  const pill = byText('button', /^¡Ahí va!$/)
  if (!pill || pill.disabled) { await wait(120); continue }
  click(pill)
  await wait(250)
  avisó = /espera un momento/.test(text())
}
r.check('avisa en pantalla cuando el servidor frena', avisó)

r.head('Las burbujas se apagan solas')
r.check('las burbujas desaparecen al pasar su tiempo',
  await until('la mesa despejada', () => burbujas().length === 0, VISIBLE_CHAT_MS + 8000))
r.check('la mesa sigue ahí debajo', /Mesa limpia|Puntas/.test(text()))
r.check('los emotes siguen a mano', !!byText('button', /^¡Data!$/))

r.head('El chat es solo de la sala')
const gaby = await makePlayer('Gaby')
const { error } = await gaby.sb.rpc('get_messages', { p_room_id: roomId, p_limit: 30 })
r.check('quien no está en la sala no lee el chat', !!error, error?.message)

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
