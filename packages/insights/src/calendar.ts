/**
 * Indian retail calendar used as forecast signals and for the festival playbook.
 * Lunar festival dates are approximate (they follow the panchang and can vary by a
 * day between regions); brands can extend or override them.
 */

export type Region = "North" | "South" | "East" | "West";
export const REGIONS: Region[] = ["North", "South", "East", "West"];

export interface Festival {
  name: string;
  date: string;
  /** "National" moments lift every store; regional ones lift only that region. */
  regions: Region[] | "National";
}

/** Playbook: crisp, actionable levers for each occasion. */
export interface Play {
  push: string;
  stock: string;
  activate: string;
}

export const PLAYBOOK: Record<string, Play> = {
  Dhanteras: { push: "Gold & silver coins, bars, light 22K", stock: "Coins 1–20 g ×3; billing counters ×2", activate: "Rate-lock pre-booking from 21 days out; open 9am–11pm" },
  Diwali: { push: "Diamond gifting, festive sets", stock: "Gift-wrapped ₹25k–1L SKUs", activate: "Corporate gifting desk; WhatsApp to past gifters" },
  "Akshaya Tritiya": { push: "Coins, bars, bridal pre-booking", stock: "Coins & 24K bars ×2", activate: "Advance booking 4 weeks out; digital-gold option" },
  "Karva Chauth": { push: "Light pendants, mangalsutra, couple bands", stock: "₹25k–75k light 18K/22K +30%", activate: "Targeted WhatsApp to married buyers, 10 days out" },
  Lohri: { push: "Newlywed & baby gifting, coins", stock: "Coins 1–5 g, kids' bangles", activate: "Family offers for first-Lohri households" },
  Dussehra: { push: "Gold coins (auspicious buy), festive sets", stock: "Coins + Navratri colour sets", activate: "Evening slots; extend hours on Dussehra" },
  "Raksha Bandhan": { push: "Gifts for sisters: earrings, silver", stock: "₹10k–30k earrings, silver rakhis", activate: "Pre-order + same-day pickup" },
  Pongal: { push: "Temple jewellery, kasu mala, coins", stock: "Traditional 22K +25%", activate: "Tamil-language campaigns; family buying offers" },
  Ugadi: { push: "New-year auspicious gold, coins", stock: "Coins & light 22K", activate: "Telugu/Kannada campaigns; booking schemes" },
  Onam: { push: "Kerala traditional: palakka mala, kasavu-match sets", stock: "Traditional sets +30% in Kerala stores", activate: "10-day Onam window; Malayalam creatives" },
  "Durga Puja": { push: "Light necklaces, Pujo collection, Bengali bridal", stock: "Light 22K +30% from 3 weeks out", activate: "Peak buying 2 weeks before Ashtami; pandal-area outreach" },
  "Poila Baisakh": { push: "New-year gold, advance booking", stock: "Coins & daily-wear 22K", activate: "Halkhata-style loyalty for regular buyers" },
  "Gudi Padwa": { push: "Auspicious gold, gold coins", stock: "Coins & Maharashtrian nath/thushi", activate: "Marathi campaigns; pre-booking" },
  Navratri: { push: "Garba-ready oxidised & light gold", stock: "Fashion silver & light 18K", activate: "Gujarat stores: 9-night evening events" },
  "Ganesh Chaturthi": { push: "Silver idols & coins, festive light gold", stock: "Silver ×2 in West stores", activate: "Mandal partnerships; 10-day window" },
  "Wedding season": { push: "Bridal sets, diamond solitaires", stock: "Bridal & heavy 22K; old-gold exchange", activate: "Appointment-only bridal consultations" },
};

