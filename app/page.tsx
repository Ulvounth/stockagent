import Link from "next/link";
import { fetchAllStocks } from "@/lib/eodhd";
import { generateReport } from "@/lib/ai";
import { StockWithChange } from "@/lib/types";

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

function rowHighlightClass(stock: StockWithChange): string {
  if (stock.change_pct !== null && Math.abs(stock.change_pct) >= 5) {
    return stock.change_pct >= 0 ? "bg-green-50" : "bg-red-50";
  }
  return "hover:bg-gray-50";
}

function volumeSignal(
  ratio: number | null,
): { label: string; className: string } | null {
  if (ratio === null) return null;
  if (ratio >= 1.5)
    return { label: "↑↑ Høyt", className: "text-orange-600 font-semibold" };
  if (ratio <= 0.7) return { label: "↓ Lav", className: "text-gray-400" };
  return null;
}

export default async function Home() {
  let stocks: StockWithChange[] = [];
  let report: string | null = null;
  let errorMessage: string | null = null;

  try {
    stocks = await fetchAllStocks();
    // AI-rapport feiler ikke hele siden – vises bare ikke hvis noe går galt
    report = await generateReport(stocks).catch(() => null);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Ukjent feil";
  }

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-1">StockAgent</h1>
      <p className="text-gray-500 mb-6">Aksjeovervåking for Oslo Børs</p>

      {errorMessage ? (
        <p className="text-red-600 bg-red-50 p-4 rounded">{errorMessage}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Navn</th>
                  <th className="py-2 pr-4">Dato</th>
                  <th className="py-2 pr-4 text-right">Siste kurs</th>
                  <th className="py-2 pr-4 text-right">Endring</th>
                  <th className="py-2 pr-4 text-right">Åpning</th>
                  <th className="py-2 pr-4 text-right">Høy</th>
                  <th className="py-2 pr-4 text-right">Lav</th>
                  <th className="py-2 pr-4 text-right">Volum</th>
                  <th className="py-2 text-right">Volum-signal</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr
                    key={stock.symbol}
                    className={`border-b ${rowHighlightClass(stock)}`}
                  >
                    <td className="py-2 pr-4 font-mono font-medium">
                      <Link
                        href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                        className="hover:underline text-blue-700"
                      >
                        {stock.symbol}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                        className="hover:underline"
                      >
                        {stock.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{stock.date}</td>
                    <td className="py-2 pr-4 text-right font-medium">
                      {stock.close.toFixed(2)}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right ${changePctClass(stock.change_pct)}`}
                    >
                      {formatChangePct(stock.change_pct)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {stock.open.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {stock.high.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {stock.low.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">
                      {stock.volume.toLocaleString("nb-NO")}
                    </td>
                    <td className="py-2 text-right">
                      {(() => {
                        const sig = volumeSignal(stock.vol_ratio);
                        return sig ? (
                          <span className={sig.className}>{sig.label}</span>
                        ) : (
                          <span className="text-gray-300">–</span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stocks.length === 0 && (
              <p className="text-gray-400 mt-4">Ingen data tilgjengelig.</p>
            )}
          </div>

          {report && (
            <div className="mt-8 max-w-2xl">
              <h2 className="text-base font-semibold mb-2 text-gray-700">
                AI-oppsummering
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 border border-gray-200 rounded p-4">
                {report}
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
