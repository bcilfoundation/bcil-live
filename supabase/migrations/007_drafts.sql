-- BCIL Live: talks can be drafts (only hosts see them) until published; simple trim points. Safe to run more than once.
alter table public.talks add column if not exists status text not null default 'published';
alter table public.talks drop constraint if exists talks_status_check;
alter table public.talks add constraint talks_status_check check (status in ('draft','published'));
alter table public.talks add column if not exists trim_start integer;   -- seconds to skip at the start
alter table public.talks add column if not exists trim_end integer;     -- stop playing at this second

drop policy if exists "anyone sees talks" on public.talks;
create policy "anyone sees published talks" on public.talks for select using (status = 'published' or is_staff());
drop policy if exists "staff edit own talks" on public.talks;
drop policy if exists "staff edit talks" on public.talks;
create policy "staff edit talks" on public.talks for update to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "staff delete talks" on public.talks;
create policy "staff delete talks" on public.talks for delete to authenticated using (is_staff());
select 'ok' as drafts_setup;

-- live sessions can be audio (podcast style) or video (Zoom style)
alter table public.live_sessions add column if not exists kind text not null default 'audio';
alter table public.live_sessions drop constraint if exists live_sessions_kind_check;
alter table public.live_sessions add constraint live_sessions_kind_check check (kind in ('audio','video'));
