import { checkCondition, type Condition } from "@leksy/template-engine";
import { and, asc, eq } from "drizzle-orm";
import { triggers, type Db, type TriggerActions } from "../db/index.js";

export const DEFAULT_ACTIONS: TriggerActions = { templateKey: "luxe-gold", surveyKey: "project-wow", channels: ["whatsapp", "sms", "email"] };

/** First enabled trigger (lowest priority number) whose conditions all hold. */
export async function matchTrigger(db: Db, brandId: string, event: "bill.created" | "bill.updated", bill: Record<string, unknown>) {
  const rules = await db.query.triggers.findMany({
    where: and(eq(triggers.brandId, brandId), eq(triggers.enabled, true), eq(triggers.event, event)),
    orderBy: [asc(triggers.priority), asc(triggers.createdAt)],
  });
  return rules.find((r) => r.conditions.every((c) => checkCondition(c as Condition, bill))) ?? null;
}
