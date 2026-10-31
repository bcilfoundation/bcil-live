-- BCIL Live: database schema for Supabase (Postgres)
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Every table has Row Level Security (RLS) on, so people only see what they should.

-- ---------- People ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  school text,
  level text,
  role text not null default 'member' check (role in ('member','mentor','moderator','admin')),
  is_minor boolean not null default false,          -- under 18 (e.g. Beyond Junior High); limits DMs
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- helper: is the signed-in user an admin / moderator?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin')
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','moderator'))
$$;

-- create a profile automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.phone);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles readable by signed-in users" on profiles for select to authenticated using (true);
create policy "edit own profile" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- members cannot promote themselves: only admins may change role or is_minor
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_minor is distinct from old.is_minor)
     and not is_admin() and auth.uid() is not null then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;
create trigger profiles_protect_role before update on profiles
  for each row execute function public.protect_role();
create policy "admins edit any profile" on profiles for update to authenticated using (is_admin());

-- ---------- Daily quotes ----------
create table public.quotes (
  id bigint generated always as identity primary key,
  show_on date not null unique,
  theme text not null check (theme in ('Integrity','Mentorship','Persistence','Impact','Responsibility','Excellence')),
  body text not null,
  author text not null default 'BCIL Foundation',
  reflection text,
  created_by uuid references profiles(id)
);
alter table public.quotes enable row level security;
create policy "anyone reads quotes up to today" on quotes for select using (show_on <= current_date);
create policy "admins manage quotes" on quotes for all to authenticated using (is_admin()) with check (is_admin());

-- ---------- Chat ----------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'group' check (kind in ('group','announcements','dm')),
  invite_code text unique,                           -- null = open to all members
  read_only boolean not null default false,          -- announcements: only admins post
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  hidden boolean not null default false,             -- set by moderators
  created_at timestamptz not null default now()
);
create index on messages (room_id, created_at);
alter table rooms enable row level security;
alter table room_members enable row level security;
alter table messages enable row level security;

create or replace function public.is_member(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from room_members where room_id = r and user_id = auth.uid())
$$;

create policy "see rooms you belong to or open rooms" on rooms for select to authenticated
  using (is_member(id) or (invite_code is null and kind <> 'dm') or is_staff());
create policy "admins manage rooms" on rooms for all to authenticated using (is_admin()) with check (is_admin());
create policy "see own memberships" on room_members for select to authenticated using (user_id = auth.uid() or is_staff());
create policy "join open rooms" on room_members for insert to authenticated
  with check (user_id = auth.uid() and exists(select 1 from rooms where id = room_id and invite_code is null and kind <> 'dm'));
create policy "update own read marker" on room_members for update to authenticated using (user_id = auth.uid());
create policy "leave rooms" on room_members for delete to authenticated using (user_id = auth.uid());
create policy "read messages in your rooms" on messages for select to authenticated
  using ((is_member(room_id) and not hidden) or is_staff());
create policy "post in your rooms" on messages for insert to authenticated
  with check (user_id = auth.uid() and is_member(room_id)
    and (not (select read_only from rooms where id = room_id) or is_admin()));
create policy "moderators hide messages" on messages for update to authenticated using (is_staff());

