-- 050: every video session is a meeting (everyone can unmute and talk; the host can mute anyone).
-- Audio sessions keep call-in.
update public.live_sessions set open_mic = true where kind = 'video' and status <> 'ended';

create or replace function public.dm_calls_open_mic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'video' or (new.room_id is not null and exists (select 1 from rooms where id = new.room_id and kind = 'dm')) then new.open_mic := true; end if;
  return new;
end $$;
drop trigger if exists live_sessions_dm_open_mic on public.live_sessions;
create trigger live_sessions_dm_open_mic before insert or update of kind, status on public.live_sessions for each row execute function public.dm_calls_open_mic();

create or replace function public.meeting_mic(p_session uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  select * into s from live_sessions where id = p_session;
  if s.id is null or s.status <> 'live' or not (s.open_mic or s.kind = 'video') or auth.uid() is null then return false; end if;
  if s.host_id = auth.uid() then return true; end if;
  if not can_see_live(p_session) then return false; end if;
  -- someone the host muted stays muted; otherwise they get the microphone
  update call_requests set status = 'on_air' where session_id = p_session and user_id = auth.uid() and status in ('waiting', 'on_air');
  if not found then
    insert into call_requests (session_id, user_id, status) values (p_session, auth.uid(), 'on_air') on conflict do nothing;
  end if;
  return true;
end $$;
grant execute on function public.meeting_mic(uuid) to authenticated;

select 'ok' as video_meeting_setup;
