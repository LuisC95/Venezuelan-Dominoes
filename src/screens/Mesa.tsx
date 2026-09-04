import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useGameState } from '../hooks/useGameState'
import { Ficha } from '../components/Ficha'
import { Avatar } from '../components/Avatar'
import { Chat } from '../components/Chat'
import * as api from '../lib/api'
import { vibrar } from '../lib/vibrar'
import { isDouble, parseTile } from '../game/tiles'
import type { Side, Tile } from '../game/tiles'
import { useLatido } from '../hooks/useLatido'
import { useTamano } from '../hooks/useTamano'
import { useMensajes } from '../hooks/useMensajes'
import {
  hacerSinSeñal, ladoDelAsiento, otherSeats, segundosSinSeñal, tamanoMano,
  tamanoTablero, teamNames, tenderCadena, trailingPasses,
} from '../game/view'
import type { Pieza } from '../game/view'
import { RelojTurno, SegundosTurno } from '../components/RelojTurno'
import { useColaDeJugadas } from '../hooks/useCadenaVisible'
import { useMano } from '../hooks/useMano'
import type { FichaMano } from '../hooks/useMano'
import type {
  BoardTile, GameState, HandEndType, HandTile, RecentMove, Seat, SeatInfo, TeamIndex,
} from '../game/state'
import s from './Mesa.module.css'

/** Los mismos 60s que exige void_hand en el servidor. */
const UMBRAL_ANULAR_S = 60
/*
 * Y un par de segundos de propina antes de ofrecer el botón.
 *
 * La cuenta de la pantalla se corrige con `desfase`, pero esa medida se toma en
 * un fetch y envejece; encima el reloj de la máquina se va yendo. Ofreciendo el
 * botón justo en el 60 se llegaba a pulsar con la cuenta unas décimas
 * adelantada y `void_hand` respondía "el jugador de turno sigue conectado": el
 * anfitrión veía un botón que no funcionaba. Dos segundos de espera de más se
 * notan mucho menos que eso. Ver la trampa 6 de AGENTS.md.
 *
 * Los segundos que se MUESTRAN no llevan margen: eso sería mentir.
 *
 * Un segundo, no dos: medido contra el servidor real, la deriva de este equipo
 * es de 2,1 ms/s (21ms entre refrescos) y la latencia p95 de 136ms, así que
 * hacen falta ~157ms. Como la cuenta va en segundos enteros, un tic es el
 * mínimo que se puede pedir y sobra de largo. Si algún día se toca el intervalo
 * de refresco de la espera, esta cuenta hay que rehacerla.
 */
const MARGEN_RELOJ_S = 1

/*
 * Medidas del acomodo de fichas. Viven aquí y se aplican en línea —no en el
 * CSS— porque el cálculo que garantiza que todo quepa sin scroll las necesita:
 * tenerlas en dos sitios sería tenerlas mal en uno de los dos.
 */
/** Hueco entre fichas del tablero. */
const HUECO_TABLERO = 3
/**
 * Margen alrededor de la cadena. Ya no es solo para que no toque el borde: los
 * badges de punta se montan a medias sobre la ficha del extremo y salen hacia
 * fuera, y este es el aire que tienen para hacerlo.
 */
const AIRE_TABLERO = 12
/** Hueco entre las fichas de tu mano. */
const HUECO_MANO = 8
/** Lo que el botón añade alrededor de cada ficha de la mano. */
const AIRE_MANO = 3
/** Tu mano no crece más que esto aunque sobre sitio. */
const FICHA_MANO_MAX = 104
/*
 * Lo que se le quita al paño por cada lado, ahora que los jugadores y el chat
 * van ENCIMA. Los de los costados salen gratis: la cadena corre por el lado
 * largo —el vertical— y el ancho no decide el tamaño de la ficha. Los de arriba
 * y abajo sí cuestan, y por eso son lo más justo posible.
 */
/** El chip de tu pareja, arriba al centro. */
const MARGEN_ARRIBA = 62
/** La fila de emotes del chat, abajo. */
const MARGEN_ABAJO = 44
/** Los chips de los dos rivales, a los costados. */
const MARGEN_LADOS = 56