-- join an invite-only group with a code
create or replace function public.join_with_code(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  select id into r from rooms where upper(invite_code) = upper(code);
  if r is null then raise exception 'No group has that code'; end if;
  insert into room_members (room_id, user_id) values (r, auth.uid()) on conflict do nothing;
  return r;
end $$;

-- ---------- Reports (chat, comments, live) ----------
create table public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references profiles(id),
  target_type text not null check (target_type in ('message','comment','live_chat','user')),
  target_id text not null,
  reason text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table reports enable row level security;
create policy "anyone signed in can report" on reports for insert to authenticated with check (reporter = auth.uid());
create policy "staff read and resolve reports" on reports for all to authenticated using (is_staff());

-- ---------- Live room ----------
create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text,
  starts_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','ended')),
  channel text not null unique default replace(gen_random_uuid()::text,'-',''),  -- Agora channel name
  host_id uuid references profiles(id),
  chat_locked boolean not null default false,
  recording_url text,                                -- filled after the session; shows in the Library
  created_at timestamptz not null default now()
);
create table public.live_reminders (
  session_id uuid references live_sessions(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (session_id, user_id)
);
create table public.call_requests (
  id bigint generated always as identity primary key,
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  topic text,
  status text not null default 'waiting' check (status in ('waiting','on_air','done','declined','cancelled')),
  created_at timestamptz not null default now()
);
-- one open request per person per session
create unique index call_requests_one_open on call_requests (session_id, user_id) where status in ('waiting','on_air');
create table public.live_chat (
  id bigint generated always as identity primary key,
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table live_sessions enable row level security;
alter table live_reminders enable row level security;
alter table call_requests enable row level security;
alter table live_chat enable row level security;

create policy "anyone sees sessions" on live_sessions for select using (true);
create policy "admins run sessions" on live_sessions for all to authenticated using (is_admin()) with check (is_admin());
create policy "own reminders" on live_reminders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "see own requests; hosts see all" on call_requests for select to authenticated using (user_id = auth.uid() or is_staff());
create policy "request to call in" on call_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'waiting'
    and exists(select 1 from live_sessions where id = session_id and status = 'live'));
create policy "cancel own request" on call_requests for update to authenticated
  using (user_id = auth.uid()) with check (status in ('cancelled','done'));
create policy "hosts manage requests" on call_requests for update to authenticated using (is_staff());
create policy "read live chat" on live_chat for select to authenticated using (not hidden or is_staff());
create policy "post live chat" on live_chat for insert to authenticated
  with check (user_id = auth.uid()
    and exists(select 1 from live_sessions where id = session_id and status = 'live' and (not chat_locked or is_staff())));
create policy "moderate live chat" on live_chat for update to authenticated using (is_staff());

-- ---------- Forms ----------
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  subtitle text,
  fields jsonb not null,             -- [{"key":"full_name","label":"Full name","type":"text","required":true}, ...]
  is_open boolean not null default true,
  sensitive boolean not null default false,   -- e.g. laptop applications: only admins see responses
  created_at timestamptz not null default now()
);
create table public.form_responses (
  id bigint generated always as identity primary key,
  form_id uuid not null references forms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  answers jsonb not null,
  status text not null default 'received' check (status in ('received','accepted','declined','waitlist')),
  created_at timestamptz not null default now()
);
alter table forms enable row level security;
alter table form_responses enable row level security;
create policy "anyone sees open forms" on forms for select using (is_open or is_admin());
create policy "admins manage forms" on forms for all to authenticated using (is_admin()) with check (is_admin());
create policy "submit to open forms" on form_responses for insert to authenticated
  with check (user_id = auth.uid() and exists(select 1 from forms where id = form_id and is_open));
create policy "see own responses" on form_responses for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "admins update responses" on form_responses for update to authenticated using (is_admin());

-- ---------- Giving ----------
create table public.gifts (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  amount_pesewas integer not null check (amount_pesewas >= 100),   -- GH₵ 1.00 = 100 pesewas
  purpose text not null default 'General support',
  method text not null check (method in ('mobile_money','card','bank_transfer','cash')),
  status text not null default 'pending' check (status in ('pending','paid','failed','recorded')),
  paystack_reference text unique,
  note text,
  created_at timestamptz not null default now()
);
alter table gifts enable row level security;
create policy "see own gifts; admins see all" on gifts for select to authenticated using (user_id = auth.uid() or is_admin());
-- people may only RECORD a gift they already sent; paid gifts are written by the Paystack webhook (service role)
create policy "record a gift already sent" on gifts for insert to authenticated
  with check (user_id = auth.uid() and status = 'recorded' and paystack_reference is null);

