import { fetchAllStocks } from "@/lib/eodhd";
import { generateReport } from "@/lib/ai";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * GET /api/report
 * Henter aksjedata og returnerer en AI-generert daglig rapport.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request))
    return Response.json({ error: "Ingen tilgang" }, { status: 401 });
  try {
    const stocks = await fetchAllStocks();
    const report = await generateReport(stocks);

    return Response.json({ ok: true, report });
  } catch {
    return Response.json(
      { ok: false, error: "Kunne ikke lage kursrapport." },
      { status: 500 },
    );
  }
}
