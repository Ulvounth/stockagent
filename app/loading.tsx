export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12" aria-busy="true">
      <p className="eyebrow">STOCKAGENT</p>
      <p role="status" className="mt-4 text-slate-500">
        Henter rapportene dine …
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            className="h-44 animate-pulse rounded-2xl bg-slate-100"
          />
        ))}
      </div>
    </main>
  );
}
