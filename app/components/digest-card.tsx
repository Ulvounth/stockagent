import Link from "next/link";
import { Suspense } from "react";
import type { StockDigest } from "@/lib/daily-types";
import { formatOsloTime } from "@/lib/schedule";
import { RedditDiscussions } from "./reddit-discussions";

const labels = {
  news: "Medieomtale",
  announcement: "Selskapsmelding",
  rumor: "Mulig rykte · ubekreftet",
};

export function DigestCard({
  digest,
  redditPage = 1,
}: {
  digest: StockDigest;
  redditPage?: number;
}) {
  const failed = digest.sources.filter((source) => !source.ok);
  const newsSources = digest.sources.filter(
    (source) => source.provider !== "Reddit · diskusjoner",
  );
  return (
    <article className="panel overflow-hidden" id={digest.symbol}>
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 font-mono text-xs text-slate-500">
              {digest.symbol}
            </p>
            <h3 className="text-lg font-semibold tracking-tight">
              <Link
                className="hover:text-teal-700"
                href={`/stocks/${digest.symbol}`}
              >
                {digest.name}{" "}
                <span aria-hidden="true" className="text-slate-400">
                  ↗
                </span>
              </Link>
            </h3>
          </div>
          <span className="badge">{digest.articles.length} treff</span>
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {digest.summary}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {digest.summaryMode === "ai"
            ? "AI-oppsummering av overskrifter · kildenummer viser til listen under"
            : "Oversikt over innhentede overskrifter"}
        </p>
        {failed.length > 0 && (
          <p role="status" className="notice mt-4">
            Ufullstendig innhenting:{" "}
            {failed.map((source) => source.provider).join(", ")} svarte ikke.
          </p>
        )}
        {digest.warnings.map((warning) => (
          <p key={warning} className="mt-2 text-xs text-amber-800">
            {warning}
          </p>
        ))}
      </div>
      {digest.articles.length > 0 ? (
        <ol className="divide-y divide-slate-100">
          {digest.articles.map((article, index) => (
            <li key={article.id} className="px-5 py-4 sm:px-6">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span
                  className={
                    article.kind === "rumor"
                      ? "badge badge-amber"
                      : article.kind === "announcement"
                        ? "badge badge-teal"
                        : "badge"
                  }
                >
                  {labels[article.kind]}
                </span>
                <span>{article.source}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={article.publishedAt}>
                  {formatOsloTime(article.publishedAt)}
                </time>
              </div>
              <a
                className="text-sm font-medium leading-6 text-slate-800 hover:text-teal-700 hover:underline"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="mr-2 font-mono text-xs text-slate-400">
                  [{index + 1}]
                </span>
                {article.title} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-6 py-5 text-sm text-slate-500">
          {newsSources.every((source) => !source.ok)
            ? "Ingen nyhetskilder kunne kontrolleres."
            : "Ingen nye overskrifter funnet i de tilgjengelige kildene."}
        </p>
      )}
      {digest.redditPostIds !== undefined && (
        <Suspense
          fallback={
            <p className="border-t border-slate-100 p-5 text-xs text-slate-500">
              Kontrollerer Reddit-innlegg …
            </p>
          }
        >
          <RedditDiscussions digest={digest} page={redditPage} />
        </Suspense>
      )}
      <details className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">
        <summary className="cursor-pointer py-1 hover:text-slate-800">
          Tidsrom og kildedekning
        </summary>
        <p className="mt-3">
          Nyheter: {formatOsloTime(digest.windowStart)} –{" "}
          {formatOsloTime(digest.windowEnd)} (norsk tid)
        </p>
        {digest.redditWindowStart && digest.redditWindowEnd && (
          <p className="mt-2">
            Reddit: {formatOsloTime(digest.redditWindowStart)} –{" "}
            {formatOsloTime(digest.redditWindowEnd)} (norsk tid)
          </p>
        )}
        <ul className="my-3 space-y-2">
          {digest.sources.map((source) => (
            <li key={source.provider}>
              {source.provider}:{" "}
              {source.ok
                ? `${source.count} treff i siste forsøk`
                : `${source.error} (${source.count} treff i siste forsøk)`}
            </li>
          ))}
        </ul>
        <p className="mb-2 leading-5">
          Merking bygger på overskrift og kilde og er ikke en faktasjekk. Søkene
          dekker indeksert omtale, ikke alle nettsteder eller lukkede forum.
        </p>
      </details>
    </article>
  );
}
