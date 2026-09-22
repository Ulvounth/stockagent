import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test(
  "production app recovers after outages, streams AI separately, and paginates the selected report",
  { timeout: 60_000 },
  async () => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((done) => socket.close(done));
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(resolve("tests/fixtures/runtime-services.mjs")).href,
        resolve("node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_PUBLIC_SUPABASE_URL: "https://database.example",
          SUPABASE_SERVICE_ROLE_KEY: "test-only",
          EODHD_API_KEY: "test-only",
          GROQ_API_KEY: "test-only",
          GROQ_MODEL: "openai/gpt-oss-20b",
          REDDIT_ENABLED: "true",
          REDDIT_CLIENT_ID: "test-only",
          REDDIT_CLIENT_SECRET: "test-only",
          REDDIT_USER_AGENT: "stockagent:test",
          REDDIT_SUBREDDITS: "aksjer",
          CRON_SECRET: "test-only-secret-for-runtime-check-12345",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "";
    child.stdout.on("data", (chunk) => {
      logs += chunk.toString();
    });
    child.stderr.on("data", () => {}); // Feilene fra de simulerte utfallene er forventet.
    const request = (path, init) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36",
          ...init?.headers,
        },
      });
    try {
      const deadline = Date.now() + 20_000;
      while (!logs.includes("Ready in")) {
        assert.ok(
          Date.now() < deadline && child.exitCode === null,
          "Test server did not become ready",
        );
        await new Promise((done) => setTimeout(done, 100));
      }
      for (const [path, method] of [
        ["/api/report", "GET"],
        ["/api/sync", "POST"],
        ["/api/cron/daily-news", "POST"],
      ])
        assert.equal((await request(path, { method })).status, 401);
      const first = await (await request("/api/stocks")).json();
      assert.equal(first.stocks.length, 4);
      const second = await (await request("/api/stocks")).json();
      assert.equal(
        second.stocks.length,
        5,
        "A recovered price source must not stay missing in the cached list",
      );
      assert.equal(
        (logs.match(/MOCK_PRICE:SOMA.OL:/g) ?? []).length,
        1,
        "Successful stock requests should remain cached",
      );

      const start = performance.now();
      const response = await request(
        "/stocks/DOFG.OL?date=2026-09-21&redditPage=2",
      );
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = "",
        newsAt,
        pricesAt,
        aiAt;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        html += decoder.decode(part.value, { stream: true });
        const elapsed = performance.now() - start;
        if (newsAt === undefined && html.includes("STREAMED_NEWS_HEADLINE"))
          newsAt = elapsed;
        if (pricesAt === undefined && html.includes("157.25"))
          pricesAt = elapsed;
        if (aiAt === undefined && html.includes("DELAYED_TECHNICAL_SUMMARY"))
          aiAt = elapsed;
      }
      assert.ok(
        aiAt - newsAt > 1000 && aiAt - pricesAt > 1000,
        "AI held up the news or prices",
      );
      assert.match(html, /REDDIT_TITLE_t3_p100/);
      assert.ok(
        html.includes("date=2026-09-21&amp;redditPage=3#reddit-DOFG.OL"),
      );
      assert.deepEqual(logs.match(/MOCK_REDDIT:[^\r\n]+/g), [
        "MOCK_REDDIT:100:t3_p100",
      ]);

      const failedAi = await (
        await request("/stocks/SUBC.OL?date=2026-02-30")
      ).text();
      assert.ok(
        failedAi.includes("STREAMED_NEWS_HEADLINE"),
        "An invalid date must not break the report",
      );
      assert.ok(
        failedAi.includes(
          "Den tekniske oppsummeringen er midlertidig utilgjengelig.",
        ),
      );
      const recoveredAi = await (await request("/stocks/SUBC.OL")).text();
      assert.ok(
        recoveredAi.includes("DELAYED_TECHNICAL_SUMMARY"),
        "AI rate-limit messages must not be cached as successful summaries",
      );
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
  },
);
