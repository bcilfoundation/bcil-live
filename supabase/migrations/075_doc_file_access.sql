-- 075: fix opening edited copies. The storage rule compared the file's path with the document's own "name" column
-- instead of the file's name, so people could only open files they had uploaded themselves. Now anyone who can see a
-- document (the person who sent it, Solomon and anyone he assigns) can open and download every copy of it.
drop policy if exists "document readers open files" on storage.objects;
create policy "document readers open files" on storage.objects for select to authenticated
  using (bucket_id = 'form-files' and exists (select 1 from public.documents d where d.path = storage.objects.name and public.can_see_doc(d.id)));

drop policy if exists "owners delete unsent form files" on storage.objects;
create policy "owners delete unsent form files" on storage.objects for delete to authenticated
  using (bucket_id = 'form-files' and split_part(storage.objects.name, '/', 1) = auth.uid()::text
    and not exists (select 1 from public.meeting_requests r where r.files ? storage.objects.name)
    and not exists (select 1 from public.documents d where d.path = storage.objects.name));

select 'ok' as doc_file_access_setup;
