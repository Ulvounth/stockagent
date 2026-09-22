import Link from "next/link";
import { connection } from "next/server";
import { fetchAllStocks } from "@/lib/eodhd";
import { listReportDates, readDailyNews } from "@/lib/daily-news";
import { WATCHLIST } from "@/lib/watchlist";
import { formatOsloTime, isReportDue, osloDate } from "@/lib/schedule";
import { DigestCard } from "./components/digest-card";
import { SocialSearch } from "./components/social-search";
import { reportDate, type QueryValue } from "@/lib/report-query";

type Props = {
  searchParams: Promise<{ symbol?: QueryValue; date?: QueryValue }>;
};

export default async function Home({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const symbol =
    typeof params.symbol === "string" &&
    WATCHLIST.some((stock) => stock.symbol === params.symbol)
      ? params.symbol
      : undefined;
  const date = reportDate(params.date);
  const [newsResult, pricesResult, datesResult] = await Promise.allSettled([
    readDailyNews(symbol, date),
    fetchAllStocks(),
    listReportDates(),
  ]);
  const { run, digests } =
    newsResult.status === "fulfilled"
      ? newsResult.value
      : { run: null, digests: [] };
  const stocks = pricesResult.status === "fulfilled" ? pricesResult.value : [];
  const dates = datesResult.status === "fulfilled" ? datesResult.value : [];
  const articles = digests.flatMap((row) => row.digest.articles);
  const rumors = articles.filter((article) => article.kind === "rumor").length;
  const now = new Date();
  const stale =
    !date && isReportDue(now) && (!run || run.report_date !== osloDate(now));
  const interrupted =
    run?.status === "running" &&
    new Date(run.lease_until).getTime() < now.getTime();
  const status = interrupted
    ? "Kjøringen ble avbrutt"
    : run?.status === "completed"
      ? "Innhenting fullført"
      : run?.status === "partial"
        ? "Delvis innhentet"
        : run?.status === "failed"
          ? "Innhenting feilet"
          : run?.status === "running"
            ? "Agenten jobber"
            : "Venter på første rapport";

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow">DIN DAGLIGE MARKEDSOVERSIKT</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Hva skjer med aksjene dine?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Nyheter, selskapsmeldinger og omtale av selskapene du følger. Samlet
            på ett sted, med kildene ett klikk unna.
          </p>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-teal-50 px-5 py-4">
          <p className="text-xs font-medium text-teal-800">
            PLANLAGT INNHENTING
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-teal-950">
            09.00{" "}
            <span className="text-xs font-normal text-teal-700">
              hver dag · norsk tid
            </span>
          </p>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Aksjer på listen",
            value: WATCHLIST.length.toString(),
            detail: "Din overvåkingsliste",
          },
          {
            label: "Nyhetstreff",
            value: articles.length.toString(),
            detail: symbol ? "For valgt aksje" : "I valgt rapport",
          },
          {
            label: "Mulige rykter",
            value: rumors.toString(),
            detail: "Merket som ubekreftet",
          },
          {
            label: "Siste rapport",
            value: run?.report_date ?? "Ikke kjørt",
            detail: status,
          },
        ].map((stat) => (
          <div className="panel p-5" key={stat.label}>
            <p className="text-xs text-slate-500">{stat.label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight">
              {stat.value}
            </p>
            <p className="mt-2 text-xs text-slate-400">{stat.detail}</p>
          </div>
        ))}
      </div>

      <section aria-labelledby="news-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">MORGENRAPPORTEN</p>
            <h2 id="news-heading" className="mt-2 text-xl font-semibold">
              Nyheter fra overvåkingslisten
            </h2>
          </div>
          <form className="flex items-center gap-2">
            <label htmlFor="report-date" className="text-xs text-slate-500">
              Arkiv
            </label>
            <select
              id="report-date"
              name="date"
              defaultValue={date ?? ""}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Siste rapport</option>
              {dates.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
            {symbol && <input type="hidden" name="symbol" value={symbol} />}
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              type="submit"
            >
              Vis
            </button>
          </form>
        </div>
        <nav
          aria-label="Filtrer nyheter etter aksje"
          className="mb-5 flex flex-wrap gap-2"
        >
          {[{ symbol: "", name: "Alle aksjer" }, ...WATCHLIST].map((stock) => {
            const query = new URLSearchParams();
            if (stock.symbol) query.set("symbol", stock.symbol);
            if (date) query.set("date", date);
            const selected = (symbol ?? "") === stock.symbol;
            return (
              <Link
                key={stock.symbol}
                href={query.size ? `/?${query}` : "/"}
                aria-current={selected ? "page" : undefined}
                className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${selected ? "border-teal-800 bg-teal-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-teal-600"}`}
              >
                {stock.name}
              </Link>
            );
          })}
        </nav>

        {newsResult.status === "rejected" ? (
          <div className="panel p-8">
            <h3 className="font-semibold">
              Nyhetsarkivet er ikke tilgjengelig ennå
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Den daglige jobben må kobles til databasen før rapportene kan
              vises her. Oppsettet er beskrevet i prosjektets README.
            </p>
          </div>
        ) : (
          <>
            {stale && (
              <p className="notice mb-4" role="status">
                Dagens rapport er ikke klar.{" "}
                {run
                  ? "Du ser den sist lagrede rapporten."
                  : "Ingen rapport er lagret ennå."}
              </p>
            )}
            {run && (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span
                  className={`h-2 w-2 rounded-full ${run.status === "completed" ? "bg-teal-500" : "bg-amber-500"}`}
                  aria-hidden="true"
                />
                <span>{status}</span>
                {run.finished_at && (
                  <span>· {formatOsloTime(run.finished_at)}</span>
                )}
                {run.error && <span>· {run.error}</span>}
              </div>
            )}
            {digests.length ? (
              <div className="grid items-start gap-5 lg:grid-cols-2">
                {digests.map((row) => (
                  <DigestCard key={row.symbol} digest={row.digest} />
                ))}
              </div>
            ) : (
              <div className="panel p-8 text-center">
                <p className="text-lg font-semibold">
                  {run?.status === "running"
                    ? "Rapporten utarbeides"
                    : "Ingen rapport å vise ennå"}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {date
                    ? "Velg en annen dato i arkivet."
                    : "Når den første innhentingen er fullført, vises en egen nyhetsoversikt for hver aksje her."}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <SocialSearch
        stocks={
          symbol
            ? WATCHLIST.filter((stock) => stock.symbol === symbol)
            : WATCHLIST
        }
      />

      <section className="mt-12" aria-labelledby="prices-heading">
        <div className="mb-5">
          <p className="eyebrow">KURSOVERSIKT</p>
          <h2 id="prices-heading" className="mt-2 text-xl font-semibold">
            Siste sluttkurser
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Siste tilgjengelige handelsdag fra EODHD. Dette er ikke
            sanntidskurser og følger ikke datoen i nyhetsarkivet.
          </p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-4">Selskap</th>
                <th className="px-4 py-4">Dato</th>
                <th className="px-4 py-4 text-right">Sluttkurs (NOK)</th>
                <th className="px-4 py-4 text-right">Endring</th>
                <th className="px-5 py-4 text-right">Volum / snitt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {WATCHLIST.map((watched) => {
                const stock = stocks.find(
                  (item) => item.symbol === watched.symbol,
                );
                return (
                  <tr key={watched.symbol} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <Link
                        href={`/stocks/${watched.symbol}`}
                        className="font-medium hover:text-teal-700"
                      >
                        {watched.name}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-slate-400">
                        {watched.symbol}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      {stock?.date ?? "Ikke tilgjengelig"}
                    </td>
                    <td className="px-4 py-4 text-right font-medium tabular-nums">
                      {stock?.close.toLocaleString("nb-NO", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }) ?? "–"}
                    </td>
                    <td
                      className={`px-4 py-4 text-right tabular-nums ${stock?.change_pct != null && stock.change_pct > 0 ? "text-teal-700" : stock?.change_pct != null && stock.change_pct < 0 ? "text-rose-600" : "text-slate-500"}`}
                    >
                      {stock?.change_pct != null
                        ? `${stock.change_pct > 0 ? "+" : ""}${stock.change_pct.toFixed(2)} %`
                        : "–"}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-500">
                      {stock?.vol_ratio != null
                        ? `${stock.vol_ratio.toFixed(2)} ×`
                        : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
