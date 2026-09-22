import type { WatchedStock } from "./watchlist";

type CompanyNames = Pick<WatchedStock, "name" | "aliases">;

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function stockNames(stock: CompanyNames): string[] {
  return uniqueNames([stock.name, ...(stock.aliases ?? [])]);
}

export function quotedStockNames(stock: CompanyNames): string[] {
  return uniqueNames(
    stockNames(stock).map((name) => name.replace(/["()\\]/g, "")),
  ).map((name) => `"${name}"`);
}

// Samme Unicode-grenser og escaping for nyhetsoverskrifter og foruminnlegg.
export function namePattern(names: readonly string[]): RegExp {
  const alternatives = uniqueNames(names).map((name) =>
    name
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*"),
  );
  if (!alternatives.length) return new RegExp("(?!)", "u");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
}
