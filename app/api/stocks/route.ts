import { fetchAllStocks } from "@/lib/eodhd";
import { connection } from "next/server";

export async function GET() {
  await connection();
  try {
    const stocks = await fetchAllStocks();
    if (!stocks.length)
      return Response.json(
        { error: "Kursdata er utilgjengelige." },
        { status: 503 },
      );
    return Response.json({ stocks });
  } catch {
    return Response.json(
      { error: "Kursdata er utilgjengelige." },
      { status: 500 },
    );
  }
}
