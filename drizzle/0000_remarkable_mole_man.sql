CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"allowed_tenants" text,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"failed_totp_attempts" integer DEFAULT 0 NOT NULL,
	"totp_locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "ai_decision_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"phone" varchar(64) NOT NULL,
	"decision_type" varchar(64) NOT NULL,
	"intent" text,
	"confidence_score" real,
	"ai_provider" text,
	"human_review_requested" boolean DEFAULT false NOT NULL,
	"outcome" varchar(64),
	"disclosure_sent_at" timestamp,
	"review_requested_at" timestamp,
	"resolved_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "baileys_auth_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"key_type" varchar(64) NOT NULL,
	"key_id" varchar(256) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_pacing_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"phone" varchar(32) NOT NULL,
	"template_name" text,
	"message_content" text,
	"error_code" integer DEFAULT 131049 NOT NULL,
	"failure_type" varchar(16) DEFAULT 'held' NOT NULL,
	"review_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"held_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"instance_id" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"jid" varchar(64) NOT NULL,
	"profile_id" text DEFAULT 'pelangi',
	"tier" varchar(8) NOT NULL,
	"intent" text,
	"llm_provider" text,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"classification_ms" integer,
	"llm_ms" integer,
	"total_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpa_registry" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_name" text NOT NULL,
	"registered_address" text DEFAULT '' NOT NULL,
	"data_categories" text NOT NULL,
	"processing_purpose" text NOT NULL,
	"retention_period" text DEFAULT '' NOT NULL,
	"sub_processors" text DEFAULT '[]' NOT NULL,
	"dpa_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"dpa_expiry_date" timestamp,
	"dpa_signed" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpia_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"document_json" text NOT NULL,
	"processing_scope" text NOT NULL,
	"risk_summary" text NOT NULL,
	"mitigations" text NOT NULL,
	"last_reviewed_at" timestamp DEFAULT now() NOT NULL,
	"next_review_due" timestamp NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_type" varchar(32) NOT NULL,
	"transaction_id" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"customer_phone" text,
	"customer_name" text,
	"customer_id_number" text,
	"supplier_tin" text NOT NULL,
	"line_items" text NOT NULL,
	"total_amount" real NOT NULL,
	"sst_amount" real DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"uin" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp,
	"delivered_at" timestamp,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"jid" varchar(64) NOT NULL,
	"profile_id" text DEFAULT 'pelangi',
	"trigger" varchar(64) NOT NULL,
	"count" integer,
	"metadata" text,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sla_breached_at" timestamp,
	"human_responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "experiment_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"experiment_id" varchar(128) NOT NULL,
	"variant_id" varchar(128) NOT NULL,
	"phone_hash" varchar(64) NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"fallback_count" integer DEFAULT 0 NOT NULL,
	"csat_sum" integer DEFAULT 0 NOT NULL,
	"csat_count" integer DEFAULT 0 NOT NULL,
	"window_date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "festive_stickers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"sticker_name" text NOT NULL,
	"media_id" text,
	"file_size" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'image/webp' NOT NULL,
	"uploaded_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_detection_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier1_enabled" boolean DEFAULT true NOT NULL,
	"tier1_context_messages" integer DEFAULT 0 NOT NULL,
	"tier2_enabled" boolean DEFAULT true NOT NULL,
	"tier2_context_messages" integer DEFAULT 3 NOT NULL,
	"tier2_threshold" real DEFAULT 0.8 NOT NULL,
	"tier3_enabled" boolean DEFAULT true NOT NULL,
	"tier3_context_messages" integer DEFAULT 5 NOT NULL,
	"tier3_threshold" real DEFAULT 0.7 NOT NULL,
	"tier4_enabled" boolean DEFAULT true NOT NULL,
	"tier4_context_messages" integer DEFAULT 5 NOT NULL,
	"track_last_intent" boolean DEFAULT true NOT NULL,
	"track_slots" boolean DEFAULT true NOT NULL,
	"max_history_messages" integer DEFAULT 20 NOT NULL,
	"context_ttl_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_predictions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"message_text" text NOT NULL,
	"predicted_intent" text NOT NULL,
	"confidence" real NOT NULL,
	"tier" text NOT NULL,
	"model" text,
	"actual_intent" text,
	"was_correct" boolean,
	"correction_source" text,
	"corrected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cost_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"provider" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"budget_cap_usd" real,
	"budget_breached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(64) NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"consent_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"channel" varchar(32) DEFAULT 'admin_add' NOT NULL,
	"collected_via" text,
	"opt_in_sent_at" timestamp,
	"confirmed_at" timestamp,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"baileys_message_id" varchar(128) NOT NULL,
	"phone" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"status_timestamp" timestamp DEFAULT now() NOT NULL,
	"instance_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_quality_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"date" timestamp NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"opt_out_events" integer DEFAULT 0 NOT NULL,
	"block_events" integer DEFAULT 0 NOT NULL,
	"opt_out_rate" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mm_lite_sends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"phone" varchar(64) NOT NULL,
	"template_name" text NOT NULL,
	"send_api" varchar(16) DEFAULT 'mm_lite' NOT NULL,
	"ttl_hours" integer DEFAULT 720 NOT NULL,
	"ttl_expires_at" timestamp,
	"delivery_status" varchar(16) DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"expired_at" timestamp,
	"meta_message_id" text,
	"error_info" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opt_outs" (
	"phone" varchar(64) PRIMARY KEY NOT NULL,
	"opted_out_at" timestamp DEFAULT now() NOT NULL,
	"opted_in_at" timestamp,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "order_accuracy_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"profile_id" text DEFAULT 'makan-moments' NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_webhook_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"payload_json" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"profile_id" text DEFAULT 'makan-moments' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prompt_injection_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"original_message_text" text NOT NULL,
	"matched_pattern" text NOT NULL,
	"action_taken" varchar(64) DEFAULT 'blocked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rainbow_conversation_state" (
	"phone" varchar(32) PRIMARY KEY NOT NULL,
	"push_name" text NOT NULL,
	"language" varchar(2) DEFAULT 'en' NOT NULL,
	"booking_state_json" text,
	"workflow_state_json" text,
	"active_flow_json" text,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"last_intent" text,
	"last_intent_confidence" real,
	"last_intent_timestamp" timestamp,
	"slots_json" text,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"profile_id" text DEFAULT 'pelangi',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"last_user_message_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rainbow_conversations" (
	"phone" varchar(64) PRIMARY KEY NOT NULL,
	"bsuid" varchar(128),
	"push_name" text DEFAULT '' NOT NULL,
	"instance_id" text,
	"profile_id" text DEFAULT 'pelangi',
	"pinned" boolean DEFAULT false NOT NULL,
	"favourite" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp,
	"response_mode" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"contact_details_json" text,
	"context_summary" text,
	"context_summary_at" timestamp,
	"referral_ctwa_clid" text,
	"referral_source_id" text,
	"referral_source_type" text,
	"referral_headline" text,
	"referral_body" text,
	"referral_json" text,
	"opt_in_method" text,
	"opt_in_at" timestamp,
	"opt_in_channel" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "rainbow_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"phone_number" text NOT NULL,
	"intent" text,
	"confidence" real,
	"rating" integer NOT NULL,
	"feedback_text" text,
	"response_model" text,
	"response_time_ms" integer,
	"tier" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rainbow_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(64) NOT NULL,
	"role" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"intent" text,
	"confidence" real,
	"action" text,
	"manual" boolean,
	"source" text,
	"model" text,
	"response_time_ms" integer,
	"kb_files_json" text,
	"message_type" text,
	"routed_action" text,
	"workflow_id" text,
	"step_id" text,
	"usage_json" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"staff_name" text,
	"transcribed" boolean,
	"media_url" text,
	"local_media_url" text,
	"faithfulness_score" real,
	"profile_id" text DEFAULT 'pelangi',
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" varchar(64) NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"send_at" timestamp NOT NULL,
	"template_key" varchar(128) NOT NULL,
	"variables" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"booking_id" varchar(128),
	"sequence_step" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" text NOT NULL,
	"profile" text DEFAULT 'pelangi' NOT NULL,
	"room_number" text,
	"request_type" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"staff_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sticker_intents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"intent" text NOT NULL,
	"sticker_id" varchar NOT NULL,
	"greeting_text" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_quality_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_name" text NOT NULL,
	"old_status" text,
	"new_status" text NOT NULL,
	"reason" text,
	"profile_id" text DEFAULT 'pelangi',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tia_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"ai_provider" text NOT NULL,
	"destination_jurisdiction" text NOT NULL,
	"equivalence_level" varchar(16) NOT NULL,
	"api_endpoint" text NOT NULL,
	"transfer_mechanism" text NOT NULL,
	"document_json" text NOT NULL,
	"data_transferred" text NOT NULL,
	"risk_assessment" text NOT NULL,
	"controls" text NOT NULL,
	"last_reviewed_at" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utterance_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"utterance_sample" varchar(120) NOT NULL,
	"normalized_key" varchar(120) NOT NULL,
	"tier_reached" varchar(16) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vector_access_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" text NOT NULL,
	"query_hash" varchar(16) NOT NULL,
	"chunks_returned" integer DEFAULT 0 NOT NULL,
	"retrieved_sources" text DEFAULT '[]' NOT NULL,
	"top_score" real,
	"cross_namespace_detected" boolean DEFAULT false NOT NULL,
	"similarity_attack_suspected" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"service_identity" text DEFAULT 'rainbow-ai' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webchat_consent_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id_hash" varchar(64) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"user_agent_hash" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "webhook_raw_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"payload" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_cost_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"template_type" varchar(32) NOT NULL,
	"country_code" varchar(4) DEFAULT 'MY' NOT NULL,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"billable_messages" integer DEFAULT 0 NOT NULL,
	"csw_free_messages" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_name" text NOT NULL,
	"status" text NOT NULL,
	"previous_status" text,
	"rejected_reason" text,
	"profile_id" text DEFAULT 'pelangi' NOT NULL,
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sticker_intents" ADD CONSTRAINT "sticker_intents_sticker_id_festive_stickers_id_fk" FOREIGN KEY ("sticker_id") REFERENCES "public"."festive_stickers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_admin_users_username" ON "admin_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_aidecision_profile_phone" ON "ai_decision_audit" USING btree ("profile_id","phone");--> statement-breakpoint
CREATE INDEX "idx_aidecision_created_at" ON "ai_decision_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_aidecision_human_review" ON "ai_decision_audit" USING btree ("human_review_requested");--> statement-breakpoint
CREATE INDEX "idx_app_settings_key" ON "app_settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_baileys_auth_profile_type_id" ON "baileys_auth_state" USING btree ("profile_id","key_type","key_id");--> statement-breakpoint
CREATE INDEX "idx_baileys_auth_profile" ON "baileys_auth_state" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_cpe_batch_id" ON "campaign_pacing_events" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_cpe_profile_held_at" ON "campaign_pacing_events" USING btree ("profile_id","held_at");--> statement-breakpoint
CREATE INDEX "idx_cpe_review_status" ON "campaign_pacing_events" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_cpe_phone" ON "campaign_pacing_events" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_conv_traces_jid" ON "conversation_traces" USING btree ("jid");--> statement-breakpoint
CREATE INDEX "idx_conv_traces_created_at" ON "conversation_traces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_conv_traces_tier" ON "conversation_traces" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_dpa_registry_vendor" ON "dpa_registry" USING btree ("vendor_name");--> statement-breakpoint
CREATE INDEX "idx_dpa_registry_status" ON "dpa_registry" USING btree ("dpa_status");--> statement-breakpoint
CREATE INDEX "idx_dpa_registry_expiry" ON "dpa_registry" USING btree ("dpa_expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dpia_profile_id" ON "dpia_records" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_dpia_next_review_due" ON "dpia_records" USING btree ("next_review_due");--> statement-breakpoint
CREATE INDEX "idx_einvoice_queue_status" ON "einvoice_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_einvoice_queue_profile" ON "einvoice_queue" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_einvoice_queue_transaction" ON "einvoice_queue" USING btree ("transaction_type","transaction_id");--> statement-breakpoint
CREATE INDEX "idx_einvoice_queue_next_retry" ON "einvoice_queue" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_einvoice_queue_created_at" ON "einvoice_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_escalation_events_jid" ON "escalation_events" USING btree ("jid");--> statement-breakpoint
CREATE INDEX "idx_escalation_events_trigger" ON "escalation_events" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "idx_escalation_events_created_at" ON "escalation_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_experiment_metrics_exp_var_phone_date" ON "experiment_metrics" USING btree ("experiment_id","variant_id","phone_hash","window_date");--> statement-breakpoint
CREATE INDEX "idx_experiment_metrics_experiment" ON "experiment_metrics" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "idx_experiment_metrics_window_date" ON "experiment_metrics" USING btree ("window_date");--> statement-breakpoint
CREATE INDEX "idx_festive_stickers_profile_active" ON "festive_stickers" USING btree ("profile_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_festive_stickers_profile_name" ON "festive_stickers" USING btree ("profile_id","sticker_name");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_conversation_id" ON "intent_predictions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_phone_number" ON "intent_predictions" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_predicted_intent" ON "intent_predictions" USING btree ("predicted_intent");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_tier" ON "intent_predictions" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_was_correct" ON "intent_predictions" USING btree ("was_correct");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_created_at" ON "intent_predictions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_intent_predictions_correct_created" ON "intent_predictions" USING btree ("was_correct","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_llm_cost_daily_date_provider_profile" ON "llm_cost_daily" USING btree ("date","provider","profile_id");--> statement-breakpoint
CREATE INDEX "idx_llm_cost_daily_date" ON "llm_cost_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_llm_cost_daily_provider" ON "llm_cost_daily" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_marketing_sub_phone_profile" ON "marketing_subscriptions" USING btree ("phone","profile_id");--> statement-breakpoint
CREATE INDEX "idx_marketing_sub_status" ON "marketing_subscriptions" USING btree ("consent_status");--> statement-breakpoint
CREATE INDEX "idx_marketing_sub_expires_at" ON "marketing_subscriptions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_marketing_sub_profile_status" ON "marketing_subscriptions" USING btree ("profile_id","consent_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_msg_delivery_baileys_id" ON "message_delivery_status" USING btree ("baileys_message_id");--> statement-breakpoint
CREATE INDEX "idx_msg_delivery_phone" ON "message_delivery_status" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_msg_delivery_phone_ts" ON "message_delivery_status" USING btree ("phone","status_timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_quality_metrics_profile_date" ON "message_quality_metrics" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "idx_quality_metrics_date" ON "message_quality_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_campaign" ON "mm_lite_sends" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_profile_status" ON "mm_lite_sends" USING btree ("profile_id","delivery_status");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_phone" ON "mm_lite_sends" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_expires_at" ON "mm_lite_sends" USING btree ("ttl_expires_at");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_send_api" ON "mm_lite_sends" USING btree ("send_api");--> statement-breakpoint
CREATE INDEX "idx_mm_lite_created_at" ON "mm_lite_sends" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_opt_outs_opted_out_at" ON "opt_outs" USING btree ("opted_out_at");--> statement-breakpoint
CREATE INDEX "idx_order_accuracy_events_type" ON "order_accuracy_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_order_accuracy_events_created_at" ON "order_accuracy_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_order_accuracy_events_session" ON "order_accuracy_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_order_accuracy_events_profile" ON "order_accuracy_events" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_order_webhook_queue_status" ON "order_webhook_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_order_webhook_queue_order_id" ON "order_webhook_queue" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_webhook_queue_created_at" ON "order_webhook_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_injection_events_jid" ON "prompt_injection_events" USING btree ("jid");--> statement-breakpoint
CREATE INDEX "idx_injection_events_profile" ON "prompt_injection_events" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_injection_events_created_at" ON "prompt_injection_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rainbow_conversations_bsuid" ON "rainbow_conversations" USING btree ("bsuid");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_conversation_id" ON "rainbow_feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_phone_number" ON "rainbow_feedback" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_intent" ON "rainbow_feedback" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_rating" ON "rainbow_feedback" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_created_at" ON "rainbow_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_rainbow_feedback_created_intent" ON "rainbow_feedback" USING btree ("created_at","intent");--> statement-breakpoint
CREATE INDEX "idx_rainbow_messages_phone" ON "rainbow_messages" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_rainbow_messages_phone_timestamp" ON "rainbow_messages" USING btree ("phone","timestamp");--> statement-breakpoint
CREATE INDEX "idx_rainbow_messages_role" ON "rainbow_messages" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_rainbow_messages_timestamp" ON "rainbow_messages" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_rainbow_messages_phone_role_ts" ON "rainbow_messages" USING btree ("phone","role","timestamp");--> statement-breakpoint
CREATE INDEX "idx_scheduled_messages_status_send_at" ON "scheduled_messages" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "idx_scheduled_messages_booking_id" ON "scheduled_messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_messages_jid" ON "scheduled_messages" USING btree ("jid");--> statement-breakpoint
CREATE INDEX "idx_service_requests_jid" ON "service_requests" USING btree ("jid");--> statement-breakpoint
CREATE INDEX "idx_service_requests_profile" ON "service_requests" USING btree ("profile");--> statement-breakpoint
CREATE INDEX "idx_service_requests_status" ON "service_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_service_requests_created_at" ON "service_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_sticker_intents_profile_intent" ON "sticker_intents" USING btree ("profile_id","intent");--> statement-breakpoint
CREATE INDEX "idx_sticker_intents_enabled" ON "sticker_intents" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "idx_sticker_intents_sticker_id" ON "sticker_intents" USING btree ("sticker_id");--> statement-breakpoint
CREATE INDEX "idx_template_quality_events_name" ON "template_quality_events" USING btree ("template_name");--> statement-breakpoint
CREATE INDEX "idx_template_quality_events_created" ON "template_quality_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tia_profile_provider" ON "tia_records" USING btree ("profile_id","ai_provider");--> statement-breakpoint
CREATE INDEX "idx_tia_valid_until" ON "tia_records" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "idx_tia_created_at" ON "tia_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_utterance_gaps_profile_id" ON "utterance_gaps" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_utterance_gaps_count" ON "utterance_gaps" USING btree ("count");--> statement-breakpoint
CREATE INDEX "idx_utterance_gaps_last_seen" ON "utterance_gaps" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_utterance_gaps_profile_normalized" ON "utterance_gaps" USING btree ("profile_id","normalized_key");--> statement-breakpoint
CREATE INDEX "idx_val_property_created" ON "vector_access_logs" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_val_cross_namespace" ON "vector_access_logs" USING btree ("cross_namespace_detected");--> statement-breakpoint
CREATE INDEX "idx_val_attack_suspected" ON "vector_access_logs" USING btree ("similarity_attack_suspected");--> statement-breakpoint
CREATE INDEX "idx_val_created_at" ON "vector_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webchat_consent_log_profile" ON "webchat_consent_log" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_webchat_consent_log_accepted_at" ON "webchat_consent_log" USING btree ("accepted_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_raw_events_received_at" ON "webhook_raw_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_raw_events_processed" ON "webhook_raw_events" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "idx_webhook_raw_events_profile" ON "webhook_raw_events" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wa_cost_daily_date_profile_type_country" ON "whatsapp_cost_daily" USING btree ("date","profile_id","template_type","country_code");--> statement-breakpoint
CREATE INDEX "idx_wa_cost_daily_date" ON "whatsapp_cost_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_wa_cost_daily_profile" ON "whatsapp_cost_daily" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_whatsapp_templates_name_profile" ON "whatsapp_templates" USING btree ("template_name","profile_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_status" ON "whatsapp_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_profile" ON "whatsapp_templates" USING btree ("profile_id");