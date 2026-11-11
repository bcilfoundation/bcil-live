-- 047: Meet Solomon and Plan 2027 are private to the admin (and whoever he assigns, plus a mentee's own mentor);
-- Meet Solomon bookings use Solomon's availability, and confirmed meetings appear in his Google Calendar via a private feed.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- ---------- Meet Solomon: private, with assigning ----------
alter table public.meeting_requests add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.meeting_requests add column if not exists slot_at timestamptz;          -- the time the member picked
alter table public.meeting_requests add column if not exists minutes int not null default 30;
create unique index if not exists meeting_requests_one_per_slot on public.meeting_requests (slot_at) where slot_at is not null and status in ('pending', 'confirmed');

drop policy if exists "own meeting requests" on public.meeting_requests;
create policy "own meeting requests" on public.meeting_requests for select to authenticated
  using (user_id = auth.uid() or is_admin() or assigned_to = auth.uid());
drop policy if exists "staff manage meeting requests" on public.meeting_requests;
create policy "staff manage meeting requests" on public.meeting_requests for update to authenticated
  using (is_admin() or assigned_to = auth.uid()) with check (is_admin() or assigned_to = auth.uid());

create or replace function public.assign_meeting(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r meeting_requests; nm text;
begin
  if not is_admin() then raise exception 'Only the admin can assign requests'; end if;
  update meeting_requests set assigned_to = p_user where id = p_id returning * into r;
  if not found then raise exception 'Request not found'; end if;
  if p_user is not null and p_user <> auth.uid() then
    select full_name into nm from profiles where id = r.user_id;
    insert into notifications (user_id, kind, actor_id, link, body)
      values (p_user, 'meeting', auth.uid(), '/admin?tab=Meetings', '📅 You were asked to handle a meeting request from ' || coalesce(nm, 'a member') || ': ' || left(r.topic, 60));
  end if;
end $$;
grant execute on function public.assign_meeting(bigint, uuid) to authenticated;

create or replace function public.respond_meeting(p_id bigint, p_status text, p_at timestamptz, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare r meeting_requests; room uuid; body text; t timestamptz;
begin
  select * into r from meeting_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if not (is_admin() or r.assigned_to = auth.uid()) then raise exception 'Only Solomon, or someone he assigns, can respond'; end if;
  if p_status not in ('confirmed', 'declined', 'done') then raise exception 'Unknown status'; end if;
  t := coalesce(p_at, r.slot_at);
  if p_status = 'confirmed' then
    if t is null then raise exception 'Pick a date and time'; end if;
    select m1.room_id into room from room_members m1 join room_members m2 on m2.room_id = m1.room_id
      join rooms x on x.id = m1.room_id where x.kind = 'dm' and m1.user_id = auth.uid() and m2.user_id = r.user_id limit 1;
    if room is null and r.user_id <> auth.uid() then
      insert into rooms (name, kind) values ('Direct message', 'dm') returning id into room;
      insert into room_members (room_id, user_id) values (room, auth.uid()), (room, r.user_id);
    end if;
  end if;
  update meeting_requests set status = p_status, meet_at = case when p_status = 'confirmed' then t else meet_at end,
    reply = coalesce(nullif(trim(p_reply), ''), reply), room_id = coalesce(room, room_id), handled_by = auth.uid() where id = p_id;
  if p_status <> 'done' then
    body := case when p_status = 'confirmed'
      then '✅ Your meeting is confirmed for ' || to_char(t at time zone 'Africa/Accra', 'Dy DD Mon, HH12:MI AM') || ' (Ghana time). Tap to add it to your calendar'
      else 'Your meeting request was not accepted this time. Tap to see the reply' end;
    insert into notifications (user_id, kind, actor_id, link, body) values (r.user_id, 'meeting', auth.uid(), '/meet', body);
  end if;
end $$;
grant execute on function public.respond_meeting(bigint, text, timestamptz, text) to authenticated;

-- documents attached to a meeting request: the sender, the admin and the assigned person
create or replace function public.can_see_doc(d bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents x where x.id = d and (
    x.owner_id = auth.uid() or is_admin()
    or (x.context = 'form' and is_staff())
    or (x.context = 'mentorship' and exists (select 1 from mentorships m where m.id = x.ref_id and auth.uid() in (m.mentor_id, m.mentee_id)))
    or (x.context = 'meeting' and exists (select 1 from meeting_requests m where m.id = x.ref_id and m.assigned_to = auth.uid()))))
$$;

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
    if not is_staff() then raise exception 'Only BCIL staff can review applications'; end if;
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

-- comment notifications also reach whoever is assigned to the meeting request
create or replace function public.notify_doc_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare d documents; nm text;
begin
  select * into d from documents where id = new.document_id;
  select full_name into nm from profiles where id = new.user_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select distinct u, 'doc', new.user_id, '/doc/' || d.id, '💬 ' || coalesce(nm, 'Someone') || ' commented on ' || left(d.name, 50) || ': ' || left(new.body, 60)
    from (
      select d.owner_id as u
      union select m.mentor_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select m.mentee_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select m.assigned_to from meeting_requests m where d.context = 'meeting' and m.id = d.ref_id
      union select c.user_id from doc_comments c where c.document_id = d.id
      union select p.id from profiles p where d.context in ('meeting', 'form') and p.role = 'admin' and new.user_id = d.owner_id
    ) t where u is not null and u <> new.user_id;
  return new;
end $$;

-- ---------- Plan 2027: private, with assigning ----------
alter table public.plans add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create or replace function public.can_see_plan(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans x where x.id = p and (
    x.user_id = auth.uid() or is_admin() or x.assigned_to = auth.uid()
    or (x.status = 'submitted' and exists (select 1 from mentorships m where m.mentee_id = x.user_id and m.mentor_id = auth.uid() and m.status = 'active'))))
$$;

create or replace function public.assign_plan(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid; nm text;
begin
  if not is_admin() then raise exception 'Only the admin can assign plans'; end if;
  update plans set assigned_to = p_user where id = p_id returning user_id into owner;
  if owner is null then raise exception 'Plan not found'; end if;
  if p_user is not null and p_user <> auth.uid() then
    select full_name into nm from profiles where id = owner;
    insert into notifications (user_id, kind, actor_id, link, body)
      values (p_user, 'plan', auth.uid(), '/admin?tab=Plan%202027', '📝 You were asked to give feedback on ' || coalesce(nm, 'a member') || '''s 2027 plan');
  end if;
end $$;
grant execute on function public.assign_plan(bigint, uuid) to authenticated;

create or replace function public.submit_plan(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  update plans set status = 'submitted', submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Not your plan'; end if;
  select full_name into nm from profiles where id = auth.uid();
  insert into notifications (user_id, kind, actor_id, link, body)
    select distinct u, 'plan', auth.uid(), '/admin?tab=Plan%202027', '📝 ' || coalesce(nm, 'A member') || ' submitted their 2027 plan for feedback'
    from (select id as u from profiles where role = 'admin'
          union select mentor_id from mentorships where mentee_id = auth.uid() and status = 'active'
          union select assigned_to from plans where id = p_id) t
    where u is not null and u <> auth.uid();
end $$;

create or replace function public.give_plan_feedback(p_id bigint, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not can_see_plan(p_id) or exists (select 1 from plans where id = p_id and user_id = auth.uid()) then raise exception 'You can''t give feedback on this plan'; end if;
  update plans set feedback = nullif(trim(p_feedback), ''), feedback_by = auth.uid(), feedback_at = now() where id = p_id and status = 'submitted' returning user_id into owner;
  if owner is null then raise exception 'Plan not found'; end if;
  insert into notifications (user_id, kind, actor_id, link, body) values (owner, 'plan', auth.uid(), '/plan', '💬 You have feedback on your 2027 plan');
end $$;

create or replace function public.plan_draft_count() returns int
language sql stable security definer set search_path = public as $$
  select case when is_admin() then (select count(*)::int from plans where status = 'draft') else 0 end
$$;

-- ---------- Solomon's availability ----------
create table if not exists public.meeting_availability (
  id bigint generated always as identity primary key,
  weekday int not null check (weekday between 0 and 6),        -- 0 = Sunday … 6 = Saturday
  start_time time not null, end_time time not null check (end_time > start_time),
  tz text not null default 'America/New_York',
  slot_minutes int not null default 30 check (slot_minutes between 10 and 180),
  valid_from date, valid_to date, label text,
  active boolean not null default true
);
alter table public.meeting_availability enable row level security;
drop policy if exists "members see availability" on public.meeting_availability;
create policy "members see availability" on public.meeting_availability for select to authenticated using (true);
drop policy if exists "admin sets availability" on public.meeting_availability;
create policy "admin sets availability" on public.meeting_availability for all to authenticated using (is_admin()) with check (is_admin());

-- Fall 2026: Mondays and Tuesdays 12–1 pm, Fridays 2–3 pm (New York time), 30-minute meetings
insert into public.meeting_availability (weekday, start_time, end_time, tz, slot_minutes, valid_to, label)
select * from (values (1, time '12:00', time '13:00', 'America/New_York', 30, date '2026-12-20', 'Fall 2026'),
                      (2, time '12:00', time '13:00', 'America/New_York', 30, date '2026-12-20', 'Fall 2026'),
                      (5, time '14:00', time '15:00', 'America/New_York', 30, date '2026-12-20', 'Fall 2026')) v
where not exists (select 1 from public.meeting_availability);

-- open slots for the next few weeks (at least 12 hours ahead, not already booked)
create or replace function public.meeting_slots(p_days int default 28) returns table (slot_at timestamptz, minutes int)
language sql stable security definer set search_path = public as $$
  select s, a.slot_minutes
  from meeting_availability a
  cross join generate_series(current_date - 1, current_date + least(greatest(p_days, 1), 90), interval '1 day') d
  cross join lateral generate_series(((d::date + a.start_time) at time zone a.tz),
                                     ((d::date + a.end_time) at time zone a.tz) - make_interval(mins => a.slot_minutes),
                                     make_interval(mins => a.slot_minutes)) s
  where a.active and extract(dow from d) = a.weekday
    and (a.valid_from is null or d::date >= a.valid_from) and (a.valid_to is null or d::date <= a.valid_to)
    and s > now() + interval '12 hours'
    and not exists (select 1 from meeting_requests m where m.status in ('pending', 'confirmed') and coalesce(m.meet_at, m.slot_at) = s)
  order by s
$$;
grant execute on function public.meeting_slots(int) to authenticated;

-- ---------- Private calendar feed (subscribe once in Google Calendar) ----------
create table if not exists public.calendar_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
drop policy if exists "own calendar token" on public.calendar_tokens;
create policy "own calendar token" on public.calendar_tokens for select to authenticated using (user_id = auth.uid());

create or replace function public.my_calendar_token() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not (is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('moderator', 'mentor'))) then raise exception 'Not available'; end if;
  insert into calendar_tokens (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from calendar_tokens where user_id = auth.uid();
  return t;
end $$;
grant execute on function public.my_calendar_token() to authenticated;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'text/calendar') then
    create domain "text/calendar" as text;
  end if;
end $$;

-- the feed itself: confirmed meetings for the token's owner (all of them for the admin)
create or replace function public.meetings_ics(token text) returns "text/calendar"
language plpgsql stable security definer set search_path = public as $$
declare u uuid; adm boolean; out text; m record;
  esc text;
begin
  select c.user_id into u from calendar_tokens c where c.token = meetings_ics.token;
  if u is null then return 'BEGIN:VCALENDAR' || chr(13) || chr(10) || 'VERSION:2.0' || chr(13) || chr(10) || 'END:VCALENDAR'; end if;
  select role = 'admin' into adm from profiles where id = u;
  out := concat_ws(chr(13) || chr(10), 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BCIL Foundation//Meet Solomon//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Meet Solomon (BCIL)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H');
  for m in
    select r.*, p.full_name, p.phone from meeting_requests r join profiles p on p.id = r.user_id
    where r.status in ('confirmed', 'done') and r.meet_at is not null and r.meet_at > now() - interval '60 days'
      and (adm or r.assigned_to = u or r.handled_by = u)
    order by r.meet_at
  loop
    out := out || chr(13) || chr(10) || concat_ws(chr(13) || chr(10),
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
  return out || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10);
end $$;
grant execute on function public.meetings_ics(text) to anon, authenticated;

select 'ok' as private_meetings_calendar_setup, (select count(*) from public.meeting_availability) as availability_rows;
