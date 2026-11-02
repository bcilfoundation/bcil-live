-- BCIL Live: Bookshop contacts: Gloria Akey's correct number, Solomon's Ghana number. Safe to run more than once.
update public.shop_books set sellers = '[
  {"area":"Signed copy","name":"Solomon","phone":"+233540215225"},
  {"area":"Anywhere in Ghana","name":"Martina","phone":"+233559281710"},
  {"area":"Cape Coast (UCC)","name":"Benny Morgan","phone":"+233542343575"},
  {"area":"Cape Coast (UCC)","name":"Eben","phone":"+233201854278"},
  {"area":"Accra (UG, UPSA)","name":"Gloria Akey","phone":"+233546174256"},
  {"area":"Kumasi (KNUST)","name":"Esther","phone":"+233540377475"},
  {"area":"Ho (HTU, UHAS, NTC)","name":"Prince","phone":"+233542318100"},
  {"area":"Amedzofe (AMECO)","name":"Joel","phone":"+233537953354"},
  {"area":"Winneba (UEW)","name":"Kaleb","phone":"+233559193826"}]'::jsonb
where title like 'PENCILS of Success%';
select jsonb_array_length(sellers) as contacts, sellers->4->>'name' as accra_contact from public.shop_books where title like 'PENCILS of Success%';
