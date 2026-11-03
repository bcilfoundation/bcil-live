-- BCIL Live: announcements with flyers on Home, and live sessions for one group (only its members see and are notified).
-- Safe to run more than once.

-- ---------- Home announcements ----------
create table if not exists public.home_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image_url text,
  link_url text,
  link_label text,
  ends_on date,
  published boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.home_posts enable row level security;
drop policy if exists "everyone sees home posts" on public.home_posts;
create policy "everyone sees home posts" on public.home_posts for select using (published or is_staff());
drop policy if exists "staff manage home posts" on public.home_posts;
create policy "staff manage home posts" on public.home_posts for all to authenticated using (is_staff()) with check (is_staff());

-- ---------- Live sessions for a group ----------
alter table public.live_sessions add column if not exists room_id uuid references public.rooms(id) on delete set null;

create or replace function public.can_see_live(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from live_sessions x where x.id = s and (
    not x.is_private or is_staff() or x.host_id = auth.uid()
    or (x.room_id is not null and is_member(x.room_id))
    or exists (select 1 from live_invites i where i.session_id = s and i.user_id = auth.uid())))
$$;
drop policy if exists "anyone sees sessions" on public.live_sessions;
create policy "anyone sees sessions" on public.live_sessions for select using (
  not is_private or is_staff() or host_id = auth.uid()
  or (room_id is not null and is_member(room_id))
  or exists (select 1 from live_invites i where i.session_id = id and i.user_id = auth.uid()));

-- group leaders (and staff) can start a session for their group and run it
drop policy if exists "group leaders go live" on public.live_sessions;
create policy "group leaders go live" on public.live_sessions for insert to authenticated
  with check (host_id = auth.uid() and room_id is not null and is_leader(room_id));
drop policy if exists "hosts run their session" on public.live_sessions;
create policy "hosts run their session" on public.live_sessions for update to authenticated using (host_id = auth.uid());
drop policy if exists "hosts manage their callers" on public.call_requests;
create policy "hosts manage their callers" on public.call_requests for update to authenticated
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.host_id = auth.uid()));
drop policy if exists "hosts see their callers" on public.call_requests;
create policy "hosts see their callers" on public.call_requests for select to authenticated
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.host_id = auth.uid()));

-- notifications: a group session tells only that group; a private session tells no one; otherwise everyone
create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') then
    if new.room_id is not null then
      select name into g from rooms where id = new.room_id;
      insert into notifications (user_id, kind, actor_id, link, body)
        select m.user_id, 'live', new.host_id, '/live', coalesce(g, 'Your group') || ' is live now: ' || new.title
        from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.host_id;
    elsif not coalesce(new.is_private, false) then
      insert into notifications (user_id, kind, actor_id, link, body)
        select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
        from profiles p where p.id is distinct from new.host_id;
    end if;
  end if;
  return new;
end $$;

select 'ok' as home_posts_group_live_setup;
