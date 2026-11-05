-- 039: certificates for volunteers. A programme can have a volunteer form (FCB 2027: fcb27-volunteer).
-- Volunteers get a QR ticket like participants; when they're checked in (scanned on the day, or "Mark served"
-- in Admin), they get a volunteer certificate once staff release certificates. Safe to run more than once.

alter table public.event_pages add column if not exists volunteer_form_slug text;
update public.event_pages set volunteer_form_slug = 'fcb27-volunteer' where slug = 'fcb2027' and volunteer_form_slug is null;

drop function if exists public.certificate_info(uuid);
create function public.certificate_info(p_ticket uuid)
returns table (ok boolean, reason text, kind text, name text, team text, event_title text, event_subtitle text, starts_on date, venue text, ticket uuid)
language plpgsql stable security definer set search_path = public as $$
declare r record; wants text; vol boolean;
begin
  select fr.ticket, fr.answers, fr.checked_in_at, fr.paid_at, fr.guest_name, f.slug as form_slug, f.fee_pesewas,
         e.title, e.subtitle, e.starts_on, e.venue, e.certificates_open, e.volunteer_form_slug, p.full_name
    into r
    from form_responses fr
    join forms f on f.id = fr.form_id
    join event_pages e on e.form_slug = f.slug or e.volunteer_form_slug = f.slug
    left join profiles p on p.id = fr.user_id
   where fr.ticket = p_ticket
   limit 1;
  if not found then
    return query select false, 'not_found', null::text, null::text, null::text, null::text, null::text, null::date, null::text, p_ticket; return;
  end if;
  vol := r.form_slug = r.volunteer_form_slug;
  wants := case when vol then 'Yes' else r.answers->>'certificate' end;
  return query select
    (r.certificates_open and r.checked_in_at is not null and coalesce(wants, 'Yes') = 'Yes'
       and (vol or r.fee_pesewas is null or wants is distinct from 'Yes' or r.paid_at is not null)),
    case
      when not r.certificates_open then 'not_released'
      when r.checked_in_at is null then case when vol then 'not_served' else 'not_checked_in' end
      when coalesce(wants, 'Yes') <> 'Yes' then 'not_requested'
      when not vol and r.fee_pesewas is not null and r.paid_at is null then 'not_paid'
      else 'ok' end,
    case when vol then 'volunteer' else 'participant' end,
    coalesce(nullif(trim(r.answers->>'full_name'), ''), nullif(trim(r.answers->>'name'), ''), r.guest_name, r.full_name),
    case when vol then nullif(trim(r.answers->>'team'), '') end,
    r.title, r.subtitle, r.starts_on, r.venue, r.ticket;
end $$;
revoke all on function public.certificate_info(uuid) from public;
grant execute on function public.certificate_info(uuid) to anon, authenticated;

-- the ticket page knows the programme for volunteer tickets too
create or replace function public.ticket_info(p_ticket uuid)
returns table (name text, form_title text, checked_in boolean, event_title text, event_slug text, event_starts date, venue text)
language sql stable security definer set search_path = public as $$
  select coalesce(r.answers->>'full_name', r.answers->>'name', r.guest_name, p.full_name), f.title, r.checked_in_at is not null,
         e.title, e.slug, e.starts_on, e.venue
  from form_responses r join forms f on f.id = r.form_id
  left join profiles p on p.id = r.user_id
  left join event_pages e on e.form_slug = f.slug or e.volunteer_form_slug = f.slug
  where r.ticket = p_ticket
  limit 1
$$;
grant execute on function public.ticket_info(uuid) to anon, authenticated;

select slug, form_slug, volunteer_form_slug from public.event_pages where slug = 'fcb2027';
