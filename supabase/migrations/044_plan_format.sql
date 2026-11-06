-- 044: Plan 2027 in Solomon's format: area, goal, description of goal, start, end, remark
alter table public.plan_goals add column if not exists description text;
alter table public.plan_goals add column if not exists start_month int check (start_month between 1 and 12);
alter table public.plan_goals add column if not exists end_month int check (end_month between 1 and 12);
alter table public.plan_goals add column if not exists remark text;
select 'ok' as plan_format_setup;
