-- 072: say "BCIL Foundation" (not just "BCIL") in notifications, calendar names and messages from the database.
-- Each function below is its latest version, unchanged apart from that wording. Safe to run more than once.

-- from 056_live_schedule_invites.sql
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
            case when lnk <> '/live' then '📞 ' || coalesce(host, 'BCIL Foundation') || ' wants to review your document with you on a call. Tap to join.'
                 else '📞 ' || coalesce(host, 'BCIL Foundation') || ' started a live call with you. Tap to join.' end
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
        select p.id, 'live', new.host_id, '/live', 'BCIL Foundation is live now: ' || new.title
        from profiles p where p.id is distinct from new.host_id;
    end if;
  end if;
  return new;
end $$;

-- from 061_privacy_friends.sql
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if other = auth.uid() then raise exception 'You cannot message yourself'; end if;
  if is_blocked(auth.uid(), other) then raise exception 'You can''t message this person'; end if;
  if not can_connect(auth.uid(), other) then raise exception 'Messages with under-18 members go through BCIL Foundation staff and mentors'; end if;
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

-- from 012_paid_gifts.sql
create or replace function public.announce_live_gift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'live_gift' and new.session_id is not null and new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into live_chat (session_id, user_id, body, kind)
    values (new.session_id, new.user_id, 'sent ' || coalesce(new.gift_label, '🎁 a gift') || ' 💛 supporting BCIL Foundation', 'gift');
  end if;
  return new;
end $$;

