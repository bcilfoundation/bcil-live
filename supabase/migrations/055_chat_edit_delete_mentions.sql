-- 055: edit and delete messages, @mentions (and @everyone in groups). Safe to run more than once.
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists mentions uuid[] not null default '{}';
alter table public.messages add column if not exists mention_all boolean not null default false;

-- edit your own message (up to 24 hours after sending)
create or replace function public.edit_message(p_id bigint, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  select * into m from messages where id = p_id;
  if m.id is null or m.user_id <> auth.uid() then raise exception 'You can only edit your own messages'; end if;
  if m.deleted_at is not null then raise exception 'This message was deleted'; end if;
  if m.created_at < now() - interval '24 hours' then raise exception 'Messages can be edited for 24 hours after sending'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and m.attachment_url is null then raise exception 'The message cannot be empty'; end if;
  update messages set body = left(trim(coalesce(p_body, '')), 2000), edited_at = now() where id = p_id;
end $$;
grant execute on function public.edit_message(bigint, text) to authenticated;

-- delete for everyone: your own message, or any message if you are staff or the group's leader.
-- The words and the file are removed; everyone sees "This message was deleted".
create or replace function public.delete_message(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  select * into m from messages where id = p_id;
  if m.id is null then return; end if;
  if m.user_id <> auth.uid() and not is_staff() and not is_leader(m.room_id) then raise exception 'You can only delete your own messages'; end if;
  update messages set body = 'This message was deleted', attachment_url = null, attachment_name = null, attachment_type = null, attachment_size = null,
    mentions = '{}', mention_all = false, deleted_at = now() where id = p_id;
  delete from message_reactions where message_id = p_id;
end $$;
grant execute on function public.delete_message(bigint) to authenticated;

create or replace function public.is_staff_user(u uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from profiles where id = u and role in ('admin', 'moderator')) $$;

-- notify the people tagged in a group message. @everyone only works for staff and the group's leaders.
create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; rn text; n text; txt text;
begin
  if coalesce(array_length(new.mentions, 1), 0) = 0 and not new.mention_all then return new; end if;
  select kind, name into k, rn from rooms where id = new.room_id;
  if k = 'dm' then return new; end if;
  select full_name into n from profiles where id = new.user_id;
  txt := coalesce(nullif(n, ''), 'Someone') || ' mentioned ' || case when new.mention_all then 'everyone' else 'you' end || ' in ' || coalesce(rn, 'a group') || ': ' || left(new.body, 80);
  if new.mention_all and (is_staff_user(new.user_id) or exists (select 1 from room_members where room_id = new.room_id and user_id = new.user_id and role = 'leader')) then
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'mention', new.user_id, '/chat?room=' || new.room_id, txt from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  else
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'mention', new.user_id, '/chat?room=' || new.room_id, txt
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id and m.user_id = any(new.mentions);
  end if;
  return new;
end $$;
drop trigger if exists messages_notify_mentions on public.messages;
create trigger messages_notify_mentions after insert on public.messages for each row execute function public.notify_mentions();


select 'ok' as chat_edit_delete_mentions_setup;
