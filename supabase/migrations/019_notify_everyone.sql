-- BCIL Live: staff can send one notification to every member (e.g. a new book). Safe to run more than once.
create or replace function public.notify_everyone(p_kind text, p_body text, p_link text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_staff() then raise exception 'Only BCIL staff can notify everyone'; end if;
  insert into notifications (user_id, kind, actor_id, link, body)
    select p.id, left(p_kind, 30), auth.uid(), p_link, left(p_body, 200) from profiles p where p.id <> auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.notify_everyone(text, text, text) from public, anon;
grant execute on function public.notify_everyone(text, text, text) to authenticated;
select 'ok' as notify_everyone_setup;
