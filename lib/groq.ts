import "server-only";
import Groq from "groq-sdk";
import type { ChatCompletion } from "groq-sdk/resources/chat/completions";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

export function createGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY mangler i miljøvariablene");
  return new Groq({ apiKey, timeout: 25_000, maxRetries: 1 });
}

export function groqCompletionOptions(outputTokens: number) {
  const model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  const isGptOss = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(
    model,
  );
  return {
    model,
    // GPT-OSS bruker også tokens til resonnering. Behold plass til selve svaret.
    max_completion_tokens: isGptOss ? outputTokens + 1_500 : outputTokens,
    ...(isGptOss
      ? { reasoning_effort: "low" as const, include_reasoning: false }
      : {}),
  };
}

export function completionText(completion: ChatCompletion): string {
  const choice = completion.choices[0];
  const text = choice?.message?.content?.trim();
  if (choice?.finish_reason !== "stop" || !text) {
    throw new Error("AI-en returnerte ikke en fullstendig oppsummering.");
  }
  return text;
}
