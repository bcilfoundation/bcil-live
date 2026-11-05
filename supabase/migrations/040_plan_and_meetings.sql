-- 040: Plan 2027 (a one-year plan each member builds in the app, with mentor feedback, monthly check-ins and
-- quarterly reviews) and Meet Solomon (meeting requests with documents, confirmed by staff). Safe to run more than once.

-- ---------- Plan 2027 ----------
create table if not exists public.plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  year int not null default 2027,
  theme text, vision text, habits_build text, habits_drop text,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  feedback text, feedback_by uuid references profiles(id) on delete set null, feedback_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, year)
);
create table if not exists public.plan_goals (
  id bigint generated always as identity primary key,
  plan_id bigint not null references plans(id) on delete cascade,
  area text, title text not null, success text,
  q1 text, q2 text, q3 text, q4 text, first_actions text,
  progress int not null default 0 check (progress between 0 and 100),
  sort int not null default 0
);
create table if not exists public.plan_checkins (
  id bigint generated always as identity primary key,
  plan_id bigint not null references plans(id) on delete cascade,
  note text not null, score int check (score between 1 and 5),
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
alter table public.plan_goals enable row level security;
alter table public.plan_checkins enable row level security;

-- the owner does everything with their own plan; staff and mentors read submitted plans
create or replace function public.can_see_plan(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans where id = p and (user_id = auth.uid()
    or (status = 'submitted' and exists (select 1 from profiles where id = auth.uid() and role in ('admin','moderator','mentor')))))
$$;
create or replace function public.owns_plan(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans where id = p and user_id = auth.uid())
$$;
drop policy if exists "own plan" on public.plans;
create policy "own plan" on public.plans for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "mentors read submitted plans" on public.plans;
create policy "mentors read submitted plans" on public.plans for select to authenticated using (can_see_plan(id));
drop policy if exists "own goals" on public.plan_goals;
create policy "own goals" on public.plan_goals for all to authenticated using (owns_plan(plan_id)) with check (owns_plan(plan_id));
drop policy if exists "mentors read goals" on public.plan_goals;
create policy "mentors read goals" on public.plan_goals for select to authenticated using (can_see_plan(plan_id));
drop policy if exists "own checkins" on public.plan_checkins;
create policy "own checkins" on public.plan_checkins for all to authenticated using (owns_plan(plan_id)) with check (owns_plan(plan_id));
drop policy if exists "mentors read checkins" on public.plan_checkins;
create policy "mentors read checkins" on public.plan_checkins for select to authenticated using (can_see_plan(plan_id));

-- a member submits their plan for feedback: admins are told
create or replace function public.submit_plan(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  update plans set status = 'submitted', submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Not your plan'; end if;
  select full_name into nm from profiles where id = auth.uid();
  insert into notifications (user_id, kind, actor_id, link, body)
    select id, 'plan', auth.uid(), '/admin?tab=Plan%202027', '📝 ' || coalesce(nm, 'A member') || ' submitted their 2027 plan for feedback'
    from profiles where role = 'admin' and id <> auth.uid();
end $$;
grant execute on function public.submit_plan(bigint) to authenticated;

-- staff and mentors give feedback: the member is told
create or replace function public.give_plan_feedback(p_id bigint, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','moderator','mentor')) then raise exception 'Only BCIL mentors and staff can give feedback'; end if;
  update plans set feedback = nullif(trim(p_feedback), ''), feedback_by = auth.uid(), feedback_at = now() where id = p_id and status = 'submitted' returning user_id into owner;
  if owner is null then raise exception 'Plan not found'; end if;
  insert into notifications (user_id, kind, actor_id, link, body) values (owner, 'plan', auth.uid(), '/plan', '💬 You have feedback on your 2027 plan');
end $$;
grant execute on function public.give_plan_feedback(bigint, text) to authenticated;

-- how many plans are still drafts (staff only)
create or replace function public.plan_draft_count() returns int
language sql stable security definer set search_path = public as $$
  select case when is_staff() then (select count(*)::int from plans where status = 'draft') else 0 end
$$;
grant execute on function public.plan_draft_count() to authenticated;

-- monthly check-in reminder on the 1st (8:00 Ghana time); quarterly review in April, July and October
create or replace function public.send_plan_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int := extract(month from now());
begin
  insert into notifications (user_id, kind, link, body)
    select user_id, 'plan', '/plan',
      case when m in (4, 7, 10) then '🧭 Quarterly review: look back at your 2027 plan, mark your progress and adjust your goals'
           else '🗓️ Monthly check-in: how are your 2027 goals going? Update your progress' end
    from plans where year = extract(year from now())::int;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_plan_reminders() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-plan-reminders';
select cron.schedule('bcil-plan-reminders', '0 8 1 * *', 'select public.send_plan_reminders()');

-- ---------- Meet Solomon ----------
create table if not exists public.meeting_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  topic text not null, message text not null, mode text, preferred text,
  files jsonb not null default '[]',            -- private storage paths (form-files bucket)
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'done')),
  meet_at timestamptz, reply text, room_id uuid references rooms(id) on delete set null,
  handled_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.meeting_requests enable row level security;
drop policy if exists "own meeting requests" on public.meeting_requests;
create policy "own meeting requests" on public.meeting_requests for select to authenticated using (user_id = auth.uid() or is_staff());
drop policy if exists "members request meetings" on public.meeting_requests;
create policy "members request meetings" on public.meeting_requests for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "staff manage meeting requests" on public.meeting_requests;
create policy "staff manage meeting requests" on public.meeting_requests for update to authenticated using (is_staff()) with check (is_staff());

-- tell admins when a request comes in
create or replace function public.notify_meeting_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select full_name into nm from profiles where id = new.user_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select id, 'meeting', new.user_id, '/admin?tab=Meetings', '📅 ' || coalesce(nm, 'A member') || ' asked to meet: ' || left(new.topic, 60)
    from profiles where role = 'admin' and id <> new.user_id;
  return new;
end $$;
drop trigger if exists meeting_requests_notify on public.meeting_requests;
create trigger meeting_requests_notify after insert on public.meeting_requests for each row execute function public.notify_meeting_request();

-- staff confirm (with a time), decline or close a request; confirming opens a private chat with the member
create or replace function public.respond_meeting(p_id bigint, p_status text, p_at timestamptz, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare r meeting_requests; room uuid; body text;
begin
  if not is_staff() then raise exception 'Only BCIL staff can respond'; end if;
  if p_status not in ('confirmed', 'declined', 'done') then raise exception 'Unknown status'; end if;
  select * into r from meeting_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if p_status = 'confirmed' then
    if p_at is null then raise exception 'Pick a date and time'; end if;
    select m1.room_id into room from room_members m1 join room_members m2 on m2.room_id = m1.room_id
      join rooms x on x.id = m1.room_id where x.kind = 'dm' and m1.user_id = auth.uid() and m2.user_id = r.user_id limit 1;
    if room is null and r.user_id <> auth.uid() then
      insert into rooms (name, kind) values ('Direct message', 'dm') returning id into room;
      insert into room_members (room_id, user_id) values (room, auth.uid()), (room, r.user_id);
    end if;
  end if;
  update meeting_requests set status = p_status, meet_at = coalesce(p_at, meet_at), reply = coalesce(nullif(trim(p_reply), ''), reply),
    room_id = coalesce(room, room_id), handled_by = auth.uid() where id = p_id;
  if p_status <> 'done' then
    body := case when p_status = 'confirmed'
      then '✅ Your meeting is confirmed for ' || to_char(p_at at time zone 'Africa/Accra', 'Dy DD Mon, HH12:MI AM') || ' (Ghana time)'
      else 'Your meeting request was not accepted this time. Tap to see the reply' end;
    insert into notifications (user_id, kind, actor_id, link, body) values (r.user_id, 'meeting', auth.uid(), '/meet', body);
  end if;
end $$;
grant execute on function public.respond_meeting(bigint, text, timestamptz, text) to authenticated;

-- reminder an hour before a confirmed meeting, to both
create or replace function public.send_meeting_reminders() returns int
language plpgsql security definer set search_path = public, private as $$
declare m record; total int := 0;
begin
  for m in select * from meeting_requests where status = 'confirmed' and meet_at > now() + interval '50 minutes' and meet_at <= now() + interval '65 minutes' loop
    insert into private.sent_reminders (key) values ('meet:' || m.id || ':' || m.meet_at) on conflict do nothing;
    if found then
      insert into notifications (user_id, kind, link, body)
        select u, 'meeting', '/meet', '⏰ Your meeting starts in an hour: ' || left(m.topic, 60)
        from unnest(array[m.user_id, m.handled_by]) u where u is not null;
      total := total + 2;
    end if;
  end loop;
  return total;
end $$;
revoke all on function public.send_meeting_reminders() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-meeting-reminders';
select cron.schedule('bcil-meeting-reminders', '*/5 * * * *', 'select public.send_meeting_reminders()');

select (select count(*) from cron.job where jobname in ('bcil-plan-reminders','bcil-meeting-reminders')) as new_jobs,
       to_regclass('public.plans') is not null as plans_ready, to_regclass('public.meeting_requests') is not null as meetings_ready;
