-- ============================================================================
-- Ciclo de vida de la partida: arrancar, siguiente mano, anular, rey de la cancha.
-- Más las dos funciones de lectura que usa el cliente.
-- ============================================================================

create or replace function public.start_match(p_room_id uuid)
returns public.matches
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_seats uuid[];
  v_team_a public.teams;
  v_team_b public.teams;
  v_match public.matches;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión arranca la partida' using errcode = '42501';
  end if;
  if v_room.status = 'playing' then
    raise exception 'ya hay una partida en curso' using errcode = '55000';
  end if;

  select array_agg(profile_id order by seat) into v_seats
  from public.room_members where room_id = p_room_id and seat is not null;

  if v_seats is null or array_length(v_seats, 1) <> 4 then
    raise exception 'hacen falta 4 jugadores sentados' using errcode = '55000';
  end if;

  -- Parejas cruzadas: 0 y 2 contra 1 y 3.
  v_team_a := public.ensure_team(p_room_id, v_seats[1], v_seats[3]);
  v_team_b := public.ensure_team(p_room_id, v_seats[2], v_seats[4]);

  insert into public.matches (room_id, team_a_id, team_b_id, seat_map)
  values (p_room_id, v_team_a.id, v_team_b.id, v_seats)
  returning * into v_match;

  update public.room_members set team_id = v_team_a.id
  where room_id = p_room_id and seat in (0, 2);
  update public.room_members set team_id = v_team_b.id
  where room_id = p_room_id and seat in (1, 3);

  update public.rooms set status = 'playing', current_match_id = v_match.id where id = p_room_id;

  perform public.deal_hand(v_match.id, null);
  perform public.notify_room(p_room_id, 'match_started', jsonb_build_object('match_id', v_match.id));

  return v_match;
end;
$$;

-- Reparte la mano siguiente. La salida rota en sentido horario a partir de quien
-- salió antes — sin importar quién ganó. Excepción: si la mano se anuló por
-- desconexión no se jugó nada, así que sale el mismo.
create or replace function public.start_next_hand(p_match_id uuid)
returns public.hands
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_prev public.hands;
  v_starter smallint;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'partida inexistente' using errcode = 'P0002'; end if;
  if v_match.status <> 'active' then raise exception 'la partida ya terminó' using errcode = '55000'; end if;
  if not public.is_room_member(v_match.room_id) then
    raise exception 'no estás en esta sala' using errcode = '42501';
  end if;

  select * into v_prev from public.hands
  where match_id = p_match_id order by hand_number desc limit 1;

  if v_prev.status = 'active' then
    raise exception 'la mano anterior sigue en juego' using errcode = '55000';
  end if;

  v_starter := case
    when v_prev.end_type = 'anulada' then v_prev.starting_seat
    else ((v_prev.starting_seat + 1) % 4)::smallint
  end;

  return public.deal_hand(p_match_id, v_starter);
end;
$$;

-- Salida de emergencia: alguien con jugada se cayó y no volvió. Solo el anfitrión,
-- y solo si esa persona lleva más de 60s sin dar señales.
create or replace function public.void_hand(p_hand_id uuid)
returns public.hands
language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
  v_match public.matches;
  v_room public.rooms;
  v_player uuid;
  v_seen timestamptz;
begin
  select * into v_hand from public.hands where id = p_hand_id for update;
  if not found then raise exception 'mano inexistente' using errcode = 'P0002'; end if;
  if v_hand.status <> 'active' then raise exception 'esa mano ya terminó' using errcode = '55000'; end if;

  select * into v_match from public.matches where id = v_hand.match_id;
  select * into v_room from public.rooms where id = v_match.room_id;

  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión puede anular la mano' using errcode = '42501';
  end if;

  v_player := v_match.seat_map[v_hand.current_seat + 1];
  select last_seen_at into v_seen from public.room_members
  where room_id = v_room.id and profile_id = v_player;

  if v_seen is null or v_seen > now() - interval '60 seconds' then
    raise exception 'el jugador de turno sigue conectado' using errcode = '55000';
  end if;

  return public.resolve_hand(p_hand_id, 'anulada');
end;
$$;

