import type { WatchedStock } from "./watchlist";
import { quotedStockNames } from "./stock-search";

export function socialQuery(stock: WatchedStock): string {
  const phrases = quotedStockNames(stock);
  const ticker = stock.symbol.replace(/\.OL$/, "");
  return [...phrases, `"${stock.symbol}"`, `$${ticker}`].join(" OR ");
}

export function socialSearchLinks(stock: WatchedStock) {
  const q = socialQuery(stock);
  return {
    x: `https://x.com/search?${new URLSearchParams({ q, f: "live" })}`,
    reddit: `https://www.reddit.com/search/?${new URLSearchParams({ q, sort: "new", t: "week", type: "posts" })}`,
  };
}
