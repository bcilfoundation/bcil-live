-- 038: newsletter opt-in for app members, photo albums, and a weekly summary for admins. Safe to run more than once.

-- 1. members choose to get the monthly newsletter by email
alter table public.profiles add column if not exists newsletter boolean not null default false;

-- staff download the list (name + email) to send the newsletter
create or replace function public.newsletter_list() returns table (full_name text, email text, joined date)
language sql stable security definer set search_path = public as $$
  select p.full_name, u.email::text, p.created_at::date from profiles p join auth.users u on u.id = p.id
  where p.newsletter and is_staff() order by p.created_at
$$;
revoke all on function public.newsletter_list() from public, anon;
grant execute on function public.newsletter_list() to authenticated;

-- 2. photo albums (programme photos), staff add and edit them in the app
create table if not exists public.albums (
  id bigint generated always as identity primary key,
  title text not null,
  subtitle text,
  taken_on date,
  photos jsonb not null default '[]',   -- ["https://…jpg", …]
  sort int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.albums enable row level security;
drop policy if exists "everyone sees albums" on public.albums;
create policy "everyone sees albums" on public.albums for select using (true);
drop policy if exists "staff manage albums" on public.albums;
create policy "staff manage albums" on public.albums for all to authenticated using (is_staff()) with check (is_staff());

insert into public.albums (title, subtitle, taken_on, photos, sort)
select 'Beyond Junior High', 'August 2023', '2023-08-03',
  '["/photos/bjh/bjh-1.jpg","/photos/bjh/bjh-2.jpg","/photos/bjh/bjh-3.jpg","/photos/bjh/bjh-4.jpg","/photos/bjh/bjh-5.jpg"]'::jsonb, 50
where not exists (select 1 from public.albums where title = 'Beyond Junior High');

-- 3. every Monday at 7:00 (Ghana time) admins get a summary of the past week
create or replace function public.send_weekly_summary() returns int
language plpgsql security definer set search_path = public as $$
declare members int; forms int; gifts_n int; gifts_sum bigint; sessions int; body text; n int;
begin
  select count(*) into members from profiles where created_at > now() - interval '7 days';
  select count(*) into forms from form_responses where created_at > now() - interval '7 days';
  select count(*), coalesce(sum(amount_pesewas), 0) into gifts_n, gifts_sum from gifts
    where created_at > now() - interval '7 days' and status in ('paid', 'recorded');
  select count(*) into sessions from live_sessions where starts_at > now() - interval '7 days' and starts_at <= now();
  body := '📊 Last week: ' || members || ' new member' || case when members = 1 then '' else 's' end
    || ' · ' || forms || ' form response' || case when forms = 1 then '' else 's' end
    || ' · ' || gifts_n || ' gift' || case when gifts_n = 1 then '' else 's' end || ' (GH₵ ' || to_char(gifts_sum / 100.0, 'FM999,990.00') || ')'
    || ' · ' || sessions || ' live session' || case when sessions = 1 then '' else 's' end;
  insert into notifications (user_id, kind, link, body) select id, 'summary', '/admin', body from profiles where role = 'admin';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_weekly_summary() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-weekly-summary';
select cron.schedule('bcil-weekly-summary', '0 7 * * 1', 'select public.send_weekly_summary()');

select 'ok' as newsletter_photos_summary_setup;
