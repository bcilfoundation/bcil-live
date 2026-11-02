-- BCIL Live: Advisory Council: Kwabena Nkansah Darfor, Patron of Campus Sync UCC. Safe to run more than once.
insert into public.team_members (name, role, team, photo_url, sort, links, bio)
select 'Mr. Kwabena Nkansah Darfor', 'Patron, Campus Sync UCC', 'Advisory Council', '/team/kwabena-nkansah-darfor.jpg', 20,
  '{"linkedin":"https://www.linkedin.com/in/kwabena-nkansah-darfor-74b49656/"}'::jsonb,
  'Mr. Kwabena Nkansah Darfor is the Patron of Campus Sync UCC. He is a Senior Lecturer in Economics at the University of Cape Coast, where he has taught since 2010. An environmental and natural resource economist, his research covers microfinance and climate change economics.'
where not exists (select 1 from public.team_members where name like '%Kwabena Nkansah Darfor');
select name, role, team from public.team_members order by sort;
