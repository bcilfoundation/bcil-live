-- 056: schedule live sessions from the Live tab, invite members, groups and email addresses,
-- reminders 15 minutes before, cancel/edit, and "added to Google Calendar". Safe to run more than once.

alter table public.live_sessions add column if not exists record_planned boolean not null default false;
alter table public.live_sessions add column if not exists reminded_at timestamptz;

-- email addresses invited to a session (the send-live-invite function emails them)
create table if not exists public.live_email_invites (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (session_id, email)
);
alter table public.live_email_invites enable row level security;
drop policy if exists "staff see email invites" on public.live_email_invites;
create policy "staff see email invites" on public.live_email_invites for select to authenticated using (is_staff());

create or replace function public.live_when(t timestamptz) returns text
language sql immutable as $$ select trim(to_char(t at time zone 'Africa/Accra', 'Dy DD Mon, FMHH12:MI AM')) || ' GMT' $$;

-- invite members, whole groups and email addresses; members are notified straight away
create or replace function public.invite_to_live(p_session uuid, p_users uuid[] default '{}', p_rooms uuid[] default '{}', p_emails text[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare s live_sessions; host text; n int := 0; e text;
begin
  select * into s from live_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found'; end if;
  if not is_staff() and s.host_id is distinct from auth.uid() then raise exception 'Only staff or the host can invite people'; end if;
  if s.status = 'ended' then raise exception 'This session has ended'; end if;
  select full_name into host from profiles where id = auth.uid();

  with wanted as (
    select unnest(coalesce(p_users, '{}')) as uid
    union select m.user_id from room_members m where m.room_id = any(coalesce(p_rooms, '{}'))
  ), added as (
    insert into live_invites (session_id, user_id)
      select p_session, w.uid from wanted w join profiles p on p.id = w.uid where w.uid is distinct from s.host_id
      on conflict do nothing returning user_id
  ), notified as (
    insert into notifications (user_id, kind, actor_id, link, body)
      select a.user_id, 'live', auth.uid(), '/live',
        case when s.status = 'live' then '🔴 ' || coalesce(host, 'BCIL') || ' invited you to join now: ' || s.title || '. Tap to join.'
             else '📅 You''re invited: ' || s.title || ' · ' || live_when(s.starts_at) || '. You''ll get a reminder before it starts.' end
      from added a returning 1
  ) select count(*) into n from notified;

  foreach e in array coalesce(p_emails, '{}') loop
    e := lower(trim(e));
    if e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      insert into live_email_invites (session_id, email) values (p_session, e) on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.invite_to_live(uuid, uuid[], uuid[], text[]) to authenticated;

-- schedule a session (staff); returns its id
create or replace function public.schedule_live(p_title text, p_starts timestamptz, p_kind text, p_private boolean, p_record boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; code text;
begin
  if not is_staff() then raise exception 'Only staff can schedule sessions'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Add a title'; end if;
  if p_starts < now() - interval '5 minutes' then raise exception 'Pick a time in the future'; end if;
  if p_private then code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10); end if;
  insert into live_sessions (title, starts_at, status, host_id, kind, open_mic, is_private, invite_code, record_planned)
    values (left(trim(p_title), 90), p_starts, 'scheduled', auth.uid(), case when p_kind = 'video' then 'video' else 'audio' end,
            p_kind = 'video', coalesce(p_private, false), code, coalesce(p_record, false))
    returning live_sessions.id into v_id;
  return v_id;
end $$;
grant execute on function public.schedule_live(text, timestamptz, text, boolean, boolean) to authenticated;

-- change a scheduled session; invited people hear about a new time
create or replace function public.update_live(p_id uuid, p_title text, p_starts timestamptz, p_kind text, p_private boolean, p_record boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  select * into s from live_sessions where id = p_id;
  if s.id is null or s.status <> 'scheduled' then raise exception 'Only scheduled sessions can be changed'; end if;
  if not is_staff() and s.host_id is distinct from auth.uid() then raise exception 'Only staff or the host can change it'; end if;
  update live_sessions set title = left(trim(p_title), 90), starts_at = p_starts, kind = case when p_kind = 'video' then 'video' else 'audio' end,
    open_mic = p_kind = 'video', is_private = coalesce(p_private, false),
    invite_code = case when p_private then coalesce(s.invite_code, substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) else s.invite_code end,
    record_planned = coalesce(p_record, false), reminded_at = case when p_starts <> s.starts_at then null else s.reminded_at end
  where id = p_id;
  if p_starts <> s.starts_at then
    insert into notifications (user_id, kind, actor_id, link, body)
      select i.user_id, 'live', auth.uid(), '/live', '🕑 New time: ' || left(trim(p_title), 90) || ' is now ' || live_when(p_starts) || '.'
      from live_invites i where i.session_id = p_id;
    update live_email_invites set sent_at = null where session_id = p_id;   -- email the new time
  end if;
end $$;
grant execute on function public.update_live(uuid, text, timestamptz, text, boolean, boolean) to authenticated;

-- cancel a scheduled session: invited people are told, then it is removed
create or replace function public.cancel_live(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  select * into s from live_sessions where id = p_id;
  if s.id is null then return; end if;
  if s.status <> 'scheduled' then raise exception 'Only scheduled sessions can be cancelled'; end if;
  if not is_staff() and s.host_id is distinct from auth.uid() then raise exception 'Only staff or the host can cancel it'; end if;
  insert into notifications (user_id, kind, actor_id, link, body)
    select x.user_id, 'live', auth.uid(), '/live', '❌ Cancelled: ' || s.title || ' (' || live_when(s.starts_at) || ')'
    from (select user_id from live_invites where session_id = p_id union select user_id from live_reminders where session_id = p_id) x;
  delete from live_sessions where id = p_id;
end $$;
grant execute on function public.cancel_live(uuid) to authenticated;

-- invited people, and people who tapped "Remind me", get a reminder 15 minutes before
create or replace function public.send_live_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  for s in select * from live_sessions where status = 'scheduled' and reminded_at is null
             and starts_at between now() and now() + interval '15 minutes' loop
    insert into notifications (user_id, kind, link, body)
      select x.user_id, 'live', '/live', '⏰ Starting soon: ' || s.title || ' · ' || live_when(s.starts_at)
      from (select user_id from live_invites where session_id = s.id union select user_id from live_reminders where session_id = s.id) x
      where x.user_id is distinct from s.host_id;
    update live_sessions set reminded_at = now() where id = s.id;
  end loop;
end $$;
select cron.unschedule('bcil-live-reminders') where exists (select 1 from cron.job where jobname = 'bcil-live-reminders');
select cron.schedule('bcil-live-reminders', '*/5 * * * *', 'select public.send_live_reminders()');

-- going live: public sessions notify everyone (as before); invited-only sessions notify the people invited
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
    elsif coalesce(new.is_private, false) then
      insert into notifications (user_id, kind, actor_id, link, body)
        select i.user_id, 'live', new.host_id, '/live', '🔴 Live now: ' || new.title || '. Tap to join.'
        from live_invites i where i.session_id = new.id and i.user_id is distinct from new.host_id;
    else
      insert into notifications (user_id, kind, actor_id, link, body)
        select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
        from profiles p where p.id is distinct from new.host_id;
    end if;
  end if;
  return new;
end $$;

-- Google Calendar: remember that the person added their calendar link
alter table public.calendar_tokens add column if not exists added_at timestamptz;
create or replace function public.calendar_added(p_added boolean default true) returns void
language sql security definer set search_path = public as $$
  update calendar_tokens set added_at = case when p_added then now() end where user_id = auth.uid() $$;
grant execute on function public.calendar_added(boolean) to authenticated;
create or replace function public.my_calendar_added() returns timestamptz
language sql stable security definer set search_path = public as $$ select added_at from calendar_tokens where user_id = auth.uid() $$;
grant execute on function public.my_calendar_added() to authenticated;

select 'ok' as live_schedule_invites_setup;
