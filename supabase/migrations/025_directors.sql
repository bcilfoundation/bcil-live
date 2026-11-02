-- BCIL Live: directors' profile links, bios, Ebenezer Nyan as Board Secretary, constitution name for Mame Aba. Safe to run more than once.
alter table public.team_members add column if not exists links jsonb not null default '{}';

update public.team_members set name = 'Mame Aba Bentsiwa Essilfie' where name in ('Maame Aba Bentsil', 'Mame Aba Bentsil');

insert into public.team_members (name, role, team, photo_url, sort)
select * from (values
  ('Solomon Agbesi', 'Founder and Chairperson', 'Board of Directors', 'https://bcilfoundation.org/wp-content/uploads/2026/02/solomonA-423x573-1.png', 1),
  ('Samuel Osae Bledu', 'Vice-Chairperson', 'Board of Directors', null, 2),
  ('Desmond Agbesi', 'Director', 'Board of Directors', null, 3),
  ('Mame Aba Bentsiwa Essilfie', 'Director', 'Board of Directors', null, 4),
  ('Ebenezer Nyan', 'Board Secretary', 'Board of Directors', null, 5)
) v(name, role, team, photo_url, sort)
where not exists (select 1 from public.team_members t where t.name = v.name);

update public.team_members set
  bio = 'Solomon Hope Agbesi founded BCIL Foundation in 2017 and chairs its Board of Directors. He is a PhD student in Resource Economics at the University of Massachusetts Amherst, where his research covers energy, environmental and health economics. He holds an M.S. in Resource Economics and Policy from the University of Maine, and an M.Phil. and B.A. in Economics from the University of Cape Coast, where he led the Association of Economics Students and received the S.K. Armah Award for Best Graduating Econometrics Student. He is the author of PENCILS of Success.',
  links = '{"linkedin":"https://www.linkedin.com/in/bcil/","website":"https://sites.google.com/view/solomon-agbesi/about","scholar":"https://scholar.google.com/citations?user=YDtZhvcAAAAJ"}'
where name = 'Solomon Agbesi';
update public.team_members set links = '{"linkedin":"https://www.linkedin.com/in/dykagbesi/"}' where name = 'Desmond Agbesi';
update public.team_members set links = '{"linkedin":"https://www.linkedin.com/in/samuel-osae-bledu-853551177/"}' where name = 'Samuel Osae Bledu';
update public.team_members set links = '{"linkedin":"https://www.linkedin.com/in/mame-aba-bentiwa-essilfie-b78253200/"}' where name = 'Mame Aba Bentsiwa Essilfie';
update public.team_members set links = '{"linkedin":"https://www.linkedin.com/in/ebenezer-nyan/"}', role = 'Board Secretary' where name = 'Ebenezer Nyan';

alter table public.quotes alter column theme drop not null;
alter table public.quotes drop constraint if exists quotes_theme_check;

select name, role from public.team_members order by sort;
