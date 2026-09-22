import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runDailyNews, readDailyNews } from "../lib/daily-news";
import { WATCHLIST } from "../lib/watchlist";
import type { StockDigest } from "../lib/daily-types";

test("daily worker saves partial results, retries, deduplicates and then skips completed dates", async (t) => {
  const db = new PGlite();
  t.after(async () => {
    await db.close();
  });
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  for (const file of readdirSync(resolve("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
    EODHD_NEWS_ENABLED: "false",
    GROQ_API_KEY: "",
    REDDIT_ENABLED: "false",
    REDDIT_CLIENT_ID: "test-daily-client",
    REDDIT_CLIENT_SECRET: "test-daily-secret",
    REDDIT_USER_AGENT: "server:stockagent:test (by /u/test)",
  };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  let failEnglish = true;
  let failNorwegian = false;
  let failAll = false;
  let emptyFeeds = false;
  let newsRequests = 0;
  let failReddit = true;
  let emptyReddit = false;
  // Dette treffet er innenfor første 48-timersvindu, men faller utenfor hvis
  // et nytt forsøk kl. 09.30 feilaktig flytter starten en halvtime fremover.
  let articlePublished = "Sat, 19 Sep 2026 07:05:00 GMT";
  let redditPublished = "2026-09-22T06:30:00Z";
  let englishHeadline = "Ny kontrakt";
  const aiInputs: { reference: number; title: string }[][] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.groq.com") {
        const body = JSON.parse(String(init?.body));
        const { headlines } = JSON.parse(body.messages[1].content);
        aiInputs.push(headlines);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: headlines
                  .map(
                    (item: { reference: number; title: string }) =>
                      `${item.title} [${item.reference}]`,
                  )
                  .join(". "),
              },
            },
          ],
        });
      }
      if (url.hostname === "www.reddit.com")
        return Response.json({
          access_token: "test-token",
          expires_in: 3600,
          token_type: "bearer",
        });
      if (url.hostname === "oauth.reddit.com") {
        if (failReddit) return new Response("Unavailable", { status: 503 });
        if (emptyReddit)
          return Response.json({ data: { after: null, children: [] } });
        const company = url.searchParams.get("q")?.split('"')[1];
        return Response.json({
          data: {
            after: null,
            children: [
              {
                kind: "t3",
                data: {
                  name: "t3_testpost",
                  title: `${company}: PRIVATE_REDDIT_TITLE`,
                  selftext: "PRIVATE_REDDIT_BODY",
                  subreddit: "aksjer",
                  author: "PRIVATE_REDDIT_AUTHOR",
                  created_utc: Date.parse(redditPublished) / 1000,
                },
              },
            ],
          },
        });
      }
      if (url.hostname === "news.google.com") {
        newsRequests++;
        const english = url.searchParams.get("hl") === "en-US";
        if (failAll || (failEnglish && english) || (failNorwegian && !english))
          return new Response("Unavailable", { status: 503 });
        if (emptyFeeds)
          return new Response(
            "<rss><channel><title>Empty</title></channel></rss>",
          );
        const company = url.searchParams.get("q")?.split('"')[1];
        const headline = english ? englishHeadline : "Ny kontrakt";
        return new Response(
          `<rss><channel><title>Test feed</title><item><title>${company}: ${headline} - Testkilde</title><link>https://news.example/${encodeURIComponent(company ?? "company")}/${encodeURIComponent(headline)}</link><pubDate>${articlePublished}</pubDate><source url="https://news.example">Testkilde</source></item></channel></rss>`,
        );
      }
      assert.equal(
        url.hostname,
        "database.example",
        "Tests must never call a real service",
      );
      if (url.pathname.endsWith("/rpc/claim_daily_news")) {
        const body = JSON.parse(String(init?.body));
        const result = await db.query<{ claimed: boolean }>(
          "select public.claim_daily_news($1, $2) as claimed",
          [body.p_date, body.p_run_id],
        );
        return Response.json(result.rows[0].claimed);
      }
      if (url.pathname.endsWith("/rpc/finish_daily_news")) {
        const body = JSON.parse(String(init?.body));
        await db.query("select public.finish_daily_news($1, $2, $3, $4, $5)", [
          body.p_date,
          body.p_run_id,
          body.p_status,
          JSON.stringify(body.p_digests),
          body.p_error,
        ]);
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/daily_news_runs")) {
        const date = url.searchParams.get("report_date")?.replace(/^eq\./, "");
        const result = date
          ? await db.query(
              "select * from public.daily_news_runs where report_date = $1",
              [date],
            )
          : await db.query(
              "select * from public.daily_news_runs order by report_date desc limit 1",
            );
        return Response.json(result.rows);
      }
      assert.ok(url.pathname.endsWith("/stock_news_digests"));
      if (url.searchParams.get("select")?.includes("coverage_end")) {
        const column =
          url.searchParams.get("select")?.endsWith("reddit_coverage_end")
            ? "reddit_coverage_end"
            : "coverage_end";
        const symbol = url.searchParams.get("symbol")?.replace(/^eq\./, "");
        const date = url.searchParams.get("report_date")?.replace(/^lt\./, "");
        const result = await db.query(
          `select ${column} as end from public.stock_news_digests where symbol = $1 and report_date < $2 and ${column} is not null order by ${column} desc limit 1`,
          [symbol, date],
        );
        return Response.json(result.rows);
      }
      const date = url.searchParams.get("report_date")?.replace(/^eq\./, "");
      const result = await db.query(
        "select * from public.stock_news_digests where report_date = $1",
        [date],
      );
      return Response.json(result.rows);
    },
  );

  const first = await runDailyNews(new Date("2026-09-21T07:00:00Z"));
  assert.equal(first.status, "partial");
  assert.equal(first.articles, WATCHLIST.length);
  failEnglish = false;
  const retry = await runDailyNews(new Date("2026-09-21T07:30:00Z"));
  assert.equal(retry.status, "completed");
  assert.equal(
    retry.articles,
    WATCHLIST.length,
    "Same headline across both feeds appears once",
  );
  const rows = await db.query<{ digest: StockDigest }>(
    "select digest from public.stock_news_digests",
  );
  assert.equal(rows.rows.length, WATCHLIST.length);
  assert.ok(
    rows.rows.every(
      (row) => row.digest.windowStart === "2026-09-19T07:00:00.000Z",
    ),
    "Retries preserve the original report window",
  );
  assert.ok(
    rows.rows.every(
      (row) =>
        row.digest.articles.length === 1 &&
        row.digest.summaryMode === "headlines",
    ),
  );
  const beforeSkip = newsRequests;
  const skipped = await runDailyNews(new Date("2026-09-21T08:00:00Z"));
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.status, "completed");
  assert.equal(
    newsRequests,
    beforeSkip,
    "Completed run must not fetch sources or call AI again",
  );
  const saved = await readDailyNews();
  assert.equal(saved.digests.length, WATCHLIST.length);

  failAll = true;
  const failed = await runDailyNews(new Date("2026-09-22T07:00:00Z"));
  assert.equal(failed.status, "failed");
  const latest = await readDailyNews();
  assert.ok(
    latest.digests.every((row) =>
      row.digest.summary.includes("Nyhetsbildet er ukjent"),
    ),
  );

  failAll = false;
  articlePublished = "Tue, 22 Sep 2026 06:30:00 GMT";
  process.env.REDDIT_ENABLED = "true";
  const redditFailed = await runDailyNews(new Date("2026-09-22T07:30:00Z"));
  assert.equal(
    redditFailed.status,
    "partial",
    "A Reddit outage must not fail the entire job",
  );
  assert.equal(
    redditFailed.articles,
    WATCHLIST.length,
    "News articles must still be saved during Reddit outages",
  );
  failReddit = false;
  const redditRetry = await runDailyNews(new Date("2026-09-22T08:00:00Z"));
  assert.equal(redditRetry.status, "completed");
  assert.equal(redditRetry.discussions, WATCHLIST.length);
  const withReddit = await readDailyNews();
  assert.ok(
    withReddit.digests.every(
      (row) => row.digest.redditPostIds?.[0] === "t3_testpost",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(withReddit),
    /PRIVATE_REDDIT|test-token|test-daily-secret/,
    "The database must never retain Reddit titles, bodies, authors or credentials",
  );

  articlePublished = "Wed, 23 Sep 2026 06:30:00 GMT";
  redditPublished = "2026-09-23T06:30:00Z";
  failEnglish = true;
  const morning = await runDailyNews(new Date("2026-09-23T07:00:00Z"));
  assert.equal(morning.status, "partial");
  assert.equal(morning.articles, WATCHLIST.length);
  assert.equal(morning.discussions, WATCHLIST.length);

  // Bytt hvilken kilde som feiler: behold morgenens kontrakt, legg til den
  // nye ordren, og lag AI-oppsummeringen fra den endelige sammenslåtte listen.
  failNorwegian = true;
  failEnglish = false;
  failReddit = true;
  englishHeadline = "Ny ordre";
  articlePublished = "Wed, 23 Sep 2026 07:15:00 GMT";
  process.env.GROQ_API_KEY = "test-only";
  const alternating = await runDailyNews(new Date("2026-09-23T07:30:00Z"));
  assert.equal(alternating.status, "partial");
  assert.equal(alternating.articles, WATCHLIST.length * 2);
  assert.equal(
    alternating.discussions,
    WATCHLIST.length,
    "A Reddit outage must not remove stored references",
  );
  assert.equal(aiInputs.length, WATCHLIST.length);
  assert.ok(
    aiInputs.every(
      (items) =>
        items.length === 2 &&
        items[0].title.endsWith("Ny ordre") &&
        items[1].title.endsWith("Ny kontrakt"),
    ),
  );
  const retained = await readDailyNews();
  for (const { digest } of retained.digests) {
    assert.equal(digest.summaryMode, "ai");
    assert.equal(digest.articles.length, 2);
    assert.equal(
      digest.summary,
      digest.articles
        .map((article, index) => `${article.title} [${index + 1}]`)
        .join(". "),
    );
    assert.ok(
      digest.warnings.some((warning) =>
        warning.includes("1 overskrifter fra tidligere forsøk"),
      ),
    );
    assert.equal(
      digest.sources.find((source) => source.provider === "Google News · Norge")
        ?.ok,
      false,
    );
  }
  const incompleteCoverage = await db.query<{ coverage_end: unknown }>(
    "select coverage_end from public.stock_news_digests where report_date = '2026-09-23'",
  );
  assert.ok(
    incompleteCoverage.rows.every((row) => row.coverage_end === null),
    "Retained articles must not make a failed source count as fresh coverage",
  );

  failAll = true;
  const outage = await runDailyNews(new Date("2026-09-23T07:45:00Z"));
  assert.equal(outage.status, "failed");
  assert.equal(outage.articles, WATCHLIST.length * 2);
  assert.equal(outage.discussions, WATCHLIST.length);
  const duringOutage = await readDailyNews();
  assert.ok(
    duringOutage.digests.every(
      (row) =>
        row.digest.summary.includes("Ny kontrakt") &&
        row.digest.summary.includes("Ny ordre"),
    ),
  );

  failAll = false;
  failNorwegian = false;
  failReddit = false;
  const recovered = await runDailyNews(new Date("2026-09-23T08:00:00Z"));
  assert.equal(recovered.status, "completed");
  assert.equal(
    recovered.articles,
    WATCHLIST.length * 2,
    "Repeated successful fetches must not duplicate retained articles",
  );
  assert.equal(recovered.discussions, WATCHLIST.length);

  emptyFeeds = true;
  emptyReddit = true;
  const nextDay = await runDailyNews(new Date("2026-09-24T07:00:00Z"));
  assert.equal(nextDay.status, "completed");
  assert.equal(
    nextDay.articles,
    0,
    "Yesterday's saved articles must not be copied into a new report",
  );
  assert.equal(nextDay.discussions, 0);

  // Reddit forblir nede over flere datoer. Nyhetsvinduet skal fortsatt flytte
  // seg, mens Reddit beholder sitt eget etterslep frem til kilden svarer igjen.
  emptyFeeds = false;
  emptyReddit = false;
  failReddit = true;
  articlePublished = "Fri, 25 Sep 2026 06:30:00 GMT";
  redditPublished = "2026-09-25T06:30:00Z";
  const redditDown = await runDailyNews(new Date("2026-09-25T07:00:00Z"));
  assert.equal(redditDown.status, "partial");
  assert.ok(redditDown.articles > 0);
  const stillDown = await runDailyNews(new Date("2026-09-26T07:00:00Z"));
  assert.equal(stillDown.status, "partial");
  assert.equal(
    stillDown.articles,
    0,
    "Reddit failures must not repeat yesterday's headlines",
  );
  const separateWindows = await readDailyNews();
  for (const { digest } of separateWindows.digests) {
    assert.equal(digest.windowStart, "2026-09-25T07:00:00.000Z");
    assert.equal(digest.redditWindowStart, "2026-09-24T07:00:00.000Z");
  }
  failReddit = false;
  const caughtUp = await runDailyNews(new Date("2026-09-27T07:00:00Z"));
  assert.equal(caughtUp.status, "completed");
  assert.equal(caughtUp.articles, 0);
  assert.equal(
    caughtUp.discussions,
    WATCHLIST.length,
    "Reddit must recover posts older than the news watermark",
  );

  // Det motsatte tilfellet: fungerende Reddit dekning må ikke flytte
  // nyhetsvinduet forbi overskrifter som manglet mens nyhetskildene var nede.
  failAll = true;
  redditPublished = "2026-09-28T06:30:00Z";
  articlePublished = "Mon, 28 Sep 2026 06:30:00 GMT";
  assert.equal(
    (await runDailyNews(new Date("2026-09-28T07:00:00Z"))).status,
    "partial",
  );
  failAll = false;
  const newsCaughtUp = await runDailyNews(new Date("2026-09-29T07:00:00Z"));
  assert.ok(newsCaughtUp.articles > 0);
  assert.equal(
    newsCaughtUp.discussions,
    0,
    "News outages must not repeat Reddit posts already covered",
  );
});
