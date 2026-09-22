import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleId,
  classifyHeadline,
  collectNews,
  mergeArticles,
  parseGoogleRss,
  safeArticleUrl,
  selectArticles,
} from "../lib/news";
import { summarizeNews } from "../lib/news-summary";

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><item>
  <title><![CDATA[DOF: Kontrakt &amp; vekst - E24]]></title>
  <link>https://example.com/story?utm_source=rss&amp;id=1</link>
  <pubDate>Mon, 21 Sep 2026 06:30:00 GMT</pubDate>
  <source url="https://e24.no">E24</source>
</item></channel></rss>`;

test("RSS handles one item, CDATA, entities, sources and full timestamps", () => {
  const articles = parseGoogleRss(rss, "test");
  assert.equal(articles.length, 1);
  assert.equal(articles[0].source, "E24");
  assert.equal(articles[0].publishedAt, "2026-09-21T06:30:00.000Z");
  assert.equal(articles[0].url, "https://example.com/story?id=1");
  assert.ok(!articles[0].title.endsWith(" - E24"));
});

test("invalid dates and unsafe links are skipped; malformed feeds fail visibly", () => {
  assert.deepEqual(
    parseGoogleRss(
      rss.replace("Mon, 21 Sep 2026 06:30:00 GMT", "invalid"),
      "test",
    ),
    [],
  );
  assert.deepEqual(
    parseGoogleRss(
      rss.replace(
        "https://example.com/story?utm_source=rss&amp;id=1",
        "javascript:alert(1)",
      ),
      "test",
    ),
    [],
  );
  assert.throws(() => parseGoogleRss("<html>Unavailable</html>", "test"));
  assert.throws(() =>
    parseGoogleRss('<!DOCTYPE rss [<!ENTITY x "example">]><rss/>', "test"),
  );
  assert.throws(() => parseGoogleRss("<rss><channel>", "test"));
  assert.deepEqual(
    parseGoogleRss(
      "<rss><channel><title>Empty</title></channel></rss>",
      "test",
    ),
    [],
  );
});

test("headline classification keeps uncertainty and restricts announcement domains", () => {
  assert.equal(classifyHeadline("Rykter om bud på selskapet"), "rumor");
  assert.equal(
    classifyHeadline("Company reportedly considers a merger"),
    "rumor",
  );
  assert.equal(
    classifyHeadline("Kontrakt inngått", "https://newsweb.oslobors.no"),
    "announcement",
  );
  assert.equal(
    classifyHeadline(
      "Kontrakt inngått",
      "https://newsweb.oslobors.no.evil.example",
    ),
    "news",
  );
  assert.equal(
    classifyHeadline("Rumours of a deal", "https://globenewswire.com"),
    "rumor",
  );
  assert.equal(
    classifyHeadline("Ny kontrakt i Brasil", "https://e24.no"),
    "news",
  );
});

test("date window is exclusive at start, inclusive at end and removes duplicate titles/URLs", () => {
  const [article] = parseGoogleRss(rss, "test");
  const result = selectArticles(
    [
      article,
      { ...article, provider: "other" },
      {
        ...article,
        id: "other",
        publishedAt: "2026-09-20T07:00:00.000Z",
        url: "https://example.com/old",
      },
      {
        ...article,
        id: "future",
        publishedAt: "2026-09-21T07:00:01.000Z",
        url: "https://example.com/future",
      },
      {
        ...article,
        id: "end",
        publishedAt: "2026-09-21T07:00:00.000Z",
        url: "https://example.com/end",
      },
    ],
    "2026-09-20T07:00:00.000Z",
    "2026-09-21T07:00:00.000Z",
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["end", article.id],
  );
  assert.equal(
    articleId("DOF: Ny kontrakt!", "E24"),
    articleId("DOF – ny kontrakt", "e24"),
  );
  assert.equal(safeArticleUrl("https://user:password@example.com"), null);
});

test("one failed provider retains other results and never leaks raw errors", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get("hl") === "en-US")
      throw new Error("private-api-key");
    return new Response(rss);
  });
  const previous = process.env.EODHD_NEWS_ENABLED;
  process.env.EODHD_NEWS_ENABLED = "false";
  t.after(() => {
    if (previous === undefined) delete process.env.EODHD_NEWS_ENABLED;
    else process.env.EODHD_NEWS_ENABLED = previous;
  });
  const result = await collectNews(
    { symbol: "DOF.OL", name: "DOF Group" },
    "2026-09-20T07:00:00Z",
    "2026-09-21T07:00:00Z",
  );
  assert.equal(result.articles.length, 1);
  assert.equal(result.sources.filter((source) => source.ok).length, 1);
  assert.ok(!JSON.stringify(result).includes("private-api-key"));
});

test("empty feeds are successful checks, not provider failures", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<rss><channel><title>Empty</title></channel></rss>"),
  );
  const result = await collectNews(
    { symbol: "DOF.OL", name: "DOF Group" },
    "2026-09-20T07:00:00Z",
    "2026-09-21T07:00:00Z",
  );
  assert.equal(result.articles.length, 0);
  assert.ok(result.sources.every((source) => source.ok && source.count === 0));
});

test("AI outage falls back to headlines without losing article data", async (t) => {
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response('{"error":{"message":"Unavailable"}}', { status: 401 }),
  );
  const result = await summarizeNews("DOF", parseGoogleRss(rss, "test"));
  assert.equal(result.summaryMode, "headlines");
  assert.equal(result.warnings.length, 1);
});

test("Google and EODHD deduplicate a publisher's headline while retaining other publishers", async (t) => {
  const previousEnabled = process.env.EODHD_NEWS_ENABLED;
  const previousKey = process.env.EODHD_API_KEY;
  process.env.EODHD_NEWS_ENABLED = "true";
  process.env.EODHD_API_KEY = "test-only";
  t.after(() => {
    if (previousEnabled === undefined) delete process.env.EODHD_NEWS_ENABLED;
    else process.env.EODHD_NEWS_ENABLED = previousEnabled;
    if (previousKey === undefined) delete process.env.EODHD_API_KEY;
    else process.env.EODHD_API_KEY = previousKey;
  });
  const title = "Subsea 7: Ny kontrakt";
  const feed = `<rss><channel>
    <item><title>${title} - E24</title><link>https://news.google.com/rss/articles/E24</link><pubDate>Mon, 21 Sep 2026 06:30:00 GMT</pubDate><source url="https://WWW.E24.NO/">E24</source></item>
    <item><title>${title} - DN</title><link>https://news.google.com/rss/articles/DN</link><pubDate>Mon, 21 Sep 2026 06:30:00 GMT</pubDate><source url="https://www.dn.no/">DN</source></item>
    </channel></rss>`;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "news.google.com") return new Response(feed);
    assert.equal(url.hostname, "eodhd.com", "Must never call a real service");
    return Response.json([
      {
        title,
        link: "https://e24.no/boers/kontrakt?utm_source=feed",
        date: "2026-09-21T06:30:00Z",
      },
    ]);
  });
  const result = await collectNews(
    { symbol: "SUBC.OL", name: "Subsea 7" },
    "2026-09-20T07:00:00Z",
    "2026-09-21T07:00:00Z",
  );
  assert.equal(
    result.articles.length,
    2,
    "One E24 article and one independently published DN article",
  );
  assert.deepEqual(
    result.articles.map((article) => article.source),
    ["E24", "DN"],
  );
  assert.notEqual(result.articles[0].id, result.articles[1].id);
  assert.ok(result.sources.every((source) => source.ok));
  assert.deepEqual(
    result.sources.map((source) => source.count),
    [2, 2, 1],
    "Source counts describe each fetch, before cross-provider deduplication",
  );
});

test("retry merging preserves missing articles and prefers fresh copies, including legacy IDs", () => {
  const from = "2026-09-20T07:00:00Z";
  const to = "2026-09-21T07:30:00Z";
  const [article] = parseGoogleRss(rss, "Google News · Norge");
  const legacy = {
    ...article,
    id: articleId(article.title, article.source),
    url: "https://example.com/legacy-link",
  };
  const corrected = { ...article, publishedAt: "2026-09-21T06:00:00Z" };
  const missing = {
    ...article,
    id: "retained",
    title: "Annen tidligere overskrift",
    url: "https://example.com/retained",
  };
  const outsideWindow = { ...missing, id: "too-old", publishedAt: from };
  const merged = mergeArticles(
    [corrected],
    [legacy, missing, outsideWindow],
    from,
    to,
  );
  assert.equal(merged.retainedCount, 1);
  assert.equal(merged.articles.length, 2);
  assert.deepEqual(
    merged.articles.find((item) => item.id === corrected.id),
    corrected,
  );
  assert.ok(!merged.articles.some((item) => item.url === legacy.url));

  const updatedTitle = {
    ...article,
    id: "updated",
    title: "Korrigert overskrift",
    publishedAt: corrected.publishedAt,
  };
  const byUrl = mergeArticles([updatedTitle], [article], from, to);
  assert.deepEqual(
    byUrl.articles,
    [updatedTitle],
    "A freshly corrected title/date wins over the older copy with the same URL",
  );
  assert.equal(byUrl.retainedCount, 0);
});

test("retry merging does not confuse different publisher domains sharing a display name", () => {
  const [first] = parseGoogleRss(rss, "test");
  const second = {
    ...first,
    id: articleId(
      first.title,
      first.source,
      "https://another-publisher.example",
    ),
    url: "https://another-publisher.example/story",
  };
  const result = mergeArticles(
    [second],
    [first],
    "2026-09-20T07:00:00Z",
    "2026-09-21T07:30:00Z",
  );
  assert.equal(result.articles.length, 2);
  assert.equal(result.retainedCount, 1);
});
