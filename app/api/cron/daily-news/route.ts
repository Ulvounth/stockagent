import { isCronAuthorized } from "@/lib/cron-auth";
import { runDailyNews } from "@/lib/daily-news";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isCronAuthorized(request))
    return Response.json({ error: "Ingen tilgang" }, { status: 401 });
  try {
    const result = await runDailyNews();
    const ok = result.status === "completed";
    return Response.json(
      { ok, ...result },
      {
        status: ok ? 200 : result.status === "running" ? 409 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Nyhetsjobben feilet. Kontroller database og miljøvariabler.",
      },
      { status: 500 },
    );
  }
}
