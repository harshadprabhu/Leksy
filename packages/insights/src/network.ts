/**
 * A fictional national store network for demos and tests: N stores spread over
 * India's tier-1 metros and tier-2 cities in proportion to market size, with the
 * region and tier on every store. Names are generic; no real locations are used.
 */
import { regionOf } from "./calendar.js";
import type { StoreInfo } from "./dataset.js";

/** [city, tier, weight]: weight ≈ relative number of stores. */
const CITIES: [string, 1 | 2, number][] = [
  ["Mumbai", 1, 34], ["Delhi", 1, 34], ["Bengaluru", 1, 26], ["Hyderabad", 1, 22], ["Chennai", 1, 22], ["Kolkata", 1, 18], ["Pune", 1, 14], ["Ahmedabad", 1, 12],
  ["Gurugram", 1, 8], ["Noida", 1, 7], ["Navi Mumbai", 1, 5], ["Thane", 1, 6],
  ["Jaipur", 2, 9], ["Lucknow", 2, 8], ["Chandigarh", 2, 7], ["Ludhiana", 2, 5], ["Amritsar", 2, 4], ["Kanpur", 2, 4], ["Dehradun", 2, 3], ["Agra", 2, 3], ["Varanasi", 2, 3], ["Jodhpur", 2, 3], ["Udaipur", 2, 2],
  ["Surat", 2, 8], ["Vadodara", 2, 5], ["Rajkot", 2, 4], ["Nagpur", 2, 5], ["Indore", 2, 6], ["Bhopal", 2, 4], ["Nashik", 2, 3], ["Raipur", 2, 3], ["Goa", 2, 3], ["Aurangabad", 2, 2], ["Kolhapur", 2, 2],
  ["Coimbatore", 2, 7], ["Kochi", 2, 7], ["Madurai", 2, 5], ["Thiruvananthapuram", 2, 5], ["Thrissur", 2, 4], ["Visakhapatnam", 2, 5], ["Vijayawada", 2, 4], ["Mysuru", 2, 3], ["Mangaluru", 2, 3], ["Tiruchirappalli", 2, 3], ["Kozhikode", 2, 3], ["Hubballi", 2, 2], ["Salem", 2, 2],
  ["Bhubaneswar", 2, 4], ["Patna", 2, 4], ["Guwahati", 2, 4], ["Ranchi", 2, 3], ["Siliguri", 2, 2], ["Jamshedpur", 2, 2], ["Durgapur", 2, 2],
];

const AREAS = ["High Street", "City Centre", "Central Mall", "Market Road", "Ring Road", "Station Road", "Lake View", "Garden Plaza", "Civil Lines", "Park Avenue", "Main Bazaar", "Metro Mall", "Sector Plaza", "Old Town", "Riverside", "Tech Park"];

/** Deterministic network of `count` stores (same input → same stores). */
export function buildNetwork(brand: string, count = 400): StoreInfo[] {
  const totalW = CITIES.reduce((a, c) => a + c[2], 0);
  // Largest-remainder allocation so the counts add up to exactly `count`.
  const raw = CITIES.map(([, , w]) => (w / totalW) * count);
  const alloc = raw.map(Math.floor);
  let left = count - alloc.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left > 0) {
      alloc[i]! += 1;
      left -= 1;
    }
  });
  const stores: StoreInfo[] = [];
  const used = new Set<string>();
  CITIES.forEach(([city, tier], ci) => {
    // Three-letter city code, unique across the network (Kolkata KOL, Kolhapur KOH…).
    const letters = city.replace(/[^A-Za-z]/g, "").toUpperCase();
    let code3 = letters.slice(0, 3);
    for (let i = 2; used.has(code3) && i < letters.length; i++) code3 = letters.slice(0, 2) + letters[i];
    used.add(code3);
    for (let k = 0; k < alloc[ci]!; k++) {
      const area = AREAS[(ci * 7 + k) % AREAS.length]!;
      const n = Math.floor(k / AREAS.length);
      const store: StoreInfo = { code: `${code3}-${String(k + 1).padStart(3, "0")}`, name: `${brand ? `${brand} ` : ""}${city} ${area}${n ? ` ${n + 1}` : ""}`, city, tier };
      const region = regionOf(store);
      if (region) store.region = region;
      stores.push(store);
    }
  });
  return stores;
}

const CITY_TIER = new Map(CITIES.map(([c, t]) => [c.toLowerCase(), t]));
/** City tier for a known city (1 = metro, 2 = large city), or undefined. */
export function tierOf(city: string | null | undefined): 1 | 2 | undefined {
  return city ? CITY_TIER.get(city.toLowerCase().trim()) : undefined;
}
