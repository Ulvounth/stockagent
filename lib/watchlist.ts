export type WatchedStock = {
  symbol: string;
  name: string;
  aliases?: string[];
};

// Denne listen styrer både appen og den daglige nyhetsjobben.
// Bruk presise selskapsnavn som aliaser; korte tickere gir ofte irrelevante treff.
export const WATCHLIST: WatchedStock[] = [
  { symbol: "SOMA.OL", name: "Solstad Maritime" },
  { symbol: "DOFG.OL", name: "DOF Group", aliases: ["DOF Group ASA"] },
  { symbol: "SUBC.OL", name: "Subsea 7", aliases: ["Subsea7"] },
  { symbol: "SALME.OL", name: "Salmon Evolution" },
  { symbol: "SOFF.OL", name: "Solstad Offshore" },
];
