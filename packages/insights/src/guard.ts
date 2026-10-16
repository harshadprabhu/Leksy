/**
 * Number guard for language-model wording. Every figure a model writes must
 * already appear in the computed answer it was given; anything else (a guess,
 * a sum it did itself, a typo) fails the check and the wording is not shown.
 */

interface Figure {
  n: string;
  /** A bare count ("3 actions"), not money, a percentage or an amount in lakh/crore. */
  bare: boolean;
}

function figures(text: string): Figure[] {
  const out: Figure[] = [];
  // Drop list markers ("1. ", "2) ") at line starts before scanning.
  const body = text.replace(/^\s*\d{1,2}[.)]\s+/gm, "");
  for (const m of body.matchAll(/(₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent|per cent|l\b|lakh|lac|cr\b|crore|k\b)?/gi)) {
    const n = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push({ n: String(n), bare: !m[1] && !m[3] && !m[2]!.includes(".") });
  }
  return out;
}

/** Numbers in a text, normalised ("₹1,23,456.50" → "123456.5", "+5.0%" → "5"). */
export function numbersIn(text: string): string[] {
  return figures(text).map((f) => f.n);
}

export interface GuardResult {
  ok: boolean;
  /** Figures in the wording that are not in the source. */
  unknown: string[];
}

/**
 * Check that every number in `wording` is present in `source`. Bare integers up
 * to 12 are allowed (counts such as "3 actions" or "top 5"); money, percentages
 * and decimals must always come from the source.
 */
export function guardNumbers(wording: string, source: string): GuardResult {
  const known = new Set(numbersIn(source));
  const unknown = [...new Set(figures(wording).filter((f) => !known.has(f.n) && !(f.bare && Number(f.n) <= 12)).map((f) => f.n))];
  return { ok: unknown.length === 0, unknown };
}
