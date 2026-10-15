import type { Bill } from "@leksy/bill-schema";
import { eq } from "drizzle-orm";
import { bills, events, feedback, type Db } from "../db/index.js";
import { cleanAnswers, type Survey } from "../survey.js";

export interface FeedbackOutcome {
  id: string;
  rating: number;
  alert: boolean;
  askReview: boolean;
}

export class FeedbackError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

/** Record a survey response once per bill and decide on alert / review prompt. */
export async function submitFeedback(
  db: Db,
  bill: typeof bills.$inferSelect,
  survey: Survey,
  thresholds: { alert: number; review: number; slaMinutes: number },
  raw: Record<string, unknown>,
): Promise<FeedbackOutcome> {
  const { answers, errors } = cleanAnswers(survey, raw);
  if (errors.length) throw new FeedbackError(errors.join("; "));
  const rating = Number(answers[survey.primary]);
  if (!Number.isInteger(rating)) throw new FeedbackError("missing rating");
  const alert = rating <= thresholds.alert;
  const askReview = rating >= thresholds.review;
  const data = bill.data as Bill;
  const npsQ = survey.questions.find((q) => q.type === "nps");
  const textQ = survey.questions.find((q) => q.type === "text");
  const row = await db
    .insert(feedback)
    .values({
      billId: bill.id,
      brandId: bill.brandId,
      storeCode: bill.storeCode,
      staffId: data.staff?.id,
      rating,
      nps: npsQ && typeof answers[npsQ.id] === "number" ? (answers[npsQ.id] as number) : null,
      answers,
      comment: textQ ? ((answers[textQ.id] as string | undefined) ?? null) : null,
      ticketStatus: alert ? "open" : "none",
      slaDueAt: alert ? new Date(Date.now() + thresholds.slaMinutes * 60_000) : null,
      reviewPrompted: askReview,
    })
    .onConflictDoNothing({ target: feedback.billId })
    .returning({ id: feedback.id });
  if (!row[0]) throw new FeedbackError("feedback already submitted for this bill", 409);
  await db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "feedback.submitted", data: { rating, alert } });
  return { id: row[0].id, rating, alert, askReview };
}
