-- ============================================================================
-- Partidas, manos, fichas y jugadas. El motor completo vive aquí:
-- el cliente nunca escribe en estas tablas, solo llama a las RPCs.
--
-- Convención del tablero: las fichas se ordenan por board_position ascendente.
-- Cada ficha guarda cómo quedó girada (oriented_a mira a la izquierda,
-- oriented_b a la derecha), de modo que ficha[i].oriented_b = ficha[i+1].oriented_a.
-- Los extremos abiertos son hands.left_end y hands.right_end.
-- ============================================================================

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  team_a_id uuid not null references public.teams (id) on delete cascade,
  team_b_id uuid not null references public.teams (id) on delete cascade,
  -- seat_map[1..4] = quién está en el asiento 0..3. Congelado al empezar la partida
  -- para que el historial siga siendo legible aunque la sala cambie después.
  seat_map uuid[] not null check (array_length(seat_map, 1) = 4),
  score_a int not null default 0 check (score_a >= 0),
  score_b int not null default 0 check (score_b >= 0),
  status text not null default 'active' check (status in ('active', 'finished')),
  winner_team_id uuid references public.teams (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.rooms
  add constraint rooms_current_match_fk
  foreign key (current_match_id) references public.matches (id) on delete set null;

create table public.hands (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  hand_number int not null,
  starting_player_id uuid not null references public.profiles (id) on delete cascade,
  starting_seat smallint not null check (starting_seat between 0 and 3),
  status text not null default 'active' check (status in ('active', 'finished')),
  current_seat smallint check (current_seat between 0 and 3),
  left_end smallint check (left_end between 0 and 6),
  right_end smallint check (right_end between 0 and 6),
  consecutive_passes smallint not null default 0,
  move_count int not null default 0,
  -- 'anulada' no está en el spec original: es la salida de emergencia cuando el
  -- anfitrión corta una mano trancada por alguien que se cayó y no volvió.
  end_type text check (end_type in ('domino', 'tranca', 'tranca_empate', 'anulada')),
  was_capicua boolean not null default false,
  winner_team_id uuid references public.teams (id) on delete set null,
  points_awarded int not null default 0,
  turn_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (match_id, hand_number)
);

create table public.hand_tiles (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  tile text not null check (tile ~ '^[0-6]-[0-6]$'),
  state text not null default 'in_hand' check (state in ('in_hand', 'played', 'remaining_at_end')),
  played_order int,
  board_position int,
  oriented_a smallint check (oriented_a between 0 and 6),
  oriented_b smallint check (oriented_b between 0 and 6),
  unique (hand_id, tile)
);

create index hand_tiles_hand_player_idx on public.hand_tiles (hand_id, player_id);
create index hand_tiles_board_idx on public.hand_tiles (hand_id, board_position) where board_position is not null;

create table public.hand_moves (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  move_type text not null check (move_type in ('play', 'pass')),
  tile text check ((move_type = 'play') = (tile is not null)),
  side text check (side in ('l', 'r')),
  move_number int not null,
  created_at timestamptz not null default now(),
  unique (hand_id, move_number)
);

create index matches_room_idx on public.matches (room_id, started_at desc);
create index hands_match_idx on public.hands (match_id, hand_number);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.matches enable row level security;
alter table public.hands enable row level security;
alter table public.hand_tiles enable row level security;
alter table public.hand_moves enable row level security;

create policy matches_select_member on public.matches
  for select to authenticated using (public.is_room_member(room_id));

create policy hands_select_member on public.hands
  for select to authenticated using (exists (
    select 1 from public.matches m where m.id = hands.match_id and public.is_room_member(m.room_id)
  ));

create policy hand_moves_select_member on public.hand_moves
  for select to authenticated using (exists (
    select 1 from public.hands h join public.matches m on m.id = h.match_id
    where h.id = hand_moves.hand_id and public.is_room_member(m.room_id)
  ));

-- LA política del proyecto: tu mano es tuya. Lo jugado es público. Lo que quedó
-- en mano al terminar se revela (hace falta para mostrar el conteo de la tranca).
create policy hand_tiles_select_own_or_revealed on public.hand_tiles
  for select to authenticated using (
    exists (
      select 1 from public.hands h join public.matches m on m.id = h.match_id
      where h.id = hand_tiles.hand_id and public.is_room_member(m.room_id)
    )
    and (player_id = (select auth.uid()) or state <> 'in_hand')
  );

-- ---------------------------------------------------------------------------
-- Utilidades de fichas
-- ---------------------------------------------------------------------------

create or replace function public.tile_hi(p_tile text) returns int
  language sql immutable set search_path = '' as $$ select split_part(p_tile, '-', 1)::int $$;

create or replace function public.tile_lo(p_tile text) returns int
  language sql immutable set search_path = '' as $$ select split_part(p_tile, '-', 2)::int $$;

create or replace function public.tile_pips(p_tile text) returns int
  language sql immutable set search_path = '' as $$
    select split_part(p_tile, '-', 1)::int + split_part(p_tile, '-', 2)::int $$;

-- Extremos donde calza una ficha. Tablero vacío ⇒ calza (es la salida).
create or replace function public.tile_sides(p_tile text, p_left smallint, p_right smallint)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_left is null then array['r']
    else (
      case when public.tile_hi(p_tile) = p_left or public.tile_lo(p_tile) = p_left
           then array['l'] else array[]::text[] end
      ||
      case when public.tile_hi(p_tile) = p_right or public.tile_lo(p_tile) = p_right
           then array['r'] else array[]::text[] end
    )
  end;
$$;

create or replace function public.notify_match(p_match_id uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    p_payload || jsonb_build_object('event', p_event, 'match_id', p_match_id, 'at', now()),
    p_event,
    'match:' || p_match_id::text,
    false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reparto
-- ---------------------------------------------------------------------------

-- Reparte una mano nueva: 28 fichas, 7 por jugador.
-- p_starter_seat null ⇒ primera mano de la partida: sale el doble-6, y si no
-- se repartió (imposible con 4x7, pero por si acaso), el doble más alto.
create or replace function public.deal_hand(p_match_id uuid, p_starter_seat smallint default null)
returns public.hands
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_hand public.hands;
  v_tiles text[];
  v_number int;
  v_seat smallint;
  i int;
  j int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'partida inexistente' using errcode = 'P0002'; end if;
  if v_match.status <> 'active' then raise exception 'la partida ya terminó' using errcode = '55000'; end if;
  if exists (select 1 from public.hands h where h.match_id = p_match_id and h.status = 'active') then
    raise exception 'ya hay una mano en curso' using errcode = '55000';
  end if;

  select coalesce(max(hand_number), 0) + 1 into v_number from public.hands where match_id = p_match_id;

  select array_agg(t order by random()) into v_tiles
  from (
    select a::text || '-' || b::text as t
    from generate_series(0, 6) a, generate_series(0, 6) b
    where a >= b
  ) s;

  insert into public.hands (match_id, hand_number, starting_player_id, starting_seat, current_seat)
  values (p_match_id, v_number, v_match.seat_map[1], 0, 0)
  returning * into v_hand;

  for i in 0..3 loop
    for j in 1..7 loop
      insert into public.hand_tiles (hand_id, player_id, seat, tile)
      values (v_hand.id, v_match.seat_map[i + 1], i::smallint, v_tiles[i * 7 + j]);
    end loop;
  end loop;

  v_seat := p_starter_seat;

  if v_seat is null then
    select ht.seat into v_seat from public.hand_tiles ht
    where ht.hand_id = v_hand.id and ht.tile = '6-6';

    if v_seat is null then
      select ht.seat into v_seat from public.hand_tiles ht
      where ht.hand_id = v_hand.id and public.tile_hi(ht.tile) = public.tile_lo(ht.tile)
      order by public.tile_hi(ht.tile) desc
      limit 1;
    end if;

    v_seat := coalesce(v_seat, 0::smallint);
  end if;

  update public.hands set
    current_seat = v_seat,
    starting_seat = v_seat,
    starting_player_id = v_match.seat_map[v_seat + 1],
    turn_started_at = now()
  where id = v_hand.id
  returning * into v_hand;

  perform public.notify_match(p_match_id, 'hand_started', jsonb_build_object('hand_id', v_hand.id, 'hand_number', v_number));
  return v_hand;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cierre de mano
-- ---------------------------------------------------------------------------

-- Aplica las reglas de puntuación y cierra la mano (y la partida si llegó a la meta).
create or replace function public.resolve_hand(
  p_hand_id uuid,
  p_end_type text,
  p_winner_seat smallint default null,
  p_was_capicua boolean default false
) returns public.hands
language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
  v_match public.matches;
  v_room public.rooms;
  v_pips_a int;
  v_pips_b int;
  v_team_index int;
  v_points int := 0;
  v_end_type text := p_end_type;
  v_winner_team uuid;
  v_score_a int;
  v_score_b int;
begin
  select * into v_hand from public.hands where id = p_hand_id;
  select * into v_match from public.matches where id = v_hand.match_id;
  select * into v_room from public.rooms where id = v_match.room_id;

  -- Se revela lo que quedó en mano: hace falta para el conteo y para la pantalla
  -- de fin de mano. Es exactamente lo que la política de RLS permite mostrar.
  update public.hand_tiles set state = 'remaining_at_end'
  where hand_id = p_hand_id and state = 'in_hand';

  select
    coalesce(sum(public.tile_pips(tile)) filter (where seat % 2 = 0), 0),
    coalesce(sum(public.tile_pips(tile)) filter (where seat % 2 = 1), 0)
  into v_pips_a, v_pips_b
  from public.hand_tiles
  where hand_id = p_hand_id and state = 'remaining_at_end';

  if v_end_type = 'anulada' then
    v_team_index := null;
    v_points := 0;

  elsif v_end_type = 'domino' then
    -- Dominó: la pareja del que se quedó sin fichas suma los pips de la contraria.
    v_team_index := p_winner_seat % 2;
    v_points := case when v_team_index = 0 then v_pips_b else v_pips_a end;

  elsif v_end_type = 'tranca' then
    if v_pips_a = v_pips_b then
      -- Empate exacto: mano anulada, 0 puntos, se reparte otra.
      v_end_type := 'tranca_empate';
      v_team_index := null;
      v_points := 0;
    else
      -- Gana la pareja con menos pips y se lleva los de la contraria.
      v_team_index := case when v_pips_a < v_pips_b then 0 else 1 end;
      v_points := greatest(v_pips_a, v_pips_b);
    end if;
  else
    raise exception 'end_type desconocido: %', v_end_type using errcode = '22023';
  end if;

  -- Capicúa NO duplica, salvo que la sala lo haya activado explícitamente.
  if p_was_capicua and v_room.capicua_doble then
    v_points := v_points * 2;
  end if;

  v_winner_team := case v_team_index when 0 then v_match.team_a_id when 1 then v_match.team_b_id else null end;

  update public.hands set
    status = 'finished',
    end_type = v_end_type,
    was_capicua = p_was_capicua,
    winner_team_id = v_winner_team,
    points_awarded = v_points,
    current_seat = null,
    finished_at = now()
  where id = p_hand_id
  returning * into v_hand;

  v_score_a := v_match.score_a + case when v_team_index = 0 then v_points else 0 end;
  v_score_b := v_match.score_b + case when v_team_index = 1 then v_points else 0 end;

  update public.matches set
    score_a = v_score_a,
    score_b = v_score_b,
    status = case when greatest(v_score_a, v_score_b) >= v_room.points_target then 'finished' else 'active' end,
    winner_team_id = case
      when v_score_a >= v_room.points_target and v_score_a >= v_score_b then team_a_id
      when v_score_b >= v_room.points_target then team_b_id
      else null end,
    finished_at = case when greatest(v_score_a, v_score_b) >= v_room.points_target then now() else null end
  where id = v_match.id
  returning * into v_match;

  if v_match.status = 'finished' then
    update public.rooms set status = 'finished' where id = v_room.id;
    perform public.notify_match(v_match.id, 'match_finished', jsonb_build_object('winner_team_id', v_match.winner_team_id));
    perform public.notify_room(v_room.id, 'match_finished', jsonb_build_object('match_id', v_match.id));
  end if;

  perform public.notify_match(v_match.id, 'hand_finished', jsonb_build_object(
    'hand_id', p_hand_id, 'end_type', v_end_type, 'points', v_points, 'winner_team_id', v_winner_team
  ));

  return v_hand;
end;
$$;

-- ---------------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------------

-- Avanza al siguiente que SÍ tenga jugada, dejando registrado el pase de cada
-- quien no la tenga. Si dan la vuelta completa sin que nadie pueda: tranca.
create or replace function public.advance_turn(p_hand_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
  v_match public.matches;
  v_seat smallint;
  v_player uuid;
  v_has_play boolean;
  i int;
begin
  select * into v_hand from public.hands where id = p_hand_id;
  select * into v_match from public.matches where id = v_hand.match_id;
  v_seat := v_hand.current_seat;

  for i in 1..4 loop
    v_seat := ((v_seat + 1) % 4)::smallint;
    v_player := v_match.seat_map[v_seat + 1];

    select exists (
      select 1 from public.hand_tiles ht
      where ht.hand_id = p_hand_id and ht.player_id = v_player and ht.state = 'in_hand'
        and cardinality(public.tile_sides(ht.tile, v_hand.left_end, v_hand.right_end)) > 0
    ) into v_has_play;

    if v_has_play then
      update public.hands set current_seat = v_seat, turn_started_at = now() where id = p_hand_id;
      perform public.notify_match(v_hand.match_id, 'turn', jsonb_build_object('hand_id', p_hand_id, 'seat', v_seat));
      return;
    end if;

    -- Pase automático: queda registrado en el historial, como pide el spec.
    insert into public.hand_moves (hand_id, player_id, seat, move_type, move_number)
    values (p_hand_id, v_player, v_seat, 'pass', v_hand.move_count + 1);

    update public.hands set
      move_count = move_count + 1,
      consecutive_passes = consecutive_passes + 1,
      current_seat = v_seat
    where id = p_hand_id
    returning * into v_hand;
  end loop;

  -- Los cuatro pasaron seguido: tranca.
  perform public.resolve_hand(p_hand_id, 'tranca');
end;
$$;

-- ---------------------------------------------------------------------------
-- Jugar una ficha
-- ---------------------------------------------------------------------------

create or replace function public.play_tile(p_hand_id uuid, p_tile text, p_side text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hand public.hands;
  v_match public.matches;
  v_seat smallint;
  v_ht public.hand_tiles;
  v_sides text[];
  v_side text := p_side;
  v_hi int;
  v_lo int;
  v_oa smallint;
  v_ob smallint;
  v_pos int;
  v_left smallint;
  v_right smallint;
  v_capicua boolean := false;
  v_left_over int;
begin
  -- FOR UPDATE serializa: dos jugadas simultáneas no pueden pisarse.
  select * into v_hand from public.hands where id = p_hand_id for update;
  if not found then raise exception 'mano inexistente' using errcode = 'P0002'; end if;
  if v_hand.status <> 'active' then raise exception 'esa mano ya terminó' using errcode = '55000'; end if;

  select * into v_match from public.matches where id = v_hand.match_id;
  v_seat := (array_position(v_match.seat_map, v_uid) - 1)::smallint;

  if v_seat is null then raise exception 'no estás en esta mesa' using errcode = '42501'; end if;
  if v_seat <> v_hand.current_seat then raise exception 'no es tu turno' using errcode = '55000'; end if;

  select * into v_ht from public.hand_tiles
  where hand_id = p_hand_id and player_id = v_uid and tile = p_tile and state = 'in_hand';
  if not found then raise exception 'no tienes esa ficha' using errcode = '42501'; end if;

  v_sides := public.tile_sides(p_tile, v_hand.left_end, v_hand.right_end);
  if cardinality(v_sides) = 0 then
    raise exception 'esa ficha no calza en ninguna punta' using errcode = '55000';
  end if;
  if v_side is null or not (v_side = any (v_sides)) then
    if cardinality(v_sides) = 1 then
      v_side := v_sides[1];
    else
      raise exception 'di por cuál punta: l o r' using errcode = '22023';
    end if;
  end if;

  v_hi := public.tile_hi(p_tile);
  v_lo := public.tile_lo(p_tile);

  if v_hand.left_end is null then
    -- Salida: la ficha ancla el tablero en la posición 0.
    v_oa := v_hi::smallint; v_ob := v_lo::smallint; v_pos := 0;
    v_left := v_oa; v_right := v_ob;
  else
    -- Capicúa: cerrar con un doble que calzaba por las dos puntas.
    v_capicua := (v_hi = v_lo) and cardinality(v_sides) = 2;

    if v_side = 'r' then
      if v_hi = v_hand.right_end then v_oa := v_hi::smallint; v_ob := v_lo::smallint;
      else v_oa := v_lo::smallint; v_ob := v_hi::smallint; end if;
      select coalesce(max(board_position), 0) + 1 into v_pos
      from public.hand_tiles where hand_id = p_hand_id and board_position is not null;
      v_left := v_hand.left_end; v_right := v_ob;
    else
      if v_hi = v_hand.left_end then v_ob := v_hi::smallint; v_oa := v_lo::smallint;
      else v_ob := v_lo::smallint; v_oa := v_hi::smallint; end if;
      select coalesce(min(board_position), 0) - 1 into v_pos
      from public.hand_tiles where hand_id = p_hand_id and board_position is not null;
      v_left := v_oa; v_right := v_hand.right_end;
    end if;
  end if;

  update public.hand_tiles set
    state = 'played',
    played_order = v_hand.move_count + 1,
    board_position = v_pos,
    oriented_a = v_oa,
    oriented_b = v_ob
  where id = v_ht.id;

  insert into public.hand_moves (hand_id, player_id, seat, move_type, tile, side, move_number)
  values (p_hand_id, v_uid, v_seat, 'play', p_tile, v_side, v_hand.move_count + 1);

  update public.hands set
    left_end = v_left,
    right_end = v_right,
    move_count = move_count + 1,
    consecutive_passes = 0,
    turn_started_at = now()
  where id = p_hand_id
  returning * into v_hand;

  perform public.notify_match(v_hand.match_id, 'move', jsonb_build_object(
    'hand_id', p_hand_id, 'seat', v_seat, 'tile', p_tile, 'side', v_side, 'move_number', v_hand.move_count
  ));

  select count(*) into v_left_over from public.hand_tiles
  where hand_id = p_hand_id and player_id = v_uid and state = 'in_hand';

  if v_left_over = 0 then
    perform public.resolve_hand(p_hand_id, 'domino', v_seat, v_capicua);
  else
    perform public.advance_turn(p_hand_id);
  end if;

  return jsonb_build_object('ok', true, 'capicua', v_capicua, 'tiles_left', v_left_over);
end;
$$;

grant execute on function public.tile_hi(text) to authenticated;
grant execute on function public.tile_lo(text) to authenticated;
grant execute on function public.tile_pips(text) to authenticated;
grant execute on function public.tile_sides(text, smallint, smallint) to authenticated;
grant execute on function public.play_tile(uuid, text, text) to authenticated;

revoke all on function public.deal_hand(uuid, smallint) from public;
revoke all on function public.resolve_hand(uuid, text, smallint, boolean) from public;
revoke all on function public.advance_turn(uuid) from public;
revoke all on function public.notify_match(uuid, text, jsonb) from public;;
