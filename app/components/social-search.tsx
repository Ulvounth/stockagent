import type { WatchedStock } from "@/lib/watchlist";
import { socialSearchLinks } from "@/lib/social-links";
import { redditEnabled } from "@/lib/reddit";

export function SocialSearch({ stocks }: { stocks: WatchedStock[] }) {
  return (
    <section className="panel my-8 p-5 sm:p-6" aria-labelledby="social-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="social-heading" className="text-lg font-semibold">
          X og Reddit
        </h2>
        <span className="badge">Manuelle søk</span>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
        Åpne søk etter selskapet, navnealiaser og ticker på X eller Reddit.
        Lenkene søker etter nyere innlegg når du åpner dem, uavhengig av valgt
        rapportdato. Innlogging kan være nødvendig.
      </p>
      <ul className="mt-5 divide-y divide-slate-100">
        {stocks.map((stock) => {
          const links = socialSearchLinks(stock);
          return (
            <li
              key={stock.symbol}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm font-medium">{stock.name}</p>
                <p className="mt-1 font-mono text-xs text-slate-400">
                  {stock.symbol}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Søk på X", href: links.x },
                  { label: "Søk på Reddit", href: links.reddit },
                ].map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${link.label}: ${stock.name} (åpnes i ny fane)`}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700"
                  >
                    {link.label} <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        X sjekkes manuelt.{" "}
        {redditEnabled()
          ? "Reddit er valgt som kilde i morgenjobben. Se kildestatus i rapporten for resultatet."
          : "Automatisk Reddit-innhenting er ikke aktivert ennå."}{" "}
        Søkeknappene starter ikke agenten og lagrer ikke innlegg i rapporten.
      </p>
    </section>
  );
}
