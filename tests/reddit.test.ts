import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { collectReddit, readRedditPosts } from "../lib/reddit";

const stock = { symbol: "SUBC.OL", name: "Subsea 7", aliases: ["Subsea7"] };
const from = "2026-09-20T07:00:00Z";
const to = "2026-09-21T07:00:00Z";
let configNumber = 0;

function setup(t: TestContext, overrides: Record<string, string> = {}) {
  const values = {
    REDDIT_ENABLED: "true",
    REDDIT_CLIENT_ID: `test-app-${++configNumber}`,
    REDDIT_CLIENT_SECRET: "secret-not-for-logs",
    REDDIT_USER_AGENT: "server:stockagent:test (by /u/test)",
    REDDIT_SUBREDDITS: "aksjer,SalmonEvolution",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
}

function post(id: string, changes: Record<string, unknown> = {}) {
  return {
    kind: "t3",
    data: {
      name: `t3_${id}`,
      title: "Subsea 7: diskusjon om kontrakt",
      selftext: "",
      subreddit: "aksjer",
      author: "test-user",
      removed_by_category: null,
      created_utc: Date.parse("2026-09-21T06:00:00Z") / 1000,
      ...changes,
    },
  };
}

function response(children: unknown[], after: string | null = null) {
  return Response.json({ kind: "Listing", data: { children, after } });
}

function token() {
  return Response.json({
    access_token: "test-token",
    expires_in: 3600,
    token_type: "bearer",
  });
}

test("disabled Reddit and missing credentials make no external requests", async (t) => {
  setup(t, { REDDIT_ENABLED: "false" });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network call");
  });
  assert.equal(await collectReddit(stock, from, to), undefined);
  assert.ok((await readRedditPosts(["t3_one"])).error?.includes("avslått"));
  process.env.REDDIT_ENABLED = "true";
  process.env.REDDIT_CLIENT_ID = "";
  const result = await collectReddit(stock, from, to);
  assert.equal(result?.source.ok, false);
  assert.match(result?.source.error ?? "", /oppsettet/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Reddit authenticates once, paginates, checks relevance and time, and retains only post IDs", async (t) => {
  setup(t);
  let authCalls = 0;
  let searchCalls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      if (url.hostname === "www.reddit.com") {
        authCalls++;
        assert.equal(url.pathname, "/api/v1/access_token");
        assert.equal(init?.method, "POST");
        assert.equal(String(init?.body), "grant_type=client_credentials");
        assert.match(headers.get("authorization") ?? "", /^Basic /);
        return token();
      }
      assert.equal(url.hostname, "oauth.reddit.com");
      assert.equal(url.pathname, "/r/aksjer+SalmonEvolution/search");
      assert.equal(url.searchParams.get("restrict_sr"), "on");
      assert.equal(url.searchParams.get("sort"), "new");
      assert.equal(headers.get("authorization"), "Bearer test-token");
      searchCalls++;
      return url.searchParams.has("after")
        ? response([
            post("alias", { title: "Subsea7 rykter" }),
            post("body", {
              title: "Hva tenker dere?",
              selftext: "Subsea 7 diskusjon",
            }),
            post("boundary", { created_utc: Date.parse(from) / 1000 }),
          ])
        : response(
            [
              post("one"),
              post("one"),
              post("unrelated", { title: "Subsea 70" }),
              post("future", { created_utc: Date.parse(to) / 1000 + 1 }),
              post("removed", { removed_by_category: "moderator" }),
              post("deleted", { selftext: "[deleted]" }),
            ],
            "t3_next",
          );
    },
  );
  const results = await Promise.all([
    collectReddit(stock, from, to),
    collectReddit(stock, from, to),
  ]);
  for (const result of results) {
    assert.deepEqual(result?.postIds, ["t3_one", "t3_alias", "t3_body"]);
    assert.equal(result?.source.ok, true);
    assert.equal(result?.source.count, 3);
    assert.doesNotMatch(
      JSON.stringify(result),
      /test-user|test-token|diskusjon om kontrakt|selftext/,
    );
  }
  assert.equal(authCalls, 1, "Concurrent stocks must share token acquisition");
  assert.equal(searchCalls, 4);
});

