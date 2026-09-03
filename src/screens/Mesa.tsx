import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useGameState } from '../hooks/useGameState'
import { Ficha } from '../components/Ficha'
import { Avatar } from '../components/Avatar'
import * as api from '../lib/api'
import { isDouble, parseTile } from '../game/tiles'
import type { Side, Tile } from '../game/tiles'
import { boardTileSize, otherSeats, teamNames, trailingPasses } from '../game/view'
import type { GameState, HandEndType, TeamIndex } from '../game/state'
import s from './Mesa.module.css'

type ScoreCard = {
  name: string
  pts: number
  color: string
  teamId: string
  teamIndex: TeamIndex
}

function scoreCards(state: GameState): ScoreCard[] {
  const [nameA, nameB] = teamNames(state)
  const cards: ScoreCard[] = [
    { name: nameA, pts: state.match.score_a, color: 'var(--gold)', teamId: state.match.team_a_id, teamIndex: 0 },
    { name: nameB, pts: state.match.score_b, color: 'var(--red)', teamId: state.match.team_b_id, teamIndex: 1 },
  ]
  if (state.me.team_index === 1) cards.reverse()
  return cards
}

function teamNameFor(cards: ScoreCard[], teamId: string | null): string | null {
  return cards.find((t) => t.teamId === teamId)?.name ?? null
}

function endKind(endType: HandEndType | null, wasCapicua: boolean) {
  if (endType === 'tranca') return 'Tranca'
  if (endType === 'tranca_empate') return 'Tranca · empate'
  if (endType === 'anulada') return 'Mano anulada'
  return wasCapicua ? 'Capicúa' : 'Dominó'
}

function revealedPipsByTeam(state: GameState): Record<TeamIndex, number> {
  return state.revealed.reduce<Record<TeamIndex, number>>((acc, tile) => {
    const seat = state.seats[tile.seat]
    acc[seat.team_index] += tile.pips
    return acc
  }, { 0: 0, 1: 0 })
}

function finDeManoCopy(state: GameState, cards: ScoreCard[]) {
  const { hand } = state
  if (!hand) return { kind: 'Mano terminada', headline: 'La mano terminó', detail: '' }

  const winnerName = teamNameFor(cards, hand.winner_team_id)
  const winnerSeat =
    state.seats.find((p) => p.tiles_left === 0) ??
    state.seats[state.recent_moves.findLast((m) => m.move_type === 'play')?.seat ?? hand.starting_seat]

  if (hand.end_type === 'tranca_empate') {
    const pips = revealedPipsByTeam(state)
    return {
      kind: endKind(hand.end_type, hand.was_capicua),
      headline: 'Mano anulada',
      detail: `Empate exacto en la tranca: ${pips[0]} pips por lado. Se juega otra mano y la salida rota.`,
    }
  }

  if (hand.end_type === 'anulada') {
    return {
      kind: endKind(hand.end_type, hand.was_capicua),
      headline: 'Se reparte de nuevo',
      detail: 'El anfitrión cortó la mano por una desconexión. Esta mano no suma puntos y conserva la misma salida.',
    }
  }

  if (hand.end_type === 'tranca') {
    const pips = revealedPipsByTeam(state)
    const winner = winnerName ?? 'La pareja ganadora'
    const loser = cards.find((t) => t.teamId !== hand.winner_team_id)?.name ?? 'la contraria'
    return {
      kind: endKind(hand.end_type, hand.was_capicua),
      headline: `${winner} gana la mano`,
      detail: `Nadie pudo jugar. ${winner} tenía menos pips en mano y suma ${hand.points_awarded} de ${loser}: ${pips[0]} contra ${pips[1]}.`,
    }
  }

  const fin = `${winnerSeat.display_name ?? 'Alguien'} se quedó sin fichas`
  return {
    kind: endKind(hand.end_type, hand.was_capicua),
    headline: `${winnerName ?? 'La pareja ganadora'} gana la mano`,
    detail: hand.was_capicua
      ? `${fin} cerrando con capicúa. La pareja suma los pips de la contraria.`
      : `${fin}. La pareja suma los pips de la contraria.`,
  }
}

function MarcadorFin({ cards }: { cards: ScoreCard[] }) {
  return (
    <div className={s.finScores}>
      {cards.map((t) => (
        <div className={s.finScore} key={t.teamId} style={{ borderColor: t.teamIndex === 0 ? 'var(--line-gold)' : 'var(--line-red)' }}>
          <div className={s.finScoreName} style={{ color: t.color }}>{t.name}</div>
          <div className={s.finScorePts}>{t.pts}</div>
        </div>
      ))}
    </div>
  )
}

