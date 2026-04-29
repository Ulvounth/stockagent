import Groq from "groq-sdk";
import { cacheLife } from "next/cache";
import { StockWithChange, HistoricalRow, NewsItem } from "./types";

/**
 * Bygger en lesbar tekstblokk av aksjedata som sendes til AI-en.
 * Jo bedre input, jo bedre rapport.
 */
function buildPrompt(stocks: StockWithChange[]): string {
  const lines = stocks.map((s) => {
    const change =
      s.change_pct !== null ? `${s.change_pct.toFixed(2)}%` : "ukjent";
    const volSignal =
      s.vol_ratio !== null
        ? s.vol_ratio >= 1.5
          ? "høyt volum"
          : s.vol_ratio <= 0.7
            ? "lavt volum"
            : "normalt volum"
        : "ukjent volum";

    return `- ${s.name} (${s.symbol}): kurs ${s.close}, endring ${change}, ${volSignal} (ratio: ${s.vol_ratio?.toFixed(2) ?? "–"})`;
  });

  return `
Du er en nøktern aksjeanalytiker. Her er dagens EOD-data fra Oslo Børs:

${lines.join("\n")}

Skriv en kort daglig oppsummering på norsk (3–5 setninger). 
- Fremhev aksjer med uvanlig kurs- eller volumutvikling.
- Pek på hva som kan være verdt å følge med på.
- Ikke gi kjøps- eller salgsanbefalinger.
- Bruk nøkterne formuleringer som "dette kan indikere", "det kan være verdt å sjekke" osv.
- Ikke bruk markdown, bare ren tekst.
`.trim();
}

/**
 * Henter en AI-generert daglig rapport basert på aksjedata.
 */
export async function generateReport(
  stocks: StockWithChange[],
): Promise<string> {
  "use cache";
  cacheLife("hours");

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY mangler i .env.local");
  }

  const groq = new Groq({ apiKey });

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "user",
          content: buildPrompt(stocks),
        },
      ],
      max_tokens: 400,
      temperature: 0.4,
    });

    return (
      completion.choices[0]?.message?.content ?? "Ingen rapport tilgjengelig."
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("rate_limit_exceeded")
    ) {
      return "AI-rapporten er midlertidig utilgjengelig (for mange forespørsler). Prøv igjen om litt.";
    }
    throw error;
  }
}

/**
 * Beregner enkelt glidende snitt (SMA) for de første `period` dagene i listen.
 * History er sortert nyest først, så vi bruker slice(0, period).
 */
function sma(history: HistoricalRow[], period: number): number | null {
  const slice = history.slice(0, period);
  if (slice.length < period) return null;
  return slice.reduce((sum, row) => sum + row.close, 0) / period;
}

/**
 * Bygger en prompt basert på 30 dagers historikk for én aksje.
 * Tekniske indikatorer beregnes i koden – ikke av AI-en.
 */
function buildHistoryPrompt(
  symbol: string,
  name: string,
  history: HistoricalRow[],
  news: NewsItem[],
): string {
  // --- Tekniske indikatorer ---
  const closes = history.map((r) => r.close);
  const highs = history.map((r) => r.high);
  const lows = history.map((r) => r.low);

  const sma10 = sma(history, 10);
  const sma20 = sma(history, 20);
  const currentClose = closes[0];

  // Motstand = høyeste high siste 30 dager (unntatt siste dag)
  const resistance = Math.max(...highs.slice(1));
  // Støtte = laveste low siste 30 dager (unntatt siste dag)
  const support = Math.min(...lows.slice(1));

  // Antall dager på rad med oppgang eller nedgang
  let streak = 0;
  let streakDir: "opp" | "ned" | "flat" = "flat";
  for (let i = 0; i < closes.length - 1; i++) {
    if (closes[i] > closes[i + 1]) {
      if (i === 0 || streakDir === "opp") {
        streakDir = "opp";
        streak++;
      } else break;
    } else if (closes[i] < closes[i + 1]) {
      if (i === 0 || streakDir === "ned") {
        streakDir = "ned";
        streak++;
      } else break;
    } else break;
  }

  const technicalSummary = `
Tekniske indikatorer (beregnet):
- Siste kurs: ${currentClose}
- 10-dagers glidende snitt (SMA10): ${sma10?.toFixed(2) ?? "ikke nok data"}
- 20-dagers glidende snitt (SMA20): ${sma20?.toFixed(2) ?? "ikke nok data"}
- Kurs vs SMA10: ${sma10 ? (currentClose > sma10 ? "over" : "under") : "ukjent"}
- Kurs vs SMA20: ${sma20 ? (currentClose > sma20 ? "over" : "under") : "ukjent"}
- Motstandsnivå (30d høy): ${resistance.toFixed(2)}
- Støttenivå (30d lav): ${support.toFixed(2)}
- Avstand til motstand: ${(((resistance - currentClose) / currentClose) * 100).toFixed(1)}%
- Avstand til støtte: ${(((currentClose - support) / currentClose) * 100).toFixed(1)}%
- Momentum: ${streak} dager på rad ${streakDir === "flat" ? "uten klar retning" : streakDir}
`.trim();

  const lines = history.map((row) => {
    const change =
      row.change_pct !== null ? `${row.change_pct.toFixed(2)}%` : "–";
    return `${row.date}: kurs ${row.close}, endring ${change}, volum ${row.volume.toLocaleString("nb-NO")}`;
  });

  const newsSection =
    news.length > 0
      ? `\nSiste nyheter (titler):\n${news.map((n) => `- [${n.date}] ${n.title}`).join("\n")}`
      : "";

  return `
Du er en nøktern teknisk aksjeanalytiker. Her er data for ${name} (${symbol}):

${technicalSummary}${newsSection}

Daglige data (nyest først):
${lines.join("\n")}

Skriv en teknisk analyse på norsk (5–8 setninger). Inkluder:
1. Overordnet trend siste 30 dager
2. Hva SMA10 og SMA20 indikerer om momentum
3. Kommentar om støtte- og motstandsnivåene
4. Eventuelle dager med uvanlig bevegelse eller volum
5. Hva som kan være verdt å følge med på videre

Regler:
- Ingen kjøps- eller salgsanbefalinger
- Bruk nøkterne formuleringer som "dette kan indikere", "det kan være verdt å sjekke", "kursen har nærmet seg"
- Forklar fagbegreper enkelt første gang de brukes
- Ren tekst, ingen markdown
${
  news.length > 0
    ? `
Om du ser relevante koblinger mellom nyhetene og kursutviklingen, nevn dette kort.`
    : ""
}
`.trim();
}

/**
 * Henter en AI-generert oppsummering av historikken for én aksje.
 */
export async function generateHistoryReport(
  symbol: string,
  name: string,
  history: HistoricalRow[],
  news: NewsItem[] = [],
): Promise<string> {
  "use cache";
  cacheLife("hours");

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY mangler i .env.local");
  }

  const groq = new Groq({ apiKey });

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "user",
          content: buildHistoryPrompt(symbol, name, history, news),
        },
      ],
      max_tokens: 700,
      temperature: 0.4,
    });

    return (
      completion.choices[0]?.message?.content ??
      "Ingen oppsummering tilgjengelig."
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("rate_limit_exceeded")
    ) {
      return "AI-analysen er midlertidig utilgjengelig (for mange forespørsler). Prøv igjen om litt.";
    }
    throw error;
  }
}
