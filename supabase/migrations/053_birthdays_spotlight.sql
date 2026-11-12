-- Birthdays and Spotlight of the week. Safe to run more than once.

-- ---------- Birthdays: day and month only (no year), shown only if the member allows it ----------
alter table public.profiles add column if not exists birthday_month smallint check (birthday_month between 1 and 12);
alter table public.profiles add column if not exists birthday_day smallint check (birthday_day between 1 and 31);
alter table public.profiles add column if not exists show_birthday boolean not null default true;

-- today's birthdays in Ghana time; under-18s are never listed
create or replace function public.birthdays_today() returns table (id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url from profiles p
  where p.show_birthday and not coalesce(p.is_minor, false)
    and p.birthday_month = extract(month from (now() at time zone 'Africa/Accra'))::int
    and p.birthday_day = extract(day from (now() at time zone 'Africa/Accra'))::int
  order by p.full_name
$$;
grant execute on function public.birthdays_today() to authenticated;

-- staff: birthdays in the next N days (for shout-outs and planning)
create or replace function public.birthdays_upcoming(p_days int default 30) returns table (id uuid, full_name text, avatar_url text, birthday_month smallint, birthday_day smallint, days_away int, shown boolean)
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Accra')::date;
begin
  if not is_staff() then raise exception 'Staff only'; end if;
  return query
  with b as (
    select p.id, p.full_name, p.avatar_url, p.birthday_month, p.birthday_day, (p.show_birthday and not coalesce(p.is_minor, false)) as shown,
      make_date(extract(year from today)::int, p.birthday_month, least(p.birthday_day, extract(day from (make_date(extract(year from today)::int, p.birthday_month, 1) + interval '1 month - 1 day'))::int)) as d
    from profiles p where p.birthday_month is not null and p.birthday_day is not null)
  select b.id, b.full_name, b.avatar_url, b.birthday_month, b.birthday_day,
    (case when b.d >= today then b.d - today else (b.d + interval '1 year')::date - today end)::int as days_away, b.shown
  from b
  where (case when b.d >= today then b.d - today else (b.d + interval '1 year')::date - today end) <= p_days
  order by 6, 2;
end $$;
grant execute on function public.birthdays_upcoming(int) to authenticated;

-- 6:00 am Ghana: a "Happy birthday" notification to everyone whose birthday it is
create or replace function public.send_birthday_wishes() returns int
language plpgsql security definer set search_path = public, private as $$
declare n int := 0; today date := (now() at time zone 'Africa/Accra')::date;
begin
  insert into private.sent_reminders (key) values ('birthdays:' || today) on conflict do nothing;
  if not found then return 0; end if;
  insert into notifications (user_id, kind, link, body)
    select p.id, 'birthday', '/', 'Happy birthday, ' || split_part(p.full_name, ' ', 1) || '! 🎂 Everyone at BCIL Foundation is celebrating you today.'
    from profiles p
    where p.birthday_month = extract(month from today)::int and p.birthday_day = extract(day from today)::int;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_birthday_wishes() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-birthdays';
select cron.schedule('bcil-birthdays', '0 6 * * *', 'select public.send_birthday_wishes()');

-- ---------- Spotlight of the week: a member, volunteer, mentor or partner BCIL celebrates ----------
create table if not exists public.spotlights (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid references profiles(id) on delete set null,   -- if the person is in the app
  photo_url text,
  role text,                    -- e.g. "FCB volunteer · UCC"
  headline text not null,       -- one line: why we celebrate them
  story text,                   -- a short paragraph
  link_url text,
  starts_on date not null default ((now() at time zone 'Africa/Accra')::date),
  ends_on date,                 -- empty = 7 days after it starts
  published boolean not null default true,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.spotlights enable row level security;
drop policy if exists "members see published spotlights" on public.spotlights;
create policy "members see published spotlights" on public.spotlights for select to authenticated using (published or is_staff());
drop policy if exists "staff manage spotlights" on public.spotlights;
create policy "staff manage spotlights" on public.spotlights for all to authenticated using (is_staff()) with check (is_staff());

-- the current spotlights (this week's), newest first
create or replace function public.current_spotlights() returns setof public.spotlights
language sql stable security definer set search_path = public as $$
  select * from spotlights
  where published
    and starts_on <= (now() at time zone 'Africa/Accra')::date
    and coalesce(ends_on, starts_on + 6) >= (now() at time zone 'Africa/Accra')::date
  order by starts_on desc, created_at desc
$$;
grant execute on function public.current_spotlights() to authenticated;

select 'ok' as birthdays_spotlight_setup;
