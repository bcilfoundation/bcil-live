-- ---------- Statuses: likes and emoji reactions ----------
create table if not exists public.status_reactions (
  status_id bigint not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);
alter table public.status_reactions enable row level security;
drop policy if exists "react to a status" on public.status_reactions;
create policy "react to a status" on public.status_reactions for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from statuses s where s.id = status_id and s.user_id <> auth.uid()
    and s.removed_at is null and s.expires_at > now() and can_connect(auth.uid(), s.user_id) and not is_blocked(auth.uid(), s.user_id)));
drop policy if exists "change my reaction" on public.status_reactions;
create policy "change my reaction" on public.status_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove my reaction" on public.status_reactions;
create policy "remove my reaction" on public.status_reactions for delete to authenticated using (user_id = auth.uid());
drop policy if exists "see reactions" on public.status_reactions;
create policy "see reactions" on public.status_reactions for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from statuses s where s.id = status_id and s.user_id = auth.uid()));

-- tell the owner (one note per person per status)
create or replace function public.notify_status_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; nm text;
begin
  select user_id into owner from statuses where id = new.status_id;
  select full_name into nm from profiles where id = new.user_id;
  if owner is not null and owner <> new.user_id and tg_op = 'INSERT' then
    insert into notifications (user_id, kind, actor_id, link, body)
    values (owner, 'status', new.user_id, '/', coalesce(nm, 'Someone') || ' reacted ' || new.emoji || ' to your status');
  end if;
  return new;
end $$;
drop trigger if exists notify_status_reaction on public.status_reactions;
create trigger notify_status_reaction after insert on public.status_reactions for each row execute function public.notify_status_reaction();

select 'status_reactions = ok' as result;
