-- Meeting requests: Excel and CSV documents, remove a document before sending, and undo a request in the first seconds.

-- 1) allow Excel (.xls, .xlsx) and CSV in the private documents bucket
update storage.buckets set allowed_mime_types = array[
  'application/pdf','image/jpeg','image/png','image/webp','image/heic',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv']
where id = 'form-files';

-- 2) people can delete a document they uploaded, as long as it isn't part of a request they've sent
drop policy if exists "owners delete unsent form files" on storage.objects;
create policy "owners delete unsent form files" on storage.objects for delete to authenticated
  using (bucket_id = 'form-files' and split_part(name, '/', 1) = auth.uid()::text
    and not exists (select 1 from public.meeting_requests r where r.files ? name)
    and not exists (select 1 from public.documents d where d.path = name));

-- 3) undo a request within the first moments (the app offers 15 seconds); also takes back the admin notification
create or replace function public.undo_meeting_request(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r meeting_requests;
begin
  select * into r from meeting_requests where id = p_id;
  if r.id is null or r.user_id <> auth.uid() then raise exception 'Request not found'; end if;
  if r.status <> 'pending' or r.created_at < now() - interval '30 seconds' then raise exception 'Too late to undo. You can message us instead.'; end if;
  delete from notifications where kind = 'meeting' and actor_id = r.user_id and link = '/admin?tab=Meetings'
    and created_at between r.created_at - interval '5 seconds' and r.created_at + interval '30 seconds';
  delete from meeting_requests where id = p_id;
  return jsonb_build_object('files', r.files, 'slot_at', r.slot_at);
end $$;
grant execute on function public.undo_meeting_request(bigint) to authenticated;

select 'ok' as meeting_docs_undo_setup;
