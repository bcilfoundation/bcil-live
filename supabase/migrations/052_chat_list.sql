-- WhatsApp-style chat list: every conversation I'm in, with its last message, the time and my unread count
create or replace function public.chat_list() returns table (
  room_id uuid, kind text, category text, name text, avatar text, other_id uuid,
  last_body text, last_type text, last_user uuid, last_name text, last_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.category,
         case when r.kind = 'dm' then p.full_name else r.name end,
         case when r.kind = 'dm' then p.avatar_url else r.cover_url end,
         p.id,
         lm.body, lm.attachment_type, lm.user_id, lp.full_name, lm.created_at,
         (select count(*)::int from messages m
           where m.room_id = r.id and m.created_at > rm.last_read_at and m.user_id <> rm.user_id and not m.hidden)
  from room_members rm
  join rooms r on r.id = rm.room_id
  left join lateral (select m2.user_id from room_members m2
                      where r.kind = 'dm' and m2.room_id = r.id and m2.user_id <> rm.user_id limit 1) o on true
  left join profiles p on p.id = o.user_id
  left join lateral (select m.body, m.attachment_type, m.user_id, m.created_at from messages m
                      where m.room_id = r.id and not m.hidden order by m.created_at desc limit 1) lm on true
  left join profiles lp on lp.id = lm.user_id
  where rm.user_id = auth.uid()
  order by lm.created_at desc nulls last
$$;
grant execute on function public.chat_list() to authenticated;
create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);

select 'chat_list_setup' as step, 'ok' as result;
