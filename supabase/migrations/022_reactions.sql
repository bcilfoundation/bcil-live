-- BCIL Live: emoji reactions on chat messages (👍 ❤️ 🙏 😂 🔥). Safe to run more than once.
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_room on public.message_reactions (room_id);
alter table public.message_reactions enable row level security;
drop policy if exists "see reactions in your rooms" on public.message_reactions;
create policy "see reactions in your rooms" on public.message_reactions for select to authenticated using (is_member(room_id) or is_staff());
drop policy if exists "react in your rooms" on public.message_reactions;
create policy "react in your rooms" on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and (is_member(room_id) or is_staff())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id and m.room_id = message_reactions.room_id));
drop policy if exists "remove own reactions" on public.message_reactions;
create policy "remove own reactions" on public.message_reactions for delete to authenticated using (user_id = auth.uid());
do $$ begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
end $$;
alter table public.message_reactions replica identity full;   -- so removing a reaction reaches everyone live
select 'ok' as reactions_setup;
