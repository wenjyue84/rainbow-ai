CREATE TABLE "intent_classifier_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"intent_type" text NOT NULL,
	"accuracy_pct" real NOT NULL,
	"sample_count" integer NOT NULL,
	"baseline_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_hard_cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"confidence" real NOT NULL,
	"candidate_intents" jsonb,
	"reason" text,
	"profile" text DEFAULT 'pelangi' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regression_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"intent_type" text NOT NULL,
	"baseline_accuracy" real NOT NULL,
	"current_accuracy" real NOT NULL,
	"accuracy_drop" real NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_predictions" ADD COLUMN "profile" text;--> statement-breakpoint
ALTER TABLE "rainbow_conversations" ADD COLUMN "metadata" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_classifier_baselines_profile_intent" ON "intent_classifier_baselines" USING btree ("profile_id","intent_type");--> statement-breakpoint
CREATE INDEX "idx_classifier_baselines_profile_id" ON "intent_classifier_baselines" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_classifier_baselines_intent_type" ON "intent_classifier_baselines" USING btree ("intent_type");--> statement-breakpoint
CREATE INDEX "idx_classifier_baselines_baseline_date" ON "intent_classifier_baselines" USING btree ("baseline_date");--> statement-breakpoint
CREATE INDEX "idx_intent_hard_cases_profile" ON "intent_hard_cases" USING btree ("profile");--> statement-breakpoint
CREATE INDEX "idx_intent_hard_cases_intent_id" ON "intent_hard_cases" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_intent_hard_cases_confidence" ON "intent_hard_cases" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "idx_intent_hard_cases_created_at" ON "intent_hard_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_intent_hard_cases_profile_confidence" ON "intent_hard_cases" USING btree ("profile","confidence");--> statement-breakpoint
CREATE INDEX "idx_regression_alerts_profile_id" ON "regression_alerts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_regression_alerts_intent_type" ON "regression_alerts" USING btree ("intent_type");--> statement-breakpoint
CREATE INDEX "idx_regression_alerts_status" ON "regression_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_regression_alerts_detected_at" ON "regression_alerts" USING btree ("detected_at");