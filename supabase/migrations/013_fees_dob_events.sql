-- BCIL Live: form fees (e.g. FCB certificate), date of birth, event page with QR check-in. Safe to run more than once.

-- ---------- Form fees ----------
alter table public.forms add column if not exists fee_pesewas integer check (fee_pesewas is null or fee_pesewas >= 100);
alter table public.forms add column if not exists fee_label text;                 -- e.g. "Certificate fee"
alter table public.forms add column if not exists fee_required boolean not null default false;
alter table public.form_responses add column if not exists paid_at timestamptz;
alter table public.form_responses add column if not exists ticket uuid not null default gen_random_uuid();
alter table public.form_responses add column if not exists checked_in_at timestamptz;
create unique index if not exists form_responses_ticket on public.form_responses (ticket);

alter table public.gifts drop constraint if exists gifts_kind_check;
alter table public.gifts add constraint gifts_kind_check check (kind in ('donation','live_gift','form_fee'));
alter table public.gifts add column if not exists form_response_id bigint references public.form_responses(id) on delete set null;

-- when a form fee is paid, mark the response paid
create or replace function public.mark_form_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'form_fee' and new.form_response_id is not null and new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    update form_responses set paid_at = coalesce(paid_at, now()) where id = new.form_response_id;
  end if;
  return new;
end $$;
drop trigger if exists gifts_mark_form_paid on public.gifts;
create trigger gifts_mark_form_paid after insert or update of status on public.gifts for each row execute function public.mark_form_paid();

-- how many people registered for a form (shown on the event page; no names)
create or replace function public.form_count(p_slug text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from form_responses r join forms f on f.id = r.form_id where f.slug = p_slug and r.status <> 'declined'
$$;

-- ---------- QR check-in on the day (admins and moderators scan tickets) ----------
create or replace function public.check_in(p_ticket uuid) returns table (name text, form_title text, already boolean, paid boolean, fee boolean, status text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_staff() then raise exception 'Only BCIL staff can check people in'; end if;
  select fr.id, fr.answers, fr.checked_in_at, fr.paid_at, fr.status, f.title, f.fee_pesewas, p.full_name
    into r from form_responses fr join forms f on f.id = fr.form_id join profiles p on p.id = fr.user_id where fr.ticket = p_ticket;
  if not found then raise exception 'Ticket not found'; end if;
  if r.checked_in_at is null then update form_responses set checked_in_at = now() where id = r.id; end if;
  return query select coalesce(r.answers->>'full_name', r.answers->>'name', r.full_name), r.title, r.checked_in_at is not null, r.paid_at is not null, r.fee_pesewas is not null, r.status;
end $$;

-- ---------- Date of birth (kept private: only the person and admins can see it) ----------
create table if not exists public.private_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date not null check (birth_date > '1900-01-01' and birth_date < current_date),
  updated_at timestamptz not null default now()
);
alter table public.private_profiles enable row level security;
drop policy if exists "see own private profile" on public.private_profiles;
create policy "see own private profile" on public.private_profiles for select to authenticated using (user_id = auth.uid() or is_admin());

-- members cannot change is_minor themselves, except through set_birth_date below
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_minor is distinct from old.is_minor)
     and not is_admin() and auth.uid() is not null and coalesce(current_setting('bcil.dob', true), '') <> '1' then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;

-- set your date of birth once (admins can correct it later); marks under-18s automatically
create or replace function public.set_birth_date(p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
declare minor boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if exists (select 1 from private_profiles where user_id = auth.uid()) then raise exception 'Your date of birth is already saved. Ask BCIL to correct it.'; end if;
  if p_date is null or p_date >= current_date or p_date < '1900-01-01' then raise exception 'Enter a valid date of birth'; end if;
  insert into private_profiles (user_id, birth_date) values (auth.uid(), p_date);
  minor := p_date > (current_date - interval '18 years');
  perform set_config('bcil.dob', '1', true);
  -- only ever marks someone under 18; an admin's under-18 mark is never removed this way
  if minor then update profiles set is_minor = true where id = auth.uid(); end if;
  return minor;
end $$;

-- new accounts: take the date of birth given at sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  insert into profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), new.phone);
  begin d := (new.raw_user_meta_data->>'birth_date')::date; exception when others then d := null; end;
  if d is not null and d < current_date and d > '1900-01-01' then
    insert into private_profiles (user_id, birth_date) values (new.id, d) on conflict do nothing;
    if d > (current_date - interval '18 years') then update profiles set is_minor = true where id = new.id; end if;
  end if;
  return new;
end $$;

-- ---------- Event pages (FCB 2027): edited by admins in the app ----------
create table if not exists public.event_pages (
  slug text primary key,
  title text not null,
  subtitle text,
  starts_on date,
  venue text,
  about text,
  hero_url text,
  form_slug text,                       -- the registration form for this event
  schedule jsonb not null default '[]', -- [{"time":"8:00","title":"Registration","detail":"..."}]
  speakers jsonb not null default '[]', -- [{"name":"...","role":"...","photo":"https://..."}]
  updated_at timestamptz not null default now()
);
alter table public.event_pages enable row level security;
drop policy if exists "anyone reads events" on public.event_pages;
create policy "anyone reads events" on public.event_pages for select using (true);
drop policy if exists "staff edit events" on public.event_pages;
create policy "staff edit events" on public.event_pages for all to authenticated using (is_staff()) with check (is_staff());

insert into public.event_pages (slug, title, subtitle, starts_on, venue, about, hero_url, form_slug, schedule, speakers) values (
  'fcb2027', 'Finding Campus Balance 2027', '6th edition', '2027-01-23', 'Auditorium 900, University of Cape Coast',
  'A day for students to find balance on campus: digital safety and responsibility, academic wellbeing, a campus life experience panel, a CV and cover letter clinic, and mentorship.',
  '/fcb/hero.jpg', 'fcb27-registration',
  '[{"time":"","title":"CV and Cover Letter Clinic","detail":"CALC 10. A few CVs reviewed live, common mistakes shared with everyone"},
    {"time":"","title":"Registration and check-in","detail":"Show your QR ticket at the desk"},
    {"time":"","title":"Opening"},
    {"time":"","title":"Digital Safety & Responsibility"},
    {"time":"","title":"Academic Wellbeing"},
    {"time":"","title":"Break"},
    {"time":"","title":"Campus Life Experience Panel","detail":"Followed by Q&A"},
    {"time":"","title":"Mentorship registration"},
    {"time":"","title":"Student Support and Laptop Initiative"},
    {"time":"","title":"Closing and evaluation"}]'::jsonb,
  '[]'::jsonb)
on conflict (slug) do nothing;

select 'ok' as fees_dob_events_setup;
