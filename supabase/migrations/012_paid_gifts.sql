-- BCIL Live: paid gifts in live sessions and giving any amount. All money goes to BCIL Foundation.
-- Payments go through Paystack checkout (Mobile Money or card). Safe to run more than once.
alter table public.gifts add column if not exists kind text not null default 'donation';
alter table public.gifts drop constraint if exists gifts_kind_check;
alter table public.gifts add constraint gifts_kind_check check (kind in ('donation','live_gift'));
alter table public.gifts add column if not exists session_id uuid references public.live_sessions(id) on delete set null;
alter table public.gifts add column if not exists gift_code text;          -- rose, star, gift, trophy, crown
alter table public.gifts add column if not exists gift_label text;         -- e.g. "👑 Crown"
alter table public.gifts add column if not exists under_18 boolean not null default false;
alter table public.gifts add column if not exists guardian_ok boolean not null default false;
alter table public.gifts add column if not exists anonymous boolean not null default false;
create index if not exists gifts_user_day on public.gifts (user_id, created_at desc);

-- When a live gift is paid, show it in the room (comment + animation for everyone). Amounts are never shown.
create or replace function public.announce_live_gift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'live_gift' and new.session_id is not null and new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into live_chat (session_id, user_id, body, kind)
    values (new.session_id, new.user_id, 'sent ' || coalesce(new.gift_label, '🎁 a gift') || ' 💛 supporting BCIL', 'gift');
  end if;
  return new;
end $$;
drop trigger if exists gifts_announce on public.gifts;
create trigger gifts_announce after insert or update of status on public.gifts for each row execute function public.announce_live_gift();

select 'ok' as paid_gifts_setup;