/* Referencias estables: van en las dependencias de los hooks de la mano y del
   tablero, y un `[]` nuevo en cada render los dispararía sin parar. */
const SIN_FICHAS: BoardTile[] = []
const SIN_MANO: HandTile[] = []
const SIN_JUGADAS: RecentMove[] = []

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

/**
 * Se cayó NUESTRA conexión. Puerto del overlay del prototipo: no hay nada que
 * decidir aquí, solo tranquilizar — la mano y el turno viven en el servidor, así
 * que volver a tener señal es un fetch y nada más.
 */
/**
 * Uno de los otros tres, en su lado de la mesa: la pareja al frente y los
 * rivales a los costados. Van ENCIMA del paño, así que el chip es compacto —
 * cada píxel que ocupe se lo quita a la cadena.
 */
function Jugador({
  p,
  esPareja,
  caido,
  destacado,
  paso,
  turno,
  desfase,
}: {
  p: SeatInfo
  esPareja: boolean
  caido: boolean
  /** Acaba de poner una ficha: el chip destella para que se sepa de quién fue. */
  destacado: boolean
  /** Le acaba de tocar pasar. */
  paso: boolean
  /** `turn_started_at` si tiene el turno; null si no. */
  turno: string | null
  desfase: number
}) {
  return (
    <div className={[
      s.rival,
      p.is_turn ? s.rivalActive : '',
      destacado ? s.rivalJugo : '',
      paso ? s.rivalPaso : '',
    ].join(' ')}>
      <div className={s.rivalCara}>
        <Avatar name={p.display_name} size={30} variant={esPareja ? 'gold' : 'neutral'} />
        {turno && <RelojTurno desde={turno} desfase={desfase} size={30} />}
      </div>
      <span className={s.rivalName}>{p.display_name}</span>
      {/* En el chip no cabe "· bot" al lado del nombre, pero saber quién es
          máquina importa: va como etiqueta propia. */}
      {p.is_bot && <span className={s.rivalBot}>bot</span>}
      <span className={`${s.rivalMeta} ${p.is_turn ? s.rivalMetaActive : ''} ${caido ? s.rivalOff : ''}`}>
        {caido ? 'sin señal' : p.tiles_left}
      </span>
      {paso && <span className={s.cartelPaso}>pasó</span>}
    </div>
  )
}

function Reconectando({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className={s.overlay}>
      <div className={s.spinner} />
      <div className={s.overlayTitle}>Reconectando</div>
      <div className={s.overlayText}>
        Tu mano y el turno quedan guardados. Volvemos a la mesa en cuanto haya señal.
      </div>
      <button className={s.overlayGhost} onClick={onReintentar}>Reintentar ahora</button>
    </div>
  )
}

/**
 * Se cayó la conexión de QUIEN TIENE EL TURNO. La mesa espera indefinidamente:
 * nadie juega por otro (decisión explícita del usuario). Pasados 60s el
 * anfitrión puede anular la mano — el mismo umbral que exige `void_hand`, así
 * que el botón no aparece antes de que el servidor vaya a aceptarlo.
 *
 * En `compacto` es la misma cuenta metida en una línea sobre el tablero: la
 * espera puede durar lo que sea y tapar la pantalla entera todo ese rato no
 * ayuda, pero el anfitrión tiene que poder anular sin volver al overlay.
 */
