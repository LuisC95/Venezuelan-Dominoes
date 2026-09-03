-- La mesa marca cuáles de los cuatro son bots, y los da siempre por conectados.
--
-- Sin esto, la etapa 7 se pelea con la 12: un bot no late ni aparece en
-- Presence, así que la mesa lo pintaría "sin señal" a los pocos segundos y al
-- minuto le ofrecería al anfitrión anular la mano por culpa de alguien que está
-- perfectamente. `hacerSinSeñal` en el cliente hace la otra mitad.

create or replace function public.get_game_state(p_match_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_room public.rooms;
  v_hand public.hands;
  v_seat smallint;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'partida inexistente' using errcode = 'P0002'; end if;
  if not public.is_room_member(v_match.room_id) then
    raise exception 'no estás en esta sala' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = v_match.room_id;
  select * into v_hand from public.hands where match_id = p_match_id order by hand_number desc limit 1;
  v_seat := (array_position(v_match.seat_map, v_uid) - 1)::smallint;

  return jsonb_build_object(
    -- El reloj del servidor. La UI cuenta los segundos sin señal contra ESTA
    -- hora y no contra la del navegador: el umbral de 60s que exige void_hand
    -- se mide en el servidor, y un teléfono con el reloj adelantado hacía
    -- aparecer el botón de anular antes de que la RPC fuera a aceptarlo.
    'now', now(),
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'host_id', v_room.host_id,
      'status', v_room.status, 'points_target', v_room.points_target,
      'capicua_doble', v_room.capicua_doble
    ),
    'match', jsonb_build_object(
      'id', v_match.id, 'status', v_match.status,
      'team_a_id', v_match.team_a_id, 'team_b_id', v_match.team_b_id,
      'score_a', v_match.score_a, 'score_b', v_match.score_b,
      'winner_team_id', v_match.winner_team_id
    ),
    'hand', case when v_hand.id is null then null else jsonb_build_object(
      'id', v_hand.id, 'hand_number', v_hand.hand_number, 'status', v_hand.status,
      'current_seat', v_hand.current_seat, 'starting_seat', v_hand.starting_seat,
      'left_end', v_hand.left_end, 'right_end', v_hand.right_end,
      'move_count', v_hand.move_count, 'consecutive_passes', v_hand.consecutive_passes,
      'turn_started_at', v_hand.turn_started_at,
      'end_type', v_hand.end_type, 'was_capicua', v_hand.was_capicua,
      'winner_team_id', v_hand.winner_team_id, 'points_awarded', v_hand.points_awarded
    ) end,
    'me', jsonb_build_object(
      'profile_id', v_uid,
      'seat', v_seat,
      'team_index', case when v_seat is null then null else v_seat % 2 end,
      'is_host', v_room.host_id = v_uid,
      'is_turn', v_seat is not null and v_hand.current_seat = v_seat and v_hand.status = 'active'
    ),
    -- Los 4 asientos: nombre, cuántas fichas le quedan y si está conectado.
    -- Nunca CUÁLES fichas. Un bot cuenta siempre como conectado: no late ni se
    -- suscribe al canal, así que sin esto la mesa lo daría por caído a los 30s.
    'seats', coalesce((
      select jsonb_agg(x order by x.seat)
      from (
        select
          s.seat,
          v_match.seat_map[s.seat + 1] as profile_id,
          p.display_name,
          p.avatar_url,
          coalesce(p.is_bot, false) as is_bot,
          s.seat % 2 as team_index,
          (select count(*) from public.hand_tiles ht
            where ht.hand_id = v_hand.id and ht.seat = s.seat and ht.state = 'in_hand') as tiles_left,
          coalesce(p.is_bot, false)
            or coalesce(rm.last_seen_at > now() - interval '30 seconds', false) as connected,
          rm.last_seen_at,
          (v_hand.current_seat = s.seat and v_hand.status = 'active') as is_turn
        from generate_series(0, 3) as s(seat)
        left join public.profiles p on p.id = v_match.seat_map[s.seat + 1]
        left join public.room_members rm
          on rm.room_id = v_match.room_id and rm.profile_id = v_match.seat_map[s.seat + 1]
      ) x
    ), '[]'::jsonb),
    -- El tablero, de izquierda a derecha.
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', ht.board_position, 'a', ht.oriented_a, 'b', ht.oriented_b,
        'tile', ht.tile, 'seat', ht.seat, 'played_order', ht.played_order
      ) order by ht.board_position)
      from public.hand_tiles ht
      where ht.hand_id = v_hand.id and ht.state = 'played'
    ), '[]'::jsonb),
    -- Mi mano, con las puntas donde calza cada ficha ya calculadas.
    'my_hand', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tile', ht.tile,
        'sides', public.tile_sides(ht.tile, v_hand.left_end, v_hand.right_end)
      ) order by public.tile_pips(ht.tile) desc, ht.tile)
      from public.hand_tiles ht
      where ht.hand_id = v_hand.id and ht.player_id = v_uid and ht.state = 'in_hand'
    ), '[]'::jsonb),
    -- Al cerrar la mano se revela lo que quedó en mano, para el conteo.
    'revealed', case when v_hand.status = 'finished' then coalesce((
      select jsonb_agg(jsonb_build_object('seat', ht.seat, 'tile', ht.tile, 'pips', public.tile_pips(ht.tile))
             order by ht.seat, ht.tile)
      from public.hand_tiles ht
      where ht.hand_id = v_hand.id and ht.state = 'remaining_at_end'
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- Resumen de la partida completa: alimenta la rejilla de fin de partida.
    -- Va aquí y no en una RPC nueva porque es la misma lectura y el mismo
    -- permiso; una función nueva habría que blindarla aparte (ver la trampa
    -- de los grants por defecto).
    'match_stats', (
      select jsonb_build_object(
        'hands_played', count(*) filter (where h.status = 'finished'),
        'dominos', count(*) filter (where h.end_type = 'domino'),
        'trancas', count(*) filter (where h.end_type in ('tranca', 'tranca_empate')),
        'capicuas', count(*) filter (where h.was_capicua)
      )
      from public.hands h where h.match_id = p_match_id
    ),
    -- Últimas jugadas, para animar y para el "pasó" en pantalla.
    'recent_moves', coalesce((
      select jsonb_agg(m order by m.move_number)
      from (
        select move_number, seat, move_type, tile, side
        from public.hand_moves
        where hand_id = v_hand.id
        order by move_number desc limit 8
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_game_state(uuid) to authenticated;
