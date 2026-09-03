/**
 * Historial y estadísticas de un jugador.
 *
 * Sin `:id` en la ruta muestra el tuyo; con id, el de otro — `get_profile_history`
 * acepta un perfil ajeno a propósito: las estadísticas son públicas entre
 * jugadores, es lo que da sentido al badge de pareja frecuente.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Avatar } from '../components/Avatar'
import * as api from '../lib/api'
import type { ProfileHistory } from '../game/state'
import s from './Perfil.module.css'

/**
 * "hoy", "ayer" o la fecha. Va con el reloj local a propósito: es una etiqueta
 * de día, no un umbral que el servidor vaya a revalidar, así que el desfase de
 * segundos que importa en la mesa aquí no cambia nada.
 */
function fechaRelativa(iso: string): string {
  const dia = new Date(iso)
  dia.setHours(0, 0, 0, 0)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const dias = Math.round((hoy.getTime() - dia.getTime()) / 86_400_000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
}

const porcentaje = (parte: number, total: number) =>
  total === 0 ? 0 : Math.round((parte / total) * 100)

function Estadisticas({ stats }: { stats: ProfileHistory['stats'] }) {
  const datos = [
    { label: 'Partidas', value: stats.matches_played, oro: false },
    { label: 'Ganadas', value: stats.matches_won, oro: true },
    // hands_won cuenta toda mano ganada, dominós y trancas: el label lo dice.
    { label: 'Manos ganadas', value: stats.hands_won, oro: false },
    { label: 'Trancas ganadas', value: stats.trancas_won, oro: false },
  ]

  return (
    <div className={s.stats}>
      {datos.map((d) => (
        <div className={s.stat} key={d.label}>
          <div className={s.statLabel}>{d.label}</div>
          <div className={`${s.statValue} ${d.oro ? s.statOro : ''}`}>{d.value}</div>
        </div>
      ))}
    </div>
  )
}

function Pareja({
  partner,
  onVer,
}: {
  partner: NonNullable<ProfileHistory['top_partner']>
  onVer: () => void
}) {
  return (
    <button className={s.pareja} onClick={onVer}>
      <Avatar name={partner.display_name} size={34} variant="gold" />
      <span className={s.parejaTexto}>
        <span className={s.parejaLabel}>
          {partner.is_frequent_pair ? 'Pareja frecuente' : 'Con quien más juegas'}
        </span>
        <span className={s.parejaNombre}>
          {partner.display_name} · {porcentaje(partner.won, partner.matches)}% ganadas
        </span>
      </span>
      <span className={s.parejaVeces}>{partner.matches}</span>
    </button>
  )
}

function Partidas({ matches }: { matches: ProfileHistory['matches'] }) {
  if (matches.length === 0) {
    return <div className={s.vacio}>Todavía no ha terminado ninguna partida.</div>
  }

  return (
    <div className={s.filas}>
      {matches.map((m) => (
        <div className={s.fila} key={m.id}>
          <span className={`${s.res} ${m.won ? s.gano : s.perdio}`}>{m.won ? 'Ganó' : 'Perdió'}</span>
          <span className={s.filaTexto}>
            <span className={s.conQuien}>{m.partner ? `Con ${m.partner}` : 'Sin pareja'}</span>
            <span className={s.nota}>Sala {m.room_code} · {fechaRelativa(m.finished_at)}</span>
          </span>
          <span className={s.marcador}>{m.score}</span>
        </div>
      ))}
    </div>
  )
}

export function Perfil() {
  const { profileId } = useParams<{ profileId?: string }>()
  const navigate = useNavigate()
  const { profile: yo } = useAuth()
  const [datos, setDatos] = useState<ProfileHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDatos(null)
    setError(null)
    api.getProfileHistory(profileId).then(
      (d) => { if (vivo) setDatos(d) },
      (e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer el historial') },
    )
    return () => { vivo = false }
  }, [profileId])

  const mio = !profileId || profileId === yo?.id
  const nombre = datos?.profile?.display_name ?? (mio ? yo?.display_name : null) ?? 'Jugador'

  return (
    <div className={s.screen}>
      <div className={s.top}>
        <button className={s.back} onClick={() => navigate('/')}>← Inicio</button>
        <span className={s.titulo}>Historial</span>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {!datos ? (
        !error && <div className={s.vacio}>Cargando el historial…</div>
      ) : (
        <>
          <div className={s.cabecera}>
            <Avatar name={nombre} size={56} variant="gold" />
            <div className={s.identidad}>
              <div className={s.nombre}>{nombre}</div>
              <div className={s.resumen}>
                {datos.stats.matches_played === 0
                  ? 'Todavía sin partidas terminadas'
                  : `${datos.stats.matches_played} partidas · ${porcentaje(datos.stats.matches_won, datos.stats.matches_played)}% ganadas`}
              </div>
            </div>
          </div>

          <Estadisticas stats={datos.stats} />

          {datos.top_partner && (
            <Pareja
              partner={datos.top_partner}
              onVer={() => navigate(`/perfil/${datos.top_partner!.profile_id}`)}
            />
          )}

          <div className={s.seccion}>
            <span className="label">Últimas partidas</span>
            <Partidas matches={datos.matches} />
          </div>
        </>
      )}
    </div>
  )
}
