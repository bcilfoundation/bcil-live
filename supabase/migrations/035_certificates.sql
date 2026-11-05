-- 035: certificates for programmes (FCB 2027 first).
-- Who gets one: registered for the programme, checked in at the venue, asked for a certificate on the form
-- (if the form asks), and paid the certificate fee (if the form has one). Staff release certificates when the
-- programme is over; until then nobody can download. Safe to run more than once.

alter table public.event_pages add column if not exists certificates_open boolean not null default false;

-- certificate_info(ticket): the ticket number is the key, so it works for guests without an account
-- (from their ticket page) and for the public check page /c/<ticket> that confirms a certificate is genuine.
create or replace function public.certificate_info(p_ticket uuid)
returns table (ok boolean, reason text, name text, event_title text, event_subtitle text, starts_on date, venue text, ticket uuid)
language plpgsql stable security definer set search_path = public as $$
declare r record; wants text;
begin
  select fr.ticket, fr.answers, fr.checked_in_at, fr.paid_at, fr.guest_name, f.fee_pesewas,
         e.title, e.subtitle, e.starts_on, e.venue, e.certificates_open, p.full_name
    into r
    from form_responses fr
    join forms f on f.id = fr.form_id
    join event_pages e on e.form_slug = f.slug
    left join profiles p on p.id = fr.user_id
   where fr.ticket = p_ticket
   limit 1;
  if not found then
    return query select false, 'not_found', null::text, null::text, null::text, null::date, null::text, p_ticket; return;
  end if;
  wants := r.answers->>'certificate';
  return query select
    (r.certificates_open and r.checked_in_at is not null and coalesce(wants, 'Yes') = 'Yes'
       and (r.fee_pesewas is null or wants is distinct from 'Yes' or r.paid_at is not null)),
    case
      when not r.certificates_open then 'not_released'
      when r.checked_in_at is null then 'not_checked_in'
      when coalesce(wants, 'Yes') <> 'Yes' then 'not_requested'
      when r.fee_pesewas is not null and r.paid_at is null then 'not_paid'
      else 'ok' end,
    coalesce(nullif(trim(r.answers->>'full_name'), ''), nullif(trim(r.answers->>'name'), ''), r.guest_name, r.full_name),
    r.title, r.subtitle, r.starts_on, r.venue, r.ticket;
end $$;
revoke all on function public.certificate_info(uuid) from public;
grant execute on function public.certificate_info(uuid) to anon, authenticated;

-- staff mark a certificate fee as paid (Mobile Money sent to the BCIL number, checked by the team)
drop policy if exists "staff update responses" on public.form_responses;
create policy "staff update responses" on public.form_responses for update to authenticated using (is_staff()) with check (is_staff());

select 'ok' as certificates_setup;
