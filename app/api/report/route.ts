import { fetchAllStocks } from "@/lib/eodhd";
import { generateReport } from "@/lib/ai";

/**
 * GET /api/report
 * Henter aksjedata og returnerer en AI-generert daglig rapport.
 */
export async function GET() {
  try {
    const stocks = await fetchAllStocks();
    const report = await generateReport(stocks);

    return Response.json({ ok: true, report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
