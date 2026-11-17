-- ---------- Chats: mute a conversation (no alerts or phone notifications for it) ----------
alter table public.room_members add column if not exists muted_until timestamptz;

-- skip chat notifications for people who muted that conversation
create or replace function public.skip_muted_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if new.link like '/chat?room=%' then
    begin rid := substring(new.link from '/chat\?room=([0-9a-f-]{36})')::uuid; exception when others then rid := null; end;
    if rid is not null and exists (select 1 from room_members where room_id = rid and user_id = new.user_id and muted_until is not null and muted_until > now()) then
      return null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists skip_muted on public.notifications;
create trigger skip_muted before insert on public.notifications for each row execute function public.skip_muted_notification();

-- mute for a number of hours (null = unmute, 0 = always)
create or replace function public.mute_room(p_room uuid, p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  t := case when p_hours is null then null when p_hours = 0 then 'infinity'::timestamptz else now() + make_interval(hours => p_hours) end;
  update room_members set muted_until = t where room_id = p_room and user_id = auth.uid();
  return t;
end $$;
grant execute on function public.mute_room(uuid, int) to authenticated;

select 'chat_mute = ok' as result;
