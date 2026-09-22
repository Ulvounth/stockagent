export type WatchedStock = {
  symbol: string;
  name: string;
  aliases?: string[];
};

// Denne listen styrer både appen og den daglige nyhetsjobben.
// Bruk presise selskapsnavn som aliaser; korte tickere gir ofte irrelevante treff.
export const WATCHLIST: WatchedStock[] = [
  { symbol: "SOMA.OL", name: "Solstad Maritime" },
  {
    symbol: "NOD.OL",
    name: "Nordic Semiconductor",
    aliases: ["Nordic Semiconductor ASA"],
  },
  {
    symbol: "KOG.OL",
    name: "Kongsberg Gruppen",
    aliases: ["Kongsberg Gruppen ASA"],
  },
  { symbol: "KIT.OL", name: "Kitron", aliases: ["Kitron ASA"] },
  { symbol: "SOFF.OL", name: "Solstad Offshore" },
];
