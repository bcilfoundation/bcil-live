-- 045: revised versions of a reviewed document (anyone who can see the document can upload a new version)
alter table public.documents add column if not exists root_id bigint references public.documents(id) on delete cascade;
alter table public.documents add column if not exists version int not null default 1;
alter table public.documents add column if not exists uploaded_by uuid references public.profiles(id) on delete set null;

create or replace function public.add_doc_version(p_doc bigint, p_path text, p_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare d documents; root bigint; v int; nid bigint; nm text;
begin
  select * into d from documents where id = p_doc;
  if d.id is null or not can_see_doc(p_doc) then raise exception 'You can''t open this document'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Upload the file first'; end if;
  root := coalesce(d.root_id, d.id);
  select coalesce(max(version), 1) + 1 into v from documents where id = root or root_id = root;
  insert into documents (owner_id, path, name, context, ref_id, root_id, version, uploaded_by)
    values (d.owner_id, p_path, left(coalesce(nullif(trim(p_name), ''), d.name), 150), d.context, d.ref_id, root, v, auth.uid())
    returning id into nid;
  select full_name into nm from profiles where id = auth.uid();
  insert into notifications (user_id, kind, actor_id, link, body)
    select distinct u, 'doc', auth.uid(), '/doc/' || nid, '📄 ' || coalesce(nm, 'Someone') || ' uploaded a revised version (v' || v || ') of ' || left(d.name, 60)
    from (
      select d.owner_id as u
      union select m.mentor_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select m.mentee_id from mentorships m where d.context = 'mentorship' and m.id = d.ref_id
      union select c.user_id from doc_comments c join documents x on x.id = c.document_id where x.id = root or x.root_id = root
      union select x.uploaded_by from documents x where (x.id = root or x.root_id = root)
    ) t where u is not null and u <> auth.uid();
  return nid;
end $$;

select 'ok' as doc_versions_setup;
