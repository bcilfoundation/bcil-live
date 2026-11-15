-- ---------- Live: co-hosts, and the person who started a session can take host back ----------
alter table public.live_sessions add column if not exists started_by uuid references public.profiles(id) on delete set null;
alter table public.live_sessions add column if not exists cohosts uuid[] not null default '{}';
update public.live_sessions set started_by = host_id where started_by is null;

create or replace function public.live_set_started_by() returns trigger
language plpgsql as $$
begin
  if new.started_by is null then new.started_by := new.host_id; end if;
  return new;
end $$;
drop trigger if exists live_started_by on public.live_sessions;
create trigger live_started_by before insert on public.live_sessions for each row execute function public.live_set_started_by();

-- host or co-host of a session
create or replace function public.is_live_manager(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from live_sessions x where x.id = s and (x.host_id = auth.uid() or auth.uid() = any(x.cohosts)))
$$;
grant execute on function public.is_live_manager(uuid) to authenticated;

drop policy if exists "cohosts manage callers" on public.call_requests;
create policy "cohosts manage callers" on public.call_requests for update to authenticated using (is_live_manager(session_id));
drop policy if exists "cohosts see callers" on public.call_requests;
create policy "cohosts see callers" on public.call_requests for select to authenticated using (is_live_manager(session_id));

-- the host makes someone a co-host, or removes them
create or replace function public.set_cohost(p_session uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from live_sessions where id = p_session and host_id = auth.uid()) then
    raise exception 'Only the host can choose co-hosts'; end if;
  update live_sessions set cohosts = case when p_on then array_append(array_remove(cohosts, p_user), p_user) else array_remove(cohosts, p_user) end
    where id = p_session;
  if p_on then
    insert into notifications (user_id, kind, actor_id, link, body)
      select p_user, 'live', auth.uid(), '/live', '🎙 You are now a co-host in ' || title from live_sessions where id = p_session;
  end if;
end $$;
grant execute on function public.set_cohost(uuid, uuid, boolean) to authenticated;

-- the person who started the session (or an admin/moderator) takes host back; the previous host stays on as a co-host
create or replace function public.reclaim_host(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare prev uuid;
begin
  select host_id into prev from live_sessions where id = p_session and (started_by = auth.uid() or is_staff());
  if not found then raise exception 'Only the person who started this session can take host back'; end if;
  update live_sessions set host_id = auth.uid(),
    cohosts = case when prev is not null and prev <> auth.uid() then array_append(array_remove(array_remove(cohosts, auth.uid()), prev), prev) else array_remove(cohosts, auth.uid()) end
    where id = p_session;
end $$;
grant execute on function public.reclaim_host(uuid) to authenticated;

-- ---------- Plan 2027: private by default; shared only when the member chooses ----------
alter table public.plans add column if not exists shared boolean not null default false;
update public.plans set shared = true where status = 'submitted';

create or replace function public.can_see_plan(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans x where x.id = p and (
    x.user_id = auth.uid()
    or (x.shared and (is_admin() or x.assigned_to = auth.uid()
      or exists (select 1 from mentorships m where m.mentee_id = x.user_id and m.mentor_id = auth.uid() and m.status = 'active')))))
$$;

-- share for mentorship (sends it for feedback) or make it private again
create or replace function public.set_plan_sharing(p_id bigint, p_share boolean) returns void
language plpgsql security definer set search_path = public as $$
declare nm text; was boolean;
begin
  select shared into was from plans where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Not your plan'; end if;
  if p_share then
    update plans set shared = true, status = 'submitted', submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_id;
    if not was then
      select full_name into nm from profiles where id = auth.uid();
      insert into notifications (user_id, kind, actor_id, link, body)
        select distinct u, 'plan', auth.uid(), '/admin?tab=Plan%202027', '📝 ' || coalesce(nm, 'A member') || ' shared their 2027 plan and would like mentorship'
        from (select id as u from profiles where role = 'admin' union select assigned_to from plans where id = p_id) t
        where u is not null and u <> auth.uid();
    end if;
  else
    update plans set shared = false, status = 'draft', updated_at = now() where id = p_id;
  end if;
end $$;
grant execute on function public.set_plan_sharing(bigint, boolean) to authenticated;

-- old submit button path: submitting means sharing
create or replace function public.submit_plan(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin perform set_plan_sharing(p_id, true); end $$;

-- admins no longer see counts of private plans
create or replace function public.plan_draft_count() returns int
language sql stable security definer set search_path = public as $$ select 0 $$;

select 'cohosts_private_plans = ok' as result;
