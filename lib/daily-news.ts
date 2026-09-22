import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import { WATCHLIST } from "./watchlist";
import { collectNews, mergeArticles } from "./news";
import { summarizeNews } from "./news-summary";
import { collectReddit } from "./reddit";
import { newsWindow, osloDate } from "./schedule";
import type { DailyRun, DigestRow, StockDigest } from "./daily-types";

export async function readDailyNews(
  symbol?: string,
  date?: string,
): Promise<{ run: DailyRun | null; digests: DigestRow[] }> {
  const db = getSupabaseAdmin();
  let runQuery = db
    .from("daily_news_runs")
    .select("report_date,status,started_at,finished_at,lease_until,error")
    .order("report_date", { ascending: false })
    .limit(1);
  if (date) runQuery = runQuery.eq("report_date", date);
  const { data: run, error } = await runQuery.maybeSingle();
  if (error)
    throw new Error(
      "Daglige nyheter er ikke tilgjengelige. Kontroller databaseoppsettet i README.",
    );
  if (!run) return { run: null, digests: [] };
  let query = db
    .from("stock_news_digests")
    .select("report_date,symbol,checked_at,digest")
    .eq("report_date", run.report_date)
    .order("symbol");
  if (symbol) query = query.eq("symbol", symbol);
  const result = await query;
  if (result.error) throw new Error("Kunne ikke lese lagrede nyhetsrapporter.");
  return { run: run as DailyRun, digests: (result.data ?? []) as DigestRow[] };
}

export async function listReportDates(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_news_runs")
    .select("report_date")
    .order("report_date", { ascending: false })
    .limit(30);
  if (error) throw new Error("Kunne ikke lese rapportarkivet.");
  return (data ?? []).map((row) => row.report_date as string);
}

