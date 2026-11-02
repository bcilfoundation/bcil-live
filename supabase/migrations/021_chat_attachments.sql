-- BCIL Live: photos and documents in chats (messages, groups, Announcements). Safe to run more than once.
alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;   -- 'image' or 'file'
alter table public.messages add column if not exists attachment_size int;

-- files go in a "chat-files" bucket, each person in their own folder; up to 20 MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', true, 20971520)
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;
drop policy if exists "chat files upload own folder" on storage.objects;
create policy "chat files upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "chat files delete own" on storage.objects;
create policy "chat files delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));

-- notifications for a photo or file with no text say "📷 Photo" or "📎 file name"
create or replace function public.notify_dm() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text; k text; rn text; txt text;
begin
  select kind, name into k, rn from rooms where id = new.room_id;
  txt := coalesce(nullif(trim(new.body), ''), case when new.attachment_type = 'image' then '📷 Photo' when new.attachment_url is not null then '📎 ' || coalesce(new.attachment_name, 'File') else '' end);
  if k = 'dm' then
    select full_name into n from profiles where id = new.user_id;
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'message', new.user_id, '/chat?room=' || new.room_id, coalesce(nullif(n,''),'Someone') || ': ' || left(txt, 80)
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  elsif k = 'announcements' then
    insert into notifications (user_id, kind, actor_id, link, body)
      select m.user_id, 'announcement', new.user_id, '/chat?room=' || new.room_id, '📢 ' || coalesce(rn, 'Announcement') || ': ' || left(txt, 140)
      from room_members m where m.room_id = new.room_id and m.user_id <> new.user_id;
  end if;
  return new;
end $$;

select 'ok' as chat_attachments_setup;
