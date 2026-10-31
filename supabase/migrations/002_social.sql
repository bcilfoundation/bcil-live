-- BCIL Live: friends, notifications, profile photos, groups (incl. Campus Sync chapters), direct messages
-- Safe to run more than once.

-- ---------- Profile photo & bio ----------
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists bio text;

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Safeguarding: under-18 members only connect with staff and mentors ----------
create or replace function public.can_connect(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from profiles where id in (a, b) and is_minor)
      or exists(select 1 from profiles where id in (a, b) and role in ('admin','moderator','mentor'))
$$;

-- ---------- Friends ----------
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references profiles(id) on delete cascade,
  addressee uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on friendships (least(requester, addressee), greatest(requester, addressee));
alter table friendships enable row level security;
drop policy if exists "see own friendships" on friendships;
create policy "see own friendships" on friendships for select to authenticated using (auth.uid() in (requester, addressee));
drop policy if exists "send friend request" on friendships;
create policy "send friend request" on friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending' and can_connect(requester, addressee));
drop policy if exists "accept friend request" on friendships;
create policy "accept friend request" on friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "remove friendship" on friendships;
create policy "remove friendship" on friendships for delete to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from friendships where status = 'accepted'
    and least(requester, addressee) = least(a, b) and greatest(requester, addressee) = greatest(a, b))
