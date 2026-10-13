create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists decoy_locations (
  id bigserial primary key,
  theme text not null,
  location_name text not null,
  coords text not null
);

create table if not exists islands (
  id bigserial primary key,
  theme text not null,
  location_name text not null,
  coords text not null,
  is_fixed boolean not null default false,
  fixed_order int unique
);

create table if not exists teams (
  id bigserial primary key,
  name text not null unique,
  login_code text not null unique,
  route int[] not null,
  current_step int not null default 1,
  status text not null default 'travelling' check (status in ('travelling', 'awaiting', 'astray')),
  decoy_id bigint references decoy_locations(id),
  session_token text,
  last_seen timestamptz,
  finished_at timestamptz
);

create table if not exists ledger (
  id bigserial primary key,
  team_id bigint not null references teams(id) on delete cascade,
  amount integer not null,
  reason text not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  id int primary key default 1,
  keeper_password text not null,
  admin_password text not null,
  keeper_word text not null,
  constraint single_settings_row check (id = 1)
);

create table if not exists team_word_attempts (
  team_id bigint primary key references teams(id) on delete cascade,
  failed_count int not null default 0,
  locked_until timestamptz
);

create table if not exists operator_sessions (
  token text primary key,
  role text not null check (role in ('keeper', 'admin')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create or replace function build_route_for_new_crew()
returns int[]
language plpgsql
security definer
set search_path = public
as $$
declare
  non_fixed_ids int[];
  fixed6 int;
  fixed7 int;
  team_count int;
  first_slot int;
  first_id int;
  route int[];
begin
  select array_agg(id order by id)
  into non_fixed_ids
  from (
    select id
    from islands
    where not is_fixed
    order by id
    limit 5
  ) non_fixed;
  if non_fixed_ids is null or array_length(non_fixed_ids, 1) <> 5 then
    raise exception 'At least five non-fixed islands are required.';
  end if;

  select id into fixed6 from islands where is_fixed and fixed_order = 6 limit 1;
  select id into fixed7 from islands where is_fixed and fixed_order = 7 limit 1;
  if fixed6 is null or fixed7 is null then
    raise exception 'Fixed islands for order 6 and 7 are required.';
  end if;

  select count(*) into team_count from teams;
  first_slot := (team_count % 5) + 1;
  first_id := non_fixed_ids[first_slot];

  select array[first_id] || coalesce(array_agg(id), '{}') into route
  from (
    select id
    from unnest(non_fixed_ids) as id
    where id <> first_id
    order by random()
  ) shuffled;

  route := route || array[fixed6, fixed7];
  return route;
end;
$$;

create or replace function app_require_operator(p_token text, p_admin_only boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  delete from operator_sessions where created_at < now() - interval '1 day';

  select role into v_role
  from operator_sessions
  where token = p_token;

  if v_role is null then
    raise exception 'Operator session expired.';
  end if;

  if p_admin_only and v_role <> 'admin' then
    raise exception 'Admin authority required.';
  end if;

  update operator_sessions set last_seen = now() where token = p_token;
  return v_role;
end;
$$;

create or replace function app_require_team(p_team_id bigint, p_token text)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
begin
  select * into v_team from teams where id = p_team_id;

  if not found then
    raise exception 'Crew not found.';
  end if;

  if v_team.session_token is distinct from p_token then
    raise exception 'This crew is active on another device';
  end if;

  update teams set last_seen = now() where id = p_team_id;
  return v_team;
end;
$$;

create or replace function app_login_role(p_role text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings settings;
  v_token text;
  v_role text;
begin
  v_role := lower(trim(p_role));
  if v_role not in ('keeper', 'admin') then
    raise exception 'Unknown role.';
  end if;

  select * into v_settings from settings where id = 1;
  if v_settings.id is null then
    raise exception 'Settings are not initialized.';
  end if;

  if (v_role = 'keeper' and v_settings.keeper_password <> p_password)
     or (v_role = 'admin' and v_settings.admin_password <> p_password) then
    raise exception 'That password is not known.';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into operator_sessions(token, role) values (v_token, v_role);

  return jsonb_build_object('role', v_role, 'token', v_token);
end;
$$;

create or replace function app_login_crew(p_login_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team teams;
  v_token text;
begin
  select * into v_team
  from teams
  where upper(login_code) = upper(trim(p_login_code));

  if v_team.id is null then
    raise exception 'That crew code is not known.';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  update teams
  set session_token = v_token,
      last_seen = now()
  where id = v_team.id;

  return jsonb_build_object(
    'team_id', v_team.id,
    'team_name', v_team.name,
    'token', v_token
  );
end;
$$;

create or replace function app_leaderboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_id bigint;
begin
  select id into v_winner_id
  from teams
  where finished_at is not null
  order by finished_at asc, id asc
  limit 1;

  return coalesce((
    with score_board as (
      select
        t.id,
        t.name,
        coalesce(sum(l.amount), 0)::int as total_points,
        least(greatest(t.current_step - 1, 0), 7) as islands_completed,
        t.finished_at
      from teams t
      left join ledger l on l.team_id = t.id
      group by t.id
    ), ranked as (
      select
        row_number() over (order by total_points desc, finished_at asc nulls last, name asc) as rank,
        id,
        name,
        total_points,
        islands_completed,
        finished_at,
        (id = v_winner_id) as winner
      from score_board
    )
    select jsonb_agg(jsonb_build_object(
      'rank', rank,
      'team_id', id,
      'team_name', name,
      'total_points', total_points,
      'islands_completed', islands_completed,
      'finished_at', finished_at,
      'winner', winner
    ) order by rank)
    from ranked
  ), '[]'::jsonb);
end;
$$;

create or replace function app_crew_state(p_team_id bigint, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
  v_score int;
  v_theme text;
  v_coords text;
  v_location text;
  v_island_id int;
  v_wait_seconds int;
  v_locked_until timestamptz;
begin
  v_team := app_require_team(p_team_id, p_token);
  select coalesce(sum(amount), 0) into v_score from ledger where team_id = v_team.id;

  select locked_until into v_locked_until from team_word_attempts where team_id = v_team.id;
  if v_locked_until is not null and v_locked_until > now() then
    v_wait_seconds := ceil(extract(epoch from (v_locked_until - now())))::int;
  else
    v_wait_seconds := 0;
  end if;

  if v_team.finished_at is null then
    if v_team.status = 'astray' then
      select theme, coords, location_name into v_theme, v_coords, v_location
      from decoy_locations where id = v_team.decoy_id;
    else
      v_island_id := v_team.route[least(v_team.current_step, 7)];
      select theme, coords, location_name into v_theme, v_coords, v_location
      from islands where id = v_island_id;
    end if;
  end if;

  return jsonb_build_object(
    'team_name', v_team.name,
    'score', v_score,
    'status', v_team.status,
    'current_step', least(v_team.current_step, 7),
    'total_steps', 7,
    'theme', v_theme,
    'location_name', v_location,
    'coords', v_coords,
    'finished_at', v_team.finished_at,
    'wait_seconds', greatest(v_wait_seconds, 0),
    'leaderboard', app_leaderboard()
  );
end;
$$;

create or replace function app_submit_keeper_word(p_team_id bigint, p_token text, p_word text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
  v_settings settings;
  v_attempts team_word_attempts;
  v_word text;
  v_wait_seconds int;
begin
  v_team := app_require_team(p_team_id, p_token);
  select * into v_settings from settings where id = 1;

  if v_team.finished_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Ithaca reached.');
  end if;

  if v_team.status = 'awaiting' then
    return jsonb_build_object('ok', false, 'message', 'Awaiting the Keeper''s judgment');
  end if;

  if v_team.status = 'astray' then
    return jsonb_build_object('ok', false, 'message', 'That word is not known.');
  end if;

  select * into v_attempts
  from team_word_attempts
  where team_id = v_team.id
  for update;

  if not found then
    insert into team_word_attempts(team_id, failed_count, locked_until)
    values (v_team.id, 0, null)
    returning * into v_attempts;
  end if;

  if v_attempts.locked_until is not null and v_attempts.locked_until > now() then
    v_wait_seconds := ceil(extract(epoch from (v_attempts.locked_until - now())))::int;
    return jsonb_build_object('ok', false, 'message', format('Thy crew is lost: wait %s seconds', greatest(v_wait_seconds, 1)));
  end if;

  v_word := upper(trim(coalesce(p_word, '')));
  if v_word <> upper(v_settings.keeper_word) then
    update team_word_attempts
    set failed_count = case when failed_count + 1 >= 5 then 0 else failed_count + 1 end,
        locked_until = case when failed_count + 1 >= 5 then now() + interval '30 seconds' else null end
    where team_id = v_team.id;

    if (select locked_until from team_word_attempts where team_id = v_team.id) > now() then
      return jsonb_build_object('ok', false, 'message', 'Thy crew is lost: wait 30 seconds');
    end if;

    return jsonb_build_object('ok', false, 'message', 'That word is not known.');
  end if;

  update team_word_attempts
  set failed_count = 0,
      locked_until = null
  where team_id = v_team.id;

  update teams
  set status = 'awaiting',
      decoy_id = null,
      last_seen = now()
  where id = v_team.id;

  return jsonb_build_object('ok', true, 'message', 'Awaiting the Keeper''s judgment');
end;
$$;

create or replace function app_complete_grant(p_team_id bigint, p_amount int, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
  v_current_island islands;
  v_next_step int;
begin
  select * into v_team from teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception 'Crew not found.';
  end if;
  if v_team.status <> 'awaiting' then
    raise exception 'Crew is not awaiting judgment.';
  end if;
  if v_team.finished_at is not null then
    raise exception 'Crew has already reached Ithaca.';
  end if;

  select * into v_current_island from islands where id = v_team.route[least(v_team.current_step, 7)];

  insert into ledger(team_id, amount, reason, actor)
  values (v_team.id, p_amount, p_reason, p_actor);

  v_next_step := v_team.current_step + 1;

  if v_team.current_step >= 7 then
    update teams
    set current_step = 8,
        status = 'travelling',
        decoy_id = null,
        finished_at = now(),
        last_seen = now()
    where id = v_team.id;
  else
    update teams
    set current_step = v_next_step,
        status = 'travelling',
        decoy_id = null,
        last_seen = now()
    where id = v_team.id;
  end if;
end;
$$;

create or replace function app_grant(p_token text, p_team_id bigint, p_points int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_team teams;
  v_island islands;
begin
  v_role := app_require_operator(p_token, false);
  select * into v_team from teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Crew not found.';
  end if;

  select * into v_island from islands where id = v_team.route[least(v_team.current_step, 7)];

  perform app_complete_grant(
    v_team.id,
    p_points,
    format('Grant at %s', v_island.theme),
    v_role
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_send_astray(p_token text, p_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_team teams;
  v_island islands;
  v_decoy_id bigint;
begin
  v_role := app_require_operator(p_token, false);
  select * into v_team from teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception 'Crew not found.';
  end if;
  if v_team.status <> 'awaiting' then
    raise exception 'Crew is not awaiting judgment.';
  end if;

  select * into v_island from islands where id = v_team.route[least(v_team.current_step, 7)];
  if upper(v_island.theme) <> 'SIREN' then
    raise exception 'Send astray is only for Siren island.';
  end if;

  select id into v_decoy_id from decoy_locations order by id asc limit 1;
  if v_decoy_id is null then
    raise exception 'At least one decoy location is required.';
  end if;

  update teams
  set status = 'astray',
      decoy_id = v_decoy_id,
      last_seen = now()
  where id = v_team.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_return_to_siren(p_token text, p_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_team teams;
begin
  v_role := app_require_operator(p_token, false);
  select * into v_team from teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception 'Crew not found.';
  end if;

  if v_team.status <> 'astray' then
    raise exception 'Crew is not astray.';
  end if;

  update teams
  set status = 'travelling',
      decoy_id = null,
      last_seen = now()
  where id = v_team.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_adjust_points(p_token text, p_team_id bigint, p_amount int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_reason text;
begin
  v_role := app_require_operator(p_token, false);
  v_reason := trim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'A reason is required.';
  end if;

  if not exists(select 1 from teams where id = p_team_id) then
    raise exception 'Crew not found.';
  end if;

  insert into ledger(team_id, amount, reason, actor)
  values (p_team_id, p_amount, v_reason, v_role);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_admin_add_crew_internal(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
  v_code text;
  v_id bigint;
  v_route int[];
begin
  v_name := trim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Crew name is required.';
  end if;

  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists(select 1 from teams where login_code = v_code);
  end loop;

  v_route := build_route_for_new_crew();

  insert into teams(name, login_code, route, current_step, status)
  values (v_name, v_code, v_route, 1, 'travelling')
  returning id into v_id;

  insert into team_word_attempts(team_id) values (v_id) on conflict (team_id) do nothing;

  return jsonb_build_object('id', v_id, 'name', v_name, 'login_code', v_code);
end;
$$;

create or replace function app_admin_add_crew_secure(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);
  return app_admin_add_crew_internal(p_name);
end;
$$;

create or replace function app_admin_remove_crew(p_token text, p_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);
  delete from teams where id = p_team_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_admin_release_device(p_token text, p_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);
  update teams set session_token = null, last_seen = now() where id = p_team_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_admin_save_island(
  p_token text,
  p_id bigint,
  p_theme text,
  p_location_name text,
  p_coords text,
  p_is_fixed boolean,
  p_fixed_order int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);

  if p_is_fixed and p_fixed_order not in (6, 7) then
    raise exception 'Fixed islands must have order 6 or 7.';
  end if;

  if not p_is_fixed and p_fixed_order is not null then
    raise exception 'Non-fixed islands cannot have fixed order.';
  end if;

  update islands
  set theme = trim(p_theme),
      location_name = trim(p_location_name),
      coords = trim(p_coords),
      is_fixed = p_is_fixed,
      fixed_order = p_fixed_order
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_admin_save_decoy(
  p_token text,
  p_id bigint,
  p_theme text,
  p_location_name text,
  p_coords text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);

  if p_id is null or p_id = 0 then
    insert into decoy_locations(theme, location_name, coords)
    values (trim(p_theme), trim(p_location_name), trim(p_coords));
  else
    update decoy_locations
    set theme = trim(p_theme),
        location_name = trim(p_location_name),
        coords = trim(p_coords)
    where id = p_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_admin_save_settings(
  p_token text,
  p_keeper_word text,
  p_keeper_password text,
  p_admin_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);

  update settings
  set keeper_word = trim(coalesce(p_keeper_word, keeper_word)),
      keeper_password = coalesce(nullif(trim(p_keeper_password), ''), keeper_password),
      admin_password = coalesce(nullif(trim(p_admin_password), ''), admin_password)
  where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function app_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  v_role := app_require_operator(p_token, false);
  select jsonb_build_object(
    'role', v_role,
    'awaiting', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', t.id,
        'team_name', t.name,
        'theme', i.theme,
        'location_name', i.location_name,
        'coords', i.coords
      ) order by t.name)
      from teams t
      join islands i on i.id = t.route[least(t.current_step, 7)]
      where t.status = 'awaiting' and t.finished_at is null
    ), '[]'::jsonb),
    'astray', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', t.id,
        'team_name', t.name,
        'theme', d.theme,
        'location_name', d.location_name,
        'coords', d.coords
      ) order by t.name)
      from teams t
      join decoy_locations d on d.id = t.decoy_id
      where t.status = 'astray' and t.finished_at is null
    ), '[]'::jsonb),
    'ledger', app_leaderboard(),
    'crews', case when v_role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'login_code', t.login_code,
        'current_step', least(greatest(t.current_step, 1), 8),
        'status', t.status,
        'finished_at', t.finished_at,
        'session_active', (t.session_token is not null)
      ) order by t.name)
      from teams t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'islands', case when v_role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'theme', i.theme,
        'location_name', i.location_name,
        'coords', i.coords,
        'is_fixed', i.is_fixed,
        'fixed_order', i.fixed_order
      ) order by i.id)
      from islands i
    ), '[]'::jsonb) else '[]'::jsonb end,
    'decoys', case when v_role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'theme', d.theme,
        'location_name', d.location_name,
        'coords', d.coords
      ) order by d.id)
      from decoy_locations d
    ), '[]'::jsonb) else '[]'::jsonb end,
    'keeper_word', case when v_role = 'admin' then (select keeper_word from settings where id = 1) else null end,
    'ledger_history', case when v_role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'team_name', t.name,
        'amount', l.amount,
        'reason', l.reason,
        'actor', l.actor,
        'created_at', l.created_at
      ) order by l.created_at desc, l.id desc)
      from ledger l
      join teams t on t.id = l.team_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;

  return v_result;
