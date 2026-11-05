-- 037: file uploads in forms + the Student Support Initiative application (laptops), with committee scoring.
-- The form starts CLOSED: open it in Admin → Forms when the application window starts. Safe to run more than once.

-- private storage for documents people upload in forms (transcripts, letters). Anyone filling a form can upload;
-- only BCIL staff can open the files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-files', 'form-files', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "anyone uploads form files" on storage.objects;
create policy "anyone uploads form files" on storage.objects for insert to anon, authenticated with check (bucket_id = 'form-files');
drop policy if exists "staff read form files" on storage.objects;
create policy "staff read form files" on storage.objects for select to authenticated using (bucket_id = 'form-files' and public.is_staff());

-- the selection committee's score and notes
alter table public.form_responses add column if not exists review_score int check (review_score between 0 and 100);
alter table public.form_responses add column if not exists review_note text;

insert into public.forms (slug, title, subtitle, description, sensitive, is_open, fields) values (
'student-support', 'Student Support Initiative: laptop application', 'BCIL Foundation · for undergraduate students of the University of Cape Coast',
'We support deserving undergraduate students of the University of Cape Coast who show academic potential, leadership or community involvement, a genuine need for learning support and strong future potential. This cycle supports access to a laptop, subject to available funding. Applicants need a CGPA of at least 2.5 and at least one semester left at UCC. The first cycle supports up to five students; applications need a score of 60/100 to be considered, and shortlisted applicants may be interviewed.',
true, false,
$j$[
{"key":"s1","label":"Your details","type":"section"},
{"key":"full_name","label":"Full name (first, middle, surname)","type":"text","required":true},
{"key":"dob","label":"Date of birth","type":"date","required":true},
{"key":"gender","label":"Gender","type":"radio","required":true,"options":["Male","Female","Prefer not to say"]},
{"key":"ghana_card","label":"Ghana Card number","type":"text","required":true},
{"key":"nationality","label":"Nationality","type":"text","required":true},
{"key":"region","label":"Region of residence","type":"text","required":true},
{"key":"address","label":"Permanent residential address","type":"textarea","required":true},
{"key":"phone","label":"Telephone number","type":"tel","required":true},
{"key":"email","label":"Email address","type":"email","required":true},
{"key":"s2","label":"University of Cape Coast","type":"section"},
{"key":"student_id","label":"Student ID number","type":"text","required":true},
{"key":"programme","label":"Programme of study","type":"text","required":true},
{"key":"faculty","label":"Faculty / School / College","type":"text","required":true},
{"key":"department","label":"Department","type":"text","required":true},
{"key":"level","label":"Current level","type":"radio","required":true,"options":["Level 100","Level 200","Level 300","Level 400","Other"]},
{"key":"cgpa","label":"Current CGPA","type":"text","required":true,"help":"You need a CGPA of at least 2.5."},
{"key":"semesters","label":"How many semesters have you completed at UCC?","type":"number","required":true},
{"key":"semester_left","label":"Do you have at least one semester remaining at UCC?","type":"radio","required":true,"options":["Yes","No"]},
{"key":"completion","label":"Expected year of completion","type":"text","required":true},
{"key":"transcript","label":"Most recent transcript or results","type":"file","required":true,"help":"Official or unofficial, PDF or photo."},
{"key":"s3","label":"Laptop access and need","type":"section"},
{"key":"own_laptop","label":"Do you currently own a working personal laptop?","type":"radio","required":true,"options":["Yes","No"],"help":"Students who own a working laptop may not qualify."},
{"key":"access","label":"Which best describes your access to a laptop or computer?","type":"radio","required":true,"options":["I do not have access to a laptop or computer","I occasionally borrow a laptop","I share a laptop with family members or others","I rely mainly on computer labs or public facilities","I have a laptop, but it is unreliable or not adequate","Other"]},
{"key":"challenges","label":"What academic challenges do you face without adequate access to a laptop?","type":"textarea","required":true},
{"key":"impact","label":"How would a laptop help your academic work and development?","type":"textarea","required":true,"help":"Coursework, research, online learning, data analysis, professional development, leadership, entrepreneurship…"},
{"key":"alternatives","label":"Do you have other computing resources? If yes, why are they not enough?","type":"textarea"},
{"key":"s4","label":"Leadership and community involvement","type":"section"},
{"key":"leadership","label":"Leadership positions you have held","type":"textarea","help":"For each: organisation, position, period, main responsibilities and one achievement."},
{"key":"community","label":"Community service or volunteer activities","type":"textarea"},
{"key":"leadership_evidence","label":"Evidence of leadership or community involvement","type":"file","help":"Appointment letter, letter from an organisation, certificate, reference or similar."},
{"key":"s5","label":"Other scholarships and support","type":"section"},
{"key":"other_support","label":"Do you receive any scholarship, bursary, grant or sponsorship? If yes, from whom and what kind?","type":"textarea","required":true},
{"key":"laptop_covered","label":"Does any of that support provide a laptop?","type":"radio","required":true,"options":["Yes","No"]},
{"key":"s6","label":"Personal statement","type":"section","help":"About 500 words: your educational journey, why you're applying, your leadership or community involvement, the challenges you face without a laptop, how support would help, your academic and career goals, and how you'll use your education to serve your community."},
{"key":"statement","label":"Personal statement","type":"textarea","required":true},
{"key":"s7","label":"Referee","type":"section","help":"One referee who has known you for at least six months: a lecturer, head of department, supervisor, student leader, NGO, church or community leader."},
{"key":"ref_name","label":"Referee's full name","type":"text","required":true},
{"key":"ref_position","label":"Position / title","type":"text","required":true},
{"key":"ref_org","label":"Organisation / institution","type":"text","required":true},
{"key":"ref_relationship","label":"Relationship to you","type":"text","required":true},
{"key":"ref_known","label":"How long have they known you?","type":"text","required":true},
{"key":"ref_phone","label":"Referee's phone number","type":"tel","required":true},
{"key":"ref_email","label":"Referee's email address","type":"email","required":true},
{"key":"ref_letter","label":"Recommendation letter","type":"file","required":true},
{"key":"citizenship","label":"Proof of Ghanaian citizenship","type":"file","required":true,"help":"A photo of your Ghana Card is fine."},
{"key":"s8","label":"Declaration and consent","type":"section"},
{"key":"declaration","label":"I declare that I am a Ghanaian citizen enrolled as an undergraduate at UCC, have completed at least one semester, have a CGPA of at least 2.5, have at least one semester remaining, do not have adequate access to a laptop, and that everything in this application is true. I understand false information leads to disqualification, applying does not guarantee support, and the committee's decision is final.","type":"checkbox","required":true,"options":["I agree"]},
{"key":"consent","label":"I consent to BCIL Foundation using and verifying my information and documents for assessment, selection, communication, programme administration and reporting, including contacting my referee and the University of Cape Coast.","type":"checkbox","required":true,"options":["I consent"]},
{"key":"obligations","label":"If selected, I may sign a Beneficiary Agreement and agree to keep a CGPA of 2.5, use the laptop responsibly for my studies, join a BCIL mentorship programme, volunteer at a BCIL activity, mentor another student, do community service, report on my progress and look after the laptop.","type":"checkbox","required":true,"options":["I accept"]}
]$j$::jsonb)
on conflict (slug) do nothing;

select 'ok' as student_support_setup;
