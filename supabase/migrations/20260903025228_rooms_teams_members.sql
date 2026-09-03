-- ============================================================================
-- Salas, parejas y miembros.
--
-- Modelo de miembro (los cuatro estados posibles):
--   role='player',  seat 0..3                      -> sentado en la mesa
--   role='observer', team_id, queue_position       -> en la cola, con pareja armada
--   role='observer', seeking_partner=true          -> suelto, buscando con quién
--   role='observer', todo null                     -> solo mirando
--
-- Asientos: parejas cruzadas. Asientos 0 y 2 son una pareja, 1 y 3 la otra.
-- El turno rota 0 -> 1 -> 2 -> 3 -> 0 (sentido horario).
-- ============================================================================

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles (id) on delete cascade,
  max_size int not null default 8 check (max_size >= 4 and max_size <= 32),
  points_target int not null default 100 check (points_target between 20 and 500),
  capicua_doble boolean not null default false,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  current_match_id uuid,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  player_a_id uuid not null references public.profiles (id) on delete cascade,
  player_b_id uuid not null references public.profiles (id) on delete cascade,
  is_frequent_pair boolean not null default false,
  wins_count int not null default 0,
  trancas_won_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint teams_distinct_players check (player_a_id <> player_b_id)
);

-- Una pareja (sin importar el orden) existe una sola vez por sala.
create unique index teams_room_pair_key on public.teams
  (room_id, least(player_a_id, player_b_id), greatest(player_a_id, player_b_id));

create table public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'observer' check (role in ('player', 'observer')),
  team_id uuid references public.teams (id) on delete set null,
  seat smallint check (seat between 0 and 3),
  queue_position int check (queue_position > 0),
  seeking_partner boolean not null default false,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  -- Estar sentado y ser 'player' es la misma cosa.
  constraint room_members_seat_matches_role check ((role = 'player') = (seat is not null))
);

create unique index room_members_room_profile_key on public.room_members (room_id, profile_id);
create unique index room_members_room_seat_key on public.room_members (room_id, seat) where seat is not null;
-- La cola es de parejas: los dos integrantes comparten queue_position, por eso no es único.
create index room_members_queue_idx on public.room_members (room_id, queue_position) where queue_position is not null;
create index room_members_profile_idx on public.room_members (profile_id);
create index teams_room_idx on public.teams (room_id);

alter table public.rooms
  add constraint rooms_current_match_fk foreign key (current_match_id) references public.rooms (id) on delete set null;
alter table public.rooms drop constraint rooms_current_match_fk;
-- (la FK real a matches se agrega en la migración del juego)

-- ---------------------------------------------------------------------------
-- Helpers de autorización. SECURITY DEFINER a propósito: saltan RLS, y por eso
-- se pueden usar dentro de las políticas sin caer en recursión infinita.
-- ---------------------------------------------------------------------------

create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.profile_id = auth.uid()
  );
$$;

create or replace function public.shares_room_with(p_profile_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.profile_id = auth.uid() and theirs.profile_id = p_profile_id
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default. Solo hay políticas de SELECT; toda escritura pasa por
-- las funciones SECURITY DEFINER de más abajo.
-- ---------------------------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.teams enable row level security;
alter table public.room_members enable row level security;

create policy rooms_select_member on public.rooms
  for select to authenticated using (public.is_room_member(id));

create policy teams_select_member on public.teams
  for select to authenticated using (public.is_room_member(room_id));

create policy room_members_select_member on public.room_members
  for select to authenticated using (public.is_room_member(room_id));

-- Ahora que existen las salas, el perfil se ve también entre quienes comparten sala
-- (el lobby necesita los nombres de los demás).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_room_with(id));

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- Código tipo "CCS-742". Sin I ni O para que nadie lo confunda con 1 y 0 al dictarlo.
create or replace function public.gen_room_code()
returns text language sql volatile set search_path = '' as $$
  select (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', (floor(random() * 24) + 1)::int, 1), '')
    from generate_series(1, 3)
  ) || '-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0');
$$;

-- Avisa por Realtime que algo cambió en la sala. El payload es deliberadamente
-- mínimo: el cliente se entera de que hay novedad y hace pull del estado.
create or replace function public.notify_room(p_room_id uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    p_payload || jsonb_build_object('event', p_event, 'room_id', p_room_id, 'at', now()),
    p_event,
    'room:' || p_room_id::text,
    false
  );
end;
$$;

