-- BCIL Live: Executives on About us: Benny Morgan Aboagye (Organizer) and Kaleb Akortia. Safe to run more than once.
insert into public.team_members (name, role, team, photo_url, sort, links, bio)
select 'Benny Morgan Aboagye', 'Organizer', 'Executives', '/team/benny-morgan-aboagye.jpg', 10,
  '{"linkedin":"https://www.linkedin.com/in/benny-morgan-junior-0b2905234/"}'::jsonb,
  'Benny Morgan Aboagye is the Organizer of BCIL Foundation, coordinating the planning and running of its programmes and events. He is a research and teaching assistant at the University of Cape Coast, working across economics and health science, and a tutor.'
where not exists (select 1 from public.team_members where name = 'Benny Morgan Aboagye');

insert into public.team_members (name, role, team, sort)
select 'Kaleb Akortia', 'Executive', 'Executives', 11
where not exists (select 1 from public.team_members where name = 'Kaleb Akortia');

select name, role, team from public.team_members order by sort;