function EsperandoJugador({
  jugador,
  esAnfitrion,
  busy,
  compacto,
  desfase,
  onAnular,
  onVerMesa,
  onVerAviso,
}: {
  jugador: SeatInfo
  esAnfitrion: boolean
  busy: boolean
  compacto: boolean
  /** Lo que le lleva el reloj del servidor a este dispositivo, en ms. */
  desfase: number
  onAnular: () => void
  onVerMesa: () => void
  onVerAviso: () => void
}) {
  const ahora = useLatido(true)
  const segundos = segundosSinSeñal(jugador.last_seen_at, ahora + desfase)
  const restan = segundos === null ? null : Math.max(0, UMBRAL_ANULAR_S - segundos)
  const sePuedeAnular = segundos !== null && segundos >= UMBRAL_ANULAR_S + MARGEN_RELOJ_S
  const quien = jugador.display_name ?? 'El de turno'

  if (compacto) {
    return (
      <div className={s.espera}>
        <span className={s.esperaTexto}>
          Sin señal · {quien} · {segundos ?? '—'} s
        </span>
        {esAnfitrion && sePuedeAnular ? (
          <button className={s.esperaBtn} disabled={busy} onClick={onAnular}>Anular la mano</button>
        ) : (
          <button className={s.esperaBtn} onClick={onVerAviso}>Ver aviso</button>
        )}
      </div>
    )
  }

  return (
    <div className={s.overlay}>
      <div className={s.overlayTitle}>Sin señal</div>
      <div className={s.bigNumber}>{segundos === null ? '—' : segundos}</div>
      <div className={s.overlayText}>
        {quien} lleva {segundos ?? '—'} segundos sin conectarse.
        La mesa lo espera: nadie juega por otro.
      </div>
      {esAnfitrion ? (
        sePuedeAnular ? (
          <button className={s.overlayBtn} disabled={busy} onClick={onAnular}>
            Anular la mano
          </button>
        ) : (
          <div className={s.overlayNote}>Podrás anular la mano en {restan} s</div>
        )
      ) : (
        <div className={s.overlayNote}>El anfitrión puede anular la mano al minuto</div>
      )}
      <button className={s.overlayGhost} onClick={onVerMesa}>Ver la mesa</button>
    </div>
  )
}

/**
 * Por dónde queda libre el extremo de la cadena en esa ficha. Es el lado por el
 * que la cadena habría seguido si hubiera más fichas.
 */
function bordeLibre(p: Pieza, cual: 'entrada' | 'salida') {
  const haciaDelante = cual === 'salida'
  // `sentido` es hacia dónde caminó el tendido; la entrada mira al revés.
  const s = haciaDelante ? p.sentido : ({
    abajo: 'arriba', arriba: 'abajo', izquierda: 'derecha', derecha: 'izquierda',
  } as const)[p.sentido]
  return s
}

/**
 * La cadena en el paño.
 *
 * Cada ficha va colocada por su coordenada, no por `flex-wrap`. La salida ancla
 * el centro y de ahí salen dos brazos; cuando uno llega al borde, dobla y sigue
 * en paralelo. Todo eso lo decide `tenderCadena`; aquí solo se pinta.
 */
function Tablero({
  board,
  visibles,
  piezas,
  caja,
  tileSize,
  entrando,
  autor,
  ladoEntrada,
  puntaViva,
}: {
  board: BoardTile[]
  visibles: BoardTile[]
  piezas: Pieza[]
  caja: { ancho: number; alto: number }
  tileSize: number
  /** `position` de la ficha recién puesta, si hay una entrando. */
  entrando: number | null
  autor: string | null
  ladoEntrada: 'abajo' | 'izquierda' | 'arriba' | 'derecha'
  /** Qué punta resaltar: la que el jugador está a punto de elegir, o las dos. */
  puntaViva: Side | 'ambas' | null
}) {
  /*
   * Las puntas se leen de lo que se está VIENDO, no de `hand.left_end`:
   * mientras se reproduce una ráfaga de bots el tablero va unas fichas por
   * detrás, y el número del badge tiene que ser el de la ficha que se ve.
   *
   * Lo visible es siempre un tramo seguido de la cadena —crece por los dos
   * extremos desde la salida—, así que basta con dónde empieza y dónde acaba.
   */
  const desde = board.indexOf(visibles[0])
  const hasta = desde + visibles.length - 1

  return (
    <div className={s.board} data-tablero style={{ padding: AIRE_TABLERO }}>
      <div className={s.boardInner} style={{ width: caja.ancho, height: caja.alto }}>
        {piezas.map((p) => {
          if (p.i < desde || p.i > hasta) return null
          const t = board[p.i]
          const [top, bottom] = p.espejo ? [t.b, t.a] : [t.a, t.b]
          const punta: Side | null = p.i === desde ? 'l' : p.i === hasta ? 'r' : null
          const viva = punta !== null && (puntaViva === 'ambas' || puntaViva === punta)
          const entra = t.position === entrando

          return (
            <div
              key={t.position}
              className={[
                s.pieza,
                punta ? s.piezaPunta : '',
                viva ? s.piezaViva : '',
                entra ? s.piezaEntra : '',
              ].join(' ')}
              data-tramo={p.tramo}
              data-dir={p.sentido}
              data-esquina={p.esquina ? '1' : undefined}
              data-punta={punta ?? undefined}
              data-lado={entra ? ladoEntrada : undefined}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.ancho, height: p.alto }}
            >
              {/* El cuerpo va aparte porque la animación de entrada es un
                  `transform`, y el del envoltorio es lo que la coloca en el
                  paño: en el mismo elemento, la entrada la mandaría al origen. */}
              <div className={s.piezaCuerpo}>
                <Ficha top={top} bottom={bottom} size={tileSize} vertical={p.vertical} />
              </div>
              {punta && (
                <span
                  className={`${s.puntaBadge} ${s['punta_' + bordeLibre(p, punta === 'l' ? 'entrada' : 'salida')]}`}
                >
                  {punta === 'l' ? `${visibles[0].a}` : `${visibles[visibles.length - 1].b}`}
                </span>
              )}
              {entra && autor && <span className={s.autor}>{autor}</span>}
            </div>
          )
        })}
      </div>
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

