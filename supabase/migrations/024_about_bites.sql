-- BCIL Live: directors on About us (from bcilfoundation.org / the constitution), and Daily Bites without categories. Safe to run more than once.
insert into public.team_members (name, role, team, photo_url, sort)
select * from (values
  ('Solomon Agbesi', 'Founder and Chairperson', 'Board of Directors', 'https://bcilfoundation.org/wp-content/uploads/2026/02/solomonA-423x573-1.png', 1),
  ('Samuel Osae Bledu', 'Vice-Chairperson', 'Board of Directors', null, 2),
  ('Desmond Agbesi', 'Director', 'Board of Directors', null, 3),
  ('Maame Aba Bentsil', 'Director', 'Board of Directors', null, 4)
) v(name, role, team, photo_url, sort)
where not exists (select 1 from public.team_members t where t.name = v.name);

alter table public.quotes alter column theme drop not null;
alter table public.quotes drop constraint if exists quotes_theme_check;
select 'ok' as about_bites_setup;
