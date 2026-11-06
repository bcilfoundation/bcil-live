-- 041: live calls with one person, read receipts, and document review with comments

-- ---------- Live call from a direct message (staff and mentors) ----------
drop policy if exists "dm live calls" on public.live_sessions;
create policy "dm live calls" on public.live_sessions for insert to authenticated
  with check (host_id = auth.uid() and room_id is not null
    and exists (select 1 from rooms r where r.id = room_id and r.kind = 'dm')
    and is_member(room_id)
    and (is_staff() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'mentor')));

-- notifications: a DM call rings the other person and puts them straight on the mic
create or replace function public.notify_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; k text; host text;
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') then
    if new.room_id is not null then
      select name, kind into g, k from rooms where id = new.room_id;
      if k = 'dm' then
        select full_name into host from profiles where id = new.host_id;
        insert into call_requests (session_id, user_id, status)
          select new.id, m.user_id, 'on_air' from room_members m
          where m.room_id = new.room_id and m.user_id is distinct from new.host_id
          on conflict do nothing;
        insert into notifications (user_id, kind, actor_id, link, body)
          select m.user_id, 'live', new.host_id, '/live', '📞 ' || coalesce(host, 'BCIL') || ' started a live call with you. Tap to join.'
          from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.host_id;
      else
        insert into notifications (user_id, kind, actor_id, link, body)
          select m.user_id, 'live', new.host_id, '/live', coalesce(g, 'Your group') || ' is live now: ' || new.title
          from room_members m where m.room_id = new.room_id and m.user_id is distinct from new.host_id;
      end if;
    elsif not coalesce(new.is_private, false) then
      insert into notifications (user_id, kind, actor_id, link, body)
        select p.id, 'live', new.host_id, '/live', 'BCIL is live now: ' || new.title
        from profiles p where p.id is distinct from new.host_id;
    end if;
  end if;
  return new;
end $$;

-- ---------- Read receipts: chat screens follow when others read ----------
do $$ begin
  begin alter publication supabase_realtime add table public.room_members; exception when duplicate_object then null; end;
end $$;

