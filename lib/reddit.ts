import "server-only";
import type { SourceCheck } from "./daily-types";
import type { WatchedStock } from "./watchlist";
import { socialQuery } from "./social-links";
import { namePattern, stockNames } from "./stock-search";

const PROVIDER = "Reddit · diskusjoner";
const POST_ID = /^t3_[a-z0-9]+$/;
const MAX_PAGES = 3;
const DISPLAY_PAGE_SIZE = 100;

export type RedditPost = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  publishedAt: string;
};

type Config = {
  clientId: string;
  secret: string;
  userAgent: string;
  subreddits: string[];
};
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" ? (value as RecordValue) : {};
}

export function redditEnabled() {
  return process.env.REDDIT_ENABLED === "true";
}

function config(): Config {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = process.env.REDDIT_USER_AGENT?.trim();
  const subreddits = (process.env.REDDIT_SUBREDDITS || "aksjer,SalmonEvolution")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (
    !clientId ||
    !secret ||
    !userAgent ||
    !subreddits.length ||
    subreddits.length > 20 ||
    subreddits.some((name) => !/^[a-z0-9_]{2,21}$/i.test(name))
  ) {
    throw new RedditError(
      "Reddit-oppsettet mangler eller er ugyldig. Se README.",
    );
  }
  return { clientId, secret, userAgent, subreddits };
}

class RedditError extends Error {}

// Bare OAuth-tokenet lagres i minnet. Innlegg lagres aldri i denne cachen.
class RedditClient {
  private token?: { value: string; expires: number };
  private pendingToken?: Promise<string>;
  private blockedUntil = 0;

  constructor(private settings: Config) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = this.authenticate();
    try {
      return await this.pendingToken;
    } finally {
      this.pendingToken = undefined;
    }
  }

  private async authenticate(): Promise<string> {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.settings.clientId}:${this.settings.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.settings.userAgent,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    this.checkResponse(response);
    const data = record(await response.json());
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.expires_in !== "number" ||
      data.expires_in <= 0 ||
      String(data.token_type).toLowerCase() !== "bearer"
    ) {
      throw new RedditError("Reddit returnerte ikke et gyldig tilgangstoken.");
    }
    this.token = {
      value: data.access_token,
      expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
    };
    return data.access_token;
  }

  private checkResponse(response: Response) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (
      response.status === 429 ||
      (remaining !== null && Number(remaining) < 1)
    ) {
      const seconds = Number(
        response.headers.get("retry-after") ||
          response.headers.get("x-ratelimit-reset") ||
          "60",
      );
      this.blockedUntil =
        Date.now() +
        (Number.isFinite(seconds) ? Math.max(60, seconds) : 60) * 1000;
    }
    if (response.status === 401) this.token = undefined;
    if (!response.ok)
      throw new RedditError(
        response.status === 429
          ? "Reddit sin forespørselsgrense er nådd. Prøv igjen senere."
          : `Reddit svarte HTTP ${response.status}. Kontroller tilgang og oppsett.`,
      );
  }

  async get(path: string, params: Record<string, string>): Promise<unknown> {
    if (Date.now() < this.blockedUntil)
      throw new RedditError(
        "Reddit sin forespørselsgrense er nådd. Prøv igjen senere.",
      );
    const token = await this.accessToken();
    const url = new URL(path, "https://oauth.reddit.com");
    url.search = new URLSearchParams({ ...params, raw_json: "1" }).toString();
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.settings.userAgent,
      },
    });
    this.checkResponse(response);
    return response.json();
  }
}

let session: { key: string; client: RedditClient } | undefined;
function client(settings: Config) {
  const key = JSON.stringify(settings);
  if (!session || session.key !== key)
    session = { key, client: new RedditClient(settings) };
  return session.client;
}

function listing(value: unknown) {
  const data = record(record(value).data);
  if (!Array.isArray(data.children))
    throw new RedditError("Reddit returnerte et ugyldig søkesvar.");
  const posts = data.children.flatMap((child) => {
    const entry = record(child);
    return entry.kind === "t3" ? [record(entry.data)] : [];
  });
  return { posts, after: typeof data.after === "string" ? data.after : null };
}

