import { cacheLife } from "next/cache";
import { StockWithChange, HistoricalRow, NewsItem } from "./types";
import { WATCHLIST } from "./watchlist";

const BASE_URL = "https://eodhd.com/api/eod";

/**
 * Henter de 21 siste handelsdagene for ett aksjesymbol.
 * Dag 0 = i dag, dag 1-20 brukes til snittvolum-beregning.
 * Returnerer null hvis kallet feiler eller data mangler.
 */
async function fetchEodForSymbol(
  symbol: string,
  apiKey: string,
): Promise<Omit<StockWithChange, "name"> | null> {
  const url = `${BASE_URL}/${symbol}?api_token=${apiKey}&fmt=json&order=d&limit=21`;

  const res = await fetch(url);

  if (!res.ok) {
    console.error(`EODHD feil for ${symbol}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const today = data[0];
  const yesterday = data[1];

  if (!today) return null;

  const prev_close = yesterday?.close ?? null;
  const change_pct =
    prev_close !== null
      ? ((today.close - prev_close) / prev_close) * 100
      : null;

  // Snittvolum beregnes fra dag 1–20 (ikke dagens dag)
  const prevDays: typeof data = data.slice(1);
  const avg_volume =
    prevDays.length > 0
      ? prevDays.reduce(
          (sum: number, d: { volume: number }) => sum + d.volume,
          0,
        ) / prevDays.length
      : null;

  const vol_ratio =
    avg_volume !== null && avg_volume > 0 ? today.volume / avg_volume : null;

  return {
    symbol,
    date: today.date,
    open: today.open,
    high: today.high,
    low: today.low,
    close: today.close,
    adjusted_close: today.adjusted_close,
    volume: today.volume,
    prev_close,
    change_pct,
    avg_volume,
    vol_ratio,
  };
}

/**
 * Henter EOD-data for alle aksjer i watchlisten.
 */
export async function fetchAllStocks(): Promise<StockWithChange[]> {
  "use cache";
  cacheLife("hours");

  const apiKey = process.env.EODHD_API_KEY;

  if (!apiKey) {
    throw new Error("EODHD_API_KEY mangler i .env.local");
  }

  const results = await Promise.all(
    WATCHLIST.map(async ({ symbol, name }) => {
      const quote = await fetchEodForSymbol(symbol, apiKey);
      if (!quote) return null;
      return { ...quote, name };
    }),
  );

  return results.filter((r): r is StockWithChange => r !== null);
}

/**
 * Henter de siste `days` handelsdagene for ett symbol.
 * Beregner prosentendring dag for dag.
 */
export async function fetchHistory(
  symbol: string,
  days: number = 30,
): Promise<HistoricalRow[]> {
  "use cache";
  cacheLife("hours");

  const apiKey = process.env.EODHD_API_KEY;

  if (!apiKey) {
    throw new Error("EODHD_API_KEY mangler i .env.local");
  }

  // Hent én ekstra dag slik at vi kan beregne endring for den eldste dagen også
  const url = `${BASE_URL}/${symbol}?api_token=${apiKey}&fmt=json&order=d&limit=${days + 1}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`EODHD feil for ${symbol}: ${res.status}`);
  }

  const data = await res.json();

  // Bygg opp radene med endring fra dagen før
  return data
    .slice(0, days)
    .map(
      (
        day: {
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        },
        index: number,
      ) => {
        const prevClose = data[index + 1]?.close ?? null;
        const change_pct =
          prevClose !== null
            ? ((day.close - prevClose) / prevClose) * 100
            : null;

        return {
          date: day.date,
          open: day.open,
          high: day.high,
          low: day.low,
          close: day.close,
          volume: day.volume,
          change_pct,
        };
      },
    );
}

/**
 * Henter siste nyheter for et selskap via Google News RSS.
 * Returnerer norske finansnyheter fra Finansavisen, E24, DN osv.
 */
export async function fetchNews(
  symbol: string,
  name: string,
  limit: number = 5,
): Promise<NewsItem[]> {
  "use cache";
  cacheLife("hours");

  const query = encodeURIComponent(name);
  const url = `https://news.google.com/rss/search?q=${query}&hl=nb&gl=NO&ceid=NO:nb`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAgent/1.0)" },
  });

  if (!res.ok) {
    console.error(`Google News feil for ${name}: ${res.status}`);
    return [];
  }

  const xml = await res.text();
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];

    const titleRaw =
      /<title>([\s\S]*?)<\/title>/.exec(block)?.[1]?.trim() ?? "";
    const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim() ?? "";
    const pubDate =
      /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? "";
    const source =
      /<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1]?.trim() ?? "";

    // Google News-titler har formatet "OVERSKRIFT - Kilde" — vi klipper kilden fra slutten
    const title = source
      ? titleRaw
          .replace(
            new RegExp(
              `\\s*-\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            ),
            "",
          )
          .trim()
      : titleRaw;

    const date = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "";

    if (title) {
      items.push({ date, title, link, content: "", source });
    }
  }

  return items;
}
