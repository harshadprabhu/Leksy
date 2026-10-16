/**
 * What may leave the company, and only when an admin allows it and the user
 * chooses to: a text brief of aggregates. It never includes customer names,
 * phone numbers, emails, invoice numbers or free-text comments. Store names can
 * be masked and money can be turned into an index so absolute sales stay private.
 */
import type { Answer } from "./ask.js";
import type { Dataset } from "./dataset.js";

export interface SharePolicy {
  /** Admin switch; off by default. */
  allowExternal: boolean;
  /** Replace store names with "Store A", "Store B"… */
  maskStores: boolean;
  /** Replace rupee amounts with an index (largest value = 100). */
  indexMoney: boolean;
  /** Which copilots appear for users. */
  copilots: CopilotId[];
}

export const DEFAULT_POLICY: SharePolicy = { allowExternal: false, maskStores: true, indexMoney: false, copilots: ["copilot", "chatgpt", "claude", "gemini"] };

export type CopilotId = "copilot" | "chatgpt" | "claude" | "gemini";

export const COPILOTS: Record<CopilotId, { name: string; url: string; note: string }> = {
  copilot: { name: "Microsoft Copilot", url: "https://copilot.microsoft.com/", note: "Use your company's Microsoft 365 sign-in so your organisation's data protections apply." },
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", note: "Use a business plan if your company has one." },
  claude: { name: "Claude", url: "https://claude.ai/new", note: "Use your company's Claude workspace if you have one." },
  gemini: { name: "Gemini", url: "https://gemini.google.com/app", note: "Use your Google Workspace account if your company has one." },
};

const MONEY = /₹\s?([\d,]+(?:\.\d+)?)\s?(Cr|L)?/g;

function moneyValue(m: string, unit?: string) {
  const n = Number(m.replace(/,/g, ""));
  return unit === "Cr" ? n * 1e7 : unit === "L" ? n * 1e5 : n;
}

/** Build the brief, applying the policy. Returns the exact text that would be shared. */
export function buildBrief(answers: Answer[], ds: Dataset, policy: SharePolicy, question?: string): string {
  const lines: string[] = [];
  lines.push("You are helping a retail business analyse its own summarised data. Figures are aggregates only; no customer data is included.");
  lines.push(`Business: ${policy.maskStores ? "a jewellery retailer in India" : ds.brand}. Data as of ${ds.asOf}.`);
  if (policy.indexMoney) lines.push("Money values are shown as an index where the largest value in this brief = 100.");
  lines.push("");
  for (const a of answers) {
    lines.push(`## ${a.title}`);
    for (const s of a.summary) lines.push(`- ${s}`);
    if (a.table && a.table.rows.length) {
      lines.push(`| ${a.table.columns.join(" | ")} |`);
      lines.push(`| ${a.table.columns.map(() => "---").join(" | ")} |`);
      for (const r of a.table.rows.slice(0, 30)) lines.push(`| ${r.join(" | ")} |`);
    }
    lines.push("");
  }
  if (question) lines.push(`Question: ${question}`);
  else lines.push("Question: What else should we look at, and what would you recommend for the next 8 weeks?");
  let text = lines.join("\n");

  if (policy.maskStores) {
    const sorted = [...ds.stores].sort((a, b) => b.name.length - a.name.length);
    sorted.forEach((s) => {
      const alias = `Store ${String.fromCharCode(65 + ds.stores.indexOf(s))}`;
      for (const word of [s.name, s.code, s.city].filter(Boolean) as string[]) text = text.split(word).join(alias);
    });
    text = text.split(ds.brand).join("the business");
  }
  if (policy.indexMoney) {
    const values = [...text.matchAll(MONEY)].map((m) => moneyValue(m[1]!, m[2]));
    const max = Math.max(1, ...values);
    text = text.replace(MONEY, (_, n: string, unit?: string) => `idx ${((100 * moneyValue(n, unit)) / max).toFixed(1)}`);
  }
  return text;
}

/** Last line of defence: refuse to share text that looks like it holds personal data. */
export function findPersonalData(text: string): string[] {
  const hits: string[] = [];
  if (/(\+91[\s-]?)?[6-9]\d{9}\b/.test(text)) hits.push("a phone number");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) hits.push("an email address");
  if (/\b[A-Z]{3}-[A-Z]{3}-\d{4}-\d{5}\b/.test(text)) hits.push("an invoice number");
  return hits;
}
