/**
 * Flujo de sala desde el navegador (jsdom) contra el Supabase real:
 * inicio → crear sala → lobby que se actualiza solo.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-check.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()
const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app

r.head('Inicio')
await until('sesión anónima', () => /Dominó/.test(text()))
r.check('la pantalla de inicio renderiza', /Sala de juego/.test(text()) && /Dominó/.test(text()))
r.check('muestra el subtítulo del prototipo', /rey de la cancha/.test(text()))

const nameInput = doc.querySelector('#nombre')
r.check('hay campo de nombre', !!nameInput)
type(nameInput, 'Rafa')
await wait(150)
r.check('el avatar toma la inicial',
  (doc.querySelector('[class*=avatar]')?.textContent?.trim() ?? '') === 'R')

r.head('Crear sala')
click(byText('button', /Crear sala/))
r.check('navega al lobby', await until('lobby', () => /Mesa · parejas cruzadas/.test(text())))
r.check('la URL es /sala/CODIGO', /^\/sala\/[A-Z]{3}-\d{3}$/.test(window.location.pathname), window.location.pathname)

const code = window.location.pathname.split('/').pop()
r.check('muestra el código de la sala', text().includes(code), code)
r.check('muestra los 4 asientos',
  (text().match(/Pareja 1/g) ?? []).length === 2 && (text().match(/Pareja 2/g) ?? []).length === 2)
r.check('el anfitrión aparece sentado', /Rafa/.test(text()))
r.check('contador de mesa en 1/4', /1\/4/.test(text()))
r.check('el botón de arrancar avisa que faltan', /Faltan 3 para arrancar/.test(text()))
r.check('los asientos libres invitan a sentarse', (text().match(/Sentarse aquí/g) ?? []).length === 3)

r.head('Entran los demás por RPC y el lobby se entera solo')
const otros = []
for (const nombre of ['Chuo', 'Marielba', 'Kike', 'Yorman']) {
  const p = await makePlayer(nombre)
  const { data: sala, error } = await p.sb.rpc('join_room', { p_code: code })
  if (error) console.log('  join', nombre, error.message)
  otros.push({ ...p, roomId: sala?.id })
}

r.check('el lobby se actualiza por Realtime, sin recargar',
  await until('los nombres nuevos', () => /Chuo/.test(text()) && /Kike/.test(text())))
r.check('mesa llena 4/4', /4\/4/.test(text()))
r.check('Yorman queda como observador',
  await until('Yorman', () => /Yorman/.test(text())) && /Observando/.test(text()))
r.check('ahora sí se puede iniciar', !!byText('button', /^Iniciar partida$/))

r.head('Cola en vivo')
await otros[3].sb.rpc('request_turn', { p_room_id: otros[3].roomId })
r.check('el badge cambia a "Suelto" solo', await until('badge', () => /Suelto/.test(text())))

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
