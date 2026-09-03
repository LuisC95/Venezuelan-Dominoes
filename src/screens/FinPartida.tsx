/**
 * Fin de partida y rey de la cancha.
 *
 * La partida va en la URL y no en el estado de la sala a propósito:
 * `next_match` cambia el `current_match_id`, y leer de ahí haría que el
 * resumen se reemplazara por la partida nueva justo cuando lo estás leyendo.
 * Con el id en la ruta, además, recargar la pantalla sigue mostrando el
 * resultado correcto. Que el id de la sala ya no coincida con el de la ruta es,
 * de hecho, la señal de que arrancó la siguiente: ahí sacamos a todo el mundo.
 */
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useGameState } from '../hooks/useGameState'
import { useAccion } from '../hooks/useAccion'
import { Avatar } from '../components/Avatar'
import * as api from '../lib/api'
import { pairNames, teamIndexOf } from '../game/view'
import type { GameState } from '../game/state'
import s from './FinPartida.module.css'

function Estadisticas({ state }: { state: GameState }) {
  const st = state.match_stats
  const datos = [
    { label: 'Manos jugadas', value: st.hands_played },
    { label: 'Dominós', value: st.dominos },
    { label: 'Trancas', value: st.trancas },
    { label: 'Capicúas', value: st.capicuas },
  ]

  return (
    <div className={s.stats}>
      {datos.map((d) => (
        <div className={s.stat} key={d.label}>
          <div className={s.statLabel}>{d.label}</div>
          <div className={s.statValue}>{d.value}</div>
        </div>
      ))}
    </div>
  )
}

export function FinPartida() {
  const { code, matchId: enRuta } = useParams<{ code: string; matchId?: string }>()
  const navigate = useNavigate()
  const { state: room, status, refresh } = useRoom(code)
  const { busy, error: actionError, run } = useAccion(refresh)

  // Sin id en la ruta (alguien escribió la URL a mano) cae en la partida actual.
  const matchId = enRuta ?? room?.current_match_id ?? null
  const { state } = useGameState(matchId)

  // Arrancó la siguiente: los sentados a la mesa, el resto a la cola.
  const actual = room?.current_match_id ?? null
  const miAsiento = room?.me.seat ?? null
  useEffect(() => {
    if (!matchId || !actual || actual === matchId) return
    navigate(miAsiento !== null ? `/sala/${code}/mesa` : `/sala/${code}/cola`, { replace: true })
  }, [actual, matchId, miAsiento, code, navigate])

  if (status === 'joining' || !room || !state) {
    return <div className={s.screen}><div className={s.kind}>Cargando el resultado</div></div>
  }

  if (state.match.status !== 'finished') {
    return (
      <div className={s.screen}>
        <div className={s.kind}>La partida sigue</div>
        <div className={s.winner}>Todavía no hay resultado</div>
        <button className={s.ghost} onClick={() => navigate(`/sala/${code}/mesa`)}>Ir a la mesa</button>
      </div>
    )
  }

  const ganador = teamIndexOf(state, state.match.winner_team_id)
  const perdedor = ganador === null ? null : ganador === 0 ? 1 : 0
  const nombreGanador = ganador === null ? 'La mesa' : pairNames(state, ganador)
  const puntos = ganador === 0
    ? [state.match.score_a, state.match.score_b]
    : [state.match.score_b, state.match.score_a]
  const gane = ganador !== null && state.me.team_index === ganador
  const ganadores = state.seats.filter((p) => p.team_index === ganador)
  const hayCola = room.queue.length > 0

  return (
    <div className={s.screen}>
      <div className={s.rule}>
        <span className={s.ruleLine} />
        <span className={s.kind}>Fin de partida</span>
        <span className={s.ruleLine} />
      </div>

      <div className={s.avatares}>
        {ganadores.map((p) => (
          <Avatar key={p.seat} name={p.display_name} size={46} variant="gold" />
        ))}
      </div>

      <h1 className={s.winner}>{nombreGanador}</h1>
      <div className={s.score}>{puntos[0]} — {puntos[1]}</div>
      <p className={s.detail}>
        {gane
          ? 'Se quedan en la mesa. '
          : perdedor !== null && state.me.team_index === perdedor
            ? 'Salen de la mesa y vuelven al final de la cola. '
            : ''}
        {hayCola
          ? `Entra la primera pareja de la cola: ${room.queue[0].players.map((p) => p.display_name).join(' & ')}.`
          : 'No hay nadie esperando, así que la mesa sigue con los mismos.'}
      </p>

      <Estadisticas state={state} />

      {actionError && <div className={s.error}>{actionError}</div>}

      <div className={s.acciones}>
        {room.me.is_host ? (
          <button className={s.cta} disabled={busy} onClick={() => run(() => api.nextMatch(room.room.id))}>
            {hayCola ? 'Siguiente pareja' : 'Revancha'}
          </button>
        ) : (
          <div className={s.espera}>El anfitrión arranca la siguiente</div>
        )}
        <button className={s.ghost} onClick={() => navigate(`/sala/${code}`)}>Volver a la sala</button>
        <button className={s.enlace} onClick={() => navigate('/perfil')}>
          Ver historial y estadísticas
        </button>
      </div>
    </div>
  )
}
