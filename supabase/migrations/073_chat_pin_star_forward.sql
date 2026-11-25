-- 073: WhatsApp-style message actions in chats: pin a message at the top of a chat, star messages for yourself,
-- and mark forwarded messages. Safe to run more than once.

-- pinned message: one per chat. In a group, admins (leaders) and BCIL Foundation staff pin; in a direct message, either person.
alter table public.rooms add column if not exists pinned_message_id bigint references public.messages(id) on delete set null;
alter table public.rooms add column if not exists pinned_at timestamptz;

create or replace function public.pin_message(p_id bigint, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare m messages; r rooms;
begin
  select * into m from messages where id = p_id;
  if m.id is null then raise exception 'Message not found'; end if;
  select * into r from rooms where id = m.room_id;
  if not (is_staff() or is_leader(r.id) or (r.kind = 'dm' and is_member(r.id))) then
    raise exception 'Only group admins can pin messages';
  end if;
  if p_on then update rooms set pinned_message_id = p_id, pinned_at = now() where id = r.id;
  else update rooms set pinned_message_id = null, pinned_at = null where id = r.id and pinned_message_id = p_id; end if;
end $$;
grant execute on function public.pin_message(bigint, boolean) to authenticated;

create or replace function public.room_pin(p_room uuid) returns table (message_id bigint, pinned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pinned_message_id, pinned_at from rooms where id = p_room and (is_member(p_room) or is_staff());
$$;
grant execute on function public.room_pin(uuid) to authenticated;

-- starred messages: private to each person
create table if not exists public.message_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  room_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.message_stars enable row level security;
drop policy if exists "own stars" on public.message_stars;
create policy "own stars" on public.message_stars for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(room_id));

-- forwarded messages show a small "Forwarded" label
alter table public.messages add column if not exists forwarded boolean not null default false;

select 'ok' as chat_pin_star_forward_setup;
