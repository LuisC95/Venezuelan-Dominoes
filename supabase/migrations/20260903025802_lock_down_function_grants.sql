-- ============================================================================
-- Cierre de permisos.
--
-- Supabase aplica ALTER DEFAULT PRIVILEGES concediendo EXECUTE sobre toda
-- función nueva de `public` a anon y authenticated. Eso dejaba las funciones
-- internas del motor expuestas en /rest/v1/rpc: alguien podía llamar
-- resolve_hand() o deal_hand() a mano y fabricarse una victoria.
--
-- Regla: nada es ejecutable por defecto; se concede una por una solo la
-- superficie que el cliente necesita.
-- ============================================================================

revoke execute on all functions in schema public from anon, public;
revoke execute on all functions in schema public from authenticated;

-- Que las funciones futuras tampoco nazcan abiertas.
alter default privileges in schema public revoke execute on functions from anon, public;

-- --- Superficie pública para un jugador con sesión --------------------------

-- Identidad
grant execute on function public.ensure_profile(text, text) to authenticated;

-- Sala
grant execute on function public.create_room(int, int, boolean) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.take_seat(uuid, smallint) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.set_room_config(uuid, int, int, boolean) to authenticated;

-- Cola y parejas
grant execute on function public.request_turn(uuid) to authenticated;
grant execute on function public.pair_with(uuid, uuid) to authenticated;
grant execute on function public.leave_queue(uuid) to authenticated;

-- Partida: solo las acciones que un jugador puede tomar de verdad.
grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.play_tile(uuid, text, text) to authenticated;
grant execute on function public.start_next_hand(uuid) to authenticated;
grant execute on function public.void_hand(uuid) to authenticated;
grant execute on function public.next_match(uuid) to authenticated;

-- Lectura
grant execute on function public.get_game_state(uuid) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
grant execute on function public.get_profile_history(uuid, int) to authenticated;

-- Chat
grant execute on function public.send_message(uuid, text, text) to authenticated;

-- Helpers puros y los que usan las políticas de RLS: se evalúan con los
-- privilegios de quien consulta, así que necesitan EXECUTE.
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.shares_room_with(uuid) to authenticated;
grant execute on function public.tile_hi(text) to authenticated;
grant execute on function public.tile_lo(text) to authenticated;
grant execute on function public.tile_pips(text) to authenticated;
grant execute on function public.tile_sides(text, smallint, smallint) to authenticated;

-- Deliberadamente SIN grant (solo las llama el motor por dentro):
--   deal_hand, resolve_hand, advance_turn, ensure_team, bump_player_stats,
--   gen_room_code, notify_room, notify_match, on_hand_finished, on_match_finished;