-- Encuentra (o crea) la pareja formada por dos jugadores dentro de una sala.
create or replace function public.ensure_team(p_room_id uuid, p_a uuid, p_b uuid)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams t
  where t.room_id = p_room_id
    and least(t.player_a_id, t.player_b_id) = least(p_a, p_b)
    and greatest(t.player_a_id, t.player_b_id) = greatest(p_a, p_b);

  if not found then
    insert into public.teams (room_id, player_a_id, player_b_id)
    values (p_room_id, p_a, p_b)
    returning * into v_team;
  end if;

  return v_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs de sala
-- ---------------------------------------------------------------------------

create or replace function public.create_room(
  p_max_size int default 8,
  p_points_target int default 100,
  p_capicua_doble boolean default false
) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_code text;
  i int;
begin
  if v_uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'primero escribe tu nombre' using errcode = '23503';
  end if;

  for i in 1..25 loop
    v_code := public.gen_room_code();
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'no se pudo generar un código libre' using errcode = '55000';
  end if;

  insert into public.rooms (code, host_id, max_size, points_target, capicua_doble)
  values (v_code, v_uid, p_max_size, p_points_target, p_capicua_doble)
  returning * into v_room;

  -- El anfitrión se sienta de una en el asiento 0.
  insert into public.room_members (room_id, profile_id, role, seat)
  values (v_room.id, v_uid, 'player', 0);

  return v_room;
end;
$$;

create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_member public.room_members;
  v_seat smallint;
  v_count int;
begin
  if v_uid is null then raise exception 'no autenticado' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'primero escribe tu nombre' using errcode = '23503';
  end if;

  select * into v_room from public.rooms r where r.code = upper(btrim(p_code));
  if not found then
    raise exception 'no existe una sala con ese código' using errcode = 'P0002';
  end if;

  -- Volver a entrar no es entrar de nuevo: es reconectarse.
  select * into v_member from public.room_members m
  where m.room_id = v_room.id and m.profile_id = v_uid;
  if found then
    update public.room_members set last_seen_at = now() where id = v_member.id;
    perform public.notify_room(v_room.id, 'member_back', jsonb_build_object('profile_id', v_uid));
    return v_room;
  end if;

  select count(*) into v_count from public.room_members m where m.room_id = v_room.id;
  if v_count >= v_room.max_size then
    raise exception 'la sala está llena' using errcode = '53300';
  end if;

  -- Solo se toma asiento si la mesa aún no arrancó; con la partida en curso se entra
  -- como observador y se pide turno desde la cola.
  if v_room.status = 'lobby' then
    select s into v_seat from generate_series(0, 3) as s
    where not exists (select 1 from public.room_members m where m.room_id = v_room.id and m.seat = s)
    order by s limit 1;
  end if;

  insert into public.room_members (room_id, profile_id, role, seat)
  values (v_room.id, v_uid, case when v_seat is null then 'observer' else 'player' end, v_seat);

  perform public.notify_room(v_room.id, 'member_joined', jsonb_build_object('profile_id', v_uid));
  return v_room;
end;
$$;

