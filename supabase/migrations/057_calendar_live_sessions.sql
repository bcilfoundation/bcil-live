-- 057: live sessions in the Google Calendar feed (sessions you host or are invited to). Safe to run more than once.
-- the feed: confirmed meetings, plus scheduled live sessions you host or are invited to (the admin sees all of them)
create or replace function public.meetings_ics(token text) returns "*/*"
language plpgsql volatile security definer set search_path = public as $$
declare u uuid; adm boolean; cal text; m record; l record;
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
  for l in
    select s.* from live_sessions s
    where s.status in ('scheduled', 'live') and s.starts_at > now() - interval '1 day' and s.room_id is null
      and (s.host_id = u or exists (select 1 from live_invites i where i.session_id = s.id and i.user_id = u) or adm)
    order by s.starts_at
  loop
    cal := cal || chr(13) || chr(10) || concat_ws(chr(13) || chr(10),
      'BEGIN:VEVENT',
      'UID:live-' || l.id || '@bcilfoundation.org',
      'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTSTART:' || to_char(l.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTEND:' || to_char((l.starts_at + interval '1 hour') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'SUMMARY:' || regexp_replace(left('Live: ' || l.title, 140), '([,;\\])', '\\\1', 'g'),
      'DESCRIPTION:' || case when l.is_private then 'Invited only. ' else '' end || 'Join in the BCIL Foundation app: https://live.bcilfoundation.org/live'
        || case when l.is_private and l.invite_code is not null then '?join=' || l.invite_code else '' end,
      'URL:https://live.bcilfoundation.org/live',
      'STATUS:CONFIRMED',
      'END:VEVENT');
  end loop;
  return convert_to(cal || chr(13) || chr(10) || 'END:VCALENDAR' || chr(13) || chr(10), 'UTF8');
end $$;
grant execute on function public.meetings_ics(text) to anon, authenticated;
notify pgrst, 'reload schema';
select 'ok' as calendar_feed_live;
