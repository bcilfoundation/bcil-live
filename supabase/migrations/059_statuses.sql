-- ---------- Statuses: a photo or a coloured text card that disappears after 24 hours ----------
create table if not exists public.statuses (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('photo','text')),
  media_url text,
  body text check (body is null or char_length(body) <= 700),
  bg text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  removed_at timestamptz,
  check ((kind = 'photo' and media_url is not null) or (kind = 'text' and coalesce(body, '') <> ''))
);
create index if not exists statuses_live on public.statuses (expires_at desc) where removed_at is null;
create index if not exists statuses_user on public.statuses (user_id, created_at desc);

create table if not exists public.status_views (
  status_id bigint not null references public.statuses(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

create table if not exists public.status_reports (
  id bigint generated always as identity primary key,
  status_id bigint not null references public.statuses(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (status_id, reporter_id)
);

alter table public.statuses enable row level security;
alter table public.status_views enable row level security;
alter table public.status_reports enable row level security;

-- who can see a status: the owner, staff, and other members the safeguarding rule allows (same rule as messages)
drop policy if exists "see statuses" on public.statuses;
create policy "see statuses" on public.statuses for select to authenticated using (
  user_id = auth.uid() or is_staff()
  or (removed_at is null and expires_at > now() and can_connect(auth.uid(), user_id)));
drop policy if exists "post own status" on public.statuses;
create policy "post own status" on public.statuses for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "delete own status" on public.statuses;
create policy "delete own status" on public.statuses for delete to authenticated using (user_id = auth.uid() or is_staff());

drop policy if exists "record my view" on public.status_views;
create policy "record my view" on public.status_views for insert to authenticated with check (viewer_id = auth.uid());
drop policy if exists "see views" on public.status_views;
create policy "see views" on public.status_views for select to authenticated using (
  viewer_id = auth.uid() or exists (select 1 from statuses s where s.id = status_id and s.user_id = auth.uid()));

drop policy if exists "report a status" on public.status_reports;
create policy "report a status" on public.status_reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "staff read status reports" on public.status_reports;
create policy "staff read status reports" on public.status_reports for select to authenticated using (is_staff());

-- the status row: one entry per person with a live status, newest first, with whether I've seen all of theirs
create or replace function public.status_feed() returns table (
  user_id uuid, full_name text, avatar_url text, count int, latest timestamptz, unseen int)
language sql stable security definer set search_path = public as $$
  select s.user_id, p.full_name, p.avatar_url, count(*)::int, max(s.created_at),
         count(*) filter (where not exists (select 1 from status_views v where v.status_id = s.id and v.viewer_id = auth.uid()))::int
  from statuses s join profiles p on p.id = s.user_id
  where s.removed_at is null and s.expires_at > now()
    and (s.user_id = auth.uid() or is_staff() or can_connect(auth.uid(), s.user_id))
  group by s.user_id, p.full_name, p.avatar_url
  order by (s.user_id = auth.uid()) desc, max(s.created_at) desc
$$;
grant execute on function public.status_feed() to authenticated;

-- report: hides it straight away for the reporter's safety if two people report it, and tells staff
create or replace function public.report_status(p_status bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into status_reports (status_id, reporter_id, reason) values (p_status, auth.uid(), p_reason) on conflict do nothing;
  select count(*) into n from status_reports where status_id = p_status;
  if n >= 2 then update statuses set removed_at = now() where id = p_status and removed_at is null; end if;
  insert into notifications (user_id, kind, actor_id, link, body)
    select id, 'report', auth.uid(), '/admin', '🚩 A status was reported' || coalesce(': ' || left(p_reason, 80), '')
    from profiles where role in ('admin','moderator') and id <> auth.uid();
end $$;
grant execute on function public.report_status(bigint, text) to authenticated;

-- staff remove a status
create or replace function public.remove_status(p_status bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only admins and moderators can remove a status'; end if;
  update statuses set removed_at = now() where id = p_status;
end $$;
grant execute on function public.remove_status(bigint) to authenticated;

-- tidy up statuses older than two days, every hour
do $$ begin
  perform cron.unschedule('bcil-status-cleanup');
exception when others then null; end $$;
select cron.schedule('bcil-status-cleanup', '17 * * * *', $$delete from public.statuses where expires_at < now() - interval '2 days'$$);

-- ---------- App tour: remember who has seen it ----------
alter table public.profiles add column if not exists toured_at timestamptz;

-- live updates for the status row
do $$ begin
  alter publication supabase_realtime add table public.statuses;
exception when others then null; end $$;

select 'statuses = ok' as result;
