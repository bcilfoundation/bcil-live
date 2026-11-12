-- 054: FCB 2027 evaluation form. Every rating lists the highest choice first (Excellent → Poor).
-- It stays closed until the day: open it from Admin → FCB 2027. Safe to run more than once.
insert into public.forms (slug, title, subtitle, description, sensitive, is_open, fields)
values ('fcb27-evaluation', 'FCB 2027 Evaluation', 'Tell us how Finding Campus Balance 2027 went for you',
  $q$Thank you for attending Finding Campus Balance 2027. Your honest answers help BCIL Foundation make the next edition better. It takes about 3 minutes.$q$,
  false, false,
$j$[
 {"key": "s1", "type": "section", "label": "About you"},
 {"key": "full_name", "label": "Name (optional)", "type": "text"},
 {"key": "level", "label": "Current level", "type": "radio", "required": true, "options": ["Level 100", "Level 200", "Level 300", "Level 400", "Postgraduate", "National Service Personnel", "Other"]},
 {"key": "mode", "label": "How did you attend?", "type": "radio", "required": true, "options": ["In person", "Online"]},

 {"key": "s2", "type": "section", "label": "The programme", "help": "Rate each part. 5 is the highest."},
 {"key": "overall", "label": "Overall, how would you rate FCB 2027?", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},
 {"key": "cv_clinic", "label": "CV and Cover Letter Clinic", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor", "I did not attend this part"]},
 {"key": "digital_safety", "label": "Digital Safety and Responsibility", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor", "I did not attend this part"]},
 {"key": "academic_wellbeing", "label": "Academic Wellbeing", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor", "I did not attend this part"]},
 {"key": "campus_panel", "label": "Campus Life Experience Panel", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor", "I did not attend this part"]},
 {"key": "speakers", "label": "The speakers and panellists", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},

 {"key": "s3", "type": "section", "label": "Organisation"},
 {"key": "registration", "label": "Registration and check-in", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},
 {"key": "venue", "label": "Venue, seating and sound", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},
 {"key": "time", "label": "Time management", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},
 {"key": "volunteers", "label": "Helpfulness of the volunteers and ushers", "type": "radio", "required": true, "options": ["5 · Excellent", "4 · Very good", "3 · Good", "2 · Fair", "1 · Poor"]},

 {"key": "s4", "type": "section", "label": "What you take away"},
 {"key": "useful", "label": "How useful will what you learned be for your life on campus?", "type": "radio", "required": true, "options": ["Extremely useful", "Very useful", "Somewhat useful", "Slightly useful", "Not useful"]},
 {"key": "recommend", "label": "How likely are you to recommend FCB to a friend?", "type": "radio", "required": true, "options": ["Very likely", "Likely", "Not sure", "Unlikely", "Very unlikely"]},
 {"key": "valuable", "label": "What was the most valuable thing you learned?", "type": "textarea", "required": true},
 {"key": "improve", "label": "What should we improve for the next FCB?", "type": "textarea"},
 {"key": "topics", "label": "What topics would you like at the next FCB?", "type": "textarea"},
 {"key": "mentorship", "label": "Would you like a BCIL mentor for the year?", "type": "radio", "required": true, "options": ["Yes, please sign me up", "I already signed up", "Not now"]},
 {"key": "testimonial", "label": "Would you like to share a short testimonial?", "type": "textarea", "help": "Optional. It may be shared on BCIL's app and social media."},
 {"key": "share_ok", "label": "Can BCIL Foundation share your testimonial with your first name?", "type": "radio", "options": ["Yes", "Yes, but without my name", "No"]}
]$j$::jsonb)
on conflict (slug) do nothing;

-- staff: counts of answers per choice for one form (for the FCB 2027 results view)
create or replace function public.form_tally(p_slug text) returns table (field text, answer text, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Staff only'; end if;
  return query
    select kv.key, kv.value #>> '{}', count(*)::int
    from form_responses r join forms f on f.id = r.form_id, jsonb_each(r.answers) kv
    where f.slug = p_slug and jsonb_typeof(kv.value) = 'string'
    group by 1, 2;
end $$;
grant execute on function public.form_tally(text) to authenticated;

select 'ok' as fcb_evaluation_setup;
