import { fetchAllStocks } from "@/lib/eodhd";

export async function GET() {
  try {
    const stocks = await fetchAllStocks();
    return Response.json({ stocks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil";
    return Response.json({ error: message }, { status: 500 });
  }
}
