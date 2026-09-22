export type NewsKind = "news" | "announcement" | "rumor";

export type Article = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  provider: string;
  kind: NewsKind;
};

export type SourceCheck = {
  provider: string;
  ok: boolean;
  count: number;
  error?: string;
};

export type StockDigest = {
  symbol: string;
  name: string;
  windowStart: string;
  windowEnd: string;
  articles: Article[];
  sources: SourceCheck[];
  summary: string;
  summaryMode: "ai" | "headlines";
  warnings: string[];
  // Reddit-tekst hentes på nytt ved visning og inngår ikke i nyhetsoppsummeringen.
  redditPostIds?: string[];
  redditWindowStart?: string;
  redditWindowEnd?: string;
};

export type DailyRun = {
  report_date: string;
  status: "running" | "completed" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  lease_until: string;
  error: string | null;
};

export type DigestRow = {
  report_date: string;
  symbol: string;
  checked_at: string;
  digest: StockDigest;
};
