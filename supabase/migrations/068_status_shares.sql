-- Statuses can be a shared card from the app: a Daily Bite, a Library video or an event.
-- The card (type, title, line under it, picture) is stored with the status; "link" opens it in the app.
alter table public.statuses add column if not exists link text;
alter table public.statuses add column if not exists card jsonb;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.statuses'::regclass and contype = 'c' loop
    execute format('alter table public.statuses drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.statuses add constraint statuses_kind_check check (kind in ('photo', 'text', 'share'));
alter table public.statuses add constraint statuses_body_len check (body is null or char_length(body) <= 700);
alter table public.statuses add constraint statuses_content_check check (
  (kind = 'photo' and media_url is not null)
  or (kind = 'text' and coalesce(body, '') <> '')
  or (kind = 'share' and card is not null and link is not null and link like '/%'));

select 'ok' as status_shares_setup;
