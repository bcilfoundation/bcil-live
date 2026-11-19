-- Gender as part of the profile. Kept in its own private table: each member sees only their own,
-- staff can use it to send messages to a group (e.g. International Men's Day / Women's Day). Never shown on profiles.
create table if not exists public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gender text check (gender in ('male', 'female', 'prefer_not')),
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
drop policy if exists "own private profile read" on public.profile_private;
create policy "own private profile read" on public.profile_private for select to authenticated using (user_id = auth.uid() or is_staff());
drop policy if exists "own private profile insert" on public.profile_private;
create policy "own private profile insert" on public.profile_private for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own private profile update" on public.profile_private;
create policy "own private profile update" on public.profile_private for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- how many members have answered, for Admin
create or replace function public.gender_counts() returns table (gender text, members int)
language sql stable security definer set search_path = public as $$
  select coalesce(pp.gender, 'not_answered'), count(*)::int
  from profiles p left join profile_private pp on pp.user_id = p.id
  where is_staff() and not coalesce(p.is_org, false)
  group by 1 order by 1
$$;
grant execute on function public.gender_counts() to authenticated;

select 'ok' as gender_setup;
