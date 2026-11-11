-- 051: public card images of Daily Bites, so scheduled posts on Facebook, Instagram and LinkedIn can use them
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true;
drop policy if exists "admin uploads social images" on storage.objects;
create policy "admin uploads social images" on storage.objects for insert to authenticated with check (bucket_id = 'social' and public.is_admin());
drop policy if exists "admin replaces social images" on storage.objects;
create policy "admin replaces social images" on storage.objects for update to authenticated using (bucket_id = 'social' and public.is_admin()) with check (bucket_id = 'social' and public.is_admin());
drop policy if exists "admin reads social images" on storage.objects;
create policy "admin reads social images" on storage.objects for select to authenticated using (bucket_id = 'social' and public.is_admin());
select 'ok' as social_images_setup;
