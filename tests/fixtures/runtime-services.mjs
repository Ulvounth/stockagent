// Lastes bare av runtime-testens serverprosess. Alle eksterne tjenester er falske.
const originalFetch = globalThis.fetch;
const priceCalls = new Map();
let failedAiCalls = 0;
const reportDate = "2026-09-21";

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (["127.0.0.1", "localhost"].includes(url.hostname))
    return originalFetch(input, init);
  if (url.pathname.endsWith("/daily_news_runs")) {
    const requested = url.searchParams.get("report_date");
    if (requested && requested !== `eq.${reportDate}`)
      throw new Error("Invalid archive date reached the database");
    return Response.json([
      {
        report_date: reportDate,
        status: "completed",
        started_at: `${reportDate}T07:00:00Z`,
        finished_at: `${reportDate}T07:00:00Z`,
        lease_until: `${reportDate}T07:15:00Z`,
        error: null,
      },
    ]);
  }
  if (url.pathname.endsWith("/stock_news_digests")) {
    const symbol =
      url.searchParams.get("symbol")?.replace(/^eq\./, "") ?? "DOFG.OL";
    return Response.json([
      {
        report_date: reportDate,
        symbol,
        checked_at: `${reportDate}T07:00:00Z`,
        digest: {
          symbol,
          name: "Test company",
          windowStart: "2026-09-20T07:00:00Z",
          windowEnd: `${reportDate}T07:00:00Z`,
          articles: [
            {
              id: "news1",
              title: "STREAMED_NEWS_HEADLINE",
              source: "Test",
              url: "https://example.com/news",
              publishedAt: `${reportDate}T06:00:00Z`,
              provider: "test",
              kind: "news",
            },
          ],
          sources: [{ provider: "test", ok: true, count: 1 }],
          summary: "Lagret nyhetsoversikt",
          summaryMode: "headlines",
          warnings: [],
          redditPostIds: Array.from(
            { length: 205 },
            (_, index) => `t3_p${index}`,
          ),
        },
      },
    ]);
  }
  if (url.hostname === "eodhd.com") {
    const symbol = url.pathname.split("/").at(-1);
    const calls = (priceCalls.get(symbol) ?? 0) + 1;
    priceCalls.set(symbol, calls);
    console.log(`MOCK_PRICE:${symbol}:${calls}`);
    if (symbol === "DOFG.OL" && calls === 1)
      return new Response("Temporary failure", { status: 503 });
    return Response.json([
      {
        date: reportDate,
        open: 150,
        high: 160,
        low: 145,
        close: 157.25,
        volume: 1000,
      },
      {
        date: "2026-09-20",
        open: 150,
        high: 155,
        low: 145,
        close: 150,
        volume: 800,
      },
    ]);
  }
  if (url.hostname === "api.groq.com") {
    const body = JSON.parse(String(init?.body));
    if (body.messages[0].content.includes("SUBC.OL") && failedAiCalls++ < 2)
      return Response.json(
        {
          error: {
            message: "rate_limit_exceeded",
            code: "rate_limit_exceeded",
          },
        },
        { status: 429, headers: { "retry-after": "0" } },
      );
    await new Promise((resolve) => setTimeout(resolve, 1800));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "DELAYED_TECHNICAL_SUMMARY" },
        },
      ],
    });
  }
  if (url.hostname === "www.reddit.com")
    return Response.json({
      access_token: "mock-token",
      expires_in: 3600,
      token_type: "bearer",
    });
  if (url.hostname === "oauth.reddit.com") {
    const ids = url.searchParams.get("id").split(",");
    console.log(`MOCK_REDDIT:${ids.length}:${ids[0]}`);
    return Response.json({
      data: {
        children: ids.map((id) => ({
          kind: "t3",
          data: {
            name: id,
            title: `REDDIT_TITLE_${id}`,
            subreddit: "aksjer",
            author: "test",
            created_utc: Date.parse(`${reportDate}T06:00:00Z`) / 1000,
          },
        })),
      },
    });
  }
  throw new Error("Unexpected external request in runtime test");
};
