import { fetchAllStocks } from "@/lib/eodhd";
import { saveStockPrices } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * POST /api/sync (krever CRON_SECRET)
 * Henter siste aksjedata fra EODHD og lagrer dem i Supabase.
 * Senere kan denne kalles automatisk av en cron-jobb.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request))
    return Response.json({ error: "Ingen tilgang" }, { status: 401 });
  try {
    const stocks = await fetchAllStocks();
    if (!stocks.length)
      return Response.json(
        { ok: false, error: "Ingen kursdata tilgjengelig" },
        { status: 503 },
      );
    await saveStockPrices(stocks);

    return Response.json({
      ok: true,
      message: `Lagret ${stocks.length} aksjer`,
      synced: stocks.map((s) => s.symbol),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Kunne ikke lagre kursdata." },
      { status: 500 },
    );
  }
}
