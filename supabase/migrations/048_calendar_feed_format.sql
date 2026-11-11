-- 048: the calendar feed answers as a calendar file whatever the calendar app asks for (Google sends "Accept: */*")
do $$ begin
  if not exists (select 1 from pg_type where typname = '*/*') then create domain "*/*" as bytea; end if;
end $$;
drop function if exists public.meetings_ics(text);
-- the feed itself: confirmed meetings for the token's owner (all of them for the admin)
create or replace function public.meetings_ics(token text) returns "*/*"
language plpgsql volatile security definer set search_path = public as $$
declare u uuid; adm boolean; cal text; m record;
begin
  perform set_config('response.headers', '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Content-Disposition": "inline; filename=meet-solomon.ics"}]', true);
  select c.user_id into u from calendar_tokens c where c.token = meetings_ics.token;
  if u is null then return convert_to('BEGIN:VCALENDAR' || chr(13) || chr(10) || 'VERSION:2.0' || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10), 'UTF8'); end if;
  select role = 'admin' into adm from profiles where id = u;
  cal := concat_ws(chr(13) || chr(10), 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BCIL Foundation//Meet Solomon//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Meet Solomon (BCIL)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H');
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
  return convert_to(cal || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10), 'UTF8');
end $$;
grant execute on function public.meetings_ics(text) to anon, authenticated;
notify pgrst, 'reload schema';
select 'ok' as calendar_feed_fix;
