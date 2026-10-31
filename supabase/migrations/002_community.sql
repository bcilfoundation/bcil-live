-- BCIL Live · Community update: profile photos, friends, notifications, direct messages,
-- better groups and Campus Sync pages (activities, updates, leaders).
-- Safe to run more than once.

-- ---------- Profiles: photo and short bio ----------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

-- Photos bucket (profile photos, group covers and update photos). Files live under <user id>/...
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media update own files" on storage.objects;
create policy "media update own files" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media delete own files" on storage.objects;
create policy "media delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Safeguarding ----------
-- Under-18 members can only connect with or message staff and mentors.
create or replace function public.can_connect(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where id in (a, b) and is_minor)
      or exists (select 1 from profiles where id in (a, b) and role in ('admin','moderator','mentor'))
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
  using (addressee = auth.uid()) with check (addressee = auth.uid());
drop policy if exists "remove friendship" on friendships;
create policy "remove friendship" on friendships for delete to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted'
    and least(requester, addressee) = least(a, b) and greatest(requester, addressee) = greatest(a, b))
$$;

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,              -- friend_request, friend_accepted, live, message, group_event, group_post
  actor_id uuid references profiles(id) on delete set null,
  link text,                       -- where tapping it goes, e.g. /friends or /chat?room=...
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on notifications (user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own notifications" on notifications;
create policy "mark own notifications" on notifications for update to authenticated using (user_id = auth.uid());
drop policy if exists "clear own notifications" on notifications;
create policy "clear own notifications" on notifications for delete to authenticated using (user_id = auth.uid());

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if tg_op = 'INSERT' then
    select full_name into n from profiles where id = new.requester;
    insert into notifications (user_id, kind, actor_id, link, body)
      values (new.addressee, 'friend_request', new.requester, '/friends', coalesce(nullif(n,''),'Someone') || ' sent you a friend request');
  elsif new.status = 'accepted' and old.status <> 'accepted' then
    select full_name into n from profiles where id = new.addressee;
    insert into notifications (user_id, kind, actor_id, link, body)
      values (new.requester, 'friend_accepted', new.addressee, '/friends', coalesce(nullif(n,''),'Someone') || ' accepted your friend request');
  end if;
  return new;
end $$;
drop trigger if exists friendships_notify on friendships;
create trigger friendships_notify after insert or update on friendships for each row execute function public.notify_friendship();

create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') then
    insert into notifications (user_id, kind, actor_id, link, body)
      select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
      from profiles p where p.id is distinct from new.host_id;
  end if;
  return new;
end $$;
drop trigger if exists live_notify on live_sessions;
create trigger live_notify after insert or update of status on live_sessions for each row execute function public.notify_live();

-- ---------- Groups and Campus Sync ----------
alter table public.rooms add column if not exists description text;
alter table public.rooms add column if not exists category text not null default 'general';
alter table public.rooms drop constraint if exists rooms_category_check;
alter table public.rooms add constraint rooms_category_check check (category in ('general','campus','cohort','program'));
alter table public.rooms add column if not exists school text;
alter table public.rooms add column if not exists cover_url text;
alter table public.rooms add column if not exists created_by uuid references profiles(id) on delete set null;
alter table public.room_members add column if not exists role text not null default 'member';
alter table public.room_members drop constraint if exists room_members_role_check;
alter table public.room_members add constraint room_members_role_check check (role in ('member','leader'));

create or replace function public.is_leader(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() or exists (select 1 from room_members where room_id = r and user_id = auth.uid() and role = 'leader')
$$;

-- members can see who else is in their groups
drop policy if exists "see members of your rooms" on room_members;
create policy "see members of your rooms" on room_members for select to authenticated using (is_member(room_id));
-- staff add people to groups and make campus leaders
drop policy if exists "staff manage memberships" on room_members;
create policy "staff manage memberships" on room_members for all to authenticated using (is_staff()) with check (is_staff());
-- campus leaders can edit their own group's details
drop policy if exists "leaders edit their group" on rooms;
create policy "leaders edit their group" on rooms for update to authenticated using (is_leader(id)) with check (is_leader(id));

-- Activities (events) for a group or campus
create table if not exists public.group_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  place text,
  details text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.group_event_rsvps (
  event_id bigint references group_events(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (event_id, user_id)
);
-- Updates (posts with an optional photo) for a group or campus
create table if not exists public.group_posts (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  image_url text,
  created_at timestamptz not null default now()
);
alter table group_events enable row level security;
alter table group_event_rsvps enable row level security;
alter table group_posts enable row level security;

-- anyone signed in can see open groups' activities and updates; private groups only for members
create or replace function public.can_view_room(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() or is_member(r) or exists (select 1 from rooms where id = r and invite_code is null and kind <> 'dm')
$$;
drop policy if exists "view group events" on group_events;
create policy "view group events" on group_events for select to authenticated using (can_view_room(room_id));
drop policy if exists "leaders manage group events" on group_events;
create policy "leaders manage group events" on group_events for all to authenticated using (is_leader(room_id)) with check (is_leader(room_id));
drop policy if exists "view rsvps" on group_event_rsvps;
create policy "view rsvps" on group_event_rsvps for select to authenticated using (true);
drop policy if exists "rsvp yourself" on group_event_rsvps;
create policy "rsvp yourself" on group_event_rsvps for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "cancel rsvp" on group_event_rsvps;
create policy "cancel rsvp" on group_event_rsvps for delete to authenticated using (user_id = auth.uid());
drop policy if exists "view group posts" on group_posts;
create policy "view group posts" on group_posts for select to authenticated using (can_view_room(room_id));
drop policy if exists "leaders post updates" on group_posts;
create policy "leaders post updates" on group_posts for insert to authenticated with check (user_id = auth.uid() and is_leader(room_id));
drop policy if exists "authors and staff delete posts" on group_posts;
create policy "authors and staff delete posts" on group_posts for delete to authenticated using (user_id = auth.uid() or is_staff());

-- tell members about new activities and updates
create or replace function public.notify_group_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  select name into g from rooms where id = new.room_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select m.user_id, 'group_post', new.user_id, '/groups/' || new.room_id, g || ': new update'
    from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  return new;
end $$;
create or replace function public.notify_group_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  select name into g from rooms where id = new.room_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select m.user_id, 'group_event', new.created_by, '/groups/' || new.room_id, g || ': new activity · ' || new.title
    from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.created_by;
  return new;
end $$;
drop trigger if exists group_events_notify on group_events;
create trigger group_events_notify after insert on group_events for each row execute function public.notify_group_event();
drop trigger if exists group_posts_notify on group_posts;
create trigger group_posts_notify after insert on group_posts for each row execute function public.notify_group_post();

-- the groups list with member counts (invite codes only shown to staff and leaders)
create or replace function public.group_list() returns table (
  id uuid, name text, kind text, category text, description text, school text, cover_url text,
  read_only boolean, is_private boolean, invite_code text, member_count int, is_member boolean, my_role text)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.kind, r.category, r.description, r.school, r.cover_url, r.read_only,
         r.invite_code is not null,
         case when is_staff() or exists (select 1 from room_members x where x.room_id = r.id and x.user_id = auth.uid() and x.role = 'leader') then r.invite_code end,
         (select count(*)::int from room_members m where m.room_id = r.id),
         exists (select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid()),
         (select m.role from room_members m where m.room_id = r.id and m.user_id = auth.uid())
  from rooms r
  where r.kind <> 'dm' and (r.invite_code is null or is_staff()
        or exists (select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid()))
  order by (r.kind = 'announcements') desc, r.category, r.name
$$;

-- staff create groups and Campus Sync pages
create or replace function public.create_group(p_name text, p_category text, p_description text, p_school text, p_private boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not is_staff() then raise exception 'Only admins and moderators can create groups'; end if;
  insert into rooms (name, kind, category, description, school, created_by, invite_code)
    values (p_name, 'group', coalesce(p_category,'general'), nullif(p_description,''), nullif(p_school,''), auth.uid(),
            case when p_private then upper(substr(md5(random()::text), 1, 8)) end)
    returning id into r;
  insert into room_members (room_id, user_id, role) values (r, auth.uid(), 'leader');
  return r;
end $$;

-- ---------- Direct messages ----------
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if other = auth.uid() then raise exception 'You cannot message yourself'; end if;
  if not can_connect(auth.uid(), other) then raise exception 'Messages with under-18 members go through BCIL staff and mentors'; end if;
  if not (are_friends(auth.uid(), other) or is_staff()) then raise exception 'Add them as a friend first'; end if;
  select m1.room_id into r from room_members m1 join room_members m2 on m2.room_id = m1.room_id
    join rooms x on x.id = m1.room_id
    where x.kind = 'dm' and m1.user_id = auth.uid() and m2.user_id = other limit 1;
  if r is null then
    insert into rooms (name, kind) values ('Direct message', 'dm') returning id into r;
    insert into room_members (room_id, user_id) values (r, auth.uid()), (r, other);
  end if;
  return r;
end $$;

create or replace function public.my_dms() returns table (room_id uuid, other_id uuid, other_name text, other_avatar text, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m1.room_id, p.id, p.full_name, p.avatar_url,
         (select max(created_at) from messages where room_id = m1.room_id)
  from room_members m1
  join rooms r on r.id = m1.room_id and r.kind = 'dm'
  join room_members m2 on m2.room_id = m1.room_id and m2.user_id <> m1.user_id
  join profiles p on p.id = m2.user_id
  where m1.user_id = auth.uid()
  order by 5 desc nulls last
$$;

-- unread counts per room (for the chat button dot and badges)
create or replace function public.my_unread() returns table (room_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select m.room_id, count(*)::int from room_members rm
  join messages m on m.room_id = rm.room_id and m.created_at > rm.last_read_at and m.user_id <> rm.user_id and not m.hidden
  where rm.user_id = auth.uid() group by m.room_id
$$;

create or replace function public.notify_dm() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if (select kind from rooms where id = new.room_id) = 'dm' then
    select full_name into n from profiles where id = new.user_id;
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'message', new.user_id, '/chat?room=' || new.room_id,
             coalesce(nullif(n,''),'Someone') || ': ' || left(new.body, 80)
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists messages_notify_dm on messages;
create trigger messages_notify_dm after insert on messages for each row execute function public.notify_dm();

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table friendships; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table group_posts; exception when duplicate_object then null; end;
end $$;

select 'Community update installed' as result;

-- Seed: Campus Sync UCC chapter; FCB cohort categorised
update rooms set category='cohort' where name='FCB 2027 Cohort';
insert into rooms (name, kind, category, school, description)
select 'Campus Sync UCC', 'group', 'campus', 'University of Cape Coast', 'The BCIL Foundation club at the University of Cape Coast. Meetings, outreach, leadership summits and campus activities.'
where not exists (select 1 from rooms where name='Campus Sync UCC');
