-- Home announcements can carry a short vertical video that plays full screen
alter table public.home_posts add column if not exists video_url text;

insert into public.home_posts (title, body, image_url, video_url, link_url, link_label, ends_on, published, sort)
select 'Sometimes, It Just Gets to You',
       'A spoken-word reflection by our founder, Solomon Agbesi, inspired by Matthew 21:28–32.',
       '/shorts/sometimes-it-just-gets-to-you.jpg', '/shorts/sometimes-it-just-gets-to-you.mp4',
       '/library?talk=' || t.id, 'Full video', date '2026-11-27', true, 2
from public.talks t where t.youtube_id = '_tqHz_KKPdY'
  and not exists (select 1 from public.home_posts h where h.video_url = '/shorts/sometimes-it-just-gets-to-you.mp4')
limit 1;

select id, title, link_url, ends_on from public.home_posts where video_url is not null;
