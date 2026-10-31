-- Let members delete their own account from the app (required by Google Play and the App Store).
-- Messages, friendships, notes, likes etc. are removed through ON DELETE CASCADE.
-- Gift records are kept for the foundation's accounts but no longer linked to the person.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  update public.quotes set created_by = null where created_by = me;
  update public.live_sessions set host_id = null where host_id = me;
  update public.gifts set user_id = null where user_id = me;
  delete from public.reports where reporter = me;
  delete from auth.users where id = me;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
