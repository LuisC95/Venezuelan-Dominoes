-- Un bot no es tu pareja frecuente.
--
-- `top_partner` alimenta el badge del perfil, y con dos bots en la mesa era
-- cuestión de tiempo que "La Máquina" saliera como la pareja con la que más
-- juegas. El historial de partidas sí los sigue nombrando: esas partidas se
-- jugaron y con quién fue parte de lo que pasó.

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
    -- La pareja con la que más ha jugado, para el badge. Los bots no cuentan:
    -- rellenan un puesto, no son tu pareja de verdad por mucho que se repitan.
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
       and not partner.is_bot
      where m.status = 'finished' and v_id in (t.player_a_id, t.player_b_id)
      group by partner.id, partner.display_name
      order by count(*) desc
      limit 1
    ),
    -- El historial sí los muestra: esas partidas se jugaron, y con quién fue
    -- parte de lo que pasó.
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

grant execute on function public.get_profile_history(uuid, int) to authenticated;
