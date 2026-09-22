import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const date = "2026-09-21";
const digest = {
  symbol: "DOF.OL",
  windowEnd: "2026-09-21T07:00:00Z",
  sources: [{ provider: "test", ok: true }],
  articles: [],
};
const claim = (id: string) =>
  db.query<{ claimed: boolean }>(
    "select public.claim_daily_news($1::date, $2::uuid) as claimed",
    [date, id],
  );
const finish = (id: string, status: string, reports: unknown[] = [digest]) =>
  db.query(
    "select public.finish_daily_news($1::date, $2::uuid, $3, $4::jsonb)",
    [date, id, status, JSON.stringify(reports)],
  );

before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  for (const file of readdirSync(resolve("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
});
beforeEach(async () => {
  await db.exec("truncate public.stock_news_digests, public.daily_news_runs;");
});
after(async () => {
  await db.close();
});

test("only one worker can claim a date; completed reports cannot be run twice", async () => {
  const attempts = await Promise.all([claim(first), claim(second)]);
  assert.equal(attempts.filter((result) => result.rows[0].claimed).length, 1);
  const owner = attempts[0].rows[0].claimed ? first : second;
  await finish(owner, "completed");
  assert.equal((await claim(second)).rows[0].claimed, false);
  const rows = await db.query<{ status: string; count: number }>(
    "select status, (select count(*)::int from public.stock_news_digests) as count from public.daily_news_runs",
  );
  assert.equal(rows.rows[0].status, "completed");
  assert.equal(rows.rows[0].count, 1);
});

test("partial run can retry without duplicate reports or advancing failed coverage", async () => {
  await claim(first);
  await finish(first, "partial", [
    { ...digest, sources: [{ ok: true }, { ok: false }] },
  ]);
  assert.equal(
    (
      await db.query<{ coverage_end: string | null }>(
        "select coverage_end from public.stock_news_digests",
      )
    ).rows[0].coverage_end,
    null,
  );
  assert.equal((await claim(second)).rows[0].claimed, true);
  await finish(second, "completed");
  const rows = await db.query<{ coverage_end: string | null }>(
    "select coverage_end from public.stock_news_digests",
  );
  assert.equal(rows.rows.length, 1);
  assert.ok(rows.rows[0].coverage_end);
});

test("expired worker cannot overwrite its replacement", async () => {
  await claim(first);
  await db.exec(
    "update public.daily_news_runs set lease_until = now() - interval '1 minute'",
  );
  assert.equal((await claim(second)).rows[0].claimed, true);
  await assert.rejects(finish(first, "completed"), /lease lost/);
  await finish(second, "completed");
});

test("invalid report rolls back all writes and leaves job retryable after lease expiry", async () => {
  await claim(first);
  await assert.rejects(
    finish(first, "completed", [
      digest,
      { ...digest, symbol: "SOMA.OL", windowEnd: "bad-date" },
    ]),
  );
  assert.equal(
    (await db.query("select * from public.stock_news_digests")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.daily_news_runs",
      )
    ).rows[0].status,
    "running",
  );
});

test("failed runs can be claimed again", async () => {
  await claim(first);
  await finish(first, "failed", []);
  assert.equal((await claim(second)).rows[0].claimed, true);
});

test("anonymous clients cannot read reports or execute the job functions", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(
      db.query("select * from public.stock_news_digests"),
      /permission denied/,
    );
    await assert.rejects(claim(first), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

test("news and Reddit coverage advance independently and survive later failed retries", async () => {
  await claim(first);
  await finish(first, "partial", [
    {
      ...digest,
      sources: [
        { provider: "Google News", ok: true },
        { provider: "Reddit · diskusjoner", ok: false },
      ],
    },
  ]);
  const coverage = () =>
    db.query<{ coverage_end: Date | null; reddit_coverage_end: Date | null }>(
      "select coverage_end, reddit_coverage_end from public.stock_news_digests",
    );
  let row = (await coverage()).rows[0];
  assert.equal(row.coverage_end?.toISOString(), "2026-09-21T07:00:00.000Z");
  assert.equal(row.reddit_coverage_end, null);
  await claim(second);
  await finish(second, "partial", [
    {
      ...digest,
      windowEnd: "2026-09-21T07:30:00Z",
      redditWindowEnd: "2026-09-21T07:30:00Z",
      sources: [
        { provider: "Google News", ok: false },
        { provider: "Reddit · diskusjoner", ok: true },
      ],
    },
  ]);
  row = (await coverage()).rows[0];
  assert.equal(row.coverage_end?.toISOString(), "2026-09-21T07:00:00.000Z");
  assert.equal(
    row.reddit_coverage_end?.toISOString(),
    "2026-09-21T07:30:00.000Z",
  );
  await claim(first);
  await finish(first, "failed", [
    {
      ...digest,
      windowEnd: "2026-09-21T08:00:00Z",
      sources: [
        { provider: "Google News", ok: false },
        { provider: "Reddit · diskusjoner", ok: false },
      ],
    },
  ]);
  assert.deepEqual((await coverage()).rows[0], row);
});

test("coverage migration backfills legacy partial reports without changing their contents", async () => {
  await db.exec(
    readFileSync(
      resolve("supabase/migrations/20260921090000_daily_news.sql"),
      "utf8",
    ),
  );
  const reports = [
    {
      ...digest,
      symbol: "NEWS",
      sources: [
        { provider: "Google News", ok: true },
        { provider: "Reddit · diskusjoner", ok: false },
      ],
    },
    {
      ...digest,
      symbol: "REDDIT",
      sources: [
        { provider: "Google News", ok: false },
        { provider: "Reddit · diskusjoner", ok: true },
      ],
    },
    {
      ...digest,
      symbol: "DISABLED",
      sources: [{ provider: "Google News", ok: true }],
    },
  ];
  await claim(first);
  await finish(first, "partial", reports);
  const sql = readFileSync(
    resolve(
      "supabase/migrations/20260922090000_independent_source_coverage.sql",
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql); // SQL Editor kan kjøres på nytt uten å skade rapportene.
  const rows = await db.query<{
    symbol: string;
    coverage_end: Date | null;
    reddit_coverage_end: Date | null;
    digest: unknown;
  }>("select * from public.stock_news_digests");
  for (const row of rows.rows) {
    assert.equal(Boolean(row.coverage_end), row.symbol !== "REDDIT");
    assert.equal(Boolean(row.reddit_coverage_end), row.symbol === "REDDIT");
    assert.deepEqual(
      row.digest,
      reports.find((report) => report.symbol === row.symbol),
    );
  }
});
