-- 046: comments on Daily Bites, and a count of how many times each bite has been shared
create table if not exists public.quote_comments (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quotes(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists quote_comments_quote on public.quote_comments (quote_id, created_at);
alter table public.quote_comments enable row level security;
drop policy if exists "members read bite comments" on public.quote_comments;
create policy "members read bite comments" on public.quote_comments for select to authenticated using (true);
drop policy if exists "members comment on bites" on public.quote_comments;
create policy "members comment on bites" on public.quote_comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.quotes q where q.id = quote_id and q.show_on <= current_date));
drop policy if exists "delete own bite comments" on public.quote_comments;
create policy "delete own bite comments" on public.quote_comments for delete to authenticated using (user_id = auth.uid() or public.is_staff());

create table if not exists public.quote_shares (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quotes(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists quote_shares_quote on public.quote_shares (quote_id);
alter table public.quote_shares enable row level security;
drop policy if exists "anyone counts bite shares" on public.quote_shares;
create policy "anyone counts bite shares" on public.quote_shares for select to authenticated using (true);
drop policy if exists "members record shares" on public.quote_shares;
create policy "members record shares" on public.quote_shares for insert to authenticated with check (user_id = auth.uid());

do $$ begin
  begin alter publication supabase_realtime add table public.quote_comments; exception when duplicate_object then null; end;
end $$;

select 'ok' as quote_comments_shares_setup;
