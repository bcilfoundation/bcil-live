-- 036: mentorship. Students ask for a mentor and mentors offer to help through two forms; staff pair them in
-- Admin → Mentorship. Each pair gets a private chat and session reminders an hour before. Safe to run more than once.

create table if not exists public.mentorships (
  id bigint generated always as identity primary key,
  mentor_id uuid not null references profiles(id) on delete cascade,
  mentee_id uuid not null references profiles(id) on delete cascade,
  room_id uuid references rooms(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'ended')),
  next_session timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists mentorships_pair on public.mentorships (mentor_id, mentee_id) where status = 'active';
alter table public.mentorships enable row level security;
drop policy if exists "pairs see their mentorship" on public.mentorships;
create policy "pairs see their mentorship" on public.mentorships for select to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid() or is_staff());
drop policy if exists "staff manage mentorships" on public.mentorships;
create policy "staff manage mentorships" on public.mentorships for all to authenticated using (is_staff()) with check (is_staff());

-- the pair set their next session (mentor or mentee)
create or replace function public.set_mentorship_session(p_id bigint, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare m mentorships;
begin
  select * into m from mentorships where id = p_id and status = 'active';
  if not found or not (auth.uid() in (m.mentor_id, m.mentee_id) or is_staff()) then raise exception 'Not your mentorship'; end if;
  update mentorships set next_session = p_at where id = p_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select u, 'mentorship', auth.uid(), '/mentorship',
      case when p_at is null then 'Your next mentorship session was cleared'
           else 'Next mentorship session: ' || to_char(p_at at time zone 'Africa/Accra', 'Dy DD Mon, HH12:MI AM') || ' (Ghana time)' end
    from unnest(array[m.mentor_id, m.mentee_id]) u where u <> auth.uid();
end $$;
grant execute on function public.set_mentorship_session(bigint, timestamptz) to authenticated;

-- staff pair a mentor with a mentee: a private chat for the two of them, and both are told
create or replace function public.pair_mentorship(p_mentor uuid, p_mentee uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare r uuid; id bigint; mname text; ename text;
begin
  if not is_staff() then raise exception 'Only BCIL staff can pair mentors'; end if;
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
    (p_mentee, 'mentorship', auth.uid(), '/chat?room=' || r, '🤝 ' || coalesce(mname, 'A mentor') || ' is your BCIL mentor. Say hello!'),
    (p_mentor, 'mentorship', auth.uid(), '/chat?room=' || r, '🤝 You are now mentoring ' || coalesce(ename, 'a student') || '. Say hello!');
  return id;
end $$;
grant execute on function public.pair_mentorship(uuid, uuid) to authenticated;

-- reminders an hour before a session, to both (checked every 5 minutes)
create or replace function public.send_mentorship_reminders() returns int
language plpgsql security definer set search_path = public, private as $$
declare m record; total int := 0;
begin
  for m in select * from mentorships where status = 'active' and next_session > now() + interval '50 minutes' and next_session <= now() + interval '65 minutes' loop
    insert into private.sent_reminders (key) values ('mentor:' || m.id || ':' || m.next_session) on conflict do nothing;
    if found then
      insert into notifications (user_id, kind, link, body)
        select u, 'mentorship', '/chat?room=' || m.room_id, '⏰ Your mentorship session starts in an hour'
        from unnest(array[m.mentor_id, m.mentee_id]) u;
      total := total + 2;
    end if;
  end loop;
  return total;
end $$;
revoke all on function public.send_mentorship_reminders() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-mentorship-reminders';
select cron.schedule('bcil-mentorship-reminders', '*/5 * * * *', 'select public.send_mentorship_reminders()');

-- the two sign-up forms (members fill them in the app, so staff can pair their accounts)
insert into public.forms (slug, title, subtitle, description, sensitive, fields) values
('mentorship-mentee', 'Find a mentor', 'BCIL Academic Mentorship',
 'Tell us about yourself and what you would like help with. We will pair you with a mentor and let you know in the app.', false,
 $j$[{"key":"full_name","label":"Full name","type":"text","required":true},
     {"key":"phone","label":"Phone / WhatsApp number","type":"tel","required":true},
     {"key":"school","label":"School or university","type":"text","required":true},
     {"key":"level","label":"Level or year","type":"text","required":true},
     {"key":"programme","label":"Programme of study","type":"text"},
     {"key":"areas","label":"What would you like help with?","type":"checkbox","required":true,"options":["Studies and exams","Career and CV","Leadership","Faith and purpose","Personal growth","Money and planning","Other"]},
     {"key":"goal","label":"One goal for the next three months","type":"textarea","required":true},
     {"key":"frequency","label":"How often would you like to meet?","type":"radio","required":true,"options":["Every week","Every two weeks","Once a month"]}]$j$::jsonb),
('mentorship-mentor', 'Become a mentor', 'BCIL Academic Mentorship',
 'Share your time and experience with a student. We will pair you with a mentee and let you know in the app.', false,
 $j$[{"key":"full_name","label":"Full name","type":"text","required":true},
     {"key":"phone","label":"Phone / WhatsApp number","type":"tel","required":true},
     {"key":"work","label":"What do you do? (job, studies or ministry)","type":"text","required":true},
     {"key":"areas","label":"What can you help with?","type":"checkbox","required":true,"options":["Studies and exams","Career and CV","Leadership","Faith and purpose","Personal growth","Money and planning","Other"]},
     {"key":"capacity","label":"How many mentees can you take?","type":"radio","required":true,"options":["1","2","3 or more"]},
     {"key":"why","label":"Why do you want to mentor?","type":"textarea"}]$j$::jsonb)
on conflict (slug) do nothing;

select 'ok' as mentorship_setup;