-- Cambiarse de asiento en el lobby = elegir con quién juegas (0/2 son pareja, 1/3 la otra).
create or replace function public.take_seat(p_room_id uuid, p_seat smallint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_me public.room_members;
  v_other public.room_members;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.status <> 'lobby' then
    raise exception 'la mesa ya arrancó: no se puede cambiar de asiento' using errcode = '55000';
  end if;
  if p_seat is null or p_seat < 0 or p_seat > 3 then
    raise exception 'asiento inválido' using errcode = '22023';
  end if;

  select * into v_me from public.room_members where room_id = p_room_id and profile_id = v_uid;
  if not found then raise exception 'no estás en esta sala' using errcode = '42501'; end if;
  if v_me.seat = p_seat then return; end if;

  select * into v_other from public.room_members where room_id = p_room_id and seat = p_seat;

  -- Se libera el asiento propio antes de nada para no chocar con el índice único.
  update public.room_members set seat = null, role = 'observer' where id = v_me.id;

  if v_other.id is not null then
    -- Intercambio: el otro se queda con mi asiento (o pasa a observador si yo no tenía).
    update public.room_members
    set seat = v_me.seat,
        role = case when v_me.seat is null then 'observer' else 'player' end
    where id = v_other.id;
  end if;

  update public.room_members
  set seat = p_seat, role = 'player', queue_position = null, seeking_partner = false
  where id = v_me.id;

  perform public.notify_room(p_room_id, 'seats_changed', jsonb_build_object('profile_id', v_uid, 'seat', p_seat));
end;
$$;

-- Marca presencia. El cliente lo llama cada ~20s; es lo que respalda el "sin señal".
create or replace function public.heartbeat(p_room_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.room_members set last_seen_at = now()
  where room_id = p_room_id and profile_id = auth.uid();
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  delete from public.room_members where room_id = p_room_id and profile_id = v_uid;
  perform public.notify_room(p_room_id, 'member_left', jsonb_build_object('profile_id', v_uid));
end;
$$;

create or replace function public.set_room_config(
  p_room_id uuid,
  p_max_size int default null,
  p_points_target int default null,
  p_capicua_doble boolean default null
) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'sala inexistente' using errcode = 'P0002'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'solo el anfitrión cambia la configuración' using errcode = '42501';
  end if;

  update public.rooms set
    max_size = coalesce(p_max_size, max_size),
    points_target = coalesce(p_points_target, points_target),
    capicua_doble = coalesce(p_capicua_doble, capicua_doble)
  where id = p_room_id
  returning * into v_room;

  perform public.notify_room(p_room_id, 'room_config', '{}'::jsonb);
  return v_room;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cola y jugadores sueltos
-- ---------------------------------------------------------------------------

-- Un suelto se ofrece para jugar. Si ya tiene pareja armada, entra a la cola.
create or replace function public.request_turn(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me public.room_members;
begin
  select * into v_me from public.room_members where room_id = p_room_id and profile_id = v_uid;
  if not found then raise exception 'no estás en esta sala' using errcode = '42501'; end if;
  if v_me.role = 'player' then
    raise exception 'ya estás en la mesa' using errcode = '55000';
  end if;

  update public.room_members set seeking_partner = true where id = v_me.id;
  perform public.notify_room(p_room_id, 'queue_changed', jsonb_build_object('profile_id', v_uid));
end;
$$;

-- Dos sueltos se emparejan y la pareja entra al final de la cola.
create or replace function public.pair_with(p_room_id uuid, p_partner_id uuid)
returns public.teams
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me public.room_members;
  v_them public.room_members;
  v_team public.teams;
  v_pos int;
begin
  if p_partner_id = v_uid then raise exception 'no puedes emparejarte contigo' using errcode = '22023'; end if;

  select * into v_me from public.room_members where room_id = p_room_id and profile_id = v_uid;
  if not found then raise exception 'no estás en esta sala' using errcode = '42501'; end if;
  select * into v_them from public.room_members where room_id = p_room_id and profile_id = p_partner_id;
  if not found then raise exception 'esa persona no está en la sala' using errcode = 'P0002'; end if;

  if v_me.role = 'player' or v_them.role = 'player' then
    raise exception 'quien está en la mesa no entra a la cola' using errcode = '55000';
  end if;
  if v_them.team_id is not null and v_them.queue_position is not null then
    raise exception 'esa persona ya tiene pareja en la cola' using errcode = '55000';
  end if;

  v_team := public.ensure_team(p_room_id, v_uid, p_partner_id);

  select coalesce(max(queue_position), 0) + 1 into v_pos
  from public.room_members where room_id = p_room_id;

  update public.room_members
  set team_id = v_team.id, queue_position = v_pos, seeking_partner = false
  where room_id = p_room_id and profile_id in (v_uid, p_partner_id);

  perform public.notify_room(p_room_id, 'queue_changed', jsonb_build_object('team_id', v_team.id));
  return v_team;
end;
$$;

create or replace function public.leave_queue(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me public.room_members;
begin
  select * into v_me from public.room_members where room_id = p_room_id and profile_id = v_uid;
  if not found then return; end if;

  -- Salirse deshace la pareja: el compañero vuelve a quedar suelto.
  if v_me.team_id is not null then
    update public.room_members
    set queue_position = null, team_id = null, seeking_partner = true
    where room_id = p_room_id and team_id = v_me.team_id and profile_id <> v_uid;
  end if;

  update public.room_members
  set queue_position = null, team_id = null, seeking_partner = false
  where id = v_me.id;

  perform public.notify_room(p_room_id, 'queue_changed', jsonb_build_object('profile_id', v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos: nada es ejecutable por anónimos sin sesión.
-- ---------------------------------------------------------------------------
revoke all on function public.gen_room_code() from public;
revoke all on function public.ensure_team(uuid, uuid, uuid) from public;
revoke all on function public.notify_room(uuid, text, jsonb) from public;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.shares_room_with(uuid) to authenticated;
grant execute on function public.create_room(int, int, boolean) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.take_seat(uuid, smallint) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.set_room_config(uuid, int, int, boolean) to authenticated;
grant execute on function public.request_turn(uuid) to authenticated;
grant execute on function public.pair_with(uuid, uuid) to authenticated;
grant execute on function public.leave_queue(uuid) to authenticated;;
