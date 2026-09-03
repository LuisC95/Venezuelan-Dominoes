-- ============================================================================
-- Estadísticas, historial y chat. Las estadísticas se mantienen por trigger:
-- así no dependen de que el cliente recuerde llamar a nada.
-- ============================================================================

create table public.player_stats (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  matches_played int not null default 0,
  matches_won int not null default 0,
  hands_won int not null default 0,
  trancas_won int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'chat' check (kind in ('chat', 'emote')),
  body text not null check (length(btrim(body)) between 1 and 140),
  created_at timestamptz not null default now()
);

create index room_messages_room_idx on public.room_messages (room_id, created_at desc);

alter table public.player_stats enable row level security;
alter table public.room_messages enable row level security;

-- Las estadísticas de perfil son públicas entre jugadores: son las que se ven
-- en la pantalla de historial y en el badge de pareja frecuente.
create policy player_stats_select on public.player_stats
  for select to authenticated using (true);

create policy room_messages_select_member on public.room_messages
  for select to authenticated using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- Mantenimiento de estadísticas
-- ---------------------------------------------------------------------------

create or replace function public.bump_player_stats(
  p_profile_id uuid,
  p_matches_played int default 0,
  p_matches_won int default 0,
  p_hands_won int default 0,
  p_trancas_won int default 0
) returns void language sql security definer set search_path = '' as $$
  insert into public.player_stats as s
    (profile_id, matches_played, matches_won, hands_won, trancas_won, updated_at)
  values (p_profile_id, p_matches_played, p_matches_won, p_hands_won, p_trancas_won, now())
  on conflict (profile_id) do update set
    matches_played = s.matches_played + excluded.matches_played,
    matches_won    = s.matches_won    + excluded.matches_won,
    hands_won      = s.hands_won      + excluded.hands_won,
    trancas_won    = s.trancas_won    + excluded.trancas_won,
    updated_at     = now();
$$;

-- Al cerrar una mano con ganador: cuenta la mano para los dos de la pareja.
create or replace function public.on_hand_finished() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_a uuid;
  v_b uuid;
  v_tranca int;
begin
  if new.status <> 'finished' or coalesce(old.status, '') = 'finished' then return new; end if;
  if new.winner_team_id is null then return new; end if;

  v_tranca := case when new.end_type = 'tranca' then 1 else 0 end;

  select player_a_id, player_b_id into v_a, v_b from public.teams where id = new.winner_team_id;

  update public.teams set trancas_won_count = trancas_won_count + v_tranca
  where id = new.winner_team_id;

  perform public.bump_player_stats(v_a, 0, 0, 1, v_tranca);
  perform public.bump_player_stats(v_b, 0, 0, 1, v_tranca);
  return new;
end;
$$;

create trigger hands_finished_stats
  after update of status on public.hands
  for each row execute function public.on_hand_finished();

-- Al cerrar una partida: partidas jugadas para los 4, ganadas para los 2, y se
-- recalcula el badge de "pareja frecuente" (3 partidas juntos o más).
create or replace function public.on_match_finished() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid;
  v_a uuid;
  v_b uuid;
  v_together int;
begin
  if new.status <> 'finished' or coalesce(old.status, '') = 'finished' then return new; end if;

  foreach v_player in array new.seat_map loop
    perform public.bump_player_stats(v_player, 1, 0, 0, 0);
  end loop;

  if new.winner_team_id is not null then
    update public.teams set wins_count = wins_count + 1 where id = new.winner_team_id;
    select player_a_id, player_b_id into v_a, v_b from public.teams where id = new.winner_team_id;
    perform public.bump_player_stats(v_a, 0, 1, 0, 0);
    perform public.bump_player_stats(v_b, 0, 1, 0, 0);
  end if;

  -- Pareja frecuente: se mira el histórico completo, cruzando salas.
  foreach v_player in array array[new.team_a_id, new.team_b_id] loop
    select t.player_a_id, t.player_b_id into v_a, v_b from public.teams t where t.id = v_player;

    select count(*) into v_together
    from public.matches m
    join public.teams t on t.id in (m.team_a_id, m.team_b_id)
    where m.status = 'finished'
      and least(t.player_a_id, t.player_b_id) = least(v_a, v_b)
      and greatest(t.player_a_id, t.player_b_id) = greatest(v_a, v_b);

    if v_together >= 3 then
      update public.teams set is_frequent_pair = true
      where least(player_a_id, player_b_id) = least(v_a, v_b)
        and greatest(player_a_id, player_b_id) = greatest(v_a, v_b);
    end if;
  end loop;

  return new;
