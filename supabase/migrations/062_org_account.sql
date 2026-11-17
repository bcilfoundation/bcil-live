-- ---------- The BCIL Foundation account is an organisation account, not a person ----------
-- It can chat, post and make friends, but has no birthday or other personal details.
alter table public.profiles add column if not exists is_org boolean not null default false;

update public.profiles set is_org = true, birthday_month = null, birthday_day = null,
  birthday_choice = 'none', show_birthday = false, full_name = 'BCIL Foundation'
where id = (select id from auth.users where lower(email) = 'bcilfound@gmail.com');

-- an organisation account never gets birthday details back
create or replace function public.org_no_birthday() returns trigger
language plpgsql as $$
begin
  if new.is_org then
    new.birthday_month := null; new.birthday_day := null; new.birthday_choice := 'none'; new.show_birthday := false;
  end if;
  return new;
end $$;
drop trigger if exists org_no_birthday on public.profiles;
create trigger org_no_birthday before insert or update on public.profiles for each row execute function public.org_no_birthday();

select 'org_account = ok' as result, (select count(*) from public.profiles where is_org) as org_accounts;
