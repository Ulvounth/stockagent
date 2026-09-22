-- Kjør én gang i Supabase SQL Editor, eller bruk supabase db push.
-- Ingen eksisterende kurstabeller endres.
create table if not exists public.daily_news_runs (
  report_date date primary key,
  run_id uuid not null,
  status text not null check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz not null,
  error text
);

create table if not exists public.stock_news_digests (
  report_date date not null references public.daily_news_runs(report_date),
  symbol text not null,
  checked_at timestamptz not null,
  coverage_end timestamptz,
  digest jsonb not null,
  primary key (report_date, symbol)
);
create index if not exists stock_news_digests_symbol_checked
  on public.stock_news_digests (symbol, checked_at desc);

alter table public.daily_news_runs enable row level security;
alter table public.stock_news_digests enable row level security;
revoke all on public.daily_news_runs, public.stock_news_digests from anon, authenticated;
grant all on public.daily_news_runs, public.stock_news_digests to service_role;

-- Én arbeider per norsk dato. Mislykkede/delvise kjøringer og utløpte låser kan forsøkes igjen.
create or replace function public.claim_daily_news(p_date date, p_run_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed boolean;
begin
  insert into public.daily_news_runs as existing
    (report_date, run_id, status, started_at, lease_until)
  values (p_date, p_run_id, 'running', now(), now() + interval '15 minutes')
  on conflict (report_date) do update set
    run_id = excluded.run_id, status = 'running', started_at = now(),
    lease_until = excluded.lease_until, finished_at = null, error = null
  where existing.status in ('partial', 'failed')
    or (existing.status = 'running' and existing.lease_until < now())
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

-- Rapportene og kjørestatusen lagres i samme transaksjon.
-- run_id hindrer at en gammel arbeider overskriver en nyere kjøring.
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
    insert into public.stock_news_digests (report_date, symbol, checked_at, coverage_end, digest)
    values (p_date, item->>'symbol', (item->>'windowEnd')::timestamptz,
      case when jsonb_array_length(item->'sources') > 0 and not exists (
        select 1 from jsonb_array_elements(item->'sources') source where source->>'ok' is distinct from 'true'
      ) then (item->>'windowEnd')::timestamptz else null end, item)
    on conflict (report_date, symbol) do update set
      checked_at = excluded.checked_at, coverage_end = excluded.coverage_end, digest = excluded.digest;
  end loop;

  update public.daily_news_runs set status = p_status, finished_at = now(), error = p_error
    where report_date = p_date and run_id = p_run_id;
end;
$$;

revoke all on function public.claim_daily_news(date, uuid) from public, anon, authenticated;
revoke all on function public.finish_daily_news(date, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_daily_news(date, uuid) to service_role;
grant execute on function public.finish_daily_news(date, uuid, text, jsonb, text) to service_role;
