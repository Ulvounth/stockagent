import assert from "node:assert/strict";
import { test } from "node:test";
import { isReportDue, newsWindow, osloDate } from "../lib/schedule";
import { isCronAuthorized } from "../lib/cron-auth";

test("09:00 follows Norwegian winter and summer time, including transition dates", () => {
  for (const [before, at] of [
    ["2026-01-15T07:59:00Z", "2026-01-15T08:00:00Z"],
    ["2026-07-15T06:59:00Z", "2026-07-15T07:00:00Z"],
    ["2026-03-29T06:59:00Z", "2026-03-29T07:00:00Z"],
    ["2026-10-25T07:59:00Z", "2026-10-25T08:00:00Z"],
  ]) {
    assert.equal(isReportDue(new Date(before)), false);
    assert.equal(isReportDue(new Date(at)), true);
  }
  assert.equal(osloDate(new Date("2026-07-15T22:15:00Z")), "2026-07-16");
  assert.equal(isReportDue(new Date("2026-07-15T21:00:00Z")), true);
});

test("coverage spans the 25-hour autumn day and catches up after missed jobs", () => {
  const window = newsWindow(
    new Date("2026-10-25T08:00:00Z"),
    "2026-10-24T07:00:00Z",
  );
  assert.equal(Date.parse(window.to) - Date.parse(window.from), 25 * 3_600_000);
  const capped = newsWindow(
    new Date("2026-09-21T07:00:00Z"),
    "2026-09-01T07:00:00Z",
  );
  assert.equal(capped.from, "2026-09-14T07:00:00.000Z");
  assert.equal(capped.capped, true);
  assert.equal(
    newsWindow(new Date("2026-09-21T07:00:00Z")).from,
    "2026-09-19T07:00:00.000Z",
  );
});

test("job endpoints reject missing, weak and wrong secrets", (t) => {
  const previous = process.env.CRON_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
  const request = (value?: string) =>
    new Request("https://example.com/api/cron/daily-news", {
      headers: value ? { authorization: `Bearer ${value}` } : {},
    });
  delete process.env.CRON_SECRET;
  assert.equal(isCronAuthorized(request()), false);
  process.env.CRON_SECRET = "short";
  assert.equal(isCronAuthorized(request("short")), false);
  process.env.CRON_SECRET = "a".repeat(32);
  assert.equal(isCronAuthorized(request()), false);
  assert.equal(isCronAuthorized(request("b".repeat(32))), false);
  assert.equal(isCronAuthorized(request("a".repeat(32))), true);
});
