"use client";
import { DEFAULT_POLICY, type Answer, type Dataset, type SharePolicy } from "@leksy/insights";

/** Brand-level AI settings, kept in brand.settings.ai (admins change them in Settings). */
export interface AiSettings {
  /** "builtin": Leksy's engine only. "ollama": also a language model on the company's own machine. */
  engine: "builtin" | "ollama";
  ollamaUrl: string;
  ollamaModel: string;
  share: SharePolicy;
}

export const DEFAULT_AI: AiSettings = { engine: "builtin", ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5:7b", share: DEFAULT_POLICY };

/** Company look for generated decks, kept in brand.settings.deck. */
export interface DeckTheme {
  company: string;
  primary: string;
  accent: string;
  text: string;
  headingFont: string;
  bodyFont: string;
  /** Logo as a data: URL (uploaded) or https URL. */
  logo?: string;
  footer: string;
}

export const DEFAULT_DECK = (company: string): DeckTheme => ({
  company,
  primary: "#2A2118",
  accent: "#B08D57",
  text: "#1D1A16",
  headingFont: "Georgia",
  bodyFont: "Calibri",
  footer: "Confidential. For internal use only.",
});

export function readAi(settings: Record<string, unknown> | undefined): AiSettings {
  const a = (settings?.ai ?? {}) as Partial<AiSettings>;
  return { ...DEFAULT_AI, ...a, share: { ...DEFAULT_POLICY, ...(a.share ?? {}) } };
}

export function readDeck(settings: Record<string, unknown> | undefined, company: string): DeckTheme {
  return { ...DEFAULT_DECK(company), ...((settings?.deck ?? {}) as Partial<DeckTheme>) };
}

const trimUrl = (u: string) => u.replace(/\/+$/, "");

/** Models installed in the company's local Ollama. Throws with a helpful message when unreachable. */
export async function ollamaModels(url: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${trimUrl(url)}/api/tags`);
  } catch {
    throw new Error(
      `Can't reach Ollama at ${url}. Start it with OLLAMA_ORIGINS=${typeof window !== "undefined" ? window.location.origin : "<this site>"} so this page may call it.`,
    );
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const j = (await res.json()) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}

async function ollamaChat(ai: AiSettings, system: string, user: string): Promise<string> {
  const res = await fetch(`${trimUrl(ai.ollamaUrl)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: ai.ollamaModel, stream: false, options: { temperature: 0.2 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const j = (await res.json()) as { message?: { content?: string } };
  return (j.message?.content ?? "").trim();
}

const RULES =
  "You are a retail analyst inside the company's own Leksy dashboard. Use ONLY the figures provided; never invent or estimate numbers that are not there. If the data cannot answer, say what is missing. Answer in 3-6 short bullet points in plain English, most important first, then one recommended action.";

/** Ask the local model to explain an answer the engine already computed. */
export async function localNarrative(ai: AiSettings, a: Answer): Promise<string> {
  const table = a.table ? `\nTable (${a.table.columns.join(" | ")}):\n${a.table.rows.slice(0, 25).map((r) => r.join(" | ")).join("\n")}` : "";
  return ollamaChat(ai, RULES, `Question: ${a.question}\nComputed results:\n${a.summary.map((s) => `- ${s}`).join("\n")}${table}`);
}

/** Open question the built-in engine did not recognise: answer from a compact local summary. */
export async function localFreeAnswer(ai: AiSettings, question: string, context: string): Promise<string> {
  return ollamaChat(ai, RULES, `Company data summary:\n${context}\n\nQuestion: ${question}`);
}

/** Compact, aggregate-only context for open questions to the local model. */
export function contextSummary(ds: Dataset, answers: Answer[]): string {
  const lines = answers.slice(0, 6).flatMap((a) => [`## ${a.title}`, ...a.summary.map((s) => `- ${s}`)]);
  return [`Brand ${ds.brand}, data as of ${ds.asOf}. Stores: ${ds.stores.map((s) => s.name).join(", ")}.`, ...lines].join("\n");
}
