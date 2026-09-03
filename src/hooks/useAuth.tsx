import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Profile = {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
}

type AuthValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  /** Crea o actualiza el perfil (nombre + avatar) del jugador. */
  saveProfile: (displayName: string, avatarUrl?: string | null) => Promise<Profile>
}

const Ctx = createContext<AuthValue | null>(null)

function esSesionHuerfana(err: { code?: string; message?: string }) {
  return err.code === '23503' || /profiles_id_fkey/.test(err.message ?? '')
}

async function entrarAnonimo() {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw new Error(
      error.status === 429
        ? 'Supabase cortó por límite de registros anónimos. Espera un rato o sube el límite en Authentication → Rate Limits.'
        : error.message,
    )
  }
  return data.session
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const signingIn = useRef(false)

  useEffect(() => {
    let alive = true

    async function boot() {
      const { data } = await supabase.auth.getSession()
      let current = data.session

      // Sin sesión guardada ⇒ jugador nuevo: entramos anónimos, sin email ni clave.
      if (!current && !signingIn.current) {
        signingIn.current = true
        let err: Error | null = null
        try {
          current = await entrarAnonimo()
        } catch (e) {
          err = e instanceof Error ? e : new Error('No se pudo iniciar sesión')
        }
        signingIn.current = false
        if (err) {
          if (alive) { setError(err.message); setLoading(false) }
          return
        }
      }
      if (!alive) return
      setSession(current)

      if (current) {
        const { data: rows } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', current.user.id)
          .maybeSingle()
        if (alive) setProfile((rows as Profile) ?? null)
      }
      if (alive) setLoading(false)
    }

    boot()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  async function saveProfile(displayName: string, avatarUrl: string | null = null) {
    const args = {
      p_display_name: displayName,
      p_avatar_url: avatarUrl,
    }
    let { data, error: err } = await supabase.rpc('ensure_profile', args)
    if (err && esSesionHuerfana(err)) {
      // El usuario de auth fue borrado, pero quedó su JWT en localStorage.
      // Renovamos solo la sesión local y reintentamos el perfil con un uid real.
      await supabase.auth.signOut({ scope: 'local' })
      const fresh = await entrarAnonimo()
      setSession(fresh)
      setProfile(null)
      ;({ data, error: err } = await supabase.rpc('ensure_profile', args))
    }
    if (err) throw new Error(err.message)
    const row = data as Profile
    setProfile(row)
    return row
  }

  return (
    <Ctx.Provider value={{ session, profile, loading, error, saveProfile }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return v
}
