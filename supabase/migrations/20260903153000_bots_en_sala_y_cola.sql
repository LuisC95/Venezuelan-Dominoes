-- Los bots y el rey de la cancha, y cómo se ven en la sala.
--
-- Un bot no espera turno: si al terminar la partida hay una pareja de verdad en
-- la cola, los bots que pierden dejan la mesa y se van de la sala. Si no había
-- nadie esperando, vuelven a entrar ellos mismos y esto no los toca.

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

  select coalesce(max(queue_position), 0) into v_tail
  from public.room_members where room_id = p_room_id;

  update public.room_members set
    role = 'observer', seat = null, queue_position = v_tail + 1, seeking_partner = false
  where room_id = p_room_id and seat in (v_loser_parity, v_loser_parity + 2);

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

  -- Los bots que quedaron sin asiento se van. Si los que entraron fueron ellos
  -- mismos (no había nadie esperando) siguen sentados y esto no los toca.
  delete from public.room_members rm
  using public.profiles p
  where p.id = rm.profile_id and p.is_bot
    and rm.room_id = p_room_id and rm.seat is null;

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

-- La sala: los bots se marcan y cuentan siempre como conectados.
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
        'is_bot', p.is_bot,
        'role', rm.role,
        'seat', rm.seat,
        'team_id', rm.team_id,
        'queue_position', rm.queue_position,
        'seeking_partner', rm.seeking_partner,
        'connected', p.is_bot or rm.last_seen_at > now() - interval '30 seconds',
        'joined_at', rm.joined_at
      ) order by rm.seat nulls last, rm.queue_position nulls last, rm.joined_at)
      from public.room_members rm join public.profiles p on p.id = rm.profile_id
      where rm.room_id = p_room_id
    ), '[]'::jsonb),
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

grant execute on function public.next_match(uuid) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
