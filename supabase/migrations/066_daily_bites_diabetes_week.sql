-- Daily Bites, 21–27 Nov 2026: Diabetes Awareness Month. Safe to run more than once (replaces those days).
insert into public.quotes (show_on, body, author, theme) values
 (date '2026-11-21', 'Did you know? Diabetes occurs when your body cannot produce enough insulin or cannot use insulin effectively, causing blood sugar levels to rise.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-22', 'Did you know? Frequent urination, excessive thirst, unexplained weight loss, fatigue, and blurred vision can be warning signs of diabetes. Recognizing the signs early can make a difference.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-23', 'Did you know? Type 1 and Type 2 diabetes are different. Type 1 is an autoimmune condition, while Type 2 involves the body''s inability to use insulin effectively. Neither should be dismissed or stigmatized.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-24', 'Did you know? Type 2 diabetes can sometimes develop without noticeable symptoms. Regular screening, especially if you have risk factors, can help identify it early.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-25', 'Did you know? Type 2 diabetes can often be prevented or delayed through regular physical activity, balanced nutrition, and other healthy habits. Small, consistent choices can protect your future health.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-26', 'Did you know? Uncontrolled diabetes can damage the heart, kidneys, eyes, and nerves. Early diagnosis, appropriate treatment, and regular checkups can help prevent serious complications.', 'BCIL Foundation', 'Diabetes Awareness'),
 (date '2026-11-27', 'Did you know? Living with diabetes does not mean you cannot live a healthy and fulfilling life. With appropriate treatment, healthy habits, and support, people with diabetes can thrive.', 'BCIL Foundation', 'Diabetes Awareness')
on conflict (show_on) do update set body = excluded.body, author = excluded.author, theme = excluded.theme;

select show_on, left(body, 60) as bite from public.quotes where show_on between date '2026-11-21' and date '2026-11-27' order by show_on;
