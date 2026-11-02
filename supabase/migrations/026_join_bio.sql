-- BCIL Live: Solomon's photo and short bio; a "Join us" (Campus Sync membership) form. Safe to run more than once.
update public.team_members set
  name = 'Solomon Agbesi',
  photo_url = '/team/solomon-agbesi.jpg',
  bio = 'Solomon Agbesi is a Ghanaian scholar, writer and purpose-driven leader with a deep commitment to education, service and human development. He founded BCIL Foundation, where he mentors young people and leads work on leadership development, education and character formation. His research looks at energy and environmental policy, and how communities turn potential into lasting impact. He is the author of PENCILS of Success, and believes each generation should rise higher than the one before it.'
where name in ('Solomon Agbesi', 'Solomon Hope Agbesi');

insert into public.forms (slug, title, subtitle, description, fields)
select 'join-campus-sync', 'Join BCIL Foundation', 'Become a member through Campus Sync on your campus',
  'Campus Sync is BCIL Foundation on your campus: mentorship, leadership, programmes and a community of students growing together. Fill this in and your Campus Sync executives will get in touch.',
  $j$[
    {"key":"full_name","label":"Full name","type":"text","required":true},
    {"key":"phone","label":"Phone / WhatsApp number","type":"tel","required":true},
    {"key":"email","label":"Email","type":"email","required":true},
    {"key":"institution","label":"Your school / campus","type":"select","required":true,"options":["University of Cape Coast (UCC)","University of Ghana (UG)","KNUST","University of Education, Winneba (UEW)","UPSA","Ho Technical University (HTU)","UHAS","Other"]},
    {"key":"institution_other","label":"If Other, which school?","type":"text"},
    {"key":"programme","label":"Programme of study","type":"text","required":true},
    {"key":"level","label":"Current level","type":"radio","required":true,"options":["Level 100","Level 200","Level 300","Level 400","Postgraduate","Not in school"]},
    {"key":"interests","label":"How would you like to be involved?","type":"checkbox","required":true,"help":"Select all that apply.","options":["Mentorship","Leadership roles","Volunteering at programmes","Media and publicity","Outreach and community impact","Just attend programmes"]},
    {"key":"why","label":"Why do you want to join BCIL Foundation?","type":"textarea","required":true},
    {"key":"consent","label":"I agree that BCIL Foundation and my Campus Sync executives may contact me about membership and activities.","type":"radio","required":true,"options":["Yes, I agree"]}
  ]$j$::jsonb
where not exists (select 1 from public.forms where slug = 'join-campus-sync');

select (select count(*) from public.forms where slug = 'join-campus-sync') as join_form_ready, (select left(bio, 40) from public.team_members where name = 'Solomon Agbesi') as bio_start;
