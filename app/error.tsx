"use client";

import Link from "next/link";

// Feilgrensen dekker sidene, ikke layouten, så menyen og sidepanelet blir stående.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8">
      <section className="panel p-8">
        <p className="eyebrow">NOE GIKK GALT</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Siden kunne ikke vises
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          Lagrede rapporter er ikke berørt. Feilen oppsto da siden ble bygget
          opp, og et nytt forsøk går ofte gjennom.
        </p>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-slate-400">
            Feilreferanse: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Prøv igjen
          </button>
          <Link
            href="/"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700"
          >
            Til oversikten
          </Link>
        </div>
      </section>
    </main>
  );
}
