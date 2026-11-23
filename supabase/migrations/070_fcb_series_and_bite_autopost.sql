-- 070: (1) the Finding Campus Balance series as the Daily Bites for 30 Nov – 6 Dec 2026
--      (2) every morning at 6:00 (Ghana time) the Daily Bite goes on the BCIL Foundation status
--          and is posted in Announcements; that post is each member's one notification for the day.
-- Safe to run more than once.

-- 1. the series (no dates or 2027 details until the flyer is out)
insert into public.quotes (show_on, body, author, theme)
values
 (date '2026-11-30', 'Do you know what Finding Campus Balance is about? FCB is BCIL Foundation''s yearly program for university students. It helps them handle every part of campus life and make informed decisions about their studies, their growth and their future.', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-01', 'During the program, participants get to learn about strategies to balance all aspects of their student life and get the best out of each and every aspect without compromising on the others.', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-02', 'The program is grounded on Proverbs 11:1, "A false balance is abomination to the LORD: but a just weight is his delight." And 3 John 1:2, "My loved one, it is my prayer that you may do well in all things, and be healthy in body, even as your soul does well."', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-03', 'Students also have the opportunity to be mentored after the program to streamline their journeys on campus. About 70 students have been mentored so far. This is in line with BCIL Foundation''s mission of seeing successors do better than their predecessors.', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-04', 'Over five editions, FCB has helped students with academic growth, managing money, leadership, networking, relationships and personal values.', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-05', 'FCB is for every student, whatever your level: those settling into their first year, finalists getting ready for what comes next, and everyone in between, in person and online.', 'BCIL Foundation', 'Finding Campus Balance'),
 (date '2026-12-06', 'Finding Campus Balance is back. Bigger, better, balanced. This time we are making room for 1,000 students. Will you be one of them? The official flyer drops tomorrow. Stay tuned and tell a friend to tell a friend.', 'BCIL Foundation', 'Finding Campus Balance')
on conflict (show_on) do update set body = excluded.body, author = excluded.author, theme = excluded.theme;

-- 2. the 6:00 am routine
create or replace function public.send_daily_quote() returns int
language plpgsql security definer set search_path = public, private as $$
declare q record; org uuid; ann uuid; n int := 0;
begin
  select * into q from quotes where show_on = (now() at time zone 'Africa/Accra')::date;
  if q is null then return 0; end if;
  insert into private.sent_reminders (key) values ('quote:' || q.show_on) on conflict do nothing;
  if not found then return 0; end if;

  select id into org from profiles where is_org limit 1;
  select id into ann from rooms where kind = 'announcements' order by created_at limit 1;

  if org is not null then
    -- a status from BCIL Foundation that members can open and add to their own status
    insert into statuses (user_id, kind, link, card)
    values (org, 'share', '/quotes',
            jsonb_build_object('type', 'bite', 'title', left('“' || q.body || '”', 300), 'sub', left('— ' || q.author, 200), 'image', null));
  end if;

  if org is not null and ann is not null then
    -- the Announcements post also notifies every member (see notify_dm)
    insert into messages (room_id, user_id, body)
    values (ann, org, '🌅 Today''s Daily Bite' || coalesce(' · ' || q.theme, '') || E'\n\n“' || q.body || '”' || E'\n— ' || q.author
      || E'\n\nShare it with a friend: open the BCIL Foundation status and tap “＋ Add to my status”, or open Daily Bite: live.bcilfoundation.org/quotes');
    get diagnostics n = row_count;
    return n;
  end if;

  -- fallback if the account or the room is missing: the old phone notification
  insert into notifications (user_id, kind, link, body)
    select p.id, 'quote', '/quotes', '“' || q.body || '” — ' || q.author
    from profiles p
    where p.notify_quotes and exists (select 1 from push_subscriptions s where s.user_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_daily_quote() from public, anon, authenticated;

-- schedule stays at 6:00 Ghana time
select cron.unschedule(jobid) from cron.job where jobname = 'bcil-daily-quote';
select cron.schedule('bcil-daily-quote', '0 6 * * *', 'select public.send_daily_quote()');

select show_on, theme, left(body, 50) as bite from public.quotes where show_on between date '2026-11-28' and date '2026-12-06' order by show_on;
