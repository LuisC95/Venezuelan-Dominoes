-- Perfil ligero por jugador. El id es el auth.uid() de la sesión anónima:
-- mientras el navegador conserve la sesión, el jugador es el mismo (clave para reconectar).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 24),
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Deny-by-default: sin políticas de escritura. Todo pasa por RPC SECURITY DEFINER.
-- La visibilidad "solo quien comparte sala" se añade en la migración de salas;
-- por ahora cada quien ve el suyo.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- Crea o actualiza el perfil del usuario autenticado. Es la única vía de escritura.
create or replace function public.ensure_profile(p_display_name text, p_avatar_url text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_display_name);
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'el nombre no puede estar vacío' using errcode = '22023';
  end if;

  insert into public.profiles as p (id, display_name, avatar_url)
  values (v_uid, left(v_name, 24), p_avatar_url)
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url   = coalesce(excluded.avatar_url, p.avatar_url)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ensure_profile(text, text) from public;
grant execute on function public.ensure_profile(text, text) to authenticated;;
