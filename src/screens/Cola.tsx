/**
 * La sala vista desde fuera de la mesa: quién va ganando, quién espera turno y
 * con quién emparejarse. Es la pantalla en la que vive un observador mientras
 * la partida corre — el lobby solo tiene sentido antes de arrancar.
 */
import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useGameState } from '../hooks/useGameState'
import { Avatar } from '../components/Avatar'
import * as api from '../lib/api'
import { useAccion } from '../hooks/useAccion'
import { pairNames, teamLabels } from '../game/view'
import type { GameState, QueueEntry, RoomState } from '../game/state'
import s from './Cola.module.css'

function Marcador({ state, onVerMesa }: { state: GameState; onVerMesa: () => void }) {
  const [nombreA, nombreB] = teamLabels(state)
  const meta = state.room.points_target
  const equipos = [
    { name: nombreA, pts: state.match.score_a, color: 'var(--gold)' },
    { name: nombreB, pts: state.match.score_b, color: 'var(--red)' },
  ]

  return (
    <div className={s.marcador}>
      <div className={s.marcadorLabel}>
        Partida en curso · mano {state.hand?.hand_number ?? 1} · a {meta}
      </div>
      <div className={s.equipos}>
        {equipos.map((t) => (
          <div className={s.equipo} key={t.name}>
            <div className={s.equipoName} style={{ color: t.color }}>{t.name}</div>
            <div className={s.equipoPts}>{t.pts}</div>
            <div className={s.bar}>
              <div
                className={s.barFill}
                style={{ width: `${Math.min(100, Math.round((t.pts / meta) * 100))}%`, background: t.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <button className={s.verMesa} onClick={onVerMesa}>Ver la mesa</button>
    </div>
  )
}

/** El texto bajo cada pareja de la cola: qué tan cerca está de entrar. */
function notaDeCola(q: QueueEntry, index: number): string {
  const base = index === 0 ? 'Listos · entran al terminar' : `Esperan ${index} pareja${index > 1 ? 's' : ''}`
  return q.frequent_pair ? `${base} · pareja frecuente` : base
}

function Cola_({ queue, onSalir, busy }: { queue: QueueEntry[]; onSalir: () => void; busy: boolean }) {
  if (queue.length === 0) {
    return <div className={s.vacio}>Nadie espera turno. Si quieres jugar, pide el tuyo aquí abajo.</div>
  }

  return (
    <div className={s.filas}>
      {queue.map((q, i) => (
        <div key={q.team_id} className={`${s.fila} ${q.mine ? s.filaMia : ''}`}>
          <span className={`${s.pos} ${i === 0 ? s.posPrimera : ''}`}>{q.queue_position}</span>
          <span className={s.filaTexto}>
            <span className={s.pareja}>{q.players.map((p) => p.display_name).join(' & ')}</span>
            <span className={s.nota}>{notaDeCola(q, i)}</span>
          </span>
          {q.mine && (
            <button className={s.salirChip} disabled={busy} onClick={onSalir}>Salir</button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Los sueltos: quien está solo se ofrece, y otro suelto lo toma de pareja.
 * `pair_with` arma el equipo y los mete a la cola de una vez.
 */
function Sueltos({
  room,
  onEmparejar,
  busy,
}: {
  room: RoomState
  onEmparejar: (id: string) => void
  busy: boolean
}) {
  const sueltos = room.members.filter((m) => m.seeking_partner && m.queue_position === null)
  const yoSuelto = sueltos.some((m) => m.profile_id === room.me.profile_id)
  const otros = sueltos.filter((m) => m.profile_id !== room.me.profile_id)

  if (sueltos.length === 0) return null

  return (
    <div className={s.seccion}>
      <div className={s.seccionHead}>
        <span className="label">Sueltos</span>
        <span className={s.count}>{sueltos.length} sin pareja</span>
      </div>
      <div className={s.filas}>
        {otros.map((m) => (
          <div key={m.profile_id} className={s.fila}>
            <Avatar name={m.display_name} size={32} variant="neutral" />
            <span className={s.filaTexto}>
              <span className={s.pareja}>{m.display_name}</span>
              <span className={s.nota}>{m.connected ? 'Busca pareja' : 'Sin señal'}</span>
            </span>
            {yoSuelto ? (
              <button className={s.emparejar} disabled={busy} onClick={() => onEmparejar(m.profile_id)}>
                Emparejarnos
              </button>
            ) : (
              <span className={s.chip}>Suelto</span>
            )}
          </div>
        ))}
        {yoSuelto && (
          <div className={s.vacio}>
            {otros.length === 0
              ? 'Estás suelto. En cuanto se ofrezca alguien más, se arma la pareja.'
              : 'Toca "Emparejarnos" para armar pareja y entrar juntos a la cola.'}
          </div>
        )}
      </div>
    </div>
  )
}

export function Cola() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { state: room, status, error, refresh } = useRoom(code)
  const matchId = room?.current_match_id ?? null
  const { state } = useGameState(matchId)
  const { busy, error: actionError, run } = useAccion(refresh)

  // Si te sientan (rey de la cancha), te vas a la mesa sin tocar nada.
  const miAsiento = room?.me.seat ?? null
  const asientoPrevio = useRef<number | null>(null)
  useEffect(() => {
    if (miAsiento !== null && asientoPrevio.current === null) {
      navigate(`/sala/${code}/mesa`, { replace: true })
    }
    asientoPrevio.current = miAsiento
  }, [miAsiento, code, navigate])

  if (status === 'joining') {
    return <div className={s.screen}><div className={s.vacio}>Entrando a la sala…</div></div>
  }

  if (status === 'error' || !room) {
    return (
      <div className={s.screen}>
        <button className={s.back} onClick={() => navigate('/')}>← Inicio</button>
        <div className={s.error}>{error ?? 'No se pudo entrar a la sala'}</div>
      </div>
    )
  }

  const { queue, me } = room
  const enCola = queue.some((q) => q.mine)
  const yoSuelto = room.members.find((m) => m.profile_id === me.profile_id)?.seeking_partner ?? false
  const partidaTerminada = state?.match.status === 'finished'
  const ganador =
    partidaTerminada && state
      ? pairNames(state, state.match.winner_team_id === state.match.team_a_id ? 0 : 1)
      : null

  return (
    <div className={s.screen}>
      <div className={s.top}>
        <button className={s.back} onClick={() => navigate(`/sala/${code}`)}>← Sala {room.room.code}</button>
        <span className={`${s.estado} ${enCola ? s.estadoCola : ''}`}>
          {enCola ? 'En cola' : yoSuelto ? 'Suelto' : 'Observando'}
        </span>
      </div>

      {partidaTerminada ? (
        <div className={s.terminada}>
          <div className={s.marcadorLabel}>La partida terminó</div>
          <div className={s.terminadaNombre}>{ganador} gana</div>
          <button className={s.verMesa} onClick={() => navigate(`/sala/${code}/resultado/${matchId}`)}>
            Ver resultado
          </button>
        </div>
      ) : state ? (
        <Marcador state={state} onVerMesa={() => navigate(`/sala/${code}/mesa`)} />
      ) : (
        <div className={s.vacio}>Todavía no hay partida en la mesa.</div>
      )}

      <div className={s.seccion}>
        <div className={s.seccionHead}>
          <span className="label">Cola de parejas</span>
          <span className={s.count}>Gana y se queda</span>
        </div>
        <Cola_ queue={queue} busy={busy} onSalir={() => run(() => api.leaveQueue(room.room.id))} />
      </div>

      <Sueltos
        room={room}
        busy={busy}
        onEmparejar={(id) => run(() => api.pairWith(room.room.id, id))}
      />

      {actionError && <div className={s.error}>{actionError}</div>}

      <div className={s.pie}>
        <div className={s.pieTexto}>
          {enCola
            ? 'Entras cuando la pareja perdedora salga de la mesa.'
            : yoSuelto
              ? 'Estás anotado como suelto: te falta pareja para entrar a la cola.'
              : 'Pide turno para entrar cuando termine la partida.'}
        </div>
        {enCola || yoSuelto ? (
          <button className={s.salir} disabled={busy} onClick={() => run(() => api.leaveQueue(room.room.id))}>
            Salir de la cola
          </button>
        ) : (
          <button className={s.cta} disabled={busy} onClick={() => run(() => api.requestTurn(room.room.id))}>
            Pedir turno
          </button>
        )}
      </div>
    </div>
  )
}