function FichasReveladas({ state }: { state: GameState }) {
  if (state.revealed.length === 0) return null

  return (
    <div className={s.revealed}>
      {state.seats.map((seat) => {
        const tiles = state.revealed.filter((t) => t.seat === seat.seat)
        const total = tiles.reduce((sum, tile) => sum + tile.pips, 0)
        return (
          <div className={s.revealedRow} key={seat.seat}>
            <span className={s.revealedName}>{seat.display_name}</span>
            <span className={s.revealedPips}>{total} pips</span>
          </div>
        )
      })}
    </div>
  )
}

function FinDeMano({
  state,
  roomCode,
  busy,
  onNext,
  onBack,
  onResult,
}: {
  state: GameState
  roomCode: string | undefined
  busy: boolean
  onNext: () => void
  onBack: () => void
  onResult: () => void
}) {
  const cards = scoreCards(state)
  const copy = finDeManoCopy(state, cards)
  const hand = state.hand!
  const partidaTerminada = state.match.status === 'finished'
  const nextLabel = partidaTerminada ? 'Ver resultado' : 'Siguiente mano'

  return (
    <div className={s.finScreen}>
      <button className={s.finBack} onClick={onBack}>← Sala {roomCode}</button>
      <div className={s.finKind}>{copy.kind}</div>
      <h1 className={s.finHeadline}>{copy.headline}</h1>
      <div className={s.finPoints}>
        <div className={s.finBigNumber}>{hand.points_awarded}</div>
        <div className={s.finPointsLabel}>puntos</div>
      </div>
      <MarcadorFin cards={cards} />
      <p className={s.finDetail}>{copy.detail}</p>
      <FichasReveladas state={state} />
      <button className={s.finBtn} disabled={busy} onClick={partidaTerminada ? onResult : onNext}>
        {nextLabel}
      </button>
    </div>
  )
}

