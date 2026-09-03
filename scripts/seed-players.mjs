/**
 * Crea (una sola vez) las identidades de prueba y las deja cacheadas.
 * Supabase limita los registros anónimos a 30/hora por IP, así que reintenta
 * con paciencia en vez de rendirse.
 *
 *   node scripts/seed-players.mjs
 */
import { makePlayer, readCache } from './players.mjs'

const NOMBRES = ['Rafa', 'Chuo', 'Marielba', 'Kike', 'Yorman', 'Gaby']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

for (const nombre of NOMBRES) {
  if (readCache()[nombre]?.session) { console.log(`  ya estaba  ${nombre}`); continue }
  let intento = 0
  for (;;) {
    try {
      const p = await makePlayer(nombre)
      console.log(`  creado     ${nombre}  ${p.id}`)
      break
    } catch (e) {
      if (!/límite de registros/.test(e.message) || ++intento > 40) throw e
      process.stdout.write(`  esperando cupo para ${nombre} (intento ${intento})\r`)
      await wait(30_000)
    }
  }
}
console.log('\nidentidades listas:', Object.keys(readCache()).join(', '))
