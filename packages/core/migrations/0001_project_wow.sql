ALTER TABLE "bills" DROP COLUMN "otp_lock";--> statement-breakpoint
UPDATE "triggers" SET "actions" = "actions" - 'otpLock' WHERE "actions" ? 'otpLock';--> statement-breakpoint
UPDATE "surveys" SET "key" = 'project-wow', "name" = CASE WHEN "name" = 'Mission Happiness' THEN 'Project WOW' ELSE "name" END, "body" = jsonb_set(CASE WHEN "body"->>'title' = 'Mission Happiness' THEN jsonb_set("body", '{title}', '"Project WOW"') ELSE "body" END, '{oneTap}', 'true') WHERE "key" = 'mission-happiness' AND NOT EXISTS (SELECT 1 FROM "surveys" s2 WHERE s2."brand_id" = "surveys"."brand_id" AND s2."key" = 'project-wow');--> statement-breakpoint
UPDATE "triggers" SET "actions" = jsonb_set("actions", '{surveyKey}', '"project-wow"') WHERE "actions"->>'surveyKey' = 'mission-happiness';--> statement-breakpoint
UPDATE "bills" SET "survey_key" = 'project-wow' WHERE "survey_key" = 'mission-happiness';
