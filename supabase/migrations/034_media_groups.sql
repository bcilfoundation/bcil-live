-- BCIL Live: photos/files without text can be sent; group leaders can add and remove members; people are told when added.
-- Safe to run more than once.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_or_file;
alter table public.messages add constraint messages_body_or_file
  check (char_length(body) <= 2000 and (char_length(trim(body)) >= 1 or attachment_url is not null));

drop policy if exists "leaders add members" on public.room_members;
create policy "leaders add members" on public.room_members for insert to authenticated with check (is_leader(room_id) and role = 'member');
drop policy if exists "leaders remove members" on public.room_members;
create policy "leaders remove members" on public.room_members for delete to authenticated using (is_leader(room_id) and role = 'member');

create or replace function public.notify_added_to_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if auth.uid() is null or new.user_id = auth.uid() then return new; end if;   -- joined by themselves, or by the system
  select name, kind into g from rooms where id = new.room_id;
  if g.kind = 'group' then
    insert into notifications (user_id, kind, actor_id, link, body)
    values (new.user_id, 'post', auth.uid(), '/chat?room=' || new.room_id, 'You were added to ' || g.name);
  end if;
  return new;
end $$;
drop trigger if exists room_members_notify_added on public.room_members;
create trigger room_members_notify_added after insert on public.room_members for each row execute function public.notify_added_to_group();

select 'ok' as media_groups_setup;
