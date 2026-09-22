import "server-only";
import { cacheLife } from "next/cache";
import type { StockWithChange, HistoricalRow } from "./types";
import { WATCHLIST } from "./watchlist";

type EodRow = Omit<HistoricalRow, "change_pct"> & { adjusted_close: number };

async function fetchRows(symbol: string, days: number): Promise<EodRow[]> {
  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey) throw new Error("Kursdata er ikke konfigurert.");
  const url = new URL(
    `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`,
  );
  // EOD-endepunktet har ingen limit-parameter. Begrens både dato og antall rader.
  const from = new Date(Date.now() - (days * 2 + 14) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  url.search = new URLSearchParams({
    api_token: apiKey,
    fmt: "json",
    order: "d",
    from,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok)
    throw new Error(
      `Kursdata for ${symbol} er utilgjengelige (HTTP ${res.status}).`,
    );
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error(`Ugyldige kursdata for ${symbol}.`);
  return data
    .filter(
      (row): row is EodRow =>
        typeof row?.date === "string" &&
        [row.open, row.high, row.low, row.close, row.volume].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
}

async function fetchStock(
  symbol: string,
  name: string,
): Promise<StockWithChange | null> {
  // Kursene ligger utenfor det prerenderte skallet, så et rent "use cache"
  // holder bare i minnet til én instans. Serverless gir da et nytt EODHD-kall
  // per sidevisning. Remote-cachen deles mellom instansene og holder forbruket
  // innenfor dagskvoten. Uten konfigurert handler faller den tilbake til minne.
  "use cache: remote";
  cacheLife("hours");
  const rows = await fetchRows(symbol, 21);
  const today = rows[0];
  if (!today) return null;
  const prev_close = rows[1]?.close ?? null;
  const previous = rows.slice(1, 21);
  const avg_volume = previous.length
    ? previous.reduce((sum, row) => sum + row.volume, 0) / previous.length
    : null;
  return {
    ...today,
    adjusted_close: today.adjusted_close ?? today.close,
    symbol,
    name,
    prev_close,
    avg_volume,
    change_pct:
      prev_close && prev_close > 0
        ? ((today.close - prev_close) / prev_close) * 100
        : null,
    vol_ratio: avg_volume && avg_volume > 0 ? today.volume / avg_volume : null,
  };
}

export async function fetchAllStocks(): Promise<StockWithChange[]> {
  // Cache vellykkede kurser per aksje. En midlertidig feil skal ikke bli til
  // en vellykket, ufullstendig liste som blir liggende i timescachen.
  const results = await Promise.allSettled(
    WATCHLIST.map(({ symbol, name }) => fetchStock(symbol, name)),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}

export async function fetchHistory(
  symbol: string,
  days = 30,
): Promise<HistoricalRow[]> {
  "use cache: remote";
  cacheLife("hours");
  const rows = await fetchRows(symbol, days + 1);
  return rows.slice(0, days).map((row, index) => {
    const prev = rows[index + 1]?.close;
    return {
      ...row,
      change_pct: prev && prev > 0 ? ((row.close - prev) / prev) * 100 : null,
    };
  });
}
