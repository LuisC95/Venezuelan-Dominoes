import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local.')
}

export const supabase = createClient(url, key, {
  auth: {
    // La sesión anónima persiste: al volver a abrir la PWA eres el mismo jugador,
    // que es lo que permite reconectarse a la mesa y conservar estadísticas.
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'domino.auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
})