export async function runDailyNews(now = new Date()) {
  const db = getSupabaseAdmin();
  const date = osloDate(now);
  const runId = randomUUID();
  const { data: claimed, error: claimError } = await db.rpc(
    "claim_daily_news",
    { p_date: date, p_run_id: runId },
  );
  if (claimError)
    throw new Error(
      "Kunne ikke starte nyhetsjobben. Kontroller at databasemigrasjonen er kjørt.",
    );
  if (!claimed) {
    const { run } = await readDailyNews(undefined, date);
    return {
      date,
      status: run?.status ?? "running",
      skipped: true,
      stocks: 0,
      articles: 0,
      discussions: 0,
    };
  }
  try {
    // Les først etter at låsen er tatt. Slå sammen før oppsummeringen lages;
    // ellers kan nye kildefeil eller et kortere RSS-svar slette dagens treff.
    const { data: savedRows, error: savedError } = await db
      .from("stock_news_digests")
      .select("symbol,digest")
      .eq("report_date", date);
    if (savedError)
      throw new Error("Kunne ikke lese dagens tidligere resultater.");
    const savedDigests = new Map(
      ((savedRows ?? []) as Pick<DigestRow, "symbol" | "digest">[]).map(
        (row) => [row.symbol, row.digest],
      ),
    );
    // Bruk kun tidligere dager som vannmerke. Gjentakelse av en delvis kjøring
    // skal hente hele dagens vindu, ikke erstatte rapporten med bare nye minutter.
    const coverageResults = await Promise.all(
      WATCHLIST.map(async (stock) => {
        const results = await Promise.all(
          (["coverage_end", "reddit_coverage_end"] as const).map((column) =>
            db
              .from("stock_news_digests")
              .select(`end:${column}`)
              .eq("symbol", stock.symbol)
              .lt("report_date", date)
              .not(column, "is", null)
              .order(column, { ascending: false })
              .limit(1)
              .maybeSingle(),
          ),
        );
        if (results.some((result) => result.error))
          throw new Error(
            "Kunne ikke lese forrige innhenting. Kontroller at alle databasemigrasjonene er kjørt.",
          );
        return {
          symbol: stock.symbol,
          newsEnd: results[0].data?.end as string | undefined,
          redditEnd: results[1].data?.end as string | undefined,
        };
      }),
    );
    const coverage = new Map(
      coverageResults.map((item) => [item.symbol, item]),
    );
    const digests: StockDigest[] = [];
    // Små puljer unngår et stort antall samtidige kilde- og AI-kall.
    for (let offset = 0; offset < WATCHLIST.length; offset += 3) {
      const batch = await Promise.all(
        WATCHLIST.slice(offset, offset + 3).map(
          async (stock): Promise<StockDigest> => {
            const previous = coverage.get(stock.symbol);
            const saved = savedDigests.get(stock.symbol);
            const window = newsWindow(now, previous?.newsEnd);
            const redditWindow = newsWindow(now, previous?.redditEnd);
            // Første gangs 48-timersvindu skal ikke krympe når klokken går
            // mellom forsøkene. Rapportens tidsrom må også dekke beholdte treff.
            if (
              saved &&
              Date.parse(saved.windowStart) < Date.parse(window.from)
            )
              window.from = saved.windowStart;
            const savedRedditStart =
              saved?.redditWindowStart ??
              (saved?.redditPostIds !== undefined
                ? saved.windowStart
                : undefined);
            if (
              savedRedditStart &&
              Date.parse(savedRedditStart) < Date.parse(redditWindow.from)
            )
              redditWindow.from = savedRedditStart;
            const [news, reddit] = await Promise.all([
              collectNews(stock, window.from, window.to),
              collectReddit(stock, redditWindow.from, redditWindow.to),
            ]);
            const { articles, retainedCount } = mergeArticles(
              news.articles,
              saved?.articles ?? [],
              window.from,
              window.to,
            );
            const sources = news.sources;
            const summary = await summarizeNews(
              stock.name,
              articles,
              stock.aliases,
            );
            if (!articles.length && sources.every((source) => !source.ok))
              summary.summary =
                "Innhentingen feilet for alle nyhetskildene. Nyhetsbildet er ukjent.";
            if (retainedCount)
              summary.warnings.push(
                `${retainedCount} overskrifter fra tidligere forsøk i dag er beholdt. Kildestatus gjelder siste forsøk.`,
              );
            if (window.capped)
              summary.warnings.push(
                "Innhentingen er avgrenset til siste sju dager etter et opphold.",
              );
            if (reddit) sources.push(reddit.source);
            if (reddit && redditWindow.capped)
              summary.warnings.push(
                "Reddit-søket er avgrenset til siste sju dager etter et opphold.",
              );
            const redditPostIds =
              reddit || saved?.redditPostIds !== undefined
                ? [
                    ...new Set([
                      ...(reddit?.postIds ?? []),
                      ...(saved?.redditPostIds ?? []),
                    ]),
                  ]
                : undefined;
            const retainedRedditCount =
              (redditPostIds?.length ?? 0) - (reddit?.postIds.length ?? 0);
            if (retainedRedditCount)
              summary.warnings.push(
                `${retainedRedditCount} Reddit-referanser fra tidligere forsøk i dag er beholdt. Tilgjengeligheten kontrolleres ved visning.`,
              );
            return {
              symbol: stock.symbol,
              name: stock.name,
              windowStart: window.from,
              windowEnd: window.to,
              articles,
              sources,
              ...summary,
              ...(redditPostIds !== undefined ? { redditPostIds } : {}),
              ...(reddit
                ? {
                    redditWindowStart: redditWindow.from,
                    redditWindowEnd: redditWindow.to,
                  }
                : saved?.redditPostIds !== undefined
                  ? {
                      redditWindowStart:
                        saved.redditWindowStart ?? saved.windowStart,
                      redditWindowEnd: saved.redditWindowEnd ?? saved.windowEnd,
                    }
                  : {}),
            };
          },
        ),
      );
      digests.push(...batch);
    }
    const successfulSources = digests
      .flatMap((digest) => digest.sources)
      .filter((source) => source.ok).length;
    const allSources = digests.flatMap((digest) => digest.sources).length;
    const status =
      successfulSources === 0
        ? "failed"
        : successfulSources < allSources
          ? "partial"
          : "completed";
    const { error: finishError } = await db.rpc("finish_daily_news", {
      p_date: date,
      p_run_id: runId,
      p_status: status,
      p_digests: digests,
      p_error:
        status === "completed"
          ? null
          : "En eller flere nyhetskilder svarte ikke. Se kildestatus per aksje.",
    });
    if (finishError) throw new Error("Kunne ikke lagre dagsrapporten.");
    return {
      date,
      status,
      skipped: false,
      stocks: digests.length,
      articles: digests.reduce(
        (count, digest) => count + digest.articles.length,
        0,
      ),
      discussions: digests.reduce(
        (count, digest) => count + (digest.redditPostIds?.length ?? 0),
        0,
      ),
    };
  } catch (error) {
    await db.rpc("finish_daily_news", {
      p_date: date,
      p_run_id: runId,
      p_status: "failed",
      p_digests: [],
      p_error:
        "Nyhetsjobben ble avbrutt. Kontroller oppsettet og forsøk igjen.",
    });
    throw error;
  }
}
