-- BCIL Live: daily quote on people's phones every morning, and a reminder 30 minutes before each programme session.
-- Safe to run more than once.
alter table public.profiles add column if not exists notify_quotes boolean not null default true;

create table if not exists private.sent_reminders (key text primary key, sent_at timestamptz not null default now());

-- today's quote, sent once a day to everyone who has phone notifications on (and hasn't switched quotes off)
create or replace function public.send_daily_quote() returns int
language plpgsql security definer set search_path = public, private as $$
declare q record; n int := 0;
begin
  select * into q from quotes where show_on = (now() at time zone 'Africa/Accra')::date;
  if q is null then return 0; end if;
  insert into private.sent_reminders (key) values ('quote:' || q.show_on) on conflict do nothing;
  if not found then return 0; end if;
  insert into notifications (user_id, kind, link, body)
    select p.id, 'quote', '/quotes', '“' || q.body || '” — ' || q.author
    from profiles p
    where p.notify_quotes and exists (select 1 from push_subscriptions s where s.user_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_daily_quote() from public, anon, authenticated;

-- programme sessions starting in about 30 minutes (FCB, volunteer training, ...)
create or replace function public.send_programme_reminders() returns int
language plpgsql security definer set search_path = public, private as $$
declare e record; d timestamptz; total int := 0; n int;
begin
  for e in select slug, title, online_url, dates from event_pages where listed and jsonb_array_length(dates) > 0 loop
    for d in select (x #>> '{}')::timestamptz from jsonb_array_elements(e.dates) x loop
      if d > now() + interval '20 minutes' and d <= now() + interval '35 minutes' then
        insert into private.sent_reminders (key) values ('prog:' || e.slug || ':' || d) on conflict do nothing;
        if found then
          insert into notifications (user_id, kind, link, body)
            select p.id, 'programme', '/events/' || e.slug,
              e.title || ' starts in 30 minutes' || case when e.online_url is not null then ' · tap to join' else '' end
            from profiles p where exists (select 1 from push_subscriptions s where s.user_id = p.id);
          get diagnostics n = row_count; total := total + n;
        end if;
      end if;
    end loop;
  end loop;
  return total;
end $$;
revoke all on function public.send_programme_reminders() from public, anon, authenticated;

-- schedule: quote at 6:00 am Ghana time (= 06:00 UTC), reminders checked every 5 minutes
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('bcil-daily-quote', 'bcil-programme-reminders');
select cron.schedule('bcil-daily-quote', '0 6 * * *', 'select public.send_daily_quote()');
select cron.schedule('bcil-programme-reminders', '*/5 * * * *', 'select public.send_programme_reminders()');

select 'ok' as daily_quote_push;
