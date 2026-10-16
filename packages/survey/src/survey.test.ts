import { describe, expect, it } from "vitest";
import { cleanAnswers, FACE_LABELS, faceSvg, MISSION_HAPPINESS, SurveySchema, surveyHtml } from "./index.js";

describe("happiness faces", () => {
  it("asks the main question with five faces, sad to happy", () => {
    const html = surveyHtml(MISSION_HAPPINESS, "How was it?", false);
    expect(html).toContain('class="lx-faces"');
    for (const [i, l] of FACE_LABELS.entries()) expect(html).toContain(`data-v="${i + 1}" aria-label="${l}"`);
    expect(html.match(/class="lx-face"/g)).toHaveLength(5);
    // Other rating questions keep stars.
    expect(html).toContain('class="lx-stars"');
  });
  it("records the tapped face as a 1–5 rating", () => {
    expect(cleanAnswers(MISSION_HAPPINESS, { overall: 1 }).answers.overall).toBe(1);
    expect(cleanAnswers(MISSION_HAPPINESS, { overall: 5 }).answers.overall).toBe(5);
    expect(cleanAnswers(MISSION_HAPPINESS, { overall: 6 }).errors).toEqual(["overall must be 1–5"]);
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
