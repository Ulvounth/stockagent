import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Article, NewsKind, SourceCheck } from "./daily-types";
import type { WatchedStock } from "./watchlist";
import { quotedStockNames } from "./stock-search";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "#text" in value)
    return text(value["#text"]);
  return "";
}

export function safeArticleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyHeadline(title: string, sourceUrl = ""): NewsKind {
  if (
    /\b(rykte\w*|rumou?r\w*|spekulasjon\w*|speculat\w*|ubekreftet|unconfirmed|angivelig|reportedly)\b/i.test(
      title,
    )
  )
    return "rumor";
  // Bare kjente meldingsdistributører merkes som selskapsmelding.
  try {
    const hostname = new URL(sourceUrl).hostname;
    if (
      /(^|\.)(newsweb\.oslobors\.no|live\.euronext\.com|globenewswire\.com|news\.cision\.com)$/i.test(
        hostname,
      )
    )
      return "announcement";
  } catch {
    /* Ukjent kilde er vanlig medieomtale. */
  }
  return "news";
}

export function articleId(
  title: string,
  source: string,
  sourceUrl?: string,
): string {
  // RSS bruker ofte visningsnavn (E24), mens EODHD bruker domene (e24.no).
  // Behold visningsnavnet i artikkelen, men bruk samme utgiver i identiteten.
  const publisherUrl = sourceUrl ? safeArticleUrl(sourceUrl) : null;
  const publisher = publisherUrl
    ? new URL(publisherUrl).hostname.replace(/^www\./, "").replace(/\.$/, "")
    : source.trim().toLowerCase();
  return createHash("sha256")
    .update(
      `${publisher}|${title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()}`,
    )
    .digest("hex");
}

export function parseGoogleRss(xml: string, provider: string): Article[] {
  if (
    xml.length > 2_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  ) {
    throw new Error("Ugyldig nyhetsfeed");
  }
  const parsed = parser.parse(xml);
  if (!parsed.rss?.channel) throw new Error("Nyhetskilden returnerte ikke RSS");
  const items = parsed.rss.channel.item ?? [];
  return (Array.isArray(items) ? items : [items]).flatMap((item): Article[] => {
    const source = text(item.source) || "Ukjent kilde";
    const sourceUrl = text(item.source?.["@_url"]);
    let title = text(item.title).replace(/<[^>]*>/g, "");
    if (title.endsWith(` - ${source}`))
      title = title.slice(0, -(source.length + 3)).trim();
    const url = safeArticleUrl(text(item.link));
    const published = Date.parse(text(item.pubDate));
    if (!title || !url || !Number.isFinite(published)) return [];
    return [
      {
        id: articleId(title, source, sourceUrl),
        title: title.slice(0, 600),
        url,
        publishedAt: new Date(published).toISOString(),
        source,
        provider,
        kind: classifyHeadline(title, sourceUrl),
      },
    ];
  });
}

