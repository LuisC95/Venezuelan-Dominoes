import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useAccion } from '../hooks/useAccion'
import { Avatar } from '../components/Avatar'
import * as api from '../lib/api'
import type { RoomMember, Seat } from '../game/state'
import s from './Lobby.module.css'

const SEATS: Seat[] = [0, 1, 2, 3]

export function Lobby() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { state, status, error, refresh } = useRoom(code)
  const { busy, error: actionError, run } = useAccion(refresh)
  const seated = state?.me.seat ?? null
  // null mientras no hemos leído la sala; hace falta distinguirlo de 'lobby'.
  const estadoSala = state?.room.status ?? null

  // Al arrancar la partida se mueve todo el mundo: los sentados a la mesa, los
  // demás a la cola. Solo en la TRANSICIÓN lobby → playing: si redirigiéramos
  // mientras la partida está en curso, el botón "volver a la sala" de la mesa
  // rebotaría de vuelta y no habría forma de mirar los asientos.
  const estadoPrevio = useRef<string | null>(null)
  useEffect(() => {
    if (estadoSala === null) return
    const previo = estadoPrevio.current
    estadoPrevio.current = estadoSala
    if (previo !== 'lobby' || estadoSala !== 'playing') return
    navigate(seated !== null ? `/sala/${code}/mesa` : `/sala/${code}/cola`, { replace: true })
  }, [estadoSala, seated, code, navigate])

  const [copied, setCopied] = useState(false)

  if (status === 'joining') {
    return <div className={s.screen}><div className={s.empty}>Entrando a la sala…</div></div>
  }

  if (status === 'error' || !state) {
    return (
      <div className={s.screen}>
        <button className={s.back} onClick={() => navigate('/')}>← Inicio</button>
        <div className={s.error}>{error ?? 'No se pudo entrar a la sala'}</div>
      </div>
    )
  }

  const { room, me, members, queue } = state
  const bySeat = new Map(members.filter((m) => m.seat !== null).map((m) => [m.seat as Seat, m]))
  const observers = members.filter((m) => m.seat === null)
  const seatedCount = bySeat.size
  const inLobby = room.status === 'lobby'
  const iAmSeeking = observers.find((o) => o.profile_id === me.profile_id)?.seeking_partner ?? false

  function badgeOf(m: RoomMember) {
    if (m.queue_position !== null) return { text: 'En cola', cls: s.badgeQueue }
    if (m.seeking_partner) return { text: 'Suelto', cls: s.badgeLoose }
    return { text: 'Observando', cls: s.badgeWatch }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* sin portapapeles: el código está a la vista igual */
    }
  }

  return (
    <div className={s.screen}>
      <div className={s.top}>
        <button className={s.back} onClick={() => run(async () => {
          await api.leaveRoom(room.id)
          navigate('/')
        })}>← Salir</button>
        <button className={s.codeBox} onClick={copyCode}>
          <span className={s.codeLabel}>Código</span>
          <span className={s.code}>{room.code}</span>
          {copied && <span className={s.copied}>copiado</span>}
        </button>
      </div>

      {!inLobby && (
        <div className={s.banner}>
          <span className="label" style={{ color: 'var(--gold)' }}>Partida en curso</span>
          <span className={s.bannerText}>
            La mesa ya arrancó. Pide turno para entrar con una pareja cuando termine.
          </span>
          {room.current_match_id && (
            <div className={s.bannerBtns}>
              <button className={s.ghost} onClick={() => navigate(`/sala/${room.code}/mesa`)}>
                Ver la mesa
              </button>
              <button className={s.ghost} onClick={() => navigate(`/sala/${room.code}/cola`)}>
                Cola y turnos
              </button>
            </div>
          )}
        </div>
      )}

      <div className={s.section}>
        <div className={s.sectionHead}>
          <span className="label">Mesa · parejas cruzadas</span>
          <span className={s.count}>{seatedCount}/4</span>
        </div>
        <div className={s.seats}>
          {SEATS.map((seat) => {
            const m = bySeat.get(seat)
            const gold = seat % 2 === 0
            const mine = m?.profile_id === me.profile_id
            return (
              <button
                key={seat}
                className={[
                  s.seat,
                  gold ? s.seatGold : s.seatRed,
                  m ? '' : s.seatEmpty,
                  mine ? s.seatMine : '',
                ].join(' ')}
                disabled={busy || !inLobby || mine}
                onClick={() => run(() => api.takeSeat(room.id, seat))}
              >
                <span className={`${s.teamLabel} ${gold ? s.teamGold : s.teamRed}`}>
                  {gold ? 'Pareja 1' : 'Pareja 2'}
                </span>
                <span className={s.who}>
                  {m ? (
                    <>
                      <Avatar name={m.display_name} size={36} variant={gold ? 'gold' : 'red'} />
                      <span style={{ minWidth: 0 }}>
                        <span className={s.name}>{m.display_name}</span>
                        {!m.connected && <span className={s.offline}>sin señal</span>}
                      </span>
                    </>
                  ) : (
                    <span className={s.free}>{inLobby ? 'Sentarse aquí' : 'Libre'}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <span className="label">Observadores</span>
          <span className={s.count}>{members.length} en sala · máx {room.max_size}</span>
        </div>
        {observers.length === 0 ? (
          <div className={s.empty}>Nadie mirando todavía. Comparte el código.</div>
        ) : (
          <div className={s.rows}>
            {observers.map((o) => {
              const badge = badgeOf(o)
              // A un suelto se le puede proponer pareja si tú también estás suelto.
              const canPair = iAmSeeking && o.seeking_partner && o.profile_id !== me.profile_id
              return (
                <div key={o.profile_id} className={s.row}>
                  <span className={s.rowAvatar}>{o.display_name[0]?.toUpperCase()}</span>
                  <span className={s.rowName}>
                    {o.display_name}{o.profile_id === me.profile_id ? ' · tú' : ''}
                  </span>
                  {canPair ? (
                    <button
                      className={s.pairBtn}
                      disabled={busy}
                      onClick={() => run(() => api.pairWith(room.id, o.profile_id))}
                    >
                      Emparejarnos
                    </button>
                  ) : (
                    <span className={`${s.badge} ${badge.cls}`}>{badge.text}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className="label">Cola de parejas</span>
            <span className={s.count}>Gana y se queda</span>
          </div>
          <div className={s.rows}>
            {queue.map((q) => (
              <div key={q.team_id} className={s.row}>
                <span className={s.rowAvatar} style={{ fontFamily: 'var(--font-display)' }}>
                  {q.queue_position}
                </span>
                <span className={s.rowName}>
                  {q.players.map((p) => p.display_name).join(' & ')}
                </span>
                {q.mine && <span className={`${s.badge} ${s.badgeQueue}`}>Tu pareja</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {actionError && <div className={s.error}>{actionError}</div>}

      <div className={s.actions}>
        {me.seat === null && (
          iAmSeeking || queue.some((q) => q.mine) ? (
            <button className={`${s.ghost} ${s.ghostRed}`} disabled={busy}
              onClick={() => run(() => api.leaveQueue(room.id))}>
              Salir de la cola
            </button>
          ) : (
            <button className={s.ghost} disabled={busy}
              onClick={() => run(() => api.requestTurn(room.id))}>
              Pedir turno · entrar a la cola
            </button>
          )
        )}
        {me.is_host && inLobby && (
          <button className={s.cta} disabled={busy || seatedCount < 4}
            onClick={() => run(() => api.startMatch(room.id))}>
            {seatedCount < 4 ? `Faltan ${4 - seatedCount} para arrancar` : 'Iniciar partida'}
          </button>
        )}
      </div>
    </div>
  )
}