export function Mesa() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { state: room, status: roomStatus } = useRoom(code)
  const matchId = room?.current_match_id ?? null
  const { state, loading, error, refresh } = useGameState(matchId)

  // Ficha que calza por las dos puntas: hay que preguntar por cuál.
  const [pending, setPending] = useState<Tile | null>(null)
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)

  useEffect(() => { setPending(null) }, [state?.hand?.move_count])

  if (roomStatus === 'joining' || (loading && !state)) {
    return <div className={s.screen}><div className={s.overlay}><div className={s.overlayTitle}>Cargando la mesa</div></div></div>
  }

  if (!room || !matchId || !state || !state.hand) {
    return (
      <div className={s.screen}>
        <div className={s.overlay}>
          <div className={s.overlayTitle}>No hay partida en curso</div>
          <div className={s.overlayText}>{error ?? 'Vuelve a la sala para arrancar una.'}</div>
          <button className={s.overlayBtn} onClick={() => navigate(`/sala/${code}`)}>Ir a la sala</button>
        </div>
      </div>
    )
  }

  const { hand, match, seats, me, board, my_hand: myHand } = state
  const target = state.room.points_target
  const iAmSeated = me.seat !== null
  const myTurn = me.is_turn
  const handOver = hand.status === 'finished'
  const scores = scoreCards(state)

  const meRow = me.seat !== null ? seats[me.seat] : null
  const others = otherSeats(me.seat, seats)
  const tileSize = boardTileSize(board.length)
  const passLine = trailingPasses(state.recent_moves, seats)

  async function play(tile: Tile, side?: Side) {
    setBusy(true)
    setPlayError(null)
    try {
      await api.playTile(hand!.id, tile, side)
      setPending(null)
      await refresh()
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : 'No se pudo jugar')
    } finally {
      setBusy(false)
    }
  }

  function tapTile(tile: Tile, sides: Side[]) {
    if (!myTurn || busy || sides.length === 0) return
    if (sides.length === 1) return play(tile, sides[0])
    setPending(pending === tile ? null : tile)
  }

  const turnLabel = handOver
    ? 'Mano terminada'
    : myTurn
      ? 'Tu turno · juega una ficha'
      : `Juega ${seats[hand.current_seat ?? 0]?.display_name ?? '…'}`

  async function startNext() {
    setBusy(true)
    setPlayError(null)
    try {
      await api.startNextHand(match.id)
      await refresh()
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  if (handOver) {
    return (
      <FinDeMano
        state={state}
        roomCode={code}
        busy={busy}
        onNext={startNext}
        onBack={() => navigate(`/sala/${code}`)}
        onResult={() => navigate(`/sala/${code}/resultado/${match.id}`)}
      />
    )
  }

  return (
    <div className={s.screen}>
      <div className={s.top}>
        <button className={s.back} onClick={() => navigate(`/sala/${code}`)}>←</button>
        <span
          className={`${s.conn} ${meRow && !meRow.connected ? s.connLost : s.connOk}`}
          title={meRow?.connected === false ? 'Sin señal' : 'Conectado'}
        />
        <div className={s.scores}>
          {scores.map((t) => (
            <div className={s.score} key={t.name}>
              <div className={s.scoreHead}>
                <span className={s.scoreName} style={{ color: t.color }}>{t.name}</span>
                <span className={s.scorePts}>{t.pts}</span>
              </div>
              <div className={s.bar}>
                <div
                  className={s.barFill}
                  style={{ width: `${Math.min(100, Math.round((t.pts / target) * 100))}%`, background: t.color }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className={s.handNo}>
          <span className={s.handNoLabel}>M</span>
          <span className={s.handNoValue}>{hand.hand_number}</span>
        </div>
      </div>

      <div className={s.middle}>
        <div className={s.rivals}>
          {others.map((p) => {
            const active = p.is_turn
            const isPartner = me.seat !== null && p.team_index === me.team_index
            return (
              <div key={p.seat} className={`${s.rival} ${active ? s.rivalActive : ''}`}>
                <Avatar name={p.display_name} size={34} variant={isPartner ? 'gold' : 'neutral'} />
                <span className={s.rivalName}>
                  {p.display_name}{isPartner ? ' · pareja' : ''}
                </span>
                <span className={`${s.rivalMeta} ${active ? s.rivalMetaActive : ''} ${!p.connected ? s.rivalOff : ''}`}>
                  {p.connected ? `${p.tiles_left} fichas` : 'sin señal'}
                </span>
              </div>
            )
          })}
        </div>

        <div className={s.felt}>
          {board.length === 0 ? (
            <div className={s.feltEmpty}>Mesa limpia</div>
          ) : (
            <div className={s.board}>
              <div className={s.boardInner}>
                {board.map((t) => (
                  <Ficha
                    key={t.position}
                    top={t.a}
                    bottom={t.b}
                    size={tileSize}
                    vertical={isDouble(t.tile)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className={s.ends}>
            Puntas {hand.left_end === null ? '—' : `${hand.left_end} · ${hand.right_end}`}
          </div>
          {passLine && <div className={s.passLine}>{passLine}</div>}
        </div>
      </div>

      <div className={s.bottom}>
        <div className={s.turnRow}>
          {meRow && <Avatar name={meRow.display_name} size={32} ring={myTurn ? 'var(--gold)' : 'rgba(242,234,216,.15)'} />}
          <span className={`${s.turnLabel} ${myTurn ? s.turnMine : ''}`}>{turnLabel}</span>
        </div>

        {playError && <div className={s.error}>{playError}</div>}

        {pending && (
          <div className={s.puntas}>
            <button className={s.punta} disabled={busy} onClick={() => play(pending, 'l')}>
              ◀ Punta {hand.left_end}
            </button>
            <button className={s.punta} disabled={busy} onClick={() => play(pending, 'r')}>
              Punta {hand.right_end} ▶
            </button>
            <button className={s.cancel} onClick={() => setPending(null)}>✕</button>
          </div>
        )}

        {iAmSeated ? (
          <div className={s.hand}>
            {myHand.map((t) => {
              const [a, b] = parseTile(t.tile)
              const playable = myTurn && t.sides.length > 0 && !handOver
              return (
                <button
                  key={t.tile}
                  className={[
                    s.tile,
                    pending === t.tile ? s.tileChosen : playable ? s.tilePlayable : s.tileDead,
                  ].join(' ')}
                  disabled={!playable || busy}
                  onClick={() => tapTile(t.tile, t.sides)}
                >
                  <Ficha top={a} bottom={b} size={104} vertical />
                </button>
              )
            })}
          </div>
        ) : (
          <div className={s.turnLabel} style={{ textAlign: 'center' }}>Estás observando</div>
        )}
      </div>
    </div>
  )
}
