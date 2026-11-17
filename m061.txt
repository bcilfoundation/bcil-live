-- ---------- Privacy settings ----------
alter table public.profiles add column if not exists read_receipts boolean not null default true;
alter table public.profiles add column if not exists show_online boolean not null default true;
alter table public.profiles add column if not exists discoverable text not null default 'everyone';
alter table public.profiles drop constraint if exists profiles_discoverable_check;
alter table public.profiles add constraint profiles_discoverable_check check (discoverable in ('everyone','friends_of_friends','nobody'));

-- ---------- Blocking ----------
create table if not exists public.blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.blocks enable row level security;
drop policy if exists "my blocks" on public.blocks;
create policy "my blocks" on public.blocks for all to authenticated using (blocker = auth.uid()) with check (blocker = auth.uid());

create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;

-- block someone: also removes any friendship or request between you
create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  insert into blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  delete from friendships where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
end $$;
grant execute on function public.block_user(uuid) to authenticated;

-- no friend requests between blocked people
create or replace function public.friend_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_blocked(new.requester, new.addressee) then raise exception 'You can''t connect with this person'; end if;
  return new;
end $$;
drop trigger if exists friend_block_guard on public.friendships;
create trigger friend_block_guard before insert on public.friendships for each row execute function public.friend_block_guard();

-- no new direct messages between blocked people
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if other = auth.uid() then raise exception 'You cannot message yourself'; end if;
  if is_blocked(auth.uid(), other) then raise exception 'You can''t message this person'; end if;
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

-- messages from someone you blocked don't arrive in a DM
create or replace function public.message_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from rooms where id = new.room_id and kind = 'dm')
     and exists (select 1 from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id and is_blocked(m.user_id, new.user_id)) then
    raise exception 'You can''t message this person';
  end if;
  return new;
end $$;
drop trigger if exists message_block_guard on public.messages;
create trigger message_block_guard before insert on public.messages for each row execute function public.message_block_guard();

-- statuses: hide people who are blocked either way
create or replace function public.status_feed() returns table (
  user_id uuid, full_name text, avatar_url text, count int, latest timestamptz, unseen int)
language sql stable security definer set search_path = public as $$
  select s.user_id, p.full_name, p.avatar_url, count(*)::int, max(s.created_at),
         count(*) filter (where not exists (select 1 from status_views v where v.status_id = s.id and v.viewer_id = auth.uid()))::int
  from statuses s join profiles p on p.id = s.user_id
  where s.removed_at is null and s.expires_at > now()
    and (s.user_id = auth.uid() or is_staff() or (can_connect(auth.uid(), s.user_id) and not is_blocked(auth.uid(), s.user_id)))
  group by s.user_id, p.full_name, p.avatar_url
  order by (s.user_id = auth.uid()) desc, max(s.created_at) desc
$$;

-- ---------- Finding people ----------
create or replace function public.mutual_friends(a uuid, b uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select case when requester = a then addressee else requester end f from friendships where status = 'accepted' and a in (requester, addressee)
    intersect
    select case when requester = b then addressee else requester end from friendships where status = 'accepted' and b in (requester, addressee)) x
$$;

-- search by name, respecting "who can find me" and blocks (staff can always find people)
create or replace function public.find_people(p_q text) returns table (id uuid, full_name text, avatar_url text, role text, mutual int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, p.role, mutual_friends(auth.uid(), p.id)
  from profiles p
  where p.id <> auth.uid() and coalesce(p.full_name, '') <> ''
    and p.full_name ilike '%' || replace(replace(coalesce(p_q, ''), '%', ''), '_', '') || '%'
    and not is_blocked(auth.uid(), p.id) and can_connect(auth.uid(), p.id)
    and (is_staff() or p.role in ('admin','moderator','mentor') or p.discoverable = 'everyone'
         or (p.discoverable = 'friends_of_friends' and mutual_friends(auth.uid(), p.id) > 0)
         or exists (select 1 from friendships f where f.status = 'accepted' and ((f.requester = auth.uid() and f.addressee = p.id) or (f.addressee = auth.uid() and f.requester = p.id))))
  order by mutual_friends(auth.uid(), p.id) desc, p.full_name
  limit 40
$$;
grant execute on function public.find_people(text) to authenticated;

-- people you may know: friends of your friends first, then newer members, never people you're already linked with
create or replace function public.people_you_may_know() returns table (id uuid, full_name text, avatar_url text, role text, mutual int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, p.role, mutual_friends(auth.uid(), p.id) m
  from profiles p
  where p.id <> auth.uid() and coalesce(p.full_name, '') <> ''
    and p.discoverable <> 'nobody'
    and (p.discoverable = 'everyone' or mutual_friends(auth.uid(), p.id) > 0)
    and not is_blocked(auth.uid(), p.id) and can_connect(auth.uid(), p.id)
    and not exists (select 1 from friendships f where (f.requester = auth.uid() and f.addressee = p.id) or (f.addressee = auth.uid() and f.requester = p.id))
  order by m desc, p.created_at desc
  limit 20
$$;
grant execute on function public.people_you_may_know() to authenticated;

-- your mentor(s), for the Friends page
create or replace function public.my_mentors() returns table (id uuid, full_name text, avatar_url text, room_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, m.room_id from mentorships m join profiles p on p.id = m.mentor_id
  where m.mentee_id = auth.uid() and m.status = 'active'
$$;
grant execute on function public.my_mentors() to authenticated;

-- ---------- Read receipts ----------
-- who has read up to when in a conversation; people who turned read receipts off are left out,
-- and if you turned yours off you don't see anyone's
create or replace function public.room_reads(p_room uuid) returns table (user_id uuid, last_read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.last_read_at from room_members m join profiles p on p.id = m.user_id
  where m.room_id = p_room and m.user_id <> auth.uid() and p.read_receipts
    and exists (select 1 from room_members me where me.room_id = p_room and me.user_id = auth.uid())
    and (select read_receipts from profiles where id = auth.uid())
  limit 1000
$$;
grant execute on function public.room_reads(uuid) to authenticated;

select 'privacy_friends = ok' as result;
