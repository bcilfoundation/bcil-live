-- International Men's Day, 19 Nov 2026: a message from BCIL Foundation to everyone,
-- a rolling card on Home, and the card taken down at 8:00 tomorrow morning (Ghana time).
do $$
declare
  org uuid; p record; r uuid; sent int := 0;
  msg text := 'Happy International Men''s Day from BCIL Foundation! 💙

Today we celebrate the men in our community: the fathers, brothers, sons, mentors, students and friends who lead with character, show up for others and keep growing.

To every man on BCIL: thank you for the example you set. And to everyone, take a moment today to appreciate a man who has made a difference in your life.

Keep grooming generational leaders.
— BCIL Foundation';
begin
  select id into org from profiles where is_org limit 1;
  if org is null then raise exception 'BCIL Foundation account not found'; end if;

  for p in select id from profiles where id <> org loop
    r := null;
    select m1.room_id into r from room_members m1
      join room_members m2 on m2.room_id = m1.room_id
      join rooms x on x.id = m1.room_id
      where x.kind = 'dm' and m1.user_id = org and m2.user_id = p.id limit 1;
    if r is null then
      insert into rooms (name, kind) values ('Direct message', 'dm') returning id into r;
      insert into room_members (room_id, user_id) values (r, org), (r, p.id);
    end if;
    begin
      insert into messages (room_id, user_id, body) values (r, org, msg);   -- also sends the phone notification
      sent := sent + 1;
    exception when others then null;   -- e.g. someone who blocked the account
    end;
  end loop;
  raise notice 'Messages sent: %', sent;
end $$;

insert into public.home_posts (title, body, ends_on, published, sort)
values ('Happy International Men''s Day',
        'Today we celebrate the men of BCIL: the fathers, brothers, mentors and students who lead with character and lift others up. Thank you.',
        date '2026-11-20', true, 1);

select cron.schedule('bcil-mens-day-off', '0 8 20 11 *',
  $$update public.home_posts set published = false where title = 'Happy International Men''s Day' and ends_on = date '2026-11-20';
    select cron.unschedule('bcil-mens-day-off');$$);

select 'ok' as mens_day_sent, (select count(*) from profiles) - 1 as people;
