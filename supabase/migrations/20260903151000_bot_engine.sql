-- El bot que juega.
--
-- Vive dentro del motor, en Postgres, y se dispara solo: al final de cada
-- jugada, si el turno cae en un bot, juega. No hace falta ni cron ni proceso
-- aparte, y el aviso por Realtime sale igual que con un humano.
--
-- IMPORTANTE — el bot NO hace trampa. Corriendo aquí dentro tendría acceso a
-- `hand_tiles` completo, o sea a las fichas de los cuatro: lo que protege a los
-- humanos (RLS + auth.uid()) no lo limita a él. `bot_elige` mira solo:
--   · sus propias fichas          (ht.seat = p_seat)
--   · el tablero                  (state = 'played')
--   · los pases de la mesa        (hand_moves, información pública)
-- Si alguien toca esta función, esa es la línea que no se cruza.

-- ---------------------------------------------------------------------------
-- Aplicar una jugada, ya autorizada
-- ---------------------------------------------------------------------------

-- Es el cuerpo que tenía play_tile de la ficha para abajo. Se separa para que
-- el bot pueda jugar sin fingir una sesión: play_tile hace los controles de
-- quién eres y llama aquí; el bot comprueba que el asiento es suyo y llama aquí.
-- NO valida permisos — eso es responsabilidad de quien la llama.
create or replace function public.apply_play(
  p_hand_id uuid,
  p_seat smallint,
  p_player_id uuid,
  p_tile text,
  p_side text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
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
  v_prev_left smallint;
  v_prev_right smallint;
  v_capicua boolean := false;
  v_left_over int;
begin
  select * into v_hand from public.hands where id = p_hand_id for update;
  if not found then raise exception 'mano inexistente' using errcode = 'P0002'; end if;
  if v_hand.status <> 'active' then raise exception 'esa mano ya terminó' using errcode = '55000'; end if;

  select * into v_ht from public.hand_tiles
  where hand_id = p_hand_id and player_id = p_player_id and tile = p_tile and state = 'in_hand';
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
  v_prev_left := v_hand.left_end;
  v_prev_right := v_hand.right_end;

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

  insert into public.hand_moves
    (hand_id, player_id, seat, move_type, tile, side, move_number, left_end, right_end)
  values
    (p_hand_id, p_player_id, p_seat, 'play', p_tile, v_side, v_hand.move_count + 1,
     v_prev_left, v_prev_right);

  update public.hands set
    left_end = v_left,
    right_end = v_right,
    move_count = move_count + 1,
    consecutive_passes = 0,
    turn_started_at = now()
  where id = p_hand_id
  returning * into v_hand;

  perform public.notify_match(v_hand.match_id, 'move', jsonb_build_object(
    'hand_id', p_hand_id, 'seat', p_seat, 'tile', p_tile, 'side', v_side, 'move_number', v_hand.move_count
  ));

  select count(*) into v_left_over from public.hand_tiles
  where hand_id = p_hand_id and player_id = p_player_id and state = 'in_hand';

  if v_left_over = 0 then
    perform public.resolve_hand(p_hand_id, 'domino', p_seat, v_capicua);
  else
    perform public.advance_turn(p_hand_id);
  end if;

  return jsonb_build_object('ok', true, 'capicua', v_capicua, 'tiles_left', v_left_over);
end;
$$;

-- ---------------------------------------------------------------------------
-- Jugar una ficha (lo que llama la app)
-- ---------------------------------------------------------------------------

create or replace function public.play_tile(p_hand_id uuid, p_tile text, p_side text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hand public.hands;
  v_match public.matches;
  v_seat smallint;
  v_res jsonb;
begin
  select * into v_hand from public.hands where id = p_hand_id for update;
  if not found then raise exception 'mano inexistente' using errcode = 'P0002'; end if;
  if v_hand.status <> 'active' then raise exception 'esa mano ya terminó' using errcode = '55000'; end if;

  select * into v_match from public.matches where id = v_hand.match_id;
  v_seat := (array_position(v_match.seat_map, v_uid) - 1)::smallint;

  if v_seat is null then raise exception 'no estás en esta mesa' using errcode = '42501'; end if;
  if v_seat <> v_hand.current_seat then raise exception 'no es tu turno' using errcode = '55000'; end if;

  v_res := public.apply_play(p_hand_id, v_seat, v_uid, p_tile, p_side);

  -- Si el turno cayó en un bot, juega ya: para quien está mirando, el bot
  -- responde en el mismo evento de Realtime que su propia jugada.
  perform public.play_bots(p_hand_id);

  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pases: dejar constancia de con qué puntas se pasó
-- ---------------------------------------------------------------------------

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
    -- Con las puntas del momento, que es lo que dice qué NO tiene esa persona.
    insert into public.hand_moves
      (hand_id, player_id, seat, move_type, move_number, left_end, right_end)
    values
      (p_hand_id, v_player, v_seat, 'pass', v_hand.move_count + 1,
       v_hand.left_end, v_hand.right_end);

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
-- El bot
-- ---------------------------------------------------------------------------

-- Cómo quedan las dos puntas si se juega esa ficha por ese lado: [izquierda,
-- derecha]. Jugar por la derecha deja intacta la izquierda y viceversa; la
-- punta nueva es el número de la ficha que NO casó con la punta que había.
create or replace function public.puntas_tras(
  p_tile text, p_side text, p_left smallint, p_right smallint
)
returns smallint[]
language sql immutable set search_path = '' as $$
  select case
    when p_left is null then
      array[public.tile_hi(p_tile), public.tile_lo(p_tile)]::smallint[]
    when p_side = 'r' then array[
      p_left,
      case when public.tile_hi(p_tile) = p_right then public.tile_lo(p_tile)
           else public.tile_hi(p_tile) end
    ]::smallint[]
    else array[
      case when public.tile_hi(p_tile) = p_left then public.tile_lo(p_tile)
           else public.tile_hi(p_tile) end,
      p_right
    ]::smallint[]
  end;
$$;

/*
 * La decisión del bot.
 *
 * Puntúa cada (ficha, lado) legal y se queda con la mejor. Los pesos están
 * arriba con nombre para que se puedan mover sin bucear en el código; el
 * torneo de scripts/bench-bots.mjs es lo que dice si moverlos sirvió.
 *
 * La idea, en orden de importancia:
 *   · cerrar la mano gana, no hay más que pensar
 *   · ahogar a un rival (dejarle dos puntas que ya demostró no tener) es lo
 *     más rentable que existe: se salta el turno y tú sigues jugando
 *   · ahogar a tu propia pareja es el error caro, y se castiga más de lo que
 *     se premia ahogar al rival
 *   · dejar puntas de las que tú tienes muchas te mantiene con jugada
 *   · los dobles estorban: sueltalos temprano
 *   · a igualdad de todo, descarga lo pesado, que es lo que cuenta en tranca
 */
create or replace function public.bot_elige(
  p_hand_id uuid,
  p_seat smallint,
  out o_tile text,
  out o_side text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  W_PUNTA_RIVAL  constant numeric := 10;   -- por cada punta que un rival no tiene
  W_AHOGO_RIVAL  constant numeric := 35;   -- las dos puntas: pasa seguro
  W_PUNTA_SOCIO  constant numeric := 12;   -- por cada punta que tu pareja no tiene
  W_AHOGO_SOCIO  constant numeric := 45;   -- ahogar a tu pareja: el error caro
  W_AHOGO_MESA   constant numeric := 40;   -- no queda ninguna afuera: se traba
  W_RAREZA       constant numeric := 1.5;  -- cuanto menos quede afuera, mejor
  W_MIS_PUNTAS   constant numeric := 5;    -- por cada ficha mía que seguiría calzando
  W_DOBLE        constant numeric := 10;
  W_PIPS         constant numeric := 1;

  v_hand public.hands;
  v_match public.matches;
  v_socio smallint;
  v_riv1 smallint;
  v_riv2 smallint;
  -- Indexados 1..7 para los números 0..6.
  v_falta_socio boolean[] := array_fill(false, array[7]);
  v_falta_riv1 boolean[] := array_fill(false, array[7]);
  v_falta_riv2 boolean[] := array_fill(false, array[7]);
  v_desc int[] := array_fill(0, array[7]);
  v_mias int;
  v_quedan int;
  v_bool boolean;
  v_int int;
  v_puntas smallint[];
  v_a smallint;
  v_b smallint;
  v_score numeric;
  v_mejor numeric := -1e9;
  i int;
  r record;
begin
  select * into v_hand from public.hands where id = p_hand_id;
  select * into v_match from public.matches where id = v_hand.match_id;

  v_socio := ((p_seat + 2) % 4)::smallint;
  v_riv1  := ((p_seat + 1) % 4)::smallint;
  v_riv2  := ((p_seat + 3) % 4)::smallint;

  for i in 0..6 loop
    -- Quien pasó con ese número en una punta, no lo tiene. Es certeza, no cálculo.
    select exists (select 1 from public.hand_moves m
      where m.hand_id = p_hand_id and m.move_type = 'pass' and m.seat = v_socio
        and (m.left_end = i or m.right_end = i)) into v_bool;
    v_falta_socio[i + 1] := v_bool;

    select exists (select 1 from public.hand_moves m
      where m.hand_id = p_hand_id and m.move_type = 'pass' and m.seat = v_riv1
        and (m.left_end = i or m.right_end = i)) into v_bool;
    v_falta_riv1[i + 1] := v_bool;

    select exists (select 1 from public.hand_moves m
      where m.hand_id = p_hand_id and m.move_type = 'pass' and m.seat = v_riv2
        and (m.left_end = i or m.right_end = i)) into v_bool;
    v_falta_riv2[i + 1] := v_bool;

    -- Cuántas fichas con ese número siguen fuera de mi vista: 7 en total, menos
    -- las que están en la mesa y las que tengo yo.
    select 7 - count(*) into v_int
    from public.hand_tiles ht
    where ht.hand_id = p_hand_id
      and (public.tile_hi(ht.tile) = i or public.tile_lo(ht.tile) = i)
      and (ht.state = 'played' or ht.seat = p_seat);
    v_desc[i + 1] := v_int;
  end loop;

  select count(*) into v_quedan from public.hand_tiles ht
  where ht.hand_id = p_hand_id and ht.seat = p_seat and ht.state = 'in_hand';

  for r in
    select ht.tile, s.side
    from public.hand_tiles ht
    cross join lateral unnest(
      public.tile_sides(ht.tile, v_hand.left_end, v_hand.right_end)
    ) as s(side)
    where ht.hand_id = p_hand_id and ht.seat = p_seat and ht.state = 'in_hand'
    -- Orden fijo: la decisión es reproducible, que es lo que hace testeable al bot.
    order by ht.tile, s.side
  loop
    if v_quedan = 1 then
      -- Es la última: se acabó la mano.
      v_score := 1e6 + public.tile_pips(r.tile);
    elsif v_hand.left_end is null then
      -- Salida: el doble más alto, y si no, lo más pesado. Es la convención y
      -- además deja el doble fuera de la mano, que es donde estorba.
      v_score := public.tile_pips(r.tile) * 3
               + case when public.tile_hi(r.tile) = public.tile_lo(r.tile) then 40 else 0 end;
    else
      v_puntas := public.puntas_tras(r.tile, r.side, v_hand.left_end, v_hand.right_end);
      v_a := v_puntas[1];
      v_b := v_puntas[2];
      v_score := 0;

      -- Rivales: cada punta que no tienen es un paso más cerca de ahogarlos.
      if v_falta_riv1[v_a + 1] then v_score := v_score + W_PUNTA_RIVAL; end if;
      if v_falta_riv1[v_b + 1] then v_score := v_score + W_PUNTA_RIVAL; end if;
      if v_falta_riv1[v_a + 1] and v_falta_riv1[v_b + 1] then v_score := v_score + W_AHOGO_RIVAL; end if;
      if v_falta_riv2[v_a + 1] then v_score := v_score + W_PUNTA_RIVAL; end if;
      if v_falta_riv2[v_b + 1] then v_score := v_score + W_PUNTA_RIVAL; end if;
      if v_falta_riv2[v_a + 1] and v_falta_riv2[v_b + 1] then v_score := v_score + W_AHOGO_RIVAL; end if;

      -- La pareja: dejarla sin jugada cuesta más de lo que vale ahogar a uno.
      if v_falta_socio[v_a + 1] then v_score := v_score - W_PUNTA_SOCIO; end if;
      if v_falta_socio[v_b + 1] then v_score := v_score - W_PUNTA_SOCIO; end if;
      if v_falta_socio[v_a + 1] and v_falta_socio[v_b + 1] then v_score := v_score - W_AHOGO_SOCIO; end if;

      -- Si de ninguna de las dos puntas queda nada afuera, la mesa se traba.
      if v_desc[v_a + 1] = 0 and v_desc[v_b + 1] = 0 then
        v_score := v_score + W_AHOGO_MESA;
      end if;
      v_score := v_score + W_RAREZA * (14 - v_desc[v_a + 1] - v_desc[v_b + 1]);

      -- Que las puntas que quedan sean de las mías: seguir teniendo jugada.
      select count(*) into v_mias from public.hand_tiles ht
      where ht.hand_id = p_hand_id and ht.seat = p_seat and ht.state = 'in_hand'
        and ht.tile <> r.tile
        and (public.tile_hi(ht.tile) in (v_a, v_b) or public.tile_lo(ht.tile) in (v_a, v_b));
      v_score := v_score + W_MIS_PUNTAS * v_mias;

      if public.tile_hi(r.tile) = public.tile_lo(r.tile) then
        v_score := v_score + W_DOBLE;
      end if;
      v_score := v_score + W_PIPS * public.tile_pips(r.tile);
    end if;

    if v_score > v_mejor then
      v_mejor := v_score;
      o_tile := r.tile;
      o_side := r.side;
    end if;
  end loop;
end;
$$;

-- Juega por todos los bots que tengan el turno, uno tras otro, hasta que le
-- toque a un humano o se acabe la mano.
create or replace function public.play_bots(p_hand_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hand public.hands;
  v_match public.matches;
  v_player uuid;
  v_es_bot boolean;
  v_tile text;
  v_side text;
  i int := 0;
begin
  loop
    i := i + 1;
    exit when i > 30;  -- una mano no da para más de 28 jugadas

    select * into v_hand from public.hands where id = p_hand_id;
    exit when v_hand.status <> 'active';

    select * into v_match from public.matches where id = v_hand.match_id;
    v_player := v_match.seat_map[v_hand.current_seat + 1];

    select coalesce(p.is_bot, false) into v_es_bot from public.profiles p where p.id = v_player;
    exit when not v_es_bot;

    select o_tile, o_side into v_tile, v_side
    from public.bot_elige(p_hand_id, v_hand.current_seat);
    -- No debería pasar: advance_turn solo se detiene en quien tiene jugada.
    exit when v_tile is null;

    perform public.apply_play(p_hand_id, v_hand.current_seat, v_player, v_tile, v_side);
  end loop;
end;
$$;

-- Internas: solo las llama el motor. Ver la trampa 1 de AGENTS.md.
revoke all on function public.apply_play(uuid, smallint, uuid, text, text) from public, anon, authenticated;
revoke all on function public.bot_elige(uuid, smallint) from public, anon, authenticated;
revoke all on function public.play_bots(uuid) from public, anon, authenticated;
revoke all on function public.puntas_tras(text, text, smallint, smallint) from public, anon, authenticated;
grant execute on function public.play_tile(uuid, text, text) to authenticated;
