-- BCIL Live: audio talks (recorded or uploaded) and saved live sessions. Safe to run more than once.
alter table public.talks add column if not exists kind text not null default 'video';
alter table public.talks drop constraint if exists talks_kind_check;
alter table public.talks add constraint talks_kind_check check (kind in ('video','audio'));
alter table public.talks add column if not exists audio_url text;
alter table public.talks add column if not exists description text;
alter table public.talks add column if not exists live_session_id uuid references public.live_sessions(id) on delete set null;
alter table public.talks add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.live_sessions add column if not exists recording boolean not null default false;

-- hosts (admins and moderators) can add talks, not only admins
drop policy if exists "staff add talks" on public.talks;
create policy "staff add talks" on public.talks for insert to authenticated with check (is_staff());
drop policy if exists "staff edit own talks" on public.talks;
create policy "staff edit own talks" on public.talks for update to authenticated using (is_admin() or (is_staff() and created_by = auth.uid()));

-- audio files: anyone can listen, only hosts can upload (max 50 MB each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 52428800, array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/mp3','audio/aac','audio/x-m4a','audio/m4a','audio/wav','audio/x-wav'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "staff upload audio" on storage.objects;
create policy "staff upload audio" on storage.objects for insert to authenticated with check (bucket_id = 'audio' and is_staff());
drop policy if exists "staff manage audio" on storage.objects;
create policy "staff manage audio" on storage.objects for delete to authenticated using (bucket_id = 'audio' and is_staff());

select 'ok' as audio_setup;