-- Rey de la cancha: al terminar la partida la pareja ganadora se queda, la
-- perdedora sale al final de la cola y entra la siguiente pareja que esperaba.
-- Si no hay nadie en la cola, siguen los mismos cuatro.
create or replace function public.next_match(p_room_id uuid)
returns public.matches
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_match public.matches;
  v_winner_parity int;
  v_loser_parity int;
  v_incoming uuid;
  v_incoming_a uuid;
  v_incoming_b uuid;
  v_tail int;
  v_seats uuid[];
  v_team_a public.teams;
  v_team_b public.teams;
  v_new public.matches;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión arranca la siguiente' using errcode = '42501';
  end if;

  select * into v_match from public.matches where id = v_room.current_match_id;
  if v_match.id is null or v_match.status <> 'finished' then
    raise exception 'la partida en curso todavía no termina' using errcode = '55000';
  end if;

  v_winner_parity := case when v_match.winner_team_id = v_match.team_a_id then 0 else 1 end;
  v_loser_parity := 1 - v_winner_parity;

  -- La pareja perdedora deja la mesa y se forma al final de la cola.
  select coalesce(max(queue_position), 0) into v_tail
  from public.room_members where room_id = p_room_id;

  update public.room_members set
    role = 'observer', seat = null, queue_position = v_tail + 1, seeking_partner = false
  where room_id = p_room_id and seat in (v_loser_parity, v_loser_parity + 2);

  -- Entra la primera pareja de la cola (que puede ser la que acaba de salir,
  -- si no había nadie más esperando).
  select team_id into v_incoming
  from public.room_members
  where room_id = p_room_id and team_id is not null and queue_position is not null and seat is null
  order by queue_position, joined_at
  limit 1;

  if v_incoming is not null then
    select player_a_id, player_b_id into v_incoming_a, v_incoming_b
    from public.teams where id = v_incoming;

    update public.room_members set
      role = 'player', seat = v_loser_parity::smallint, queue_position = null, seeking_partner = false
    where room_id = p_room_id and profile_id = v_incoming_a;

    update public.room_members set
      role = 'player', seat = (v_loser_parity + 2)::smallint, queue_position = null, seeking_partner = false
    where room_id = p_room_id and profile_id = v_incoming_b;
  end if;

  select array_agg(profile_id order by seat) into v_seats
  from public.room_members where room_id = p_room_id and seat is not null;

  if v_seats is null or array_length(v_seats, 1) <> 4 then
    raise exception 'la mesa quedó incompleta' using errcode = '55000';
  end if;

  v_team_a := public.ensure_team(p_room_id, v_seats[1], v_seats[3]);
  v_team_b := public.ensure_team(p_room_id, v_seats[2], v_seats[4]);

  insert into public.matches (room_id, team_a_id, team_b_id, seat_map)
  values (p_room_id, v_team_a.id, v_team_b.id, v_seats)
  returning * into v_new;

  update public.room_members set team_id = v_team_a.id where room_id = p_room_id and seat in (0, 2);
  update public.room_members set team_id = v_team_b.id where room_id = p_room_id and seat in (1, 3);
  update public.rooms set status = 'playing', current_match_id = v_new.id where id = p_room_id;

  perform public.deal_hand(v_new.id, null);
  perform public.notify_room(p_room_id, 'match_started', jsonb_build_object('match_id', v_new.id));

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lectura: una sola llamada devuelve todo lo que ese jugador puede ver.
-- Reconectarse es exactamente esto (por eso no hace falta guardar nada en el
-- cliente), y por construcción nunca se filtra la mano de otro.
-- ---------------------------------------------------------------------------

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
    -- Nunca CUÁLES fichas.
    'seats', coalesce((
      select jsonb_agg(x order by x.seat)
      from (
        select
          s.seat,
          v_match.seat_map[s.seat + 1] as profile_id,
          p.display_name,
          p.avatar_url,
          s.seat % 2 as team_index,
          (select count(*) from public.hand_tiles ht
            where ht.hand_id = v_hand.id and ht.seat = s.seat and ht.state = 'in_hand') as tiles_left,
          coalesce(rm.last_seen_at > now() - interval '30 seconds', false) as connected,
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

-- Estado de la sala: mesa, observadores, sueltos y cola. Alimenta el lobby.
create or replace function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'no estás en esta sala' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'me', jsonb_build_object(
      'profile_id', v_uid,
      'is_host', v_room.host_id = v_uid,
      'seat', (select seat from public.room_members where room_id = p_room_id and profile_id = v_uid)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', rm.profile_id,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'role', rm.role,
        'seat', rm.seat,
        'team_id', rm.team_id,
        'queue_position', rm.queue_position,
        'seeking_partner', rm.seeking_partner,
        'connected', rm.last_seen_at > now() - interval '30 seconds',
        'joined_at', rm.joined_at
      ) order by rm.seat nulls last, rm.queue_position nulls last, rm.joined_at)
      from public.room_members rm join public.profiles p on p.id = rm.profile_id
      where rm.room_id = p_room_id
    ), '[]'::jsonb),
    -- La cola, ya agrupada por pareja.
    'queue', coalesce((
      select jsonb_agg(q order by q.queue_position)
      from (
        select
          min(rm.queue_position) as queue_position,
          rm.team_id,
          jsonb_agg(jsonb_build_object('profile_id', rm.profile_id, 'display_name', p.display_name)
                    order by rm.joined_at) as players,
          bool_or(rm.profile_id = v_uid) as mine,
          bool_or(t.is_frequent_pair) as frequent_pair
        from public.room_members rm
        join public.profiles p on p.id = rm.profile_id
        left join public.teams t on t.id = rm.team_id
        where rm.room_id = p_room_id and rm.queue_position is not null and rm.seat is null
        group by rm.team_id
      ) q
    ), '[]'::jsonb),
    'current_match_id', v_room.current_match_id
  );
end;
$$;

grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.start_next_hand(uuid) to authenticated;
grant execute on function public.void_hand(uuid) to authenticated;
grant execute on function public.next_match(uuid) to authenticated;
grant execute on function public.get_game_state(uuid) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;;
