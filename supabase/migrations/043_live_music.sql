-- 043: a saved background-music library for live sessions (upload once, play any time)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-music', 'live-music', false, 31457280,
  array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.live_music (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  path text not null unique,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.live_music enable row level security;
drop policy if exists "hosts see music" on public.live_music;
create policy "hosts see music" on public.live_music for select to authenticated using (true);
drop policy if exists "staff add music" on public.live_music;
create policy "staff add music" on public.live_music for insert to authenticated with check (is_staff());
drop policy if exists "staff rename music" on public.live_music;
create policy "staff rename music" on public.live_music for update to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "staff remove music" on public.live_music;
create policy "staff remove music" on public.live_music for delete to authenticated using (is_staff());

drop policy if exists "hosts play music files" on storage.objects;
create policy "hosts play music files" on storage.objects for select to authenticated using (bucket_id = 'live-music');
drop policy if exists "staff upload music files" on storage.objects;
create policy "staff upload music files" on storage.objects for insert to authenticated with check (bucket_id = 'live-music' and public.is_staff());
drop policy if exists "staff remove music files" on storage.objects;
create policy "staff remove music files" on storage.objects for delete to authenticated using (bucket_id = 'live-music' and public.is_staff());

select 'ok' as live_music_setup;
