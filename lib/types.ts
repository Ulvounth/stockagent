export type StockWithChange = {
  symbol: string;
  name: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  change_pct: number | null;
  prev_close: number | null;
  avg_volume: number | null;
  vol_ratio: number | null;
};

export type HistoricalRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change_pct: number | null;
};

export type NewsItem = {
  date: string;
  title: string;
  link: string;
  content: string;
  source?: string;
};
