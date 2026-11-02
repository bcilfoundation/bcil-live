-- BCIL Live: "Our team" (executives and directors) and the BCIL Bookshop. Safe to run more than once.

-- ---------- Our team ----------
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,                          -- e.g. Executive Director
  team text not null default 'Executives',     -- e.g. Board of Directors, Executives, Coordinators
  bio text,
  photo_url text,
  sort int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;
drop policy if exists "anyone sees the team" on public.team_members;
create policy "anyone sees the team" on public.team_members for select using (true);
drop policy if exists "staff manage the team" on public.team_members;
create policy "staff manage the team" on public.team_members for all to authenticated using (is_staff()) with check (is_staff());

-- ---------- Bookshop: books by BCIL people, bought on Amazon or from sellers in Ghana ----------
create table if not exists public.shop_books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text not null,
  description text,
  cover_url text,
  price_text text,                 -- e.g. "GH₵ 150 · US$ 15" (optional)
  amazon_url text,
  sellers jsonb not null default '[]',   -- [{"area":"Cape Coast (UCC)","name":"Benny Morgan","phone":"+233542343575"}]
  published boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.shop_books enable row level security;
drop policy if exists "anyone sees the bookshop" on public.shop_books;
create policy "anyone sees the bookshop" on public.shop_books for select using (published or is_staff());
drop policy if exists "staff manage the bookshop" on public.shop_books;
create policy "staff manage the bookshop" on public.shop_books for all to authenticated using (is_staff()) with check (is_staff());

insert into public.shop_books (title, author, description, cover_url, amazon_url, sellers, sort)
select 'PENCILS of Success · Vol. 1', 'Solomon Agbesi',
  'Available worldwide. Order on Amazon, or get a copy from a BCIL contact near you in Ghana. Signed copies are available in the US and Canada.',
  '/shop/pencils-of-success.jpg', 'https://www.amazon.com/dp/B0H7633BP3',
  '[{"area":"Signed copy (US/Canada)","name":"Solomon","phone":"+12072990493"},
    {"area":"Anywhere in Ghana","name":"Martina","phone":"+233559281710"},
    {"area":"Cape Coast (UCC)","name":"Benny Morgan","phone":"+233542343575"},
    {"area":"Cape Coast (UCC)","name":"Eben","phone":"+233201854278"},
    {"area":"Accra (UG, UPSA)","name":"Gloria","phone":"+233201854278"},
    {"area":"Kumasi (KNUST)","name":"Esther","phone":"+233540377475"},
    {"area":"Ho (HTU, UHAS, NTC)","name":"Prince","phone":"+233542318100"},
    {"area":"Amedzofe (AMECO)","name":"Joel","phone":"+233537953354"},
    {"area":"Winneba (UEW)","name":"Kaleb","phone":"+233559193826"}]'::jsonb, 1
where not exists (select 1 from public.shop_books where title like 'PENCILS of Success%');

select 'ok' as team_shop_setup;
