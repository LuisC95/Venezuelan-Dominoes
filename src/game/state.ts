/** Formas exactas que devuelven get_game_state() y get_room_state(). */
import type { Pip, Side, Tile } from './tiles'

export type Seat = 0 | 1 | 2 | 3
/** 0 = pareja de los asientos 0 y 2; 1 = pareja de los asientos 1 y 3. */
export type TeamIndex = 0 | 1

export type HandEndType = 'domino' | 'tranca' | 'tranca_empate' | 'anulada'

export type RoomInfo = {
  id: string
  code: string
  host_id: string
  status: 'lobby' | 'playing' | 'finished'
  points_target: number
  capicua_doble: boolean
}

export type MatchInfo = {
  id: string
  status: 'active' | 'finished'
  team_a_id: string
  team_b_id: string
  score_a: number
  score_b: number
  winner_team_id: string | null
}

export type HandInfo = {
  id: string
  hand_number: number
  status: 'active' | 'finished'
  current_seat: Seat | null
  starting_seat: Seat
  left_end: Pip | null
  right_end: Pip | null
  move_count: number
  consecutive_passes: number
  turn_started_at: string
  end_type: HandEndType | null
  was_capicua: boolean
  winner_team_id: string | null
  points_awarded: number
}

export type SeatInfo = {
  seat: Seat
  profile_id: string
  display_name: string | null
  avatar_url: string | null
  team_index: TeamIndex
  tiles_left: number
  connected: boolean
  last_seen_at: string | null
  is_turn: boolean
}

export type BoardTile = {
  position: number
  /** Pip que mira a la izquierda. */
  a: Pip
  /** Pip que mira a la derecha. */
  b: Pip
  tile: Tile
  seat: Seat
  played_order: number
}

export type HandTile = { tile: Tile; sides: Side[] }

export type RevealedTile = { seat: Seat; tile: Tile; pips: number }

/** Resumen de la partida entera; alimenta la rejilla de fin de partida. */
export type MatchStats = {
  hands_played: number
  dominos: number
  trancas: number
  capicuas: number
}

export type RecentMove = {
  move_number: number
  seat: Seat
  move_type: 'play' | 'pass'
  tile: Tile | null
  side: Side | null
}

export type GameState = {
  room: RoomInfo
  match: MatchInfo
  hand: HandInfo | null
  me: {
    profile_id: string
    seat: Seat | null
    team_index: TeamIndex | null
    is_host: boolean
    is_turn: boolean
  }
  seats: SeatInfo[]
  board: BoardTile[]
  /** Solo las fichas de quien llama. El servidor nunca manda las de otro. */
  my_hand: HandTile[]
  /** Vacío mientras la mano está en juego; se llena al cerrarla. */
  revealed: RevealedTile[]
  match_stats: MatchStats
  recent_moves: RecentMove[]
}

export type RoomMember = {
  profile_id: string
  display_name: string
  avatar_url: string | null
  role: 'player' | 'observer'
  seat: Seat | null
  team_id: string | null
  queue_position: number | null
  seeking_partner: boolean
  connected: boolean
  joined_at: string
}

export type QueueEntry = {
  queue_position: number
  team_id: string
  players: { profile_id: string; display_name: string }[]
  mine: boolean
  frequent_pair: boolean
}

export type RoomState = {
  room: RoomInfo & { max_size: number; current_match_id: string | null; created_at: string }
  me: { profile_id: string; is_host: boolean; seat: Seat | null }
  members: RoomMember[]
  queue: QueueEntry[]
  current_match_id: string | null
}

export type ProfileHistory = {
  profile: { id: string; display_name: string; avatar_url: string | null } | null
  stats: { matches_played: number; matches_won: number; hands_won: number; trancas_won: number }
  top_partner: {
    profile_id: string
    display_name: string
    matches: number
    won: number
    is_frequent_pair: boolean
  } | null
  matches: {
    id: string
    room_code: string
    finished_at: string
    won: boolean
    score: string
    partner: string | null
  }[]
}
