-- BCIL Live: directors' photos, short bios, LinkedIn only (uniform). Safe to run more than once.
update public.team_members set photo_url = '/team/samuel-osae-bledu.jpg', links = '{"linkedin":"https://www.linkedin.com/in/samuel-osae-bledu-853551177/"}',
  bio = 'Samuel Osae Bledu is Vice-Chairperson of BCIL Foundation. He is a dependable, results-driven collaborator with a passion for leadership and a keen interest in economics, finance and project appraisal. He has served as a teaching assistant at the School of Economics, University of Cape Coast, and brings years of volunteer and leadership experience, including as a club president and conference coordinator.'
where name = 'Samuel Osae Bledu';

update public.team_members set photo_url = '/team/desmond-agbesi.jpg', links = '{"linkedin":"https://www.linkedin.com/in/dykagbesi/"}',
  bio = 'Desmond Agbesi is a Director of BCIL Foundation. He is an environmental economist focused on sustainable development in the blue economy, and is pursuing an MPhil in Blue Economy, Governance and Social Resilience at the University of Cape Coast. His research looks at resource management and sustainable practices that support economic stability.'
where name = 'Desmond Agbesi';

update public.team_members set photo_url = '/team/mame-aba-bentsiwa-essilfie.jpg', links = '{"linkedin":"https://www.linkedin.com/in/mame-aba-bentiwa-essilfie-b78253200/"}',
  bio = 'Mame Aba Bentsiwa Essilfie is a Director of BCIL Foundation. She is a women''s advocate and development practitioner studying for an MPhil in Social Studies, and serves as Women''s Commissioner of the 33rd GRASAG UCC. She brings experience in teaching, research and financial management, and is also a photographer and graphic designer.'
where name = 'Mame Aba Bentsiwa Essilfie';

update public.team_members set photo_url = '/team/ebenezer-nyan.jpg', links = '{"linkedin":"https://www.linkedin.com/in/ebenezer-nyan/"}', role = 'Board Secretary',
  bio = 'Ebenezer Nyan is Board Secretary of BCIL Foundation, where he has served as Secretary since 2023, supporting its youth empowerment work. An economics graduate and emerging development economist, he works in research and data analytics; his research has looked at how energy poverty affects students'' academic performance. He is passionate about evidence-based policy that tackles socio-economic challenges in Africa.'
where name = 'Ebenezer Nyan';

update public.team_members set links = '{"linkedin":"https://www.linkedin.com/in/bcil/"}' where name = 'Solomon Agbesi';

select name, role, photo_url is not null as has_photo, links->>'linkedin' is not null as has_linkedin from public.team_members order by sort;
