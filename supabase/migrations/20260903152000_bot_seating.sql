-- Sentar y quitar bots, y arrancarlos cuando les toca la salida.
--
-- `deal_hand` se reemplaza entero por una sola línea al final (`play_bots`): si
-- la salida cae en un bot, la mano no puede quedarse esperándolo. Va ahí y no en
-- cada llamador porque las tres puertas de entrada —start_match, start_next_hand
-- y next_match— reparten por esta misma función.
--
-- El tope de dos bots por mesa lo impone add_bot, no la UI: la idea es rellenar
-- cuando falta gente, no jugar contra la máquina.

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

  perform public.play_bots(v_hand.id);
  select * into v_hand from public.hands where id = v_hand.id;
  return v_hand;
end;
$$;

-- Poner un bot en un asiento vacío. Tope de dos por mesa.
create or replace function public.add_bot(p_room_id uuid, p_seat smallint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_bots int;
  v_bot uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión pone bots' using errcode = '42501';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'la mesa ya arrancó' using errcode = '55000';
  end if;
  if p_seat is null or p_seat < 0 or p_seat > 3 then
    raise exception 'asiento inválido' using errcode = '22023';
  end if;
  if exists (select 1 from public.room_members where room_id = p_room_id and seat = p_seat) then
    raise exception 'ese asiento está ocupado' using errcode = '55000';
  end if;

  select count(*) into v_bots
  from public.room_members rm join public.profiles p on p.id = rm.profile_id
  where rm.room_id = p_room_id and p.is_bot;
  if v_bots >= 2 then
    raise exception 'máximo dos bots por mesa' using errcode = '55000';
  end if;

  select p.id into v_bot from public.profiles p
  where p.is_bot and not exists (
    select 1 from public.room_members rm
    where rm.room_id = p_room_id and rm.profile_id = p.id
  )
  order by p.display_name
  limit 1;
  if v_bot is null then raise exception 'no quedan bots libres' using errcode = '55000'; end if;

  insert into public.room_members (room_id, profile_id, role, seat)
  values (p_room_id, v_bot, 'player', p_seat);

  perform public.notify_room(p_room_id, 'seats_changed',
    jsonb_build_object('profile_id', v_bot, 'seat', p_seat));
end;
$$;

create or replace function public.remove_bot(p_room_id uuid, p_seat smallint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión quita bots' using errcode = '42501';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'la mesa ya arrancó' using errcode = '55000';
  end if;

  select rm.id into v_id
  from public.room_members rm join public.profiles p on p.id = rm.profile_id
  where rm.room_id = p_room_id and rm.seat = p_seat and p.is_bot;
  if v_id is null then raise exception 'ahí no hay ningún bot' using errcode = 'P0002'; end if;

  delete from public.room_members where id = v_id;
  perform public.notify_room(p_room_id, 'seats_changed', jsonb_build_object('seat', p_seat));
end;
$$;

-- Un bot no se desconecta nunca: no late ni se suscribe al canal, así que sin
-- esto la mesa lo daría por caído a los 30s y le ofrecería al anfitrión anular
-- la mano por culpa de alguien que está perfectamente.
create or replace function public.void_hand(p_hand_id uuid)
returns public.hands
language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
  v_match public.matches;
  v_room public.rooms;
  v_player uuid;
  v_seen timestamptz;
  v_es_bot boolean;
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

  select coalesce(p.is_bot, false) into v_es_bot from public.profiles p where p.id = v_player;
  if v_es_bot then
    raise exception 'el de turno es un bot: no se desconecta' using errcode = '55000';
  end if;

  select last_seen_at into v_seen from public.room_members
  where room_id = v_room.id and profile_id = v_player;

  if v_seen is null or v_seen > now() - interval '60 seconds' then
    raise exception 'el jugador de turno sigue conectado' using errcode = '55000';
  end if;

  return public.resolve_hand(p_hand_id, 'anulada');
end;
$$;

grant execute on function public.add_bot(uuid, smallint) to authenticated;
grant execute on function public.remove_bot(uuid, smallint) to authenticated;
revoke all on function public.add_bot(uuid, smallint) from public, anon;
revoke all on function public.remove_bot(uuid, smallint) from public, anon;
grant execute on function public.void_hand(uuid) to authenticated;
