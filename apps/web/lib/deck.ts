"use client";
import { buildLeadershipDeck, type Answer, type Dataset } from "@leksy/insights";
import type { DeckTheme } from "./ai";

/** Builds the leadership pack in the browser (nothing is uploaded) and downloads it. */
export async function buildDeck(ds: Dataset, theme: DeckTheme, answers: Answer[]): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = buildLeadershipDeck(PptxGenJS, { ds, theme, answers });
  await pptx.writeFile({ fileName: `${theme.company.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-leadership-pack-${ds.asOf}.pptx` });
}