-- ---------- Documents for review, with comments ----------
create table if not exists public.documents (
  id bigint generated always as identity primary key,
  owner_id uuid references profiles(id) on delete cascade,
  path text not null unique,                       -- private file in the form-files bucket
  name text not null,
  context text not null check (context in ('meeting', 'mentorship', 'form')),
  ref_id bigint,                                   -- meeting request, mentorship pair, or form response
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;

create or replace function public.can_see_doc(d bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents x where x.id = d and (
    is_staff() or x.owner_id = auth.uid()
    or (x.context = 'mentorship' and exists (select 1 from mentorships m where m.id = x.ref_id and auth.uid() in (m.mentor_id, m.mentee_id)))))
$$;
drop policy if exists "see documents" on public.documents;
create policy "see documents" on public.documents for select to authenticated using (can_see_doc(id));

-- the people who can see a document can open its file
drop policy if exists "document readers open files" on storage.objects;
create policy "document readers open files" on storage.objects for select to authenticated
  using (bucket_id = 'form-files' and exists (select 1 from public.documents d where d.path = name and public.can_see_doc(d.id)));
-- people open what they uploaded themselves
drop policy if exists "owners open own form files" on storage.objects;
create policy "owners open own form files" on storage.objects for select to authenticated
  using (bucket_id = 'form-files' and split_part(name, '/', 1) = auth.uid()::text);

-- open (or register) a document for review and return its id
create or replace function public.open_document(p_path text, p_name text, p_context text, p_ref bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare d bigint; own uuid;
begin
  select id into d from documents where path = p_path;
  if d is not null then
    if not can_see_doc(d) then raise exception 'You can''t open this document'; end if;
    return d;
  end if;
  if p_context = 'meeting' then
    select user_id into own from meeting_requests where id = p_ref and files ? p_path;
    if own is null or not (is_staff() or own = auth.uid()) then raise exception 'You can''t open this document'; end if;
  elsif p_context = 'mentorship' then
    if not exists (select 1 from mentorships where id = p_ref and auth.uid() in (mentor_id, mentee_id)) then raise exception 'You are not in this mentorship'; end if;
    if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Upload the file first'; end if;
    own := auth.uid();
  elsif p_context = 'form' then
    -- application reviews stay with the committee: the applicant does not see them
    if not is_staff() then raise exception 'Only BCIL staff can review applications'; end if;
    own := null;
  else
    raise exception 'Unknown document type';
  end if;
  insert into documents (owner_id, path, name, context, ref_id)
    values (own, p_path, left(coalesce(nullif(trim(p_name), ''), regexp_replace(p_path, '^.*/', '')), 150), p_context, p_ref)
    returning id into d;
  if p_context = 'mentorship' then
    insert into notifications (user_id, kind, actor_id, link, body)
      select case when m.mentor_id = auth.uid() then m.mentee_id else m.mentor_id end, 'doc', auth.uid(), '/doc/' || d,
        '📄 ' || coalesce((select full_name from profiles where id = auth.uid()), 'Your mentorship partner') || ' shared a document for review: ' || left(p_name, 60)
      from mentorships m where m.id = p_ref;
  end if;
  return d;
end $$;

create table if not exists public.doc_comments (
  id bigint generated always as identity primary key,
  document_id bigint not null references documents(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  parent_id bigint references doc_comments(id) on delete cascade,
  page int,                      -- PDF page (1, 2, …); null for pictures and Word files
  x real, y real,                -- where the pin sits, as a share of the page width and height
  quote text,                    -- text the person had selected
  body text not null check (length(trim(body)) between 1 and 4000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists doc_comments_doc on public.doc_comments (document_id, created_at);
alter table public.doc_comments enable row level security;
drop policy if exists "see doc comments" on public.doc_comments;
create policy "see doc comments" on public.doc_comments for select to authenticated using (can_see_doc(document_id));
drop policy if exists "add doc comments" on public.doc_comments;
create policy "add doc comments" on public.doc_comments for insert to authenticated with check (user_id = auth.uid() and can_see_doc(document_id) and not resolved);
drop policy if exists "resolve doc comments" on public.doc_comments;
create policy "resolve doc comments" on public.doc_comments for update to authenticated using (can_see_doc(document_id)) with check (can_see_doc(document_id));
drop policy if exists "delete own doc comments" on public.doc_comments;
create policy "delete own doc comments" on public.doc_comments for delete to authenticated using (user_id = auth.uid() or is_staff());
do $$ begin
  begin alter publication supabase_realtime add table public.doc_comments; exception when duplicate_object then null; end;
end $$;

-- tell the other side about a new comment
create or replace function public.notify_doc_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare d documents; nm text;
begin
  select * into d from documents where id = new.document_id;
  select full_name into nm from profiles where id = new.user_id;
  insert into notifications (user_id, kind, actor_id, link, body)
    select distinct u, 'doc', new.user_id, '/doc/' || d.id, '💬 ' || coalesce(nm, 'Someone') || ' commented on ' || left(d.name, 50) || ': ' || left(new.body, 60)
    from (
      select d.owner_id as u
      union select m.mentor_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select m.mentee_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select c.user_id from doc_comments c where c.document_id = d.id
      union select p.id from profiles p where d.context in ('meeting', 'form') and p.role = 'admin' and new.user_id = d.owner_id
    ) t where u is not null and u <> new.user_id;
  return new;
end $$;
drop trigger if exists doc_comments_notify on public.doc_comments;
create trigger doc_comments_notify after insert on public.doc_comments for each row execute function public.notify_doc_comment();

select 'ok' as live_dm_receipts_documents_setup,
  (select count(*) from pg_policies where tablename in ('documents', 'doc_comments')) as doc_policies;