end;
$$;

create or replace function app_export_results(p_token text)
returns table(rank int, crew text, total_points int, islands_completed int, finish_time timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_operator(p_token, true);

  return query
  with score_board as (
    select
      t.id,
      t.name,
      coalesce(sum(l.amount), 0)::int as total_points,
      least(greatest(t.current_step - 1, 0), 7) as islands_completed,
      t.finished_at
    from teams t
    left join ledger l on l.team_id = t.id
    group by t.id
  )
  select
    row_number() over (order by total_points desc, finished_at asc nulls last, name asc)::int as rank,
    name as crew,
    total_points,
    islands_completed,
    finished_at as finish_time
  from score_board
  order by rank;
end;
$$;

insert into islands(theme, location_name, coords, is_fixed, fixed_order)
select *
from (
  values
    ('Cyclops', 'LHC-D', '3.9', false, null),
    ('Lotus', 'SAC', '8.6', false, null),
    ('Siren', 'Suprabha', '6.3', false, null),
    ('Circe''s Pig', 'CCC', '7.9', false, null),
    ('Giant', 'NSC', '12.8', false, null),
    ('Whirlpool and Monster', 'MB', '4.5', true, 6),
    ('Suitors', 'Pavillion', '5.5', true, 7)
) as seed(theme, location_name, coords, is_fixed, fixed_order)
where not exists (select 1 from islands);

insert into decoy_locations(theme, location_name, coords)
select 'Hades'' Shore', '(placeholder)', '0.0'
where not exists (select 1 from decoy_locations);

insert into settings(id, keeper_password, admin_password, keeper_word)
values (1, 'keeper123', 'admin123', 'TESTWORD')
on conflict (id) do update
set keeper_password = excluded.keeper_password,
    admin_password = excluded.admin_password,
    keeper_word = excluded.keeper_word;

insert into teams(name, login_code, route, current_step, status)
select 'Argonaut Crew', 'CREW01', build_route_for_new_crew(), 1, 'travelling'
where not exists (select 1 from teams where login_code = 'CREW01');

insert into teams(name, login_code, route, current_step, status)
select 'Aeolian Crew', 'CREW02', build_route_for_new_crew(), 1, 'travelling'
where not exists (select 1 from teams where login_code = 'CREW02');

insert into teams(name, login_code, route, current_step, status)
select 'Achaean Crew', 'CREW03', build_route_for_new_crew(), 1, 'travelling'
where not exists (select 1 from teams where login_code = 'CREW03');

insert into team_word_attempts(team_id)
select id from teams
on conflict (team_id) do nothing;

alter table teams enable row level security;
alter table islands enable row level security;
alter table decoy_locations enable row level security;
alter table ledger enable row level security;
alter table settings enable row level security;
alter table team_word_attempts enable row level security;
alter table operator_sessions enable row level security;

revoke all on teams from anon, authenticated;
revoke all on islands from anon, authenticated;
revoke all on decoy_locations from anon, authenticated;
revoke all on ledger from anon, authenticated;
revoke all on settings from anon, authenticated;
revoke all on team_word_attempts from anon, authenticated;
revoke all on operator_sessions from anon, authenticated;

grant execute on function build_route_for_new_crew to anon, authenticated;
grant execute on function app_login_role(text, text) to anon, authenticated;
grant execute on function app_login_crew(text) to anon, authenticated;
grant execute on function app_leaderboard() to anon, authenticated;
grant execute on function app_crew_state(bigint, text) to anon, authenticated;
grant execute on function app_submit_keeper_word(bigint, text, text) to anon, authenticated;
grant execute on function app_grant(text, bigint, int) to anon, authenticated;
grant execute on function app_send_astray(text, bigint) to anon, authenticated;
grant execute on function app_return_to_siren(text, bigint) to anon, authenticated;
grant execute on function app_adjust_points(text, bigint, int, text) to anon, authenticated;
grant execute on function app_admin_add_crew_secure(text, text) to anon, authenticated;
grant execute on function app_admin_remove_crew(text, bigint) to anon, authenticated;
grant execute on function app_admin_release_device(text, bigint) to anon, authenticated;
grant execute on function app_admin_save_island(text, bigint, text, text, text, boolean, int) to anon, authenticated;
grant execute on function app_admin_save_decoy(text, bigint, text, text, text) to anon, authenticated;
grant execute on function app_admin_save_settings(text, text, text, text) to anon, authenticated;
grant execute on function app_snapshot(text) to anon, authenticated;
grant execute on function app_export_results(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'teams') then
      execute 'alter publication supabase_realtime add table teams';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ledger') then
      execute 'alter publication supabase_realtime add table ledger';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'islands') then
      execute 'alter publication supabase_realtime add table islands';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'decoy_locations') then
      execute 'alter publication supabase_realtime add table decoy_locations';
    end if;
  end if;
end;
$$;
