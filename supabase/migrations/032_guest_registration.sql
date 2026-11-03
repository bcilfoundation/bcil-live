-- BCIL Live: register for a programme without an account (link or QR code), walk-in registration that checks
-- people in straight away, public ticket page, and names on the scanner for everyone. Safe to run more than once.
alter table public.form_responses alter column user_id drop not null;
alter table public.form_responses add column if not exists guest_name text;
alter table public.form_responses add column if not exists guest_email text;
alter table public.form_responses add column if not exists guest_phone text;
alter table public.form_responses add column if not exists ticket_emailed_at timestamptz;

-- the walk-in code is secret (forms are readable by everyone), so it lives in the private schema
create table if not exists private.form_onsite (form_id uuid primary key references public.forms(id) on delete cascade, code text not null);

create or replace function public.form_onsite_code(p_form uuid) returns text
language plpgsql security definer set search_path = public, private as $$
declare c text;
begin
  if not is_staff() then raise exception 'Only BCIL staff can see the walk-in link'; end if;
  select code into c from private.form_onsite where form_id = p_form;
  if c is null then
    c := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    insert into private.form_onsite (form_id, code) values (p_form, c);
  end if;
  return c;
end $$;
grant execute on function public.form_onsite_code(uuid) to authenticated;

-- submit a form with or without an account. With the walk-in code, the person is checked in at once.
create or replace function public.submit_form(p_slug text, p_answers jsonb, p_onsite text default null)
returns table (ticket uuid, response_id bigint, name text, form_title text, checked_in boolean)
language plpgsql security definer set search_path = public, private as $$
declare f record; nm text; em text; ph text; walk boolean; r record;
begin
  select * into f from forms where slug = p_slug and is_open;
  if f is null then raise exception 'This form is closed or the link is not valid'; end if;
  nm := nullif(trim(coalesce(p_answers->>'full_name', p_answers->>'name', '')), '');
  em := nullif(lower(trim(coalesce(p_answers->>'email', ''))), '');
  ph := nullif(trim(coalesce(p_answers->>'phone', '')), '');
  if auth.uid() is null and nm is null then raise exception 'Please add your full name'; end if;
  walk := p_onsite is not null and exists (select 1 from private.form_onsite o where o.form_id = f.id and o.code = p_onsite);
  insert into form_responses (form_id, user_id, answers, guest_name, guest_email, guest_phone, checked_in_at)
  values (f.id, auth.uid(), p_answers, nm, em, ph, case when walk then now() end)
  returning form_responses.id, form_responses.ticket, form_responses.checked_in_at into r;
  return query select r.ticket, r.id,
    coalesce(nm, (select full_name from profiles where id = auth.uid())), f.title, r.checked_in_at is not null;
end $$;
grant execute on function public.submit_form(text, jsonb, text) to anon, authenticated;

-- the ticket page (/t/<ticket>): the long random ticket number is the key, so no account is needed
create or replace function public.ticket_info(p_ticket uuid)
returns table (name text, form_title text, checked_in boolean, event_title text, event_slug text, event_starts date, venue text)
language sql stable security definer set search_path = public as $$
  select coalesce(r.answers->>'full_name', r.answers->>'name', r.guest_name, p.full_name), f.title, r.checked_in_at is not null,
         e.title, e.slug, e.starts_on, e.venue
  from form_responses r join forms f on f.id = r.form_id
  left join profiles p on p.id = r.user_id
  left join event_pages e on e.form_slug = f.slug
  where r.ticket = p_ticket
$$;
grant execute on function public.ticket_info(uuid) to anon, authenticated;

-- scanning: show the name for guests too
create or replace function public.check_in(p_ticket uuid) returns table (name text, form_title text, already boolean, paid boolean, fee boolean, status text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_staff() then raise exception 'Only BCIL staff can check people in'; end if;
  select fr.id, fr.answers, fr.checked_in_at, fr.paid_at, fr.status, fr.guest_name, f.title, f.fee_pesewas, p.full_name
    into r from form_responses fr join forms f on f.id = fr.form_id left join profiles p on p.id = fr.user_id where fr.ticket = p_ticket;
  if not found then raise exception 'Ticket not found'; end if;
  if r.checked_in_at is null then update form_responses set checked_in_at = now() where id = r.id; end if;
  return query select coalesce(r.answers->>'full_name', r.answers->>'name', r.guest_name, r.full_name), r.title, r.checked_in_at is not null, r.paid_at is not null, r.fee_pesewas is not null, r.status;
end $$;

select 'ok' as guest_registration_setup;