function visiblePost(post: RecordValue): RedditPost | null {
  const { name, title, subreddit, created_utc: created } = post;
  if (
    typeof name !== "string" ||
    !POST_ID.test(name) ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof subreddit !== "string" ||
    !/^[a-z0-9_]{2,21}$/i.test(subreddit) ||
    typeof created !== "number" ||
    !Number.isFinite(created) ||
    created <= 0 ||
    !Number.isFinite(new Date(created * 1000).getTime()) ||
    post.removed_by_category ||
    post.author === "[deleted]" ||
    [title, post.selftext].some(
      (value) => value === "[deleted]" || value === "[removed]",
    )
  )
    return null;
  return {
    id: name,
    title: title.slice(0, 600),
    subreddit,
    url: `https://www.reddit.com/comments/${name.slice(3)}/`,
    publishedAt: new Date(created * 1000).toISOString(),
  };
}

function mentionsStock(post: RecordValue, stock: WatchedStock) {
  const text = `${post.title ?? ""}\n${post.selftext ?? ""}`;
  const names = [
    ...stockNames(stock),
    stock.symbol,
    `$${stock.symbol.replace(/\.OL$/, "")}`,
  ];
  return namePattern(names).test(text);
}

function errorMessage(error: unknown) {
  // Nettverksfeil og svartekst kan inneholde hemmeligheter; returner bare egne meldinger.
  return error instanceof RedditError
    ? error.message
    : "Kunne ikke hente eller lese Reddit. Prøv igjen senere.";
}

export async function collectReddit(
  stock: WatchedStock,
  from: string,
  to: string,
): Promise<
  | {
      postIds: string[];
      source: SourceCheck;
    }
  | undefined
> {
  if (!redditEnabled()) return undefined;
  const ids = new Set<string>();
  try {
    const settings = config();
    const api = client(settings);
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = listing(
        await api.get(`/r/${settings.subreddits.join("+")}/search`, {
          q: socialQuery(stock),
          sort: "new",
          t: "all",
          restrict_sr: "on",
          type: "link",
          limit: "100",
          ...(after ? { after } : {}),
        }),
      );
      for (const raw of result.posts) {
        const post = visiblePost(raw);
        if (
          post &&
          Date.parse(post.publishedAt) > Date.parse(from) &&
          Date.parse(post.publishedAt) <= Date.parse(to) &&
          mentionsStock(raw, stock)
        )
          ids.add(post.id);
      }
      const reachedStart = result.posts.some(
        (post) =>
          typeof post.created_utc === "number" &&
          post.created_utc * 1000 <= Date.parse(from),
      );
      if (!result.after || reachedStart) break;
      if (page === MAX_PAGES - 1 || after === result.after)
        throw new RedditError(
          "Reddit-søket ble avgrenset til 300 innlegg. Dekningen er ufullstendig.",
        );
      after = result.after;
    }
    return {
      postIds: [...ids],
      source: { provider: PROVIDER, ok: true, count: ids.size },
    };
  } catch (error) {
    return {
      postIds: [...ids],
      source: {
        provider: PROVIDER,
        ok: false,
        count: ids.size,
        error: errorMessage(error),
      },
    };
  }
}

// Hent gjeldende titler når siden åpnes. Databasen beholder bare referanse-ID-er,
// slik at slettede innlegg ikke lever videre som tekst eller AI-sammendrag i arkivet.
export async function readRedditPosts(
  ids: string[],
  requestedPage = 1,
): Promise<{
  posts: RedditPost[];
  page: number;
  pageCount: number;
  total: number;
  error?: string;
}> {
  // Behold alle referanser i arkivet, men kontroller bare én side per visning.
  const allIds = [...new Set(ids.filter((id) => POST_ID.test(id)))];
  const pageCount = Math.max(1, Math.ceil(allIds.length / DISPLAY_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.max(1, Math.min(requestedPage, pageCount))
    : 1;
  const pagination = { page, pageCount, total: allIds.length };
  if (!redditEnabled())
    return {
      ...pagination,
      posts: [],
      error: "Automatisk Reddit-innhenting er avslått.",
    };
  const wanted = allIds.slice(
    (page - 1) * DISPLAY_PAGE_SIZE,
    page * DISPLAY_PAGE_SIZE,
  );
  if (!wanted.length) return { ...pagination, posts: [] };
  try {
    const api = client(config());
    const posts = new Map<string, RedditPost>();
    const result = listing(
      await api.get("/api/info", { id: wanted.join(",") }),
    );
    for (const raw of result.posts) {
      const post = visiblePost(raw);
      if (post && wanted.includes(post.id)) posts.set(post.id, post);
    }
    return {
      ...pagination,
      posts: [...posts.values()].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt),
      ),
    };
  } catch (error) {
    return { ...pagination, posts: [], error: errorMessage(error) };
  }
}
