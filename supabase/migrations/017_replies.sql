-- BCIL Live: reply to a specific message (chat and live room), like WhatsApp. Safe to run more than once.
alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;
alter table public.live_chat add column if not exists reply_to bigint references public.live_chat(id) on delete set null;
select 'ok' as replies_setup;
