-- Bots para rellenar puestos vacíos: esquema.
--
-- Dos cosas que el motor no podía representar todavía.
--
-- 1) IDENTIDAD. `profiles.id` era FK a `auth.users`, así que todo jugador tenía
--    que ser una sesión real. Un bot no la tiene ni debe tenerla. Se cambia la
--    FK por un trigger que exige lo mismo *solo para humanos*: así un perfil
--    humano sigue sin poder existir sin su usuario, y el bot puede.
--
--    Se pierde el `on delete cascade` que borraba el perfil al borrar el
--    usuario. No es una regresión práctica: AGENTS.md ya dice que no se borra
--    `auth.users` (invalida las sesiones cacheadas de las pruebas).
--
-- 2) MEMORIA DE LOS PASES. Un pase es la información más valiosa de la mesa:
--    quien pasa con puntas 3 y 5 no tiene NINGÚN 3 ni NINGÚN 5, y eso vale el
--    resto de la mano. Pero `hand_moves` no guardaba las puntas del momento, y
--    reconstruirlas después es un lío. Se guardan al registrar la jugada.

-- --- 1) identidad ------------------------------------------------------------

alter table public.profiles add column is_bot boolean not null default false;

alter table public.profiles drop constraint profiles_id_fkey;

create or replace function public.profiles_humano_con_sesion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_bot and not exists (select 1 from auth.users u where u.id = new.id) then
    raise exception 'un perfil humano necesita su usuario de auth' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger profiles_humano_con_sesion
  before insert or update on public.profiles
  for each row execute function public.profiles_humano_con_sesion();

revoke all on function public.profiles_humano_con_sesion() from public, anon, authenticated;

-- Los cuatro de la casa. Ids fijos para que sean los mismos en cualquier
-- entorno; en una mesa caben dos como mucho (lo impone add_bot).
insert into public.profiles (id, display_name, is_bot) values
  ('b0000000-0000-4000-8000-000000000001', 'La Máquina', true),
  ('b0000000-0000-4000-8000-000000000002', 'El Compa',   true),
  ('b0000000-0000-4000-8000-000000000003', 'Robotico',   true),
  ('b0000000-0000-4000-8000-000000000004', 'La Doña',    true)
on conflict (id) do update set display_name = excluded.display_name, is_bot = true;

-- --- 2) memoria de los pases -------------------------------------------------

-- Las puntas ANTES de la jugada. En un pase son justo los números que esa
-- persona no tiene; en una jugada sirven para reconstruir la mano.
alter table public.hand_moves
  add column left_end smallint check (left_end between 0 and 6),
  add column right_end smallint check (right_end between 0 and 6);

comment on column public.hand_moves.left_end is
  'Punta izquierda antes de la jugada. En un pase: número que el jugador NO tiene.';
comment on column public.hand_moves.right_end is
  'Punta derecha antes de la jugada. En un pase: número que el jugador NO tiene.';
