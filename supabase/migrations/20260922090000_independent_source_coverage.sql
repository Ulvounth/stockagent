-- Kjør etter 20260921090000_daily_news.sql. Beholder eksisterende rapporter.
-- Nyheter og Reddit må kunne hente inn etterslep uavhengig av hverandre.
alter table public.stock_news_digests
  add column if not exists reddit_coverage_end timestamptz;

-- Gjenopprett vellykket dekning fra eldre rapporter, også delvise kjøringer.
update public.stock_news_digests set coverage_end = greatest(coverage_end, checked_at)
where exists (
  select 1 from jsonb_array_elements(digest->'sources') source
  where source->>'provider' is distinct from 'Reddit · diskusjoner'
) and not exists (
  select 1 from jsonb_array_elements(digest->'sources') source
  where source->>'provider' is distinct from 'Reddit · diskusjoner'
    and source->>'ok' is distinct from 'true'
);

update public.stock_news_digests set reddit_coverage_end = greatest(
  reddit_coverage_end, coalesce((digest->>'redditWindowEnd')::timestamptz, checked_at)
)
where exists (
  select 1 from jsonb_array_elements(digest->'sources') source
  where source->>'provider' = 'Reddit · diskusjoner'
) and not exists (
  select 1 from jsonb_array_elements(digest->'sources') source
  where source->>'provider' = 'Reddit · diskusjoner'
    and source->>'ok' is distinct from 'true'
);

create or replace function public.finish_daily_news(
  p_date date, p_run_id uuid, p_status text, p_digests jsonb, p_error text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'Invalid final status';
  end if;
  perform 1 from public.daily_news_runs
    where report_date = p_date and run_id = p_run_id and status = 'running'
    for update;
  if not found then raise exception 'Daily news lease lost'; end if;

  for item in select value from jsonb_array_elements(p_digests) loop
    insert into public.stock_news_digests as existing
      (report_date, symbol, checked_at, coverage_end, reddit_coverage_end, digest)
    values (p_date, item->>'symbol', (item->>'windowEnd')::timestamptz,
      case when exists (
        select 1 from jsonb_array_elements(item->'sources') source
        where source->>'provider' is distinct from 'Reddit · diskusjoner'
      ) and not exists (
        select 1 from jsonb_array_elements(item->'sources') source
        where source->>'provider' is distinct from 'Reddit · diskusjoner'
          and source->>'ok' is distinct from 'true'
      ) then (item->>'windowEnd')::timestamptz else null end,
      case when exists (
        select 1 from jsonb_array_elements(item->'sources') source
        where source->>'provider' = 'Reddit · diskusjoner'
      ) and not exists (
        select 1 from jsonb_array_elements(item->'sources') source
        where source->>'provider' = 'Reddit · diskusjoner'
          and source->>'ok' is distinct from 'true'
      ) then coalesce(item->>'redditWindowEnd', item->>'windowEnd')::timestamptz else null end,
      item)
    on conflict (report_date, symbol) do update set
      checked_at = excluded.checked_at,
      coverage_end = greatest(existing.coverage_end, excluded.coverage_end),
      reddit_coverage_end = greatest(existing.reddit_coverage_end, excluded.reddit_coverage_end),
      digest = excluded.digest;
  end loop;

  update public.daily_news_runs set status = p_status, finished_at = now(), error = p_error
    where report_date = p_date and run_id = p_run_id;
end;
$$;

revoke all on function public.finish_daily_news(date, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_daily_news(date, uuid, text, jsonb, text) to service_role;