-- from 032_guest_registration.sql
create or replace function public.check_in(p_ticket uuid) returns table (name text, form_title text, already boolean, paid boolean, fee boolean, status text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can check people in'; end if;
  select fr.id, fr.answers, fr.checked_in_at, fr.paid_at, fr.status, fr.guest_name, f.title, f.fee_pesewas, p.full_name
    into r from form_responses fr join forms f on f.id = fr.form_id left join profiles p on p.id = fr.user_id where fr.ticket = p_ticket;
  if not found then raise exception 'Ticket not found'; end if;
  if r.checked_in_at is null then update form_responses set checked_in_at = now() where id = r.id; end if;
  return query select coalesce(r.answers->>'full_name', r.answers->>'name', r.guest_name, r.full_name), r.title, r.checked_in_at is not null, r.paid_at is not null, r.fee_pesewas is not null, r.status;
end $$;

-- from 013_fees_dob_events.sql
create or replace function public.set_birth_date(p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
declare minor boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if exists (select 1 from private_profiles where user_id = auth.uid()) then raise exception 'Your date of birth is already saved. Ask BCIL Foundation to correct it.'; end if;
  if p_date is null or p_date >= current_date or p_date < '1900-01-01' then raise exception 'Enter a valid date of birth'; end if;
  insert into private_profiles (user_id, birth_date) values (auth.uid(), p_date);
  minor := p_date > (current_date - interval '18 years');
  perform set_config('bcil.dob', '1', true);
  -- only ever marks someone under 18; an admin's under-18 mark is never removed this way
  if minor then update profiles set is_minor = true where id = auth.uid(); end if;
  return minor;
end $$;

-- from 014_engagement.sql
create or replace function public.engagement_leaderboard(p_days int default 30)
returns table (user_id uuid, name text, avatar_url text, listen_minutes int, talks_finished int, live_minutes int, live_sessions int,
               quotes_read int, quote_likes int, days_active int, score int)
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can see this'; end if;
  return query
  with l as (select t.user_id, sum(t.seconds)::int / 60 as mins, count(*) filter (where t.completed)::int as fin, array_agg(distinct t.day) as d
             from talk_listens t where t.day >= since::date group by t.user_id),
       a as (select x.user_id, sum(x.minutes)::int as mins, count(*)::int as n, array_agg(distinct x.last_at::date) as d
             from live_attendance x where x.last_at >= since group by x.user_id),
       r as (select q.user_id, count(*)::int as n, array_agg(distinct q.read_at::date) as d from quote_reads q where q.read_at >= since group by q.user_id),
       k as (select q.user_id, count(*)::int as n from quote_likes q where q.created_at >= since group by q.user_id),
       ids as (select l.user_id from l union select a.user_id from a union select r.user_id from r union select k.user_id from k)
  select ids.user_id, p.full_name, p.avatar_url,
         coalesce(l.mins, 0), coalesce(l.fin, 0), coalesce(a.mins, 0), coalesce(a.n, 0), coalesce(r.n, 0), coalesce(k.n, 0),
         (select count(distinct dd)::int from unnest(coalesce(l.d, '{}'::date[]) || coalesce(a.d, '{}'::date[]) || coalesce(r.d, '{}'::date[])) dd),
         (coalesce(l.mins, 0) + coalesce(a.mins, 0) + coalesce(l.fin, 0) * 5 + coalesce(r.n, 0) * 2 + coalesce(k.n, 0))
  from ids join profiles p on p.id = ids.user_id
  left join l on l.user_id = ids.user_id left join a on a.user_id = ids.user_id
  left join r on r.user_id = ids.user_id left join k on k.user_id = ids.user_id
  order by 11 desc, 2 limit 200;
end $$;

-- from 014_engagement.sql
create or replace function public.talk_stats(p_days int default 30)
returns table (talk_id uuid, title text, kind text, listeners int, minutes int, finished int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can see this'; end if;
  return query select t.id, t.title, t.kind, count(distinct l.user_id)::int, (sum(l.seconds) / 60)::int, count(*) filter (where l.completed)::int
  from talk_listens l join talks t on t.id = l.talk_id where l.day >= current_date - greatest(p_days, 1)
  group by t.id order by 4 desc, 5 desc limit 50;
end $$;

-- from 014_engagement.sql
create or replace function public.quote_stats(p_days int default 30)
returns table (quote_id bigint, show_on date, body text, reads int, likes int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can see this'; end if;
  return query select q.id, q.show_on, q.body,
    (select count(*)::int from quote_reads r where r.quote_id = q.id),
    (select count(*)::int from quote_likes k where k.quote_id = q.id)
  from quotes q where q.show_on <= current_date and q.show_on >= current_date - greatest(p_days, 1)
  order by q.show_on desc;
end $$;

-- from 019_notify_everyone.sql
create or replace function public.notify_everyone(p_kind text, p_body text, p_link text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can notify everyone'; end if;
  insert into notifications (user_id, kind, actor_id, link, body)
    select p.id, left(p_kind, 30), auth.uid(), p_link, left(p_body, 200) from profiles p where p.id <> auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- from 032_guest_registration.sql
create or replace function public.form_onsite_code(p_form uuid) returns text
language plpgsql security definer set search_path = public, private as $$
declare c text;
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can see the walk-in link'; end if;
  select code into c from private.form_onsite where form_id = p_form;
  if c is null then
    c := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    insert into private.form_onsite (form_id, code) values (p_form, c);
  end if;
  return c;
end $$;

-- from 036_mentorship.sql
create or replace function public.pair_mentorship(p_mentor uuid, p_mentee uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare r uuid; id bigint; mname text; ename text;
begin
  if not is_staff() then raise exception 'Only BCIL Foundation staff can pair mentors'; end if;
  if p_mentor = p_mentee then raise exception 'Pick two different people'; end if;
  select full_name into mname from profiles where profiles.id = p_mentor;
  select full_name into ename from profiles where profiles.id = p_mentee;
  -- reuse their direct-message room if they already have one
  select m1.room_id into r from room_members m1 join room_members m2 on m2.room_id = m1.room_id
    join rooms x on x.id = m1.room_id
    where x.kind = 'dm' and m1.user_id = p_mentor and m2.user_id = p_mentee limit 1;
  if r is null then
    insert into rooms (name, kind) values ('Mentorship', 'dm') returning rooms.id into r;
    insert into room_members (room_id, user_id) values (r, p_mentor), (r, p_mentee);
  end if;
  insert into mentorships (mentor_id, mentee_id, room_id, created_by) values (p_mentor, p_mentee, r, auth.uid())
    on conflict (mentor_id, mentee_id) where status = 'active' do update set room_id = excluded.room_id
    returning mentorships.id into id;
  insert into notifications (user_id, kind, actor_id, link, body) values
    (p_mentee, 'mentorship', auth.uid(), '/chat?room=' || r, '🤝 ' || coalesce(mname, 'A mentor') || ' is your BCIL Foundation mentor. Say hello!'),
    (p_mentor, 'mentorship', auth.uid(), '/chat?room=' || r, '🤝 You are now mentoring ' || coalesce(ename, 'a student') || '. Say hello!');
  return id;
end $$;

-- from 047_private_meetings_calendar.sql
create or replace function public.open_document(p_path text, p_name text, p_context text, p_ref bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare d bigint; own uuid; asg uuid;
begin
  select id into d from documents where path = p_path;
  if d is not null then
    if not can_see_doc(d) then raise exception 'You can''t open this document'; end if;
    return d;
  end if;
  if p_context = 'meeting' then
    select user_id, assigned_to into own, asg from meeting_requests where id = p_ref and files ? p_path;
    if own is null or not (is_admin() or own = auth.uid() or asg = auth.uid()) then raise exception 'You can''t open this document'; end if;
  elsif p_context = 'mentorship' then
    if not exists (select 1 from mentorships where id = p_ref and auth.uid() in (mentor_id, mentee_id)) then raise exception 'You are not in this mentorship'; end if;
    if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Upload the file first'; end if;
    own := auth.uid();
  elsif p_context = 'form' then
    if not is_staff() then raise exception 'Only BCIL Foundation staff can review applications'; end if;
    own := null;
  else
    raise exception 'Unknown document type';
  end if;
  insert into documents (owner_id, path, name, context, ref_id)
    values (own, p_path, left(coalesce(nullif(trim(p_name), ''), regexp_replace(p_path, '^.*/', '')), 150), p_context, p_ref)
    returning id into d;
  if p_context = 'mentorship' then
    insert into notifications (user_id, kind, actor_id, link, body)
      select case when m.mentor_id = auth.uid() then m.mentee_id else m.mentor_id end, 'doc', auth.uid(), '/doc/' || d,
        '📄 ' || coalesce((select full_name from profiles where id = auth.uid()), 'Your mentorship partner') || ' shared a document for review: ' || left(p_name, 60)
      from mentorships m where m.id = p_ref;
  end if;
  return d;
end $$;

-- from 057_calendar_live_sessions.sql
create or replace function public.meetings_ics(token text) returns "*/*"
language plpgsql volatile security definer set search_path = public as $$
declare u uuid; adm boolean; cal text; m record; l record;
begin
  perform set_config('response.headers', '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Content-Disposition": "inline; filename=meet-solomon.ics"}]', true);
  select c.user_id into u from calendar_tokens c where c.token = meetings_ics.token;
  if u is null then return convert_to('BEGIN:VCALENDAR' || chr(13) || chr(10) || 'VERSION:2.0' || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10), 'UTF8'); end if;
  select role = 'admin' into adm from profiles where id = u;
  cal := concat_ws(chr(13) || chr(10), 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BCIL Foundation//Meet Solomon//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Meet Solomon (BCIL Foundation)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H');
  for m in
    select r.*, p.full_name, p.phone from meeting_requests r join profiles p on p.id = r.user_id
    where r.status in ('confirmed', 'done') and r.meet_at is not null and r.meet_at > now() - interval '60 days'
      and (adm or r.assigned_to = u or r.handled_by = u)
    order by r.meet_at
  loop
    cal := cal || chr(13) || chr(10) || concat_ws(chr(13) || chr(10),
      'BEGIN:VEVENT',
      'UID:meet-' || m.id || '@bcilfoundation.org',
      'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTSTART:' || to_char(m.meet_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTEND:' || to_char((m.meet_at + make_interval(mins => coalesce(m.minutes, 30))) at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'SUMMARY:' || regexp_replace(left('Meet: ' || coalesce(m.full_name, 'Member') || ' – ' || m.topic, 140), '([,;\\])', '\\\1', 'g'),
      'DESCRIPTION:' || replace(regexp_replace(left(concat_ws(E'\n', m.message, case when m.mode is not null then 'How: ' || m.mode end,
          case when m.phone is not null then 'Phone: ' || m.phone end, 'https://live.bcilfoundation.org/admin?tab=Meetings'), 900),
        '([,;\\])', '\\\1', 'g'), E'\n', '\n'),
      'STATUS:CONFIRMED',
      'END:VEVENT');
  end loop;
  for l in
    select s.* from live_sessions s
    where s.status in ('scheduled', 'live') and s.starts_at > now() - interval '1 day' and s.room_id is null
      and (s.host_id = u or exists (select 1 from live_invites i where i.session_id = s.id and i.user_id = u) or adm)
    order by s.starts_at
  loop
    cal := cal || chr(13) || chr(10) || concat_ws(chr(13) || chr(10),
      'BEGIN:VEVENT',
      'UID:live-' || l.id || '@bcilfoundation.org',
      'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTSTART:' || to_char(l.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTEND:' || to_char((l.starts_at + interval '1 hour') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'SUMMARY:' || regexp_replace(left('Live: ' || l.title, 140), '([,;\\])', '\\\1', 'g'),
      'DESCRIPTION:' || case when l.is_private then 'Invited only. ' else '' end || 'Join in the BCIL Foundation app: https://live.bcilfoundation.org/live'
        || case when l.is_private and l.invite_code is not null then '?join=' || l.invite_code else '' end,
      'URL:https://live.bcilfoundation.org/live',
      'STATUS:CONFIRMED',
      'END:VEVENT');
  end loop;
  return convert_to(cal || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10), 'UTF8');
end $$;

-- from 056_live_schedule_invites.sql
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
        case when s.status = 'live' then '🔴 ' || coalesce(host, 'BCIL Foundation') || ' invited you to join now: ' || s.title || '. Tap to join.'
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

-- names and text stored as data
update public.forms set subtitle = replace(subtitle, 'BCIL Academic Mentorship', 'BCIL Foundation Academic Mentorship') where subtitle like '%BCIL Academic Mentorship%';
update public.forms set title = replace(title, 'BCIL Academic Mentorship', 'BCIL Foundation Academic Mentorship') where title like '%BCIL Academic Mentorship%';
update public.shop_books set description = replace(description, 'from a BCIL contact', 'from a BCIL Foundation contact') where description like '%from a BCIL contact%';

select 'ok' as foundation_name_setup;
