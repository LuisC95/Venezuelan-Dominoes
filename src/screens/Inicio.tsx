import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import * as api from '../lib/api'
import s from './Inicio.module.css'

export function Inicio() {
  const { profile, saveProfile, error: authError } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (profile) setName(profile.display_name)
  }, [profile])

  const initial = (name.trim()[0] ?? 'T').toUpperCase()
  const ready = name.trim().length > 0

  // El perfil se guarda antes de cualquier acción: la sala necesita saber tu nombre.
  async function commitName() {
    const v = name.trim()
    if (!v) throw new Error('Escribe tu nombre primero')
    if (v !== profile?.display_name) await saveProfile(v)
  }

  async function go(action: 'crear' | 'unirse') {
    setBusy(true)
    setFailed(null)
    try {
      await commitName()
      const room = action === 'crear'
        ? await api.createRoom()
        : await api.joinRoom(code.trim())
      navigate(`/sala/${room.code}`)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Algo salió mal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.screen}>
      <div className={s.brand}>
        <div className={s.eyebrow}>
          <div className={s.rule} />
          <span>Sala de juego</span>
          <div className={`${s.rule} ${s.ruleR}`} />
        </div>
        <div className={s.title}>Dominó</div>
        <div className={s.tagline}>Parejas cruzadas · 100 puntos · rey de la cancha</div>
      </div>

      <div className={s.card}>
        <div className={s.identity}>
          {/* El avatar es el acceso al historial, como en el prototipo. Solo
              tiene sentido cuando ya hay perfil guardado. */}
          {profile ? (
            <button
              className={s.avatar}
              title="Ver historial y estadísticas"
              onClick={() => navigate('/perfil')}
            >
              {initial}
            </button>
          ) : (
            <div className={s.avatar}>{initial}</div>
          )}
          <div className={s.field}>
            <label className={s.fieldLabel} htmlFor="nombre">Tu nombre</label>
            <input
              id="nombre"
              className={s.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder="Escribe tu nombre"
              autoComplete="given-name"
              maxLength={24}
            />
          </div>
        </div>

        <button className={s.cta} disabled={!ready || busy} onClick={() => go('crear')}>
          {busy ? 'Un momento…' : 'Crear sala'}
        </button>

        <div className={s.sep}><i />Ó<i /></div>

        <div className={s.joinBlock}>
          <div className={s.fieldLabel}>Código de sala</div>
          <div className={s.joinRow}>
            <input
              className={s.codeInput}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 7))}
              placeholder="ABC-123"
              inputMode="text"
              autoCapitalize="characters"
            />
            <button
              className={s.joinBtn}
              disabled={!ready || busy || code.trim().length < 6}
              onClick={() => go('unirse')}
            >
              Unirme
            </button>
          </div>
        </div>
      </div>

      {failed && <div className={`${s.note} ${s.error}`}>{failed}</div>}
      {authError && <div className={`${s.note} ${s.error}`}>Sesión: {authError}</div>}
    </div>
  )
}