export const FESTIVALS: Festival[] = [
  // National
  { name: "Akshaya Tritiya", date: "2024-05-10", regions: "National" },
  { name: "Dhanteras", date: "2024-10-29", regions: "National" },
  { name: "Diwali", date: "2024-11-01", regions: "National" },
  { name: "Akshaya Tritiya", date: "2025-04-30", regions: "National" },
  { name: "Dhanteras", date: "2025-10-18", regions: "National" },
  { name: "Diwali", date: "2025-10-20", regions: "National" },
  { name: "Akshaya Tritiya", date: "2026-04-20", regions: "National" },
  { name: "Dhanteras", date: "2026-11-06", regions: "National" },
  { name: "Diwali", date: "2026-11-08", regions: "National" },
  { name: "Akshaya Tritiya", date: "2027-05-09", regions: "National" },
  { name: "Dhanteras", date: "2027-10-27", regions: "National" },
  { name: "Diwali", date: "2027-10-29", regions: "National" },
  // North
  { name: "Lohri", date: "2025-01-13", regions: ["North"] },
  { name: "Raksha Bandhan", date: "2025-08-09", regions: ["North"] },
  { name: "Dussehra", date: "2025-10-02", regions: ["North"] },
  { name: "Karva Chauth", date: "2025-10-10", regions: ["North"] },
  { name: "Lohri", date: "2026-01-13", regions: ["North"] },
  { name: "Raksha Bandhan", date: "2026-08-28", regions: ["North"] },
  { name: "Dussehra", date: "2026-10-20", regions: ["North"] },
  { name: "Karva Chauth", date: "2026-10-29", regions: ["North"] },
  { name: "Lohri", date: "2027-01-13", regions: ["North"] },
  // South
  { name: "Pongal", date: "2025-01-14", regions: ["South"] },
  { name: "Ugadi", date: "2025-03-30", regions: ["South"] },
  { name: "Onam", date: "2025-09-05", regions: ["South"] },
  { name: "Pongal", date: "2026-01-14", regions: ["South"] },
  { name: "Ugadi", date: "2026-03-19", regions: ["South"] },
  { name: "Onam", date: "2026-08-26", regions: ["South"] },
  { name: "Pongal", date: "2027-01-14", regions: ["South"] },
  { name: "Ugadi", date: "2027-04-07", regions: ["South"] },
  // East
  { name: "Poila Baisakh", date: "2025-04-15", regions: ["East"] },
  { name: "Durga Puja", date: "2025-09-30", regions: ["East"] },
  { name: "Poila Baisakh", date: "2026-04-15", regions: ["East"] },
  { name: "Durga Puja", date: "2026-10-18", regions: ["East"] },
  { name: "Poila Baisakh", date: "2027-04-15", regions: ["East"] },
  // West
  { name: "Gudi Padwa", date: "2025-03-30", regions: ["West"] },
  { name: "Ganesh Chaturthi", date: "2025-08-27", regions: ["West"] },
  { name: "Navratri", date: "2025-09-22", regions: ["West"] },
  { name: "Gudi Padwa", date: "2026-03-19", regions: ["West"] },
  { name: "Ganesh Chaturthi", date: "2026-09-14", regions: ["West"] },
  { name: "Navratri", date: "2026-10-11", regions: ["West"] },
  { name: "Gudi Padwa", date: "2027-04-07", regions: ["West"] },
];

/** Festivals that matter for a set of regions (national ones always included). */
export function festivalsFor(regions?: Region[]): Festival[] {
  if (!regions?.length) return FESTIVALS.filter((f) => f.regions === "National");
  return FESTIVALS.filter((f) => f.regions === "National" || f.regions.some((r) => regions.includes(r)));
}

/** Peak wedding-shopping months (Nov–Feb, Apr–Jun). */
export const isWeddingSeason = (iso: string) => [11, 12, 1, 2, 4, 5, 6].includes(Number(iso.slice(5, 7)));

export function festivalsBetween(from: string, to: string, list: Festival[] = FESTIVALS) {
  return list.filter((f) => f.date >= from && f.date <= to);
}

const CITY_REGION: Record<string, Region> = Object.fromEntries(
  (
    [
      ["North", "delhi,new delhi,gurugram,gurgaon,noida,chandigarh,jaipur,lucknow,ludhiana,amritsar,dehradun,kanpur,agra,varanasi,jammu"],
      ["South", "bengaluru,bangalore,chennai,hyderabad,kochi,cochin,coimbatore,madurai,visakhapatnam,vizag,mysuru,mysore,thiruvananthapuram,trivandrum,vijayawada,thrissur"],
      ["East", "kolkata,calcutta,bhubaneswar,guwahati,patna,ranchi,siliguri,cuttack"],
      ["West", "mumbai,pune,ahmedabad,surat,vadodara,nagpur,goa,panaji,indore,rajkot,nashik,thane"],
    ] as const
  ).flatMap(([region, cities]) => cities.split(",").map((c) => [c, region as Region])),
);

/** A store's region: set explicitly, or inferred from its city. */
export function regionOf(store: { region?: string; city?: string }): Region | null {
  if (store.region && (REGIONS as string[]).includes(store.region)) return store.region as Region;
  const c = (store.city ?? "").toLowerCase().trim();
  return CITY_REGION[c] ?? null;
}
