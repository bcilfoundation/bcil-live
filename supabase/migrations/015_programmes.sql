-- BCIL Live: upcoming programmes on Home (FCB, volunteer training, ...) with dates, online link and flyer. Safe to run more than once.
alter table public.event_pages add column if not exists summary text;           -- one line for the Home card
alter table public.event_pages add column if not exists dates jsonb not null default '[]';  -- ["2026-11-01T19:00:00Z", ...] one or more sessions
alter table public.event_pages add column if not exists online_url text;        -- e.g. a Google Meet link
alter table public.event_pages add column if not exists listed boolean not null default true;
alter table public.event_pages add column if not exists created_at timestamptz not null default now();

update public.event_pages set summary = coalesce(summary, 'Digital safety, academic wellbeing, campus life panel and CV clinic'),
  starts_on = coalesce(starts_on, '2027-01-23')
where slug = 'fcb2027';

insert into public.event_pages (slug, title, subtitle, starts_on, venue, about, hero_url, summary, dates, schedule, speakers)
values ('fcb27-volunteer-training', 'FCB 2027 Volunteers Training', 'Attendance is mandatory for all volunteers', '2026-11-01',
  'Online · Google Meet',
  'Training for everyone volunteering at Finding Campus Balance 2027. Three sessions, 7:00 pm each Sunday. Attendance is mandatory for all volunteers.',
  '/events/volunteer-training.jpg', 'Three Sundays, 7:00 pm · attendance is mandatory for volunteers',
  '["2026-11-01T19:00:00Z","2026-11-08T19:00:00Z","2026-11-15T19:00:00Z"]'::jsonb, '[]'::jsonb, '[]'::jsonb)
on conflict (slug) do nothing;

select 'ok' as programmes_setup;
