-- BCIL Live: reading room (books shelf for mentorship). Safe to run more than once.
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  category text not null default 'Mentorship',
  description text,
  cover_url text,
  file_url text not null,
  pages int,
  published boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.books enable row level security;
drop policy if exists "members read books" on public.books;
create policy "members read books" on public.books for select to authenticated using (published or is_staff());
drop policy if exists "staff add books" on public.books;
create policy "staff add books" on public.books for insert to authenticated with check (is_staff());
drop policy if exists "staff edit books" on public.books;
create policy "staff edit books" on public.books for update to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "staff delete books" on public.books;
create policy "staff delete books" on public.books for delete to authenticated using (is_staff());

-- where each reader stopped, so "Continue reading" opens on the right page
create table if not exists public.book_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  page int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
alter table public.book_progress enable row level security;
drop policy if exists "own progress" on public.book_progress;
create policy "own progress" on public.book_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- book files: PDFs and cover images, max 50 MB each
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', true, 52428800, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "staff upload books" on storage.objects;
create policy "staff upload books" on storage.objects for insert to authenticated with check (bucket_id = 'books' and is_staff());
drop policy if exists "staff manage books" on storage.objects;
create policy "staff manage books" on storage.objects for delete to authenticated using (bucket_id = 'books' and is_staff());

select 'ok' as reading_room_setup;