test("Reddit detects truncation and retains partial references", async (t) => {
  setup(t);
  let searches = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "www.reddit.com") return token();
    searches++;
    return response([post(`p${searches}`)], `t3_next${searches}`);
  });
  const result = await collectReddit(stock, from, to);
  assert.equal(searches, 3);
  assert.equal(result?.source.ok, false);
  assert.equal(result?.postIds.length, 3);
  assert.match(result?.source.error ?? "", /ufullstendig/);
});

test("current Reddit reads exclude deleted posts and never return stale content on failure", async (t) => {
  setup(t);
  let fail = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "www.reddit.com") return token();
    assert.equal(url.pathname, "/api/info");
    assert.equal(
      url.searchParams.get("id"),
      "t3_one,t3_removed,t3_deleted,t3_missing",
    );
    if (fail) throw new Error("secret-not-for-logs and test-token");
    return response([
      post("one", { title: "Oppdatert tittel" }),
      post("removed", { removed_by_category: "deleted" }),
      post("deleted", { author: "[deleted]" }),
      post("unrequested"),
    ]);
  });
  const ids = [
    "t3_one",
    "t3_one",
    "t3_removed",
    "t3_deleted",
    "t3_missing",
    "https://evil.example",
  ];
  const first = await readRedditPosts(ids);
  assert.equal(first.posts.length, 1);
  assert.equal(first.posts[0].title, "Oppdatert tittel");
  assert.equal(first.posts[0].url, "https://www.reddit.com/comments/one/");
  assert.doesNotMatch(JSON.stringify(first), /test-user|author|selftext/);
  fail = true;
  const second = await readRedditPosts(ids);
  assert.deepEqual(second.posts, []);
  assert.ok(second.error);
  assert.doesNotMatch(second.error, /secret-not-for-logs|test-token/);
});

test("rate limiting pauses further requests without automatic retries", async (t) => {
  setup(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls++;
    if (new URL(String(input)).hostname === "www.reddit.com") return token();
    return new Response("limit", {
      status: 429,
      headers: { "retry-after": "120" },
    });
  });
  const first = await collectReddit(stock, from, to);
  const second = await collectReddit(stock, from, to);
  assert.equal(first?.source.ok, false);
  assert.equal(second?.source.ok, false);
  assert.match(second?.source.error ?? "", /forespørselsgrense/);
  assert.equal(calls, 2);
});

test("Reddit reads at most one batch per page and keeps every retained reference reachable", async (t) => {
  setup(t);
  const ids = Array.from({ length: 905 }, (_, index) => `t3_p${index}`);
  const requests: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "www.reddit.com") return token();
    assert.equal(url.hostname, "oauth.reddit.com");
    const batch = (url.searchParams.get("id") ?? "").split(",");
    requests.push(batch.length);
    return response(batch.map((id) => post(id.slice(3))));
  });
  const first = await readRedditPosts([...ids, ids[0], "invalid"]);
  assert.equal(first.error, undefined);
  assert.equal(first.posts.length, 100);
  assert.equal(first.pageCount, 10);
  assert.equal(first.total, 905);
  assert.deepEqual(requests, [100]);
  const seen = new Set(first.posts.map((post) => post.id));
  for (let page = 2; page <= first.pageCount; page++) {
    const result = await readRedditPosts(ids, page);
    assert.equal(result.page, page);
    for (const post of result.posts) {
      assert.ok(!seen.has(post.id), "Pages must not overlap");
      seen.add(post.id);
    }
  }
  assert.equal(seen.size, ids.length);
  assert.equal(requests.length, 10);
  assert.equal(requests.at(-1), 5);
  for (const invalid of [NaN, Infinity, -1, 1.5])
    assert.equal((await readRedditPosts(ids, invalid)).page, 1);
  assert.equal((await readRedditPosts(ids, 999)).page, 10);
});
