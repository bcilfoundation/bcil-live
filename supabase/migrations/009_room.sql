-- BCIL Live: questions and gifts in live comments, pinned comment, host-chosen room background. Safe to run more than once.
alter table public.live_chat add column if not exists kind text not null default 'chat';
alter table public.live_chat drop constraint if exists live_chat_kind_check;
alter table public.live_chat add constraint live_chat_kind_check check (kind in ('chat','question','gift'));
alter table public.live_sessions add column if not exists background text;
alter table public.live_sessions add column if not exists pinned_chat_id bigint;
select 'ok' as room_setup;
