import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { fetchHistory } from "@/lib/eodhd";
import { generateHistoryReport } from "@/lib/ai";
import { readDailyNews } from "@/lib/daily-news";
import { WATCHLIST } from "@/lib/watchlist";
import { DigestCard } from "@/app/components/digest-card";
import { SocialSearch } from "@/app/components/social-search";
import { isReportDue, osloDate } from "@/lib/schedule";
import type { HistoricalRow } from "@/lib/types";
import { reportDate, reportPage, type QueryValue } from "@/lib/report-query";
import Loading from "@/app/loading";

type Props = {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ date?: QueryValue; redditPage?: QueryValue }>;
};

export default function StockPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <StockContent {...props} />
    </Suspense>
  );
}

async function StockContent({ params, searchParams }: Props) {
  await connection();
  const { symbol } = await params;
  const query = await searchParams;
  const date = reportDate(query.date);
  const redditPage = reportPage(query.redditPage);
  const stock = WATCHLIST.find((item) => item.symbol === symbol);
  if (!stock) notFound();
  const [historyResult, newsResult] = await Promise.allSettled([
    fetchHistory(symbol, 30),
    readDailyNews(symbol, date),
  ]);
  const history =
    historyResult.status === "fulfilled" ? historyResult.value : [];
  const digest =
    newsResult.status === "fulfilled"
      ? newsResult.value.digests[0]?.digest
      : undefined;
  const run = newsResult.status === "fulfilled" ? newsResult.value.run : null;
  const now = new Date();
  const stale =
    !date && isReportDue(now) && (!run || run.report_date !== osloDate(now));
  const latest = history[0];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-teal-700">
        ← Tilbake til oversikten
      </Link>
      <header className="my-8">
        <p className="eyebrow">{symbol} · OSLO BØRS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {stock.name}
        </h1>
      </header>
      {latest && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Sluttkurs (NOK)", value: latest.close.toFixed(2) },
            {
              label: "Endring",
              value:
                latest.change_pct == null
                  ? "–"
                  : `${latest.change_pct > 0 ? "+" : ""}${latest.change_pct.toFixed(2)} %`,
            },
            { label: "Volum", value: latest.volume.toLocaleString("nb-NO") },
            { label: "Handelsdato", value: latest.date },
          ].map((stat) => (
            <div className="panel p-5" key={stat.label}>
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-3 text-xl font-semibold tabular-nums">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}
      <SocialSearch stocks={[stock]} />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <section aria-labelledby="stock-news">
          <h2 id="stock-news" className="mb-4 text-lg font-semibold">
            Siste nyhetsrapport{run ? ` · ${run.report_date}` : ""}
          </h2>
          {stale && (
            <p className="notice mb-4">Dagens nyhetsrapport er ikke klar.</p>
          )}
          {run?.status === "failed" && (
            <p className="notice mb-4">
              Siste innhenting feilet. Nyhetsbildet kan være ufullstendig.
            </p>
          )}
          {run?.status === "running" && (
            <p className="notice mb-4">
              {Date.parse(run.lease_until) < now.getTime()
                ? "Siste innhenting ble avbrutt."
                : "Agenten henter nyheter. Rapporten er ikke ferdig ennå."}
            </p>
          )}
          {digest ? (
            <DigestCard digest={digest} redditPage={redditPage} />
          ) : (
            <div className="panel p-6 text-sm text-slate-500">
              {newsResult.status === "rejected"
                ? "Nyhetsarkivet er foreløpig utilgjengelig."
                : "Ingen nyhetsrapport er lagret for denne aksjen ennå."}
            </div>
          )}
        </section>
        <section aria-labelledby="stock-history">
          <h2 id="stock-history" className="mb-4 text-lg font-semibold">
            Kurshistorikk
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Siste tilgjengelige handelsdager. Sluttkurser, ikke sanntidsdata.
          </p>
          {history.length >= 2 && (
            <Suspense
              fallback={
                <p
                  role="status"
                  className="panel mb-5 p-5 text-sm text-slate-500"
                >
                  Lager teknisk oppsummering …
                </p>
              }
            >
              <HistorySummary
                symbol={symbol}
                name={stock.name}
                history={history}
              />
            </Suspense>
          )}
          {history.length ? (
            <div className="panel overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Dato</th>
                    <th className="px-4 py-3 text-right">Sluttkurs</th>
                    <th className="px-4 py-3 text-right">Endring</th>
                    <th className="px-4 py-3 text-right">Volum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{row.date}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {row.close.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${row.change_pct && row.change_pct > 0 ? "text-teal-700" : row.change_pct && row.change_pct < 0 ? "text-rose-600" : "text-slate-500"}`}
                      >
                        {row.change_pct == null
                          ? "–"
                          : `${row.change_pct > 0 ? "+" : ""}${row.change_pct.toFixed(2)} %`}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {row.volume.toLocaleString("nb-NO")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="panel p-6 text-sm text-slate-500">
              Kursdata er ikke tilgjengelige akkurat nå.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

async function HistorySummary({
  symbol,
  name,
  history,
}: {
  symbol: string;
  name: string;
  history: HistoricalRow[];
}) {
  // AI-kallet ligger innenfor sin egen Suspense-grense, slik at nyheter og
  // kurstabellen kan vises mens oppsummeringen fortsatt lages.
  const summary = await generateHistoryReport(symbol, name, history).catch(
    () => null,
  );
  return (
    <div className="panel mb-5 p-5">
      <h3 className="mb-2 text-sm font-semibold">Teknisk oppsummering</h3>
      <p className="text-sm leading-7 text-slate-600">
        {summary ?? "Den tekniske oppsummeringen er midlertidig utilgjengelig."}
      </p>
      {summary && (
        <p className="mt-3 text-xs text-slate-400">
          AI-generert fra kurshistorikk.
        </p>
      )}
    </div>
  );
}
