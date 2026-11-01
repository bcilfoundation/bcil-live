-- BCIL Live: Announcements reach everyone. Safe to run more than once.
-- 1) every member is in the Announcements room and the open Community rooms (new members too)
insert into public.room_members (room_id, user_id)
  select r.id, p.id from public.rooms r cross join public.profiles p
  where r.kind = 'announcements' or (r.kind = 'group' and r.category = 'general' and r.invite_code is null)
on conflict do nothing;

create or replace function public.join_default_rooms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into room_members (room_id, user_id)
    select r.id, new.id from rooms r
    where r.kind = 'announcements' or (r.kind = 'group' and r.category = 'general' and r.invite_code is null)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists profiles_join_default_rooms on public.profiles;
create trigger profiles_join_default_rooms after insert on public.profiles for each row execute function public.join_default_rooms();

-- 2) a post in Announcements sends a notification (and phone alert) to every member; DMs work as before
create or replace function public.notify_dm() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text; k text; rn text;
begin
  select kind, name into k, rn from rooms where id = new.room_id;
  if k = 'dm' then
    select full_name into n from profiles where id = new.user_id;
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'message', new.user_id, '/chat?room=' || new.room_id,
             coalesce(nullif(n,''),'Someone') || ': ' || left(new.body, 80)
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  elsif k = 'announcements' then
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'announcement', new.user_id, '/chat?room=' || new.room_id, '📢 ' || coalesce(rn, 'Announcement') || ': ' || left(new.body, 140)
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  end if;
  return new;
end $$;

select count(*) as announcement_members from public.room_members m join public.rooms r on r.id = m.room_id where r.kind = 'announcements';
