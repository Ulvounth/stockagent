import Link from "next/link";
import { readRedditPosts } from "@/lib/reddit";
import type { StockDigest } from "@/lib/daily-types";
import { formatOsloTime, osloDate } from "@/lib/schedule";

export async function RedditDiscussions({
  digest,
  page = 1,
}: {
  digest: StockDigest;
  page?: number;
}) {
  if (digest.redditPostIds === undefined) return null;
  const result = await readRedditPosts(digest.redditPostIds, page);
  const sectionId = `reddit-${digest.symbol}`;
  const pageHref = (page: number) => {
    const query = new URLSearchParams({
      date: osloDate(new Date(digest.windowEnd)),
      redditPage: String(page),
    });
    return `/stocks/${encodeURIComponent(digest.symbol)}?${query}#${sectionId}`;
  };
  const source = digest.sources.find(
    (item) => item.provider === "Reddit · diskusjoner",
  );
  return (
    <section
      id={sectionId}
      className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6"
      aria-label={`Reddit-diskusjoner om ${digest.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Reddit-diskusjoner</h4>
        <span className="badge badge-amber">Påstander er ubekreftet</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Innlegg funnet av morgenjobben. Titlene kontrolleres hos Reddit når
        siden åpnes. Slettede eller utilgjengelige innlegg vises ikke.
      </p>
      {result.error ? (
        <p role="status" className="notice mt-3">
          {result.error}
        </p>
      ) : result.posts.length ? (
        <ul className="mt-4 space-y-4">
          {result.posts.map((post) => (
            <li key={post.id}>
              <p className="mb-1 text-xs text-slate-500">
                r/{post.subreddit} ·{" "}
                <time dateTime={post.publishedAt}>
                  {formatOsloTime(post.publishedAt)}
                </time>
              </p>
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium leading-6 hover:text-teal-700 hover:underline"
              >
                {post.title} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {source && !source.ok
            ? "Søket var ufullstendig. Se kildestatus."
            : digest.redditPostIds.length
              ? "Ingen av de lagrede referansene er tilgjengelige for visning nå."
              : "Ingen relevante innlegg funnet i de valgte subredditene i dette tidsrommet."}
        </p>
      )}
      {result.pageCount > 1 && (
        <nav
          aria-label={`Flere Reddit-innlegg om ${digest.name}`}
          className="mt-4 flex flex-wrap items-center gap-4 text-xs"
        >
          <span className="text-slate-500">
            Side {result.page} av {result.pageCount} · {result.total} lagrede
            referanser
          </span>
          {result.page > 1 && (
            <Link
              prefetch={false}
              href={pageHref(result.page - 1)}
              className="font-medium text-teal-700 hover:underline"
            >
              ← Forrige
            </Link>
          )}
          {result.page < result.pageCount && (
            <Link
              prefetch={false}
              href={pageHref(result.page + 1)}
              className="font-medium text-teal-700 hover:underline"
            >
              Neste →
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
