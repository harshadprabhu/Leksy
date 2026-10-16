import { z } from "zod";

export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  type: z.enum(["rating", "nps", "choice", "multi", "text"]),
  label: z.string().max(300),
  options: z.array(z.string().max(80)).max(20).optional(),
  required: z.boolean().default(false),
  /** How a 1–5 rating is asked: five faces from sad to happy, or stars. */
  style: z.enum(["faces", "stars"]).optional(),
  /** Show only when an earlier answer matches, e.g. { question: "overall", op: "lte", value: 3 }. */
  showIf: z.object({ question: z.string(), op: z.enum(["lte", "gte", "eq", "includes"]), value: z.union([z.number(), z.string()]) }).optional(),
});

export const SurveySchema = z.object({
  title: z.string().max(200).default("How was your visit?"),
  thankYou: z.string().max(300).default("Thank you! Your feedback goes straight to the store team."),
  /** The question whose 1–5 answer drives alerts and review prompts. */
  primary: z.string().default("overall"),
  questions: z.array(QuestionSchema).min(1).max(30),
});

export type Survey = z.infer<typeof SurveySchema>;
export type Question = z.infer<typeof QuestionSchema>;

export const MISSION_HAPPINESS: Survey = SurveySchema.parse({
  title: "Mission Happiness",
  questions: [
    { id: "overall", type: "rating", style: "faces", label: "How happy are you with your visit today?", required: true },
    { id: "improve", type: "multi", label: "What could we do better?", options: ["Store ambience", "Staff help", "Product range", "Waiting time", "Billing", "Pricing"], showIf: { question: "overall", op: "lte", value: 3 } },
    { id: "loved", type: "multi", label: "What did you love?", options: ["Store ambience", "Staff help", "Product range", "Quick billing", "Pricing"], showIf: { question: "overall", op: "gte", value: 4 } },
    { id: "ambience", type: "rating", label: "How was the store ambience?" },
    { id: "staff", type: "rating", label: "How helpful was our staff?" },
    { id: "nps", type: "nps", label: "How likely are you to recommend us to a friend?" },
    { id: "comment", type: "text", label: "Anything else you'd like to tell us?" },
  ],
});

/** Validate answers against the survey, dropping unknown or hidden questions. */
export function cleanAnswers(survey: Survey, raw: Record<string, unknown>): { answers: Record<string, unknown>; errors: string[] } {
  const answers: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const q of survey.questions) {
    if (q.showIf) {
      const prev = answers[q.showIf.question];
      const v = q.showIf.value;
      const visible =
        q.showIf.op === "lte" ? Number(prev) <= Number(v) : q.showIf.op === "gte" ? Number(prev) >= Number(v) : q.showIf.op === "eq" ? String(prev) === String(v) : Array.isArray(prev) && prev.includes(v);
      if (!visible) continue;
    }
    const a = raw[q.id];
    if (a === undefined || a === null || a === "") {
      if (q.required) errors.push(`${q.id} is required`);
      continue;
    }
    switch (q.type) {
      case "rating": {
        const n = Number(a);
        if (Number.isInteger(n) && n >= 1 && n <= 5) answers[q.id] = n;
        else errors.push(`${q.id} must be 1–5`);
        break;
      }
      case "nps": {
        const n = Number(a);
        if (Number.isInteger(n) && n >= 0 && n <= 10) answers[q.id] = n;
        else errors.push(`${q.id} must be 0–10`);
        break;
      }
      case "choice":
        if (typeof a === "string" && (q.options ?? []).includes(a)) answers[q.id] = a;
        else errors.push(`${q.id} has an unknown option`);
        break;
      case "multi":
        if (Array.isArray(a)) answers[q.id] = a.filter((x) => typeof x === "string" && (q.options ?? []).includes(x));
        break;
      case "text":
        answers[q.id] = String(a).slice(0, 2000);
        break;
    }
  }
  return { answers, errors };
}
