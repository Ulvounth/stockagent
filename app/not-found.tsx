import Link from "next/link";
import { WATCHLIST } from "@/lib/watchlist";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8">
      <section className="panel p-8">
        <p className="eyebrow">FANT IKKE SIDEN</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Denne siden finnes ikke
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          Adressen kan være utdatert, eller aksjen står ikke på
          overvåkingslisten. Disse følges nå:
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {WATCHLIST.map((stock) => (
            <li key={stock.symbol}>
              <Link
                href={`/stocks/${stock.symbol}`}
                className="inline-block rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700"
              >
                {stock.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Til oversikten
        </Link>
      </section>
    </main>
  );
}
