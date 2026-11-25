-- 074: remove the test donations made while Paystack was in test mode (before live giving started on 25 Nov 2026),
-- and checkouts that were opened but never paid. From now on, unpaid checkouts older than a day are cleared every night.
-- Gifts that were really received (status "paid" since live giving began) and gifts people recorded themselves are kept.

-- certificate fees "paid" with test money are no longer marked as paid
update public.form_responses set paid_at = null
where id in (select form_response_id from public.gifts
             where form_response_id is not null and status = 'paid' and created_at < '2026-11-25 16:41:00+00' and paystack_reference is not null);

-- test-mode gifts (anything paid through Paystack before live giving) and unpaid checkouts
delete from public.gifts
where (created_at < '2026-11-25 16:41:00+00' and paystack_reference is not null)
   or status = 'failed'
   or (status = 'pending' and created_at < now() - interval '15 minutes');

-- every night: clear checkouts that were never paid
select cron.unschedule('bcil-clear-unpaid-gifts') where exists (select 1 from cron.job where jobname = 'bcil-clear-unpaid-gifts');
select cron.schedule('bcil-clear-unpaid-gifts', '30 3 * * *',
  $$delete from public.gifts where status in ('pending', 'failed') and created_at < now() - interval '1 day'$$);

select 'ok' as clear_test_gifts_setup, (select count(*) from public.gifts) as gifts_left;