end;
$$;

create trigger matches_finished_stats
  after update of status on public.matches
  for each row execute function public.on_match_finished();

-- ---------------------------------------------------------------------------
-- Historial de un jugador (pantalla de perfil)
-- ---------------------------------------------------------------------------

create or replace function public.get_profile_history(p_profile_id uuid default null, p_limit int default 12)
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare
  v_id uuid := coalesce(p_profile_id, auth.uid());
begin
  if auth.uid() is null then raise exception 'no autenticado' using errcode = '28000'; end if;

  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_id),
    'stats', coalesce(
      (select to_jsonb(s) from public.player_stats s where s.profile_id = v_id),
      jsonb_build_object('matches_played', 0, 'matches_won', 0, 'hands_won', 0, 'trancas_won', 0)
    ),
    -- La pareja con la que más ha jugado, para el badge.
    'top_partner', (
      select jsonb_build_object(
        'profile_id', partner.id,
        'display_name', partner.display_name,
        'matches', count(*),
        'won', count(*) filter (where m.winner_team_id = t.id),
        'is_frequent_pair', count(*) >= 3
      )
      from public.matches m
      join public.teams t on t.id in (m.team_a_id, m.team_b_id)
      join public.profiles partner
        on partner.id = case when t.player_a_id = v_id then t.player_b_id else t.player_a_id end
      where m.status = 'finished' and v_id in (t.player_a_id, t.player_b_id)
      group by partner.id, partner.display_name
      order by count(*) desc
      limit 1
    ),
    'matches', coalesce((
      select jsonb_agg(h order by h.finished_at desc)
      from (
        select
          m.id,
          r.code as room_code,
          m.finished_at,
          (m.winner_team_id = t.id) as won,
          case when t.id = m.team_a_id
               then m.score_a || '–' || m.score_b
               else m.score_b || '–' || m.score_a end as score,
          (select p2.display_name from public.profiles p2
            where p2.id = case when t.player_a_id = v_id then t.player_b_id else t.player_a_id end) as partner
        from public.matches m
        join public.rooms r on r.id = m.room_id
        join public.teams t on t.id in (m.team_a_id, m.team_b_id)
        where m.status = 'finished' and v_id in (t.player_a_id, t.player_b_id)
        order by m.finished_at desc
        limit greatest(1, least(p_limit, 50))
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat / emotes
-- ---------------------------------------------------------------------------

create or replace function public.send_message(p_room_id uuid, p_body text, p_kind text default 'chat')
returns public.room_messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.room_messages;
  v_recent int;
begin
  if not public.is_room_member(p_room_id) then
    raise exception 'no estás en esta sala' using errcode = '42501';
  end if;

  -- Freno simple contra el pana que se emociona con los emotes.
  select count(*) into v_recent from public.room_messages
  where room_id = p_room_id and profile_id = v_uid and created_at > now() - interval '10 seconds';
  if v_recent >= 8 then
    raise exception 'espera un momento antes de escribir de nuevo' using errcode = '53400';
  end if;

  insert into public.room_messages (room_id, profile_id, kind, body)
  values (p_room_id, v_uid, p_kind, left(btrim(p_body), 140))
  returning * into v_msg;

  perform public.notify_room(p_room_id, 'message', jsonb_build_object(
    'id', v_msg.id, 'profile_id', v_uid, 'kind', v_msg.kind, 'body', v_msg.body
  ));

  return v_msg;
end;
$$;

grant execute on function public.get_profile_history(uuid, int) to authenticated;
grant execute on function public.send_message(uuid, text, text) to authenticated;
revoke all on function public.bump_player_stats(uuid, int, int, int, int) from public;;
