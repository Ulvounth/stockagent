export const REPORT_TIME_ZONE = "Europe/Oslo";

export function osloDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatOsloTime(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function isReportDue(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORT_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 9;
}

export function newsWindow(now: Date, previousEnd?: string) {
  const maximumLookback = now.getTime() - 7 * 86_400_000;
  const previous = previousEnd ? Date.parse(previousEnd) : NaN;
  const start =
    Number.isFinite(previous) && previous < now.getTime()
      ? Math.max(previous, maximumLookback)
      : now.getTime() - 48 * 3_600_000;
  return {
    from: new Date(start).toISOString(),
    to: now.toISOString(),
    capped: Number.isFinite(previous) && previous < maximumLookback,
  };
}
