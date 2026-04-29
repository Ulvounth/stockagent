import { fetchAllStocks } from "@/lib/eodhd";
import { saveStockPrices } from "@/lib/db";

/**
 * GET /api/sync
 * Henter siste aksjedata fra EODHD og lagrer dem i Supabase.
 * Senere kan denne kalles automatisk av en cron-jobb.
 */
export async function GET() {
  try {
    const stocks = await fetchAllStocks();
    await saveStockPrices(stocks);

    return Response.json({
      ok: true,
      message: `Lagret ${stocks.length} aksjer`,
      synced: stocks.map((s) => s.symbol),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