/** Cuánto hay que arrastrar para que deje de ser un toque y pase a ser mover. */
const UMBRAL_ARRASTRE = 8
/** Cuánto hay que mantener pulsado, sin moverse, para voltear la ficha. */
const PULSACION_LARGA_MS = 450

type Arrastre = { desde: number; hasta: number; dx: number }

/**
 * Tu mano, con los tres gestos.
 *
 * | toque corto            | jugar   |
 * | pulsar y mover (>8px)  | ordenar |
 * | mantener pulsado 450ms | voltear |
 *
 * El volteo se lleva la pulsación larga porque los otros dos gestos ya estaban
 * cogidos, y así no hace falta un "modo ordenar" que separe las dos cosas.
 *
 * Ordenar y voltear funcionan **también cuando no es tu turno** —es cuando más
 * falta hace, mientras esperas—, y ahí las fichas van `disabled`, que mata los
 * eventos de puntero. Por eso el botón lleva `pointer-events: none` y los gestos
 * viven en el envoltorio: el `disabled` se queda donde tiene que estar, para el
 * teclado y para quien lea el DOM.
 */
function ManoPropia({
  fichas,
  size,
  medir,
  puedeJugar,
  onJugar,
  onVoltear,
  onMover,
}: {
  fichas: FichaMano[]
  size: number
  medir: (el: HTMLDivElement | null) => void
  puedeJugar: boolean
  onJugar: (tile: Tile, sides: Side[]) => void
  onVoltear: (tile: Tile) => void
  onMover: (desde: number, hasta: number) => void
}) {
  const [arrastre, setArrastre] = useState<Arrastre | null>(null)
  // El gesto en curso. Va en un ref porque cambia en cada `pointermove` y
  // re-renderizar la mano entera a 60fps por eso no tiene sentido.
  const gesto = useRef<
    { x: number; y: number; desde: number; hasta: number; movido: boolean; volteada: boolean } | null
  >(null)
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Todas las fichas de la mano miden lo mismo, así que el paso de una posición
  // a la siguiente es una constante y no hay que medir el DOM para saber sobre
  // cuál estás soltando.
  const paso = Math.round(size / 2) + AIRE_MANO * 2 + HUECO_MANO

  function soltar() {
    if (reloj.current) { clearTimeout(reloj.current); reloj.current = null }
    gesto.current = null
  }

  function alBajar(e: React.PointerEvent<HTMLDivElement>, i: number, tile: Tile) {
    // Capturar el puntero es lo que deja seguir arrastrando cuando el dedo se
    // sale de la ficha. jsdom no lo implementa y no pasa nada: es una mejora
    // del arrastre, no un requisito.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesto.current = { x: e.clientX, y: e.clientY, desde: i, hasta: i, movido: false, volteada: false }
    reloj.current = setTimeout(() => {
      if (!gesto.current || gesto.current.movido) return
      gesto.current.volteada = true
      onVoltear(tile)
    }, PULSACION_LARGA_MS)
  }

  function alMover(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesto.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.movido) {
      if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return
      // Ya es un arrastre: lo que fuera a pasar por quedarse quieto, no pasa.
      g.movido = true
      if (reloj.current) { clearTimeout(reloj.current); reloj.current = null }
    }
    const salto = Math.round(dx / paso)
    g.hasta = Math.min(fichas.length - 1, Math.max(0, g.desde + salto))
    setArrastre({ desde: g.desde, hasta: g.hasta, dx })
  }

  function alSubir(tile: Tile, sides: Side[]) {
    const g = gesto.current
    soltar()
    if (!g) return
    if (g.movido) {
      // Del ref, no del estado: soltar enseguida después de mover ejecuta las
      // dos cosas en el mismo tick y el estado todavía no se ha enterado.
      onMover(g.desde, g.hasta)
      setArrastre(null)
      return
    }
    // Ni se movió ni llegó a voltearse: fue un toque, y un toque es jugar.
    if (!g.volteada && puedeJugar) onJugar(tile, sides)
  }

  return (
    <div className={s.hand} data-mano ref={medir} style={{ gap: HUECO_MANO }}>
      {fichas.map((t, i) => {
        const [a, b] = parseTile(t.tile)
        const playable = puedeJugar && t.sides.length > 0
        // Mientras arrastras, las que quedan entre el origen y el destino se
        // corren un puesto para dejarle el hueco a la vista.
        let corrimiento = 0
        if (arrastre && i !== arrastre.desde) {
          if (arrastre.desde < i && i <= arrastre.hasta) corrimiento = -paso
          else if (arrastre.hasta <= i && i < arrastre.desde) corrimiento = paso
        }
        const arrastrada = arrastre?.desde === i

        return (
          <div
            key={t.tile}
            className={`${s.slot} ${arrastrada ? s.slotArrastrada : ''}`}
            onPointerDown={(e) => alBajar(e, i, t.tile)}
            onPointerMove={alMover}
            onPointerUp={() => alSubir(t.tile, t.sides)}
            onPointerCancel={() => { soltar(); setArrastre(null) }}
            style={{
              transform: `translateX(${arrastrada ? arrastre.dx : corrimiento}px)`,
              zIndex: arrastrada ? 2 : 1,
            }}
          >
            <button
              className={[s.tile, playable ? s.tilePlayable : s.tileDead].join(' ')}
              style={{ padding: AIRE_MANO }}
              disabled={!playable}
              onClick={() => onJugar(t.tile, t.sides)}
            >
              <Ficha
                top={t.volteada ? b : a}
                bottom={t.volteada ? a : b}
                size={size}
                vertical
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function Mesa() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { state: room, status: roomStatus, conexion, presentes, pulso } = useRoom(code)
  const matchId = room?.current_match_id ?? null
  const { state, loading, error, refresh, desfase } = useGameState(matchId)
  const chat = useMensajes(room?.room.id, pulso)

  // Ficha que calza por las dos puntas: hay que preguntar por cuál.
  const [pending, setPending] = useState<Tile | null>(null)
  // La punta que el jugador está a punto de elegir, para que parpadee en el
  // tablero: el rótulo "Punta 3" no dice cuál de las dos es hasta que se ve.
  const [puntaResaltada, setPuntaResaltada] = useState<Side | null>(null)
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  // Mirar el tablero mientras se espera a alguien sin señal: la espera puede ser
  // larga y bloquear la pantalla entera no ayuda a nadie.
  const [espiando, setEspiando] = useState(false)
  const [medirTablero, cajaTablero] = useTamano<HTMLDivElement>()
  const [medirMano, cajaMano] = useTamano<HTMLDivElement>()

  const cadena = useColaDeJugadas(
    state?.hand?.id ?? null, state?.board ?? SIN_FICHAS, state?.recent_moves ?? SIN_JUGADAS,
  )
  const ultimaJugada = cadena.ultima
  const mano = useMano(state?.hand?.id ?? null, state?.my_hand ?? SIN_MANO)

  useEffect(() => {
    setPending(null)
    setPuntaResaltada(null)
    setEspiando(false)
  }, [state?.hand?.move_count])

  /*
   * Mientras se espera a alguien sin señal, la mesa se queda sin noticias:
   * `heartbeat` es un update pelado que no avisa por el canal, así que ni un
   * evento entra en todo ese minuto. Eso tenía dos consecuencias malas:
   *
   * - si el jugador vuelve, la mesa no se entera y lo sigue dando por caído;
   * - la cuenta de segundos corre contra el `desfase` medido en el último
   *   fetch, cada vez más viejo. Medido aquí: el botón de anular llegó a
   *   ofrecerse con la cuenta 0,9s ADELANTADA, y `void_hand` lo rechazaba con
   *   "el jugador de turno sigue conectado". Es la trampa 6 otra vez, ahora por
   *   antigüedad de la medida en vez de por usar el reloj del navegador.
   *
   * Releer cada 10s arregla las dos: es el patrón de siempre —el cliente
   * vuelve a pedir el estado— y de paso vuelve a medir el desfase.
   */
  const esperandoSinSeñal =
    state?.hand?.status === 'active'
    && state.hand.current_seat !== null
    && state.hand.current_seat !== state.me.seat
    && !state.seats[state.hand.current_seat].connected

  /*
   * El pase es automático y hasta ahora no se notaba: te saltaban y te
   * enterabas por una línea de texto en una esquina. Ahora vibra.
   *
   * `navigator.vibrate` NO existe en iPhone, así que en iPhone lo único que
   * queda es el cartel — por eso el cartel no es opcional.
   */
  const pasoPropio = ultimaJugada?.tipo === 'pass' && ultimaJugada.seat === state?.me.seat
  useEffect(() => {
    if (pasoPropio) vibrar(120)
  }, [pasoPropio])

  useEffect(() => {
    if (!esperandoSinSeñal) return
    const cada = setInterval(() => { refresh() }, 10000)
    return () => clearInterval(cada)
  }, [esperandoSinSeñal, refresh])

  if (roomStatus === 'joining' || (loading && !state)) {
    return (
      <div className={s.screen}>
        {conexion.perdida ? (
          <Reconectando onReintentar={conexion.reintentar} />
        ) : (
          <div className={s.overlay}><div className={s.overlayTitle}>Cargando la mesa</div></div>
        )}
      </div>
    )
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
  // De izquierda a derecha vistos desde tu silla: el que juega después de ti
  // queda a tu izquierda (el turno gira en sentido horario), tu pareja al
  // frente, y el que juega antes a tu derecha.
  const [aLaIzquierda, pareja, aLaDerecha] = otherSeats(me.seat, seats)
  const passLine = trailingPasses(state.recent_moves, seats)

  // El tamaño sale de lo que mide el tablero, no de una fórmula por número de
  // fichas: es la única forma de garantizar que la cadena entera se vea sin
  // scroll cuando el hueco cambia (se abre el chat, entra un aviso, gira el
  // teléfono). Mientras no haya medida se usa la estimación de siempre.
  const dobles = board.map((t) => isDouble(t.tile))
  // La ficha de salida ancla el centro. Es la del `board_position` 0: el resto
  // crece hacia los dos lados desde ella.
  const iSalida = Math.max(0, board.findIndex((t) => t.position === 0))
  /*
   * La caja donde se tiende la cadena se mete hacia dentro lo que ocupan los
   * chips de los jugadores, que ahora van ENCIMA del paño: así la cadena no
   * pasa por debajo de una cara.
   */
  const cajaCadena = {
    ancho: Math.max(1, cajaTablero.ancho - AIRE_TABLERO * 2 - MARGEN_LADOS * 2),
    alto: Math.max(1, cajaTablero.alto - AIRE_TABLERO * 2 - MARGEN_ARRIBA - MARGEN_ABAJO),
  }
  const tileSize = tamanoTablero(dobles, iSalida, cajaCadena, HUECO_TABLERO)
  /*
   * El acomodo se calcula sobre el tablero ENTERO, no sobre lo que ya se ve.
   * Mientras se reproduce una ráfaga de bots eso deja las fichas ya puestas
   * quietas en su sitio; si se recalculara con cada revelado, la cadena entera
   * se reacomodaría tres veces seguidas y quedaría temblando.
   */
  const acomodo = tenderCadena(dobles, iSalida, tileSize, cajaCadena, HUECO_TABLERO)
  const manoSize = tamanoMano(myHand.length, cajaMano.ancho, HUECO_MANO, AIRE_MANO, FICHA_MANO_MAX)

  const puso = cadena.ultima?.tipo === 'play' ? cadena.ultima : null
  const jugoAhora = puso?.seat ?? null
  const ladoEntrada = ladoDelAsiento(me.seat, puso?.seat ?? 0)
  const autorEntrada = puso ? seats[puso.seat]?.display_name ?? null : null
  const pasoDe = (asiento: Seat) => cadena.ultima?.tipo === 'pass' && cadena.ultima.seat === asiento
  // El que juega justo después de ti. Que ÉL pase es mérito tuyo: le dejaste
  // dos puntas que no tiene.
  const elQueSigue = me.seat === null ? null : (((me.seat + 1) % 4) as Seat)
  const ahogaste = elQueSigue !== null && pasoDe(elQueSigue)

  const sinSeñal = hacerSinSeñal(presentes, me.profile_id)
  const enTurno = hand.current_seat !== null ? seats[hand.current_seat] : null
  // Solo se espera a OTRO: si el que no tiene señal fuera yo, no estaría viendo
  // esto, y el overlay que toca es el de reconectando.
  const esperandoA =
    !handOver && enTurno && enTurno.seat !== me.seat && sinSeñal(enTurno) ? enTurno : null

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

  async function anular() {
    setBusy(true)
    setPlayError(null)
    try {
      await api.voidHand(hand!.id)
      await refresh()
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : 'No se pudo anular la mano')
    } finally {
      setBusy(false)
    }
  }

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
    <div className={`${s.screen} ${ahogaste ? s.ahogaste : ''}`}>
      {/* Ahogaste al que juega después de ti: no tenía ninguna de las dos
          puntas. Es una buena noticia, así que se celebra en verde y sin
          vibrar — vibrar es para lo que te pasa a ti. */}
      {ahogaste && <div className={s.verde} aria-hidden />}
      <div className={s.top}>
        <button className={s.back} onClick={() => navigate(`/sala/${code}`)}>←</button>
        <span
          className={`${s.conn} ${conexion.perdida || (meRow && !meRow.connected) ? s.connLost : s.connOk}`}
          title={conexion.perdida || meRow?.connected === false ? 'Sin señal' : 'Conectado'}
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
        {esperandoA && espiando && (
          <EsperandoJugador
            jugador={esperandoA}
            esAnfitrion={me.is_host}
            busy={busy}
            compacto
            desfase={desfase}
            onAnular={anular}
            onVerMesa={() => setEspiando(true)}
            onVerAviso={() => setEspiando(false)}
          />
        )}

        {/*
          * El paño se queda con la pantalla entera. Los tres jugadores van
          * ENCIMA, pegados a sus bordes —la pareja al frente, los rivales a los
          * costados, como antes— y el chat flota en una esquina. Tenerlos al
          * lado costaba ~104px de ancho y una franja de alto, que es justo lo
          * que ahogaba la cadena.
          */}
        <div className={s.felt} ref={medirTablero}>
          {cadena.visibles.length === 0 ? (
            <div className={s.feltEmpty}>Mesa limpia</div>
          ) : (
            <Tablero
              board={board}
              visibles={cadena.visibles}
              piezas={acomodo.piezas}
              caja={{ ancho: acomodo.ancho, alto: acomodo.alto }}
              tileSize={tileSize}
              entrando={puso?.position ?? null}
              autor={autorEntrada}
              ladoEntrada={ladoEntrada}
              puntaViva={puntaResaltada ?? (pending ? 'ambas' : null)}
            />
          )}

          <div className={s.arriba}>
            <Jugador
              p={pareja}
              esPareja
              caido={sinSeñal(pareja)}
              destacado={jugoAhora === pareja.seat}
              paso={pasoDe(pareja.seat)}
              turno={hand.current_seat === pareja.seat ? hand.turn_started_at : null}
              desfase={desfase}
            />
          </div>
          <div className={`${s.lado} ${s.ladoIzq}`}>
            <Jugador
              p={aLaIzquierda}
              esPareja={false}
              caido={sinSeñal(aLaIzquierda)}
              destacado={jugoAhora === aLaIzquierda.seat}
              paso={pasoDe(aLaIzquierda.seat)}
              turno={hand.current_seat === aLaIzquierda.seat ? hand.turn_started_at : null}
              desfase={desfase}
            />
          </div>
          <div className={`${s.lado} ${s.ladoDer}`}>
            <Jugador
              p={aLaDerecha}
              esPareja={false}
              caido={sinSeñal(aLaDerecha)}
              destacado={jugoAhora === aLaDerecha.seat}
              paso={pasoDe(aLaDerecha.seat)}
              turno={hand.current_seat === aLaDerecha.seat ? hand.turn_started_at : null}
              desfase={desfase}
            />
          </div>

          <div className={s.ends}>
            Puntas {hand.left_end === null ? '—' : `${hand.left_end} · ${hand.right_end}`}
          </div>
          {passLine && <div className={s.passLine}>{passLine}</div>}

          <div className={s.chatFlotante}>
            <Chat
              mensajes={chat.mensajes}
              desfase={chat.desfase}
              error={chat.error}
              enviando={chat.enviando}
              onEnviar={chat.enviar}
            />
          </div>
        </div>
      </div>

      <div className={s.bottom}>
        <div className={`${s.turnRow} ${jugoAhora === me.seat ? s.turnRowJugo : ''}`}>
          {meRow && (
            <div className={s.miCara}>
              <Avatar name={meRow.display_name} size={32} ring={myTurn ? 'var(--gold)' : 'rgba(242,234,216,.15)'} />
              {myTurn && <RelojTurno desde={hand.turn_started_at} desfase={desfase} size={32} />}
            </div>
          )}
          <span className={`${s.turnLabel} ${myTurn ? s.turnMine : ''}`}>
            {turnLabel}
            {!handOver && hand.current_seat !== null && (
              <span className={s.turnSegundos}>
                <SegundosTurno desde={hand.turn_started_at} desfase={desfase} />
              </span>
            )}
          </span>
        </div>

        {pasoPropio && <div className={s.pasaste}>Te tocó pasar</div>}
        {playError && <div className={s.error}>{playError}</div>}

        {pending && (
          <div className={s.puntas}>
            <button
              className={`${s.punta} ${puntaResaltada === 'l' ? s.puntaViva : ''}`}
              disabled={busy}
              onClick={() => play(pending, 'l')}
              onPointerEnter={() => setPuntaResaltada('l')}
              onPointerDown={() => setPuntaResaltada('l')}
              onPointerLeave={() => setPuntaResaltada(null)}
              onFocus={() => setPuntaResaltada('l')}
              onBlur={() => setPuntaResaltada(null)}
            >
              ◀ Punta {hand.left_end}
            </button>
            <button
              className={`${s.punta} ${puntaResaltada === 'r' ? s.puntaViva : ''}`}
              disabled={busy}
              onClick={() => play(pending, 'r')}
              onPointerEnter={() => setPuntaResaltada('r')}
              onPointerDown={() => setPuntaResaltada('r')}
              onPointerLeave={() => setPuntaResaltada(null)}
              onFocus={() => setPuntaResaltada('r')}
              onBlur={() => setPuntaResaltada(null)}
            >
              Punta {hand.right_end} ▶
            </button>
            <button className={s.cancel} onClick={() => setPending(null)}>✕</button>
          </div>
        )}

        {iAmSeated ? (
          <ManoPropia
            fichas={mano.fichas}
            size={manoSize}
            medir={medirMano}
            puedeJugar={myTurn && !busy && !handOver}
            onJugar={tapTile}
            onVoltear={mano.voltear}
            onMover={mano.mover}
          />
        ) : (
          <div className={s.turnLabel} style={{ textAlign: 'center' }}>Estás observando</div>
        )}
      </div>

      {/* Nuestra propia caída manda: si no hay red, lo de los demás no se sabe. */}
      {conexion.perdida ? (
        <Reconectando onReintentar={conexion.reintentar} />
      ) : esperandoA && !espiando ? (
        <EsperandoJugador
          jugador={esperandoA}
          esAnfitrion={me.is_host}
          busy={busy}
          compacto={false}
          desfase={desfase}
          onAnular={anular}
          onVerMesa={() => setEspiando(true)}
          onVerAviso={() => setEspiando(false)}
        />
      ) : null}
    </div>
  )
}