$$;

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,             -- friend_request, friend_accepted, live, message, activity, group_added
  actor_id uuid references profiles(id) on delete set null,
  body text not null,
  link text,                      -- where tapping the notification goes, e.g. /live, /friends, /chat?room=...
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on notifications (user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own notifications read" on notifications;
create policy "mark own notifications read" on notifications for update to authenticated using (user_id = auth.uid());
drop policy if exists "clear own notifications" on notifications;
create policy "clear own notifications" on notifications for delete to authenticated using (user_id = auth.uid());

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if tg_op = 'INSERT' then
    select full_name into n from profiles where id = new.requester;
    insert into notifications (user_id, kind, actor_id, body, link)
    values (new.addressee, 'friend_request', new.requester, coalesce(nullif(n,''),'Someone') || ' sent you a friend request', '/friends');
  elsif new.status = 'accepted' and old.status = 'pending' then
    select full_name into n from profiles where id = new.addressee;
    insert into notifications (user_id, kind, actor_id, body, link)
    values (new.requester, 'friend_accepted', new.addressee, coalesce(nullif(n,''),'Someone') || ' accepted your friend request', '/friends');
  end if;
  return new;
end $$;
drop trigger if exists friendships_notify on friendships;
create trigger friendships_notify after insert or update on friendships for each row execute function public.notify_friendship();

create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    insert into notifications (user_id, kind, actor_id, body, link)
    select p.id, 'live', new.host_id, 'BCIL is live now: ' || new.title, '/live'
    from profiles p where p.id is distinct from new.host_id;
  end if;
  return new;
end $$;
drop trigger if exists live_notify on live_sessions;
create trigger live_notify after insert or update of status on live_sessions for each row execute function public.notify_live();

-- ---------- Groups (community groups and Campus Sync chapters) ----------
alter table rooms add column if not exists description text;
alter table rooms add column if not exists category text not null default 'community';  -- community | campus
alter table rooms add column if not exists campus text;                                 -- e.g. University of Cape Coast
alter table rooms add column if not exists created_by uuid references profiles(id);
alter table room_members add column if not exists role text not null default 'member';  -- member | leader

create or replace function public.is_leader(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from room_members where room_id = r and user_id = auth.uid() and role = 'leader') or is_staff()
$$;

-- only leaders/staff may change someone's group role (members can still update their own read marker)
create or replace function public.protect_member_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_leader(new.room_id) then
    raise exception 'Only group leaders can change roles';
  end if;
  return new;
end $$;
drop trigger if exists room_members_protect_role on room_members;
create trigger room_members_protect_role before update on room_members for each row execute function public.protect_member_role();

-- members of a room can see each other (for member lists and DM names)
drop policy if exists "see members of your rooms" on room_members;
create policy "see members of your rooms" on room_members for select to authenticated using (is_member(room_id));
drop policy if exists "leaders manage members" on room_members;
create policy "leaders manage members" on room_members for update to authenticated using (is_leader(room_id));
-- leaders can post in their own read-only group
drop policy if exists "post in your rooms" on messages;
create policy "post in your rooms" on messages for insert to authenticated
  with check (user_id = auth.uid() and is_member(room_id)
    and (not (select read_only from rooms where id = room_id) or is_leader(room_id)));

-- group list with member counts (open groups, groups you are in, everything for staff)
create or replace function public.group_list() returns table (
  id uuid, name text, kind text, category text, campus text, description text, read_only boolean,
  private boolean, invite_code text, member_count bigint, is_member boolean, my_role text)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.kind, r.category, r.campus, r.description, r.read_only,
    r.invite_code is not null,
    case when is_staff() or exists(select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid() and m.role = 'leader') then r.invite_code end,
    (select count(*) from room_members m where m.room_id = r.id),
    exists(select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid()),
    (select m.role from room_members m where m.room_id = r.id and m.user_id = auth.uid())
  from rooms r
  where r.kind <> 'dm' and (r.invite_code is null or is_staff()
    or exists(select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid()))
  order by r.created_at
$$;

-- staff create groups; the creator becomes a leader
create or replace function public.create_group(p_name text, p_description text, p_category text, p_campus text, p_private boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not is_staff() then raise exception 'Only admins and moderators can create groups'; end if;
  insert into rooms (name, kind, description, category, campus, invite_code, created_by)
  values (p_name, 'group', nullif(p_description,''), coalesce(p_category,'community'), nullif(p_campus,''),
          case when p_private then upper(substr(md5(random()::text), 1, 8)) end, auth.uid())
  returning id into r;
  insert into room_members (room_id, user_id, role) values (r, auth.uid(), 'leader');
  return r;
end $$;

-- ---------- Group activities (events, meetings, outreach) ----------
create table if not exists public.group_activities (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  title text not null,
  details text,
  location text,
  starts_at timestamptz not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.activity_rsvps (
  activity_id uuid references group_activities(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (activity_id, user_id)
);
alter table group_activities enable row level security;
alter table activity_rsvps enable row level security;
drop policy if exists "see activities of visible groups" on group_activities;
create policy "see activities of visible groups" on group_activities for select to authenticated
  using (is_member(room_id) or is_staff() or exists(select 1 from rooms where id = room_id and invite_code is null));
drop policy if exists "leaders manage activities" on group_activities;
create policy "leaders manage activities" on group_activities for all to authenticated
  using (is_leader(room_id)) with check (is_leader(room_id));
drop policy if exists "see rsvps" on activity_rsvps;
create policy "see rsvps" on activity_rsvps for select to authenticated using (true);
drop policy if exists "rsvp yourself" on activity_rsvps;
create policy "rsvp yourself" on activity_rsvps for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "cancel own rsvp" on activity_rsvps;
create policy "cancel own rsvp" on activity_rsvps for delete to authenticated using (user_id = auth.uid());

create or replace function public.notify_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  select name into g from rooms where id = new.room_id;
  insert into notifications (user_id, kind, actor_id, body, link)
  select m.user_id, 'activity', new.created_by, g || ': ' || new.title, '/groups/' || new.room_id
  from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.created_by;
  return new;
end $$;
drop trigger if exists activities_notify on group_activities;
create trigger activities_notify after insert on group_activities for each row execute function public.notify_activity();

-- ---------- Direct messages between friends ----------
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not (are_friends(auth.uid(), other) or is_staff()) then raise exception 'You can message friends only. Send a friend request first.'; end if;
  if not can_connect(auth.uid(), other) then raise exception 'This member cannot receive direct messages.'; end if;
  select rm.room_id into r from room_members rm join rooms ro on ro.id = rm.room_id
    where ro.kind = 'dm' and rm.user_id = auth.uid()
      and exists(select 1 from room_members o where o.room_id = rm.room_id and o.user_id = other) limit 1;
  if r is null then
    insert into rooms (name, kind, created_by) values ('Direct message', 'dm', auth.uid()) returning id into r;
    insert into room_members (room_id, user_id) values (r, auth.uid()), (r, other);
  end if;
  return r;
end $$;

create or replace function public.my_dms() returns table (room_id uuid, other_id uuid, other_name text, other_avatar text)
language sql stable security definer set search_path = public as $$
  select rm.room_id, p.id, p.full_name, p.avatar_url
  from room_members rm join rooms ro on ro.id = rm.room_id and ro.kind = 'dm'
  join room_members o on o.room_id = rm.room_id and o.user_id <> rm.user_id
  join profiles p on p.id = o.user_id
  where rm.user_id = auth.uid()
$$;

create or replace function public.notify_dm() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if (select kind from rooms where id = new.room_id) = 'dm' then
    select full_name into n from profiles where id = new.user_id;
    insert into notifications (user_id, kind, actor_id, body, link)
    select m.user_id, 'message', new.user_id, coalesce(nullif(n,''),'Someone') || ': ' || left(new.body, 80), '/chat?room=' || new.room_id
    from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists messages_notify_dm on messages;
create trigger messages_notify_dm after insert on messages for each row execute function public.notify_dm();

-- unread messages per room (for the chat button dot and badges)
create or replace function public.my_unread() returns table (room_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select m.room_id, count(*) from messages m join room_members rm on rm.room_id = m.room_id and rm.user_id = auth.uid()
  where m.created_at > rm.last_read_at and m.user_id <> auth.uid() and not m.hidden
  group by m.room_id
$$;

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table friendships; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table group_activities; exception when duplicate_object then null; end;
end $$;

-- ---------- Seed: Campus Sync UCC chapter ----------
insert into rooms (name, kind, category, campus, description)
select 'Campus Sync UCC', 'group', 'campus', 'University of Cape Coast',
  'The BCIL Foundation club at the University of Cape Coast. Meetings, outreach, leadership summits and campus activities.'
where not exists (select 1 from rooms where name = 'Campus Sync UCC');
