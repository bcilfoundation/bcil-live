-- BCIL Live: private live sessions (like Podbean's private live). Only people with the link can see and join,
-- and no "BCIL is live" notification goes out. Safe to run more than once.
alter table public.live_sessions add column if not exists is_private boolean not null default false;
alter table public.live_sessions add column if not exists invite_code text unique;

create table if not exists public.live_invites (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.live_invites enable row level security;
drop policy if exists "see own live invites" on public.live_invites;
create policy "see own live invites" on public.live_invites for select to authenticated using (user_id = auth.uid() or is_staff());

-- who may see a session: public ones everyone; private ones staff, the host and people who opened the link
create or replace function public.can_see_live(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from live_sessions x where x.id = s and (
    not x.is_private or is_staff() or x.host_id = auth.uid()
    or exists (select 1 from live_invites i where i.session_id = s and i.user_id = auth.uid())))
$$;

drop policy if exists "anyone sees sessions" on public.live_sessions;
create policy "anyone sees sessions" on public.live_sessions for select using (
  not is_private or is_staff() or host_id = auth.uid()
  or exists (select 1 from live_invites i where i.session_id = id and i.user_id = auth.uid()));

drop policy if exists "read live chat" on public.live_chat;
create policy "read live chat" on public.live_chat for select to authenticated using ((not hidden or is_staff()) and can_see_live(session_id));

-- opening the private link: adds you to the guest list and returns the session
create or replace function public.join_live_with_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  select id into s from live_sessions where invite_code = p_code and status <> 'ended';
  if s is null then raise exception 'This private session link has ended or is not valid'; end if;
  insert into live_invites (session_id, user_id) values (s, auth.uid()) on conflict do nothing;
  return s;
end $$;
grant execute on function public.join_live_with_code(text) to authenticated;

-- no "BCIL is live" notification for private sessions
create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and not coalesce(new.is_private, false) and (tg_op = 'INSERT' or old.status <> 'live') then
    insert into notifications (user_id, kind, actor_id, link, body)
      select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
      from profiles p where p.id is distinct from new.host_id;
  end if;
  return new;
end $$;

select 'ok' as private_live_setup;
