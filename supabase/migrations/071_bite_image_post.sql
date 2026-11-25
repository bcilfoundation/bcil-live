-- 071: the Daily Bite post in Announcements is the branded image (from live.bcilfoundation.org/bites/bite-YYYY-MM-DD.jpg),
-- with the quote as a short caption underneath. The status card carries the same image. Safe to run more than once.
create or replace function public.send_daily_quote() returns int
language plpgsql security definer set search_path = public, private as $$
declare q record; org uuid; ann uuid; n int := 0; img text;
begin
  select * into q from quotes where show_on = (now() at time zone 'Africa/Accra')::date;
  if q is null then return 0; end if;
  insert into private.sent_reminders (key) values ('quote:' || q.show_on) on conflict do nothing;
  if not found then return 0; end if;

  img := 'https://live.bcilfoundation.org/bites/bite-' || to_char(q.show_on, 'YYYY-MM-DD') || '.jpg';
  select id into org from profiles where is_org limit 1;
  select id into ann from rooms where kind = 'announcements' order by created_at limit 1;

  if org is not null then
    insert into statuses (user_id, kind, link, card)
    values (org, 'share', '/quotes',
            jsonb_build_object('type', 'bite', 'title', left('“' || q.body || '”', 300), 'sub', left('— ' || q.author, 200), 'image', img));
  end if;

  if org is not null and ann is not null then
    insert into messages (room_id, user_id, body, attachment_url, attachment_type, attachment_name)
    values (ann, org, '🌅 Daily Bite' || coalesce(' · ' || q.theme, '') || E'\n“' || q.body || '”',
            img, 'image', 'Daily Bite ' || to_char(q.show_on, 'DD Mon YYYY'));
    get diagnostics n = row_count;
    return n;
  end if;

  insert into notifications (user_id, kind, link, body)
    select p.id, 'quote', '/quotes', '“' || q.body || '” — ' || q.author
    from profiles p
    where p.notify_quotes and exists (select 1 from push_subscriptions s where s.user_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;

select 'ok' as bite_image_post_setup;
