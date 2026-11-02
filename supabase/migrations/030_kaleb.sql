-- BCIL Live: Kaleb Akortia, Media Head. Safe to run more than once.
insert into public.team_members (name, role, team, sort)
select 'Kaleb Akortia', 'Media Head', 'Executives', 11
where not exists (select 1 from public.team_members where name = 'Kaleb Akortia');
update public.team_members set role = 'Media Head', team = 'Executives', photo_url = '/team/kaleb-akortia-2.jpg',
  links = '{"facebook":"https://www.facebook.com/kalebelisha.akortia.3"}',
  bio = 'Kaleb Akortia is the Media Head of BCIL Foundation. He leads media coverage and publicity, oversees content creation, and manages the Foundation''s social media and online presence.'
where name = 'Kaleb Akortia';
select name, role, team from public.team_members order by sort;
