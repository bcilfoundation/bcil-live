-- 042: a call started from a document opens that document for the other person
create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; k text; host text; lnk text := '/live';
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') then
    if new.room_id is not null then
      select name, kind into g, k from rooms where id = new.room_id;
      if k = 'dm' then
        select full_name into host from profiles where id = new.host_id;
        if new.topic like '/doc/%' then lnk := new.topic; end if;
        insert into call_requests (session_id, user_id, status)
          select new.id, m.user_id, 'on_air' from room_members m
          where m.room_id = new.room_id and m.user_id is distinct from new.host_id
          on conflict do nothing;
        insert into notifications (user_id, kind, actor_id, link, body)
          select m.user_id, 'live', new.host_id, lnk,
            case when lnk <> '/live' then '📞 ' || coalesce(host, 'BCIL') || ' wants to review your document with you on a call. Tap to join.'
                 else '📞 ' || coalesce(host, 'BCIL') || ' started a live call with you. Tap to join.' end
          from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.host_id;
      else
        insert into notifications (user_id, kind, actor_id, link, body)
          select m.user_id, 'live', new.host_id, '/live', coalesce(g, 'Your group') || ' is live now: ' || new.title
          from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.host_id;
      end if;
    elsif not coalesce(new.is_private, false) then
      insert into notifications (user_id, kind, actor_id, link, body)
        select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
        from profiles p where p.id is distinct from new.host_id;
    end if;
  end if;
  return new;
end $$;
select 'ok' as doc_calls_setup;
