import { supabaseAdmin } from "./supabase";
import { StockWithChange } from "./types";

/**
 * Lagrer en liste med aksjedata til Supabase.
 * Hvis samme symbol+dato allerede finnes, oppdateres raden (upsert).
 */
export async function saveStockPrices(
  stocks: StockWithChange[],
): Promise<void> {
  const rows = stocks.map((s) => ({
    symbol: s.symbol,
    date: s.date,
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.close,
    adjusted_close: s.adjusted_close,
    volume: s.volume,
    change_pct: s.change_pct,
    prev_close: s.prev_close,
    avg_volume: s.avg_volume,
    vol_ratio: s.vol_ratio,
  }));

  const { error } = await supabaseAdmin
    .from("stock_prices")
    .upsert(rows, { onConflict: "symbol,date" });

  if (error) {
    throw new Error(`Supabase lagringsfeil: ${error.message}`);
  }
}
