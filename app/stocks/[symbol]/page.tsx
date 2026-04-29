import Link from "next/link";
import { fetchHistory, fetchNews } from "@/lib/eodhd";
import { generateHistoryReport } from "@/lib/ai";
import { WATCHLIST } from "@/lib/watchlist";
import { HistoricalRow, NewsItem } from "@/lib/types";

type Props = {
  params: Promise<{ symbol: string }>;
};

export function generateStaticParams() {
  return WATCHLIST.map(({ symbol }) => ({
    symbol: encodeURIComponent(symbol),
  }));
}

function formatChangePct(pct: number | null): string {
  if (pct === null) return "–";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)} %`;
}

function changePctClass(pct: number | null): string {
  if (pct === null) return "text-gray-400";
  if (pct >= 5) return "text-green-700 font-bold";
  if (pct > 0) return "text-green-600";
  if (pct <= -5) return "text-red-700 font-bold";
  return "text-red-500";
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const decodedSymbol = decodeURIComponent(symbol);

  const stockInfo = WATCHLIST.find((s) => s.symbol === decodedSymbol);

  let history: HistoricalRow[] = [];
  let news: NewsItem[] = [];
  let aiSummary: string | null = null;
  let errorMessage: string | null = null;

  try {
    // Historikk og nyheter hentes parallelt — begge er uavhengige av hverandre
    [history, news] = await Promise.all([
      fetchHistory(decodedSymbol, 30),
      fetchNews(decodedSymbol, stockInfo?.name ?? decodedSymbol, 5),
    ]);
    aiSummary = await generateHistoryReport(
      decodedSymbol,
      stockInfo?.name ?? decodedSymbol,
      history,
      news,
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Ukjent feil";
  }

  const latest = history[0];

  return (
    <main className="min-h-screen p-8 max-w-6xl">
      <Link
        href="/"
        className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-block"
      >
        ← Tilbake til oversikt
      </Link>

      <h1 className="text-2xl font-bold mb-1">
        {stockInfo?.name ?? decodedSymbol}
      </h1>
      <p className="text-gray-400 font-mono text-sm mb-6">{decodedSymbol}</p>

      {latest && (
        <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
          <Stat label="Siste kurs" value={latest.close.toFixed(2)} />
          <Stat label="Åpning" value={latest.open.toFixed(2)} />
          <Stat label="Høy" value={latest.high.toFixed(2)} />
          <Stat label="Lav" value={latest.low.toFixed(2)} />
        </div>
      )}

      {errorMessage ? (
        <p className="text-red-600 bg-red-50 p-4 rounded">{errorMessage}</p>
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Venstre: historikk-tabell */}
          <div className="flex-1 overflow-x-auto">
            <h2 className="text-base font-semibold text-gray-700 mb-3">
              Historikk – siste 30 handelsdager
            </h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Dato</th>
                  <th className="py-2 pr-4 text-right">Kurs</th>
                  <th className="py-2 pr-4 text-right">Endring</th>
                  <th className="py-2 pr-4 text-right">Høy</th>
                  <th className="py-2 pr-4 text-right">Lav</th>
                  <th className="py-2 text-right">Volum</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.date} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-500">{row.date}</td>
                    <td className="py-2 pr-4 text-right font-medium">
                      {row.close.toFixed(2)}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right ${changePctClass(row.change_pct)}`}
                    >
                      {formatChangePct(row.change_pct)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {row.high.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {row.low.toFixed(2)}
                    </td>
                    <td className="py-2 text-right text-gray-600">
                      {row.volume.toLocaleString("nb-NO")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Høyre: AI-oppsummering */}
          {aiSummary && (
            <div className="lg:w-72 xl:w-80 shrink-0">
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                AI-oppsummering
              </h2>
              <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-600 leading-relaxed">
                {aiSummary}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Nyheter */}
      {news.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            Siste nyheter
          </h2>
          <ul className="space-y-3">
            {news.map((item, i) => (
              <li
                key={i}
                className="border border-gray-100 rounded p-3 hover:bg-gray-50"
              >
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-700 hover:underline leading-snug"
                >
                  {item.title}
                </a>
                <p className="text-xs text-gray-400 mt-1">
                  {item.date}
                  {item.source && <span className="ml-2 text-gray-300">·</span>}
                  {item.source && <span className="ml-2">{item.source}</span>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded p-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