export function selectArticles(
  articles: Article[],
  from: string,
  to: string,
): Article[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return articles
    .filter(
      (item) =>
        Date.parse(item.publishedAt) > Date.parse(from) &&
        Date.parse(item.publishedAt) <= Date.parse(to),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((item) => {
      if (seenIds.has(item.id) || seenUrls.has(item.url)) return false;
      seenIds.add(item.id);
      seenUrls.add(item.url);
      return true;
    });
}

export function mergeArticles(
  current: Article[],
  previous: Article[],
  from: string,
  to: string,
): { articles: Article[]; retainedCount: number } {
  const fresh = selectArticles(current, from, to);
  const ids = new Set(fresh.map((article) => article.id));
  const urls = new Set(fresh.map((article) => article.url));
  // Eldre rapporter bruker visningsnavnet i ID-en. Gjenkjenn også disse når
  // samme overskrift hentes på nytt etter innføringen av domene-baserte ID-er.
  const legacyIds = new Set(
    fresh.map((article) => articleId(article.title, article.source)),
  );
  const retained = selectArticles(previous, from, to).filter(
    (article) =>
      !ids.has(article.id) &&
      !urls.has(article.url) &&
      !(
        article.id === articleId(article.title, article.source) &&
        legacyIds.has(article.id)
      ),
  );
  // Nye kopier vinner selv om utgiveren har korrigert publiseringstiden bakover.
  return {
    articles: selectArticles([...fresh, ...retained], from, to),
    retainedCount: retained.length,
  };
}

function queryFor(stock: WatchedStock, from: string): string {
  const names = quotedStockNames(stock);
  // En ekstra kalenderdag i søket; presis tidsavgrensing gjøres etter innhenting.
  const after = new Date(Date.parse(from) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `(${names.join(" OR ")}) after:${after}`;
}

async function fetchGoogle(
  stock: WatchedStock,
  from: string,
  english: boolean,
): Promise<Article[]> {
  const provider = english
    ? "Google News · internasjonalt"
    : "Google News · Norge";
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({
    q: queryFor(stock, from),
    hl: english ? "en-US" : "nb",
    gl: english ? "US" : "NO",
    ceid: english ? "US:en" : "NO:nb",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "StockAgent/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseGoogleRss(await response.text(), provider);
}

async function fetchEodhdNews(
  stock: WatchedStock,
  from: string,
  to: string,
): Promise<Article[]> {
  const key = process.env.EODHD_API_KEY;
  if (!key) throw new Error("API-nøkkel mangler");
  const url = new URL("https://eodhd.com/api/news");
  url.search = new URLSearchParams({
    s: stock.symbol,
    api_token: key,
    from: from.slice(0, 10),
    to: to.slice(0, 10),
    limit: "1000",
    fmt: "json",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Ugyldig svar fra EODHD");
  if (data.length >= 1000)
    throw new Error("For mange treff; tidsvinduet må avgrenses");
  return data.flatMap((item): Article[] => {
    const title = text(item.title);
    const url = safeArticleUrl(text(item.link));
    const published = Date.parse(text(item.date));
    if (!title || !url || !Number.isFinite(published)) return [];
    const source = new URL(url).hostname.replace(/^www\./, "");
    return [
      {
        id: articleId(title, source, url),
        title: title.slice(0, 600),
        url,
        publishedAt: new Date(published).toISOString(),
        source,
        provider: "EODHD",
        kind: classifyHeadline(title, url),
      },
    ];
  });
}

export async function collectNews(
  stock: WatchedStock,
  from: string,
  to: string,
): Promise<{ articles: Article[]; sources: SourceCheck[] }> {
  const providers = [
    {
      name: "Google News · Norge",
      fetch: () => fetchGoogle(stock, from, false),
    },
    {
      name: "Google News · internasjonalt",
      fetch: () => fetchGoogle(stock, from, true),
    },
  ];
  if (process.env.EODHD_NEWS_ENABLED === "true") {
    providers.push({
      name: "EODHD",
      fetch: () => fetchEodhdNews(stock, from, to),
    });
  }
  const results = await Promise.allSettled(
    providers.map((provider) => provider.fetch()),
  );
  const all: Article[] = [];
  const sources = results.map((result, i): SourceCheck => {
    if (result.status === "rejected") {
      // Ikke lagre rå fetch-feil: URL-en kan inneholde API-nøkkel.
      const http =
        result.reason instanceof Error
          ? /^HTTP \d{3}$/.exec(result.reason.message)?.[0]
          : null;
      return {
        provider: providers[i].name,
        ok: false,
        count: 0,
        error: http ?? "Kunne ikke hente eller lese nyhetskilden",
      };
    }
    const articles = selectArticles(result.value, from, to);
    all.push(...articles);
    return { provider: providers[i].name, ok: true, count: articles.length };
  });
  return { articles: selectArticles(all, from, to), sources };
}
