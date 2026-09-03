/**
 * Identidades de prueba compartidas por todos los scripts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

export const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => l.split('='))
)

/**
 * Supabase limita los registros anónimos a 30/hora por IP, y una tanda de
 * pruebas se los come rápido. Guardamos las sesiones de los jugadores de prueba
 * y las reutilizamos: después de la primera corrida no se crea ningún usuario.
 */
const CACHE = 'scripts/.test-sessions.json'
export const readCache = () => (existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {})
export const writeCache = (c) => writeFileSync(CACHE, JSON.stringify(c, null, 2) + '\n')

/** Un jugador extra que actúa por RPC, fuera del navegador. */
export async function makePlayer(name) {
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const cache = readCache()

  let user = null
  if (cache[name]?.session) {
    const { data, error } = await sb.auth.setSession(cache[name].session)
    if (!error && data.user) user = data.user
  }

  if (!user) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error) {
      throw new Error(
        error.status === 429
          ? `${name}: Supabase cortó por límite de registros anónimos (30/h por IP). ` +
            'Espera un rato o súbelo en Authentication → Rate Limits.'
          : `${name}: ${error.message}`
      )
    }
    user = data.user
  }

  const { data: sess } = await sb.auth.getSession()
  cache[name] = { id: user.id, session: sess.session }
  writeCache(cache)

  await sb.rpc('ensure_profile', { p_display_name: name })
  return { name, sb, id: user.id }
}

/** Guarda la sesión que quedó en el navegador de jsdom, para reutilizarla. */
export function saveBrowserSession(window, name) {
  const raw = window.localStorage.getItem('domino.auth')
  if (!raw) return
  const cache = readCache()
  cache[name] = { ...(cache[name] ?? {}), session: JSON.parse(raw) }
  writeCache(cache)
}

export function reporter() {
  const r = { failures: 0 }
  r.check = (label, ok, extra = '') => {
    console.log(`${ok ? '  ok  ' : ' FALLO'} ${label}${extra ? '  ' + extra : ''}`)
    if (!ok) r.failures++
  }
  r.head = (t) => console.log('\n=== ' + t + ' ===')
  r.done = (note = '') => {
    console.log(`\n${r.failures === 0 ? 'TODO EN ORDEN' : r.failures + ' FALLO(S)'}`)
    if (note) console.log(note)
    process.exit(r.failures === 0 ? 0 : 1)
  }
  return r
}
