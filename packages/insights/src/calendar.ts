/**
 * Indian retail calendar used as forecast signals. Dates are approximate (they
 * follow the lunar calendar); brands can override them per region.
 */
export interface Festival {
  name: string;
  date: string;
  /** Typical lift for jewellery sales in the festival week, used as a prior. */
  weight: number;
}

export const FESTIVALS: Festival[] = [
  { name: "Akshaya Tritiya", date: "2024-05-10", weight: 1 },
  { name: "Dhanteras", date: "2024-10-29", weight: 1 },
  { name: "Diwali", date: "2024-11-01", weight: 1 },
  { name: "Akshaya Tritiya", date: "2025-04-30", weight: 1 },
  { name: "Dhanteras", date: "2025-10-18", weight: 1 },
  { name: "Diwali", date: "2025-10-20", weight: 1 },
  { name: "Akshaya Tritiya", date: "2026-04-20", weight: 1 },
  { name: "Dhanteras", date: "2026-11-06", weight: 1 },
  { name: "Diwali", date: "2026-11-08", weight: 1 },
  { name: "Akshaya Tritiya", date: "2027-05-09", weight: 1 },
  { name: "Dhanteras", date: "2027-10-27", weight: 1 },
  { name: "Diwali", date: "2027-10-29", weight: 1 },
];

/** Peak wedding-shopping months (Nov–Feb, Apr–Jun). */
export const isWeddingSeason = (iso: string) => [11, 12, 1, 2, 4, 5, 6].includes(Number(iso.slice(5, 7)));

export function festivalsBetween(from: string, to: string) {
  return FESTIVALS.filter((f) => f.date >= from && f.date <= to);
}
