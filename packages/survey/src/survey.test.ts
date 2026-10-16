import { describe, expect, it } from "vitest";
import { cleanAnswers, FACE_LABELS, faceSvg, PROJECT_WOW, SurveySchema, surveyHtml } from "./index.js";

describe("happiness faces", () => {
  it("asks the main question with five faces, sad to happy", () => {
    const html = surveyHtml({ ...PROJECT_WOW, oneTap: false }, "How was it?", false);
    expect(html).toContain('class="lx-faces"');
    for (const [i, l] of FACE_LABELS.entries()) expect(html).toContain(`data-v="${i + 1}" aria-label="${l}"`);
    expect(html.match(/class="lx-face"/g)).toHaveLength(5);
    // Other rating questions keep stars.
    expect(html).toContain('class="lx-stars"');
  });
  it("records the tapped face as a 1–5 rating", () => {
    expect(cleanAnswers(PROJECT_WOW, { overall: 1 }).answers.overall).toBe(1);
    expect(cleanAnswers(PROJECT_WOW, { overall: 5 }).answers.overall).toBe(5);
    expect(cleanAnswers(PROJECT_WOW, { overall: 6 }).errors).toEqual(["overall must be 1–5"]);
  });
  it("draws a different face for each rating and clamps out-of-range values", () => {
    const faces = [1, 2, 3, 4, 5].map((n) => faceSvg(n));
    expect(new Set(faces).size).toBe(5);
    expect(faceSvg(0)).toBe(faces[0]);
    expect(faceSvg(9)).toBe(faces[4]);
  });
  it("keeps older surveys valid and lets brands choose stars", () => {
    const s = SurveySchema.parse({ questions: [{ id: "overall", type: "rating", label: "Rate us", style: "stars" }] });
    expect(surveyHtml(s, "t", false)).not.toContain("lx-faces");
  });
});

describe("one-tap Project WOW", () => {
  it("asks only the happiness faces, and nothing once answered", () => {
    expect(PROJECT_WOW.oneTap).toBe(true);
    const html = surveyHtml(PROJECT_WOW, "How was it?", false);
    expect(html).toContain('id="lx-wow"');
    expect(html.match(/data-v="/g)).toHaveLength(5);
    expect(html).not.toContain("lx-submit");
    expect(html).not.toContain("<textarea");
    expect(surveyHtml(PROJECT_WOW, "How was it?", true)).toBe("");
  });
  it("still validates a single tap as a complete answer", () => {
    expect(cleanAnswers(PROJECT_WOW, { overall: 4 })).toEqual({ answers: { overall: 4 }, errors: [] });
  });
});
