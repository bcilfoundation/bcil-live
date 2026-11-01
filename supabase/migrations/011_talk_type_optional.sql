-- BCIL Live: the programme/type of a talk is now optional free text (the title is the main thing). Safe to run more than once.
alter table public.talks alter column program drop not null;
select 'ok' as talk_type_optional;
