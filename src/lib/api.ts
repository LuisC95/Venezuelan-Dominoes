/**
 * Capa de acceso al motor. Toda la lógica del juego vive en Postgres; esto es
 * apenas la lista de llamadas permitidas, tipada.
 */
import { supabase } from './supabase'
import type { GameState, Mensajes, MessageKind, ProfileHistory, RoomState, Seat } from '../game/state'
import type { Side, Tile } from '../game/tiles'

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export type Room = {
  id: string
  code: string
  host_id: string
  max_size: number
  points_target: number
  capicua_doble: boolean
  status: 'lobby' | 'playing' | 'finished'
  current_match_id: string | null
  created_at: string
}

// --- identidad --------------------------------------------------------------
export const ensureProfile = (displayName: string, avatarUrl: string | null = null) =>
  call('ensure_profile', { p_display_name: displayName, p_avatar_url: avatarUrl })

// --- sala -------------------------------------------------------------------
export const createRoom = (maxSize = 8, pointsTarget = 100, capicuaDoble = false) =>
  call<Room>('create_room', {
    p_max_size: maxSize,
    p_points_target: pointsTarget,
    p_capicua_doble: capicuaDoble,
  })

export const joinRoom = (code: string) => call<Room>('join_room', { p_code: code })
export const takeSeat = (roomId: string, seat: Seat) =>
  call<void>('take_seat', { p_room_id: roomId, p_seat: seat })
export const leaveRoom = (roomId: string) => call<void>('leave_room', { p_room_id: roomId })
export const heartbeat = (roomId: string) => call<void>('heartbeat', { p_room_id: roomId })
export const setRoomConfig = (
  roomId: string,
  cfg: { maxSize?: number; pointsTarget?: number; capicuaDoble?: boolean },
) =>
  call<Room>('set_room_config', {
    p_room_id: roomId,
    p_max_size: cfg.maxSize ?? null,
    p_points_target: cfg.pointsTarget ?? null,
    p_capicua_doble: cfg.capicuaDoble ?? null,
  })

// --- cola y parejas ---------------------------------------------------------
export const requestTurn = (roomId: string) => call<void>('request_turn', { p_room_id: roomId })
export const pairWith = (roomId: string, partnerId: string) =>
  call<void>('pair_with', { p_room_id: roomId, p_partner_id: partnerId })
export const leaveQueue = (roomId: string) => call<void>('leave_queue', { p_room_id: roomId })

// --- partida ----------------------------------------------------------------
export const startMatch = (roomId: string) => call<{ id: string }>('start_match', { p_room_id: roomId })
export const playTile = (handId: string, tile: Tile, side?: Side) =>
  call<{ ok: boolean; capicua: boolean; tiles_left: number }>('play_tile', {
    p_hand_id: handId,
    p_tile: tile,
    p_side: side ?? null,
  })
export const startNextHand = (matchId: string) => call<void>('start_next_hand', { p_match_id: matchId })
export const voidHand = (handId: string) => call<void>('void_hand', { p_hand_id: handId })
export const nextMatch = (roomId: string) => call<{ id: string }>('next_match', { p_room_id: roomId })

// --- lectura ----------------------------------------------------------------
export const getGameState = (matchId: string) => call<GameState>('get_game_state', { p_match_id: matchId })
export const getRoomState = (roomId: string) => call<RoomState>('get_room_state', { p_room_id: roomId })
export const getProfileHistory = (profileId?: string, limit = 12) =>
  call<ProfileHistory>('get_profile_history', { p_profile_id: profileId ?? null, p_limit: limit })

// --- chat -------------------------------------------------------------------
export const sendMessage = (roomId: string, body: string, kind: MessageKind = 'chat') =>
  call<void>('send_message', { p_room_id: roomId, p_body: body, p_kind: kind })
export const getMessages = (roomId: string, limit = 30) =>
  call<Mensajes>('get_messages', { p_room_id: roomId, p_limit: limit })
