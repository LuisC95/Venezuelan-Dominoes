-- Lectura del chat.
--
-- La tabla y `send_message` existían desde la etapa 2, pero no había por dónde
-- leer: faltaba la mitad de la etapa 9. Va como RPC y no como select directo a
-- `room_messages` para no romper el patrón —toda lectura sale de una función
-- SECURITY DEFINER que devuelve jsonb recortado— y para traer el nombre ya
-- resuelto en la misma llamada.
--
-- Devuelve `now` por la misma razón que `get_game_state`: las burbujas de la
-- mesa se apagan contando contra `created_at`, y esa cuenta se mide con el
-- reloj del servidor, no con el del teléfono (ver la trampa 6 de AGENTS.md).
--
-- Función NUEVA: lleva su `grant execute` explícito al final. Sin eso el
-- `revoke` de 20260903025802 la dejaría sin permisos, y con el `grant` por
-- defecto de Supabase habría quedado abierta sin decidirlo.

create or replace function public.get_messages(p_room_id uuid, p_limit int default 30)
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_room_member(p_room_id) then
    raise exception 'no estás en esta sala' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'now', now(),
    -- Los últimos N, pero devueltos del más viejo al más nuevo: es el orden en
    -- que se pintan y así el cliente no tiene que darle la vuelta.
    'messages', coalesce((
      select jsonb_agg(m order by m.created_at)
      from (
        select
          rm.id,
          rm.profile_id,
          p.display_name,
          rm.kind,
          rm.body,
          rm.created_at,
          rm.profile_id = v_uid as mine
        from public.room_messages rm
        join public.profiles p on p.id = rm.profile_id
        where rm.room_id = p_room_id
        order by rm.created_at desc
        limit least(greatest(coalesce(p_limit, 30), 1), 100)
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

-- Explícito en las dos direcciones, como manda la migración de candados:
-- nadie sin sesión, y con sesión solo pasa el filtro de is_room_member.
revoke execute on function public.get_messages(uuid, int) from anon, public;
grant execute on function public.get_messages(uuid, int) to authenticated;
