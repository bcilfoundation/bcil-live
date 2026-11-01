-- BCIL Live: engagement — who listens to talks, attends live sessions and reads quotes; likes on quotes. Safe to run more than once.

-- ---------- listening to talks (per person, per talk, per day) ----------
create table if not exists public.talk_listens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  talk_id uuid not null references public.talks(id) on delete cascade,
  day date not null default current_date,
  seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, talk_id, day)
);
alter table public.talk_listens enable row level security;
drop policy if exists "see own listens" on public.talk_listens;
create policy "see own listens" on public.talk_listens for select to authenticated using (user_id = auth.uid() or is_staff());

create or replace function public.log_listen(p_talk uuid, p_seconds int, p_completed boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into talk_listens (user_id, talk_id, seconds, completed)
  values (auth.uid(), p_talk, greatest(0, least(coalesce(p_seconds, 0), 120)), coalesce(p_completed, false))
  on conflict (user_id, talk_id, day) do update
    set seconds = talk_listens.seconds + excluded.seconds,
        completed = talk_listens.completed or excluded.completed,
        updated_at = now();
end $$;

-- ---------- live session attendance (minutes in the room) ----------
create table if not exists public.live_attendance (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  minutes integer not null default 0,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.live_attendance enable row level security;
drop policy if exists "see own attendance" on public.live_attendance;
create policy "see own attendance" on public.live_attendance for select to authenticated using (user_id = auth.uid() or is_staff());

create or replace function public.live_heartbeat(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into live_attendance (session_id, user_id) values (p_session, auth.uid())
  on conflict (session_id, user_id) do update
    set minutes = live_attendance.minutes + case when live_attendance.last_at < now() - interval '50 seconds' then 1 else 0 end,
        last_at = case when live_attendance.last_at < now() - interval '50 seconds' then now() else live_attendance.last_at end;
end $$;

-- ---------- quotes: reads and likes ----------
create table if not exists public.quote_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  quote_id bigint not null references public.quotes(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, quote_id)
);
alter table public.quote_reads enable row level security;
drop policy if exists "own quote reads" on public.quote_reads;
create policy "own quote reads" on public.quote_reads for select to authenticated using (user_id = auth.uid() or is_staff());
drop policy if exists "add own quote reads" on public.quote_reads;
create policy "add own quote reads" on public.quote_reads for insert to authenticated with check (user_id = auth.uid());

create table if not exists public.quote_likes (
  quote_id bigint not null references public.quotes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quote_id, user_id)
);
alter table public.quote_likes enable row level security;
drop policy if exists "everyone sees quote likes" on public.quote_likes;
create policy "everyone sees quote likes" on public.quote_likes for select to authenticated using (true);
drop policy if exists "like quotes" on public.quote_likes;
create policy "like quotes" on public.quote_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike quotes" on public.quote_likes;
create policy "unlike quotes" on public.quote_likes for delete to authenticated using (user_id = auth.uid());

-- ---------- reports for admins ----------
create or replace function public.engagement_leaderboard(p_days int default 30)
returns table (user_id uuid, name text, avatar_url text, listen_minutes int, talks_finished int, live_minutes int, live_sessions int,
               quotes_read int, quote_likes int, days_active int, score int)
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not is_staff() then raise exception 'Only BCIL staff can see this'; end if;
  return query
  with l as (select t.user_id, sum(t.seconds)::int / 60 as mins, count(*) filter (where t.completed)::int as fin, array_agg(distinct t.day) as d
             from talk_listens t where t.day >= since::date group by t.user_id),
       a as (select x.user_id, sum(x.minutes)::int as mins, count(*)::int as n, array_agg(distinct x.last_at::date) as d
             from live_attendance x where x.last_at >= since group by x.user_id),
       r as (select q.user_id, count(*)::int as n, array_agg(distinct q.read_at::date) as d from quote_reads q where q.read_at >= since group by q.user_id),
       k as (select q.user_id, count(*)::int as n from quote_likes q where q.created_at >= since group by q.user_id),
       ids as (select l.user_id from l union select a.user_id from a union select r.user_id from r union select k.user_id from k)
  select ids.user_id, p.full_name, p.avatar_url,
         coalesce(l.mins, 0), coalesce(l.fin, 0), coalesce(a.mins, 0), coalesce(a.n, 0), coalesce(r.n, 0), coalesce(k.n, 0),
         (select count(distinct dd)::int from unnest(coalesce(l.d, '{}'::date[]) || coalesce(a.d, '{}'::date[]) || coalesce(r.d, '{}'::date[])) dd),
         (coalesce(l.mins, 0) + coalesce(a.mins, 0) + coalesce(l.fin, 0) * 5 + coalesce(r.n, 0) * 2 + coalesce(k.n, 0))
  from ids join profiles p on p.id = ids.user_id
  left join l on l.user_id = ids.user_id left join a on a.user_id = ids.user_id
  left join r on r.user_id = ids.user_id left join k on k.user_id = ids.user_id
  order by 11 desc, 2 limit 200;
end $$;

create or replace function public.talk_stats(p_days int default 30)
returns table (talk_id uuid, title text, kind text, listeners int, minutes int, finished int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only BCIL staff can see this'; end if;
  return query select t.id, t.title, t.kind, count(distinct l.user_id)::int, (sum(l.seconds) / 60)::int, count(*) filter (where l.completed)::int
  from talk_listens l join talks t on t.id = l.talk_id where l.day >= current_date - greatest(p_days, 1)
  group by t.id order by 4 desc, 5 desc limit 50;
end $$;

create or replace function public.quote_stats(p_days int default 30)
returns table (quote_id bigint, show_on date, body text, reads int, likes int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only BCIL staff can see this'; end if;
  return query select q.id, q.show_on, q.body,
    (select count(*)::int from quote_reads r where r.quote_id = q.id),
    (select count(*)::int from quote_likes k where k.quote_id = q.id)
  from quotes q where q.show_on <= current_date and q.show_on >= current_date - greatest(p_days, 1)
  order by q.show_on desc;
end $$;

select 'ok' as engagement_setup;
