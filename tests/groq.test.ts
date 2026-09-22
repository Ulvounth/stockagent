import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeNews } from "../lib/news-summary";
import { groqCompletionOptions } from "../lib/groq";
import type { Article } from "../lib/daily-types";

const article: Article = {
  id: "test",
  title: "Eksempelselskap melder om en ny kontrakt",
  source: "Testkilde",
  url: "https://example.com/test",
  provider: "test",
  kind: "news",
  publishedAt: "2026-09-21T07:00:00Z",
};

test("broad search hits never become company-specific AI claims", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Broad hits must not be sent to the AI");
  });
  const result = await summarizeNews("Salmon Evolution", [
    { ...article, title: "Atlantic Sapphire CFO to join Hofseth" },
  ]);
  assert.equal(result.summaryMode, "headlines");
  assert.ok(result.summary.includes("Overskriftene navngir ikke selskapet"));
  assert.equal(result.warnings.length, 0);
});

test("GPT-OSS requests reserve reasoning tokens and use only the final cited answer", async (t) => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  process.env.GROQ_API_KEY = "test-key";
  delete process.env.GROQ_MODEL;
  t.after(() => {
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  });
  let finishReason = "stop";
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "openai/gpt-oss-20b");
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.include_reasoning, false);
      assert.ok(body.max_completion_tokens >= 2_000);
      assert.equal(body.max_tokens, undefined);
      return Response.json({
        choices: [
          {
            finish_reason: finishReason,
            message: {
              content: "Testkildens overskrift omtaler en ny kontrakt [1].",
              reasoning:
                "Private reasoning must not appear in the saved report",
            },
          },
        ],
      });
    },
  );
  const result = await summarizeNews("Eksempelselskap", [article]);
  assert.equal(result.summaryMode, "ai");
  assert.ok(!result.summary.includes("Private reasoning"));
  finishReason = "length";
  const truncated = await summarizeNews("Eksempelselskap", [article]);
  assert.equal(truncated.summaryMode, "headlines");
  assert.equal(truncated.warnings.length, 1);
});

test("model overrides do not send GPT-OSS-specific options to other models", (t) => {
  const previous = process.env.GROQ_MODEL;
  process.env.GROQ_MODEL = "custom-model";
  t.after(() => {
    if (previous === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previous;
  });
  const options = groqCompletionOptions(500);
  assert.equal(options.model, "custom-model");
  assert.equal(options.reasoning_effort, undefined);
  assert.equal(options.include_reasoning, undefined);
});

test("company aliases qualify headlines without admitting substrings or renumbering references", async (t) => {
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-only";
  t.after(() => {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  });
  let reference = 32;
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.messages[1].content);
      assert.equal(payload.headlines.length, 1);
      assert.equal(payload.headlines[0].reference, reference);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: `Kildens overskrift omtaler selskapet [${reference}].`,
            },
          },
        ],
      });
    },
  );
  const articles = [
    ...Array.from({ length: 30 }, () => ({
      ...article,
      title: "Et annet selskap",
    })),
    { ...article, title: "Hydrogenmarkedet vokser" },
    { ...article, title: "Hydro åpner et nytt anlegg" },
  ];
  assert.equal(
    (await summarizeNews("Norsk Hydro", articles, ["Hydro", " "])).summaryMode,
    "ai",
  );
  assert.equal(fetch.mock.callCount(), 1);
  reference = 2;
  assert.equal(
    (
      await summarizeNews(
        "Example Holding",
        [
          { ...article, title: "AAB kjøper et selskap" },
          { ...article, title: "A+B kjøper et selskap" },
        ],
        ["A+B"],
      )
    ).summaryMode,
    "ai",
  );
  assert.equal(fetch.mock.callCount(), 2);
  const rejected = await summarizeNews(
    "Norsk Hydro",
    [{ ...article, title: "Hydrogenmarkedet vokser" }],
    ["Hydro", ""],
  );
  assert.equal(rejected.summaryMode, "headlines");
  assert.equal(fetch.mock.callCount(), 2);
});