-- ---------- Library (YouTube videos synced by admins) ----------
create table public.talks (
  id uuid primary key default gen_random_uuid(),
  youtube_id text unique,
  title text not null,
  program text not null,
  published_on date,
  duration_seconds integer,
  created_at timestamptz not null default now()
);
create table public.talk_likes (talk_id uuid references talks(id) on delete cascade, user_id uuid references profiles(id) on delete cascade, primary key (talk_id, user_id));
create table public.talk_saves (talk_id uuid references talks(id) on delete cascade, user_id uuid references profiles(id) on delete cascade, primary key (talk_id, user_id));
create table public.talk_comments (
  id bigint generated always as identity primary key,
  talk_id uuid not null references talks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table talks enable row level security;
alter table talk_likes enable row level security;
alter table talk_saves enable row level security;
alter table talk_comments enable row level security;
create policy "anyone sees talks" on talks for select using (true);
create policy "admins manage talks" on talks for all to authenticated using (is_admin()) with check (is_admin());
create policy "likes are public" on talk_likes for select using (true);
create policy "own likes" on talk_likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saves" on talk_saves for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read comments" on talk_comments for select using (not hidden or is_staff());
create policy "post comments" on talk_comments for insert to authenticated with check (user_id = auth.uid());
create policy "moderate comments" on talk_comments for update to authenticated using (is_staff());

-- ---------- Private notes ----------
create table public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  talk_id uuid references talks(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table notes enable row level security;
create policy "only you see your notes" on notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Real-time ----------
-- Chat, live chat, call-in queue and live session status update instantly in the app.
alter publication supabase_realtime add table messages, live_chat, call_requests, live_sessions;

-- ---------- Starter content ----------
insert into rooms (name, kind, read_only) values
  ('BCIL Community','group',false),
  ('Announcements','announcements',true);
insert into rooms (name, kind, invite_code) values ('FCB 2027 Cohort','group','FCB-2027');

insert into forms (slug, title, subtitle, fields) values
 ('fcb27-registration', 'FCB''27 Registration', 'Sat 23 Jan 2027 · Auditorium 900, UCC',
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"phone","label":"Phone or WhatsApp","type":"tel","required":true},{"key":"programme","label":"Programme and level","type":"text","required":true},{"key":"hall","label":"Hall or hostel","type":"text","required":false}]'),
 ('cv-clinic', 'CV and Cover Letter Clinic', 'One-hour pre-program session · CALC 10',
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"phone","label":"Phone or WhatsApp","type":"tel","required":true},{"key":"applying_for","label":"What are you applying for?","type":"text","required":true}]'),
 ('fcb27-volunteer', 'FCB''27 Volunteering', 'Ushering, registration, technical, media',
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"phone","label":"Phone or WhatsApp","type":"tel","required":true},{"key":"team","label":"Preferred team","type":"select","options":["Ushering and protocol","Registration","Technical","Media","Logistics"],"required":true}]'),
 ('fcb27-mentorship', 'FCB 2027 Mentorship Registration', 'Academic, career and personal development',
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"phone","label":"Phone or WhatsApp","type":"tel","required":true},{"key":"area","label":"Area you want mentorship in","type":"text","required":true}]');
insert into forms (slug, title, subtitle, sensitive, fields) values
 ('student-support-laptop', 'Student Support Initiative (laptop)', 'For deserving UCC undergraduates', true,
  '[{"key":"full_name","label":"Full name","type":"text","required":true},{"key":"student_id","label":"Student ID","type":"text","required":true},{"key":"programme","label":"Programme and level","type":"text","required":true},{"key":"need","label":"Why do you need a laptop?","type":"textarea","required":true}]');

-- ---------- Update: host can mute callers (added 31 Oct 2026) ----------
alter table public.call_requests add column if not exists muted_by_host boolean not null default false;

-- Everyone in a session can see who is on air (and whether the host muted them),
-- so every listener's app can silence a muted caller.
drop policy if exists "everyone sees on-air callers" on call_requests;
create policy "everyone sees on-air callers" on call_requests for select to authenticated using (status = 'on_air');
