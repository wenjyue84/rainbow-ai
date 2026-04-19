CREATE TABLE IF NOT EXISTS `admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config_file` text NOT NULL,
	`changed_by` text,
	`previous_hash` text,
	`new_hash` text NOT NULL,
	`diff_summary` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_log_config_file` ON `admin_audit_log` (`config_file`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_log_changed_by` ON `admin_audit_log` (`changed_by`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_log_timestamp` ON `admin_audit_log` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admin_audit_log_file_timestamp` ON `admin_audit_log` (`config_file`,`timestamp`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admin_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`allowed_tenants` text,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`failed_totp_attempts` integer DEFAULT 0 NOT NULL,
	`totp_locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_admin_users_username` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_decision_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`phone` text NOT NULL,
	`decision_type` text NOT NULL,
	`intent` text,
	`confidence_score` real,
	`ai_provider` text,
	`human_review_requested` integer DEFAULT false NOT NULL,
	`outcome` text,
	`disclosure_sent_at` integer,
	`review_requested_at` integer,
	`resolved_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_aidecision_profile_phone` ON `ai_decision_audit` (`profile_id`,`phone`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_aidecision_created_at` ON `ai_decision_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_aidecision_human_review` ON `ai_decision_audit` (`human_review_requested`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updated_by` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_key_unique` ON `app_settings` (`key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_app_settings_key` ON `app_settings` (`key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `baileys_auth_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`key_type` text NOT NULL,
	`key_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_baileys_auth_profile_type_id` ON `baileys_auth_state` (`profile_id`,`key_type`,`key_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_baileys_auth_profile` ON `baileys_auth_state` (`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_execution_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booking_id` text NOT NULL,
	`step_name` text NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`status` text NOT NULL,
	`executed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_exec_audit_booking_id` ON `booking_execution_audit` (`booking_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_exec_audit_step_name` ON `booking_execution_audit` (`step_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_exec_audit_status` ON `booking_execution_audit` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_exec_audit_executed_at` ON `booking_execution_audit` (`executed_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_exec_audit_booking_step` ON `booking_execution_audit` (`booking_id`,`step_name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_state_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booking_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`valid` integer NOT NULL,
	`reason` text NOT NULL,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_booking_id` ON `booking_state_audit` (`booking_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_from_state` ON `booking_state_audit` (`from_state`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_to_state` ON `booking_state_audit` (`to_state`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_valid` ON `booking_state_audit` (`valid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_profile` ON `booking_state_audit` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_state_audit_timestamp` ON `booking_state_audit` (`timestamp`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_step_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`error_code` text NOT NULL,
	`error_message` text,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`conversation_id` text,
	`guest_phone` text,
	`workflow_id` text,
	`recovery_message_sent` integer DEFAULT false NOT NULL,
	`recovery_message_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_step_errors_step_id` ON `booking_step_errors` (`step_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_step_errors_error_code` ON `booking_step_errors` (`error_code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_step_errors_profile` ON `booking_step_errors` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_step_errors_profile_code` ON `booking_step_errors` (`profile`,`error_code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_step_errors_created_at` ON `booking_step_errors` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaign_pacing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`phone` text NOT NULL,
	`template_name` text,
	`message_content` text,
	`error_code` integer DEFAULT 131049 NOT NULL,
	`failure_type` text DEFAULT 'held' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`held_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`instance_id` text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cpe_batch_id` ON `campaign_pacing_events` (`batch_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cpe_profile_held_at` ON `campaign_pacing_events` (`profile_id`,`held_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cpe_review_status` ON `campaign_pacing_events` (`review_status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cpe_phone` ON `campaign_pacing_events` (`phone`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`guest_id` text,
	`message` text NOT NULL,
	`intent` text,
	`confidence` real,
	`action_taken` text,
	`tier` text,
	`profile_id` text DEFAULT 'pelangi',
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_phone` ON `conversation_audit` (`phone`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_timestamp` ON `conversation_audit` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_phone_timestamp` ON `conversation_audit` (`phone`,`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_intent` ON `conversation_audit` (`intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_profile` ON `conversation_audit` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_audit_guest_id` ON `conversation_audit` (`guest_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_traces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trace_id` text NOT NULL,
	`jid` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi',
	`tier` text NOT NULL,
	`intent` text,
	`llm_provider` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`classification_ms` integer,
	`llm_ms` integer,
	`total_ms` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_traces_jid` ON `conversation_traces` (`jid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_traces_created_at` ON `conversation_traces` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conv_traces_tier` ON `conversation_traces` (`tier`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dead_letter_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`body` text NOT NULL,
	`failure_reason` text NOT NULL,
	`failed_at` integer NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dlq_guest_id` ON `dead_letter_queue` (`guest_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dlq_profile` ON `dead_letter_queue` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dlq_failed_at` ON `dead_letter_queue` (`failed_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dlq_expires_at` ON `dead_letter_queue` (`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dpa_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_name` text NOT NULL,
	`registered_address` text DEFAULT '' NOT NULL,
	`data_categories` text NOT NULL,
	`processing_purpose` text NOT NULL,
	`retention_period` text DEFAULT '' NOT NULL,
	`sub_processors` text DEFAULT '[]' NOT NULL,
	`dpa_status` text DEFAULT 'pending' NOT NULL,
	`dpa_expiry_date` integer,
	`dpa_signed` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dpa_registry_vendor` ON `dpa_registry` (`vendor_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dpa_registry_status` ON `dpa_registry` (`dpa_status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dpa_registry_expiry` ON `dpa_registry` (`dpa_expiry_date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dpia_records` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text NOT NULL,
	`document_json` text NOT NULL,
	`processing_scope` text NOT NULL,
	`risk_summary` text NOT NULL,
	`mitigations` text NOT NULL,
	`last_reviewed_at` integer NOT NULL,
	`next_review_due` integer NOT NULL,
	`reviewed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dpia_profile_id` ON `dpia_records` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dpia_next_review_due` ON `dpia_records` (`next_review_due`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `einvoice_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_type` text NOT NULL,
	`transaction_id` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`customer_phone` text,
	`customer_name` text,
	`customer_id_number` text,
	`supplier_tin` text NOT NULL,
	`line_items` text NOT NULL,
	`total_amount` real NOT NULL,
	`sst_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`uin` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`submitted_at` integer,
	`delivered_at` integer,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_einvoice_queue_status` ON `einvoice_queue` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_einvoice_queue_profile` ON `einvoice_queue` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_einvoice_queue_transaction` ON `einvoice_queue` (`transaction_type`,`transaction_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_einvoice_queue_next_retry` ON `einvoice_queue` (`next_retry_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_einvoice_queue_created_at` ON `einvoice_queue` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escalation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi',
	`trigger` text NOT NULL,
	`count` integer,
	`metadata` text,
	`summary` text,
	`created_at` integer NOT NULL,
	`sla_breached_at` integer,
	`human_responded_at` integer,
	`fallback_response_template_id` text,
	`escalation_within_2_msgs` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_events_jid` ON `escalation_events` (`jid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_events_trigger` ON `escalation_events` (`trigger`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_events_created_at` ON `escalation_events` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escalation_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escalation_id` integer NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`staff_id` text,
	`feedback_type` text NOT NULL,
	`correct_intent` text,
	`severity` text DEFAULT 'medium' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_feedback_escalation_id` ON `escalation_feedback` (`escalation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_feedback_profile_id` ON `escalation_feedback` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_feedback_type` ON `escalation_feedback` (`feedback_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_feedback_severity` ON `escalation_feedback` (`severity`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_feedback_created_at` ON `escalation_feedback` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escalation_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`original_intent` text NOT NULL,
	`confidence_score` real NOT NULL,
	`message_preview` text,
	`recommended_keywords` text,
	`guest_correction_intent` text,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_queue_profile` ON `escalation_queue` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_queue_confidence` ON `escalation_queue` (`confidence_score`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_queue_timestamp` ON `escalation_queue` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalation_queue_profile_confidence` ON `escalation_queue` (`profile`,`confidence_score`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `experiment_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`phone_hash` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`fallback_count` integer DEFAULT 0 NOT NULL,
	`csat_sum` integer DEFAULT 0 NOT NULL,
	`csat_count` integer DEFAULT 0 NOT NULL,
	`window_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_experiment_metrics_exp_var_phone_date` ON `experiment_metrics` (`experiment_id`,`variant_id`,`phone_hash`,`window_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_experiment_metrics_experiment` ON `experiment_metrics` (`experiment_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_experiment_metrics_window_date` ON `experiment_metrics` (`window_date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fallback_response_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`template_id` text NOT NULL,
	`escalation_count` integer DEFAULT 0 NOT NULL,
	`resolution_count` integer DEFAULT 0 NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fallback_resp_metrics_profile` ON `fallback_response_metrics` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fallback_resp_metrics_template` ON `fallback_response_metrics` (`template_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fallback_resp_metrics_timestamp` ON `fallback_response_metrics` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fallback_resp_metrics_profile_template` ON `fallback_response_metrics` (`profile_id`,`template_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `festive_stickers` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`sticker_name` text NOT NULL,
	`media_id` text,
	`file_size` integer NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text DEFAULT 'image/webp' NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_festive_stickers_profile_active` ON `festive_stickers` (`profile_id`,`is_active`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_festive_stickers_profile_name` ON `festive_stickers` (`profile_id`,`sticker_name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_analytics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`intent_type` text NOT NULL,
	`confidence` real NOT NULL,
	`latency_ms` integer NOT NULL,
	`was_correct` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_analytics_profile_id` ON `intent_analytics` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_analytics_intent_type` ON `intent_analytics` (`intent_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_analytics_profile_intent` ON `intent_analytics` (`profile_id`,`intent_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_analytics_created_at` ON `intent_analytics` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_classification_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`profile_name` text DEFAULT 'pelangi' NOT NULL,
	`message_hash` text NOT NULL,
	`classified_intent` text NOT NULL,
	`confidence_score` real NOT NULL,
	`top_3_candidates_json` text DEFAULT '[]' NOT NULL,
	`actual_intent` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_icd_profile_name` ON `intent_classification_decisions` (`profile_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_icd_timestamp` ON `intent_classification_decisions` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_icd_profile_timestamp` ON `intent_classification_decisions` (`profile_name`,`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_icd_classified_intent` ON `intent_classification_decisions` (`classified_intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_icd_message_hash` ON `intent_classification_decisions` (`message_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_classification_thresholds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`intent` text NOT NULL,
	`min_confidence` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_classification_thresholds_profile_intent` ON `intent_classification_thresholds` (`profile_id`,`intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_classification_thresholds_profile_id` ON `intent_classification_thresholds` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_classification_thresholds_intent` ON `intent_classification_thresholds` (`intent`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_classifier_baselines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`intent_type` text NOT NULL,
	`accuracy_pct` real NOT NULL,
	`sample_count` integer NOT NULL,
	`baseline_date` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_classifier_baselines_profile_intent` ON `intent_classifier_baselines` (`profile_id`,`intent_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_classifier_baselines_profile_id` ON `intent_classifier_baselines` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_classifier_baselines_intent_type` ON `intent_classifier_baselines` (`intent_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_classifier_baselines_baseline_date` ON `intent_classifier_baselines` (`baseline_date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_detection_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tier1_enabled` integer DEFAULT true NOT NULL,
	`tier1_context_messages` integer DEFAULT 0 NOT NULL,
	`tier2_enabled` integer DEFAULT true NOT NULL,
	`tier2_context_messages` integer DEFAULT 3 NOT NULL,
	`tier2_threshold` real DEFAULT 0.8 NOT NULL,
	`tier3_enabled` integer DEFAULT true NOT NULL,
	`tier3_context_messages` integer DEFAULT 5 NOT NULL,
	`tier3_threshold` real DEFAULT 0.7 NOT NULL,
	`tier4_enabled` integer DEFAULT true NOT NULL,
	`tier4_context_messages` integer DEFAULT 5 NOT NULL,
	`track_last_intent` integer DEFAULT true NOT NULL,
	`track_slots` integer DEFAULT true NOT NULL,
	`max_history_messages` integer DEFAULT 20 NOT NULL,
	`context_ttl_minutes` integer DEFAULT 30 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_hard_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`confidence` real NOT NULL,
	`candidate_intents` text,
	`reason` text,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_hard_cases_profile` ON `intent_hard_cases` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_hard_cases_intent_id` ON `intent_hard_cases` (`intent_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_hard_cases_confidence` ON `intent_hard_cases` (`confidence`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_hard_cases_created_at` ON `intent_hard_cases` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_hard_cases_profile_confidence` ON `intent_hard_cases` (`profile`,`confidence`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intent_predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`phone_number` text NOT NULL,
	`message_text` text NOT NULL,
	`predicted_intent` text NOT NULL,
	`confidence` real NOT NULL,
	`tier` text NOT NULL,
	`model` text,
	`profile` text,
	`actual_intent` text,
	`was_correct` integer,
	`correction_source` text,
	`corrected_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_conversation_id` ON `intent_predictions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_phone_number` ON `intent_predictions` (`phone_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_predicted_intent` ON `intent_predictions` (`predicted_intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_tier` ON `intent_predictions` (`tier`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_was_correct` ON `intent_predictions` (`was_correct`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_created_at` ON `intent_predictions` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_predictions_correct_created` ON `intent_predictions` (`was_correct`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `llm_cost_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`provider` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`budget_cap_usd` real,
	`budget_breached` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_llm_cost_daily_date_provider_profile` ON `llm_cost_daily` (`date`,`provider`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_llm_cost_daily_date` ON `llm_cost_daily` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_llm_cost_daily_provider` ON `llm_cost_daily` (`provider`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketing_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`consent_status` text DEFAULT 'pending' NOT NULL,
	`channel` text DEFAULT 'admin_add' NOT NULL,
	`collected_via` text,
	`opt_in_sent_at` integer,
	`confirmed_at` integer,
	`revoked_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_marketing_sub_phone_profile` ON `marketing_subscriptions` (`phone`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_marketing_sub_status` ON `marketing_subscriptions` (`consent_status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_marketing_sub_expires_at` ON `marketing_subscriptions` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_marketing_sub_profile_status` ON `marketing_subscriptions` (`profile_id`,`consent_status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_delivery_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`baileys_message_id` text NOT NULL,
	`phone` text NOT NULL,
	`status` text NOT NULL,
	`status_timestamp` integer NOT NULL,
	`instance_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_msg_delivery_baileys_id` ON `message_delivery_status` (`baileys_message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_msg_delivery_phone` ON `message_delivery_status` (`phone`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_msg_delivery_phone_ts` ON `message_delivery_status` (`phone`,`status_timestamp`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_quality_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`date` integer NOT NULL,
	`messages_sent` integer DEFAULT 0 NOT NULL,
	`opt_out_events` integer DEFAULT 0 NOT NULL,
	`block_events` integer DEFAULT 0 NOT NULL,
	`opt_out_rate` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quality_metrics_profile_date` ON `message_quality_metrics` (`profile_id`,`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_quality_metrics_date` ON `message_quality_metrics` (`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mm_lite_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`phone` text NOT NULL,
	`template_name` text NOT NULL,
	`send_api` text DEFAULT 'mm_lite' NOT NULL,
	`ttl_hours` integer DEFAULT 720 NOT NULL,
	`ttl_expires_at` integer,
	`delivery_status` text DEFAULT 'queued' NOT NULL,
	`sent_at` integer,
	`delivered_at` integer,
	`expired_at` integer,
	`meta_message_id` text,
	`error_info` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_campaign` ON `mm_lite_sends` (`campaign_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_profile_status` ON `mm_lite_sends` (`profile_id`,`delivery_status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_phone` ON `mm_lite_sends` (`phone`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_expires_at` ON `mm_lite_sends` (`ttl_expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_send_api` ON `mm_lite_sends` (`send_api`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mm_lite_created_at` ON `mm_lite_sends` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `opt_outs` (
	`phone` text PRIMARY KEY NOT NULL,
	`opted_out_at` integer NOT NULL,
	`opted_in_at` integer,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_opt_outs_opted_out_at` ON `opt_outs` (`opted_out_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `order_accuracy_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`profile_id` text DEFAULT 'makan-moments' NOT NULL,
	`event_type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_accuracy_events_type` ON `order_accuracy_events` (`event_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_accuracy_events_created_at` ON `order_accuracy_events` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_accuracy_events_session` ON `order_accuracy_events` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_accuracy_events_profile` ON `order_accuracy_events` (`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `order_webhook_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`profile_id` text DEFAULT 'makan-moments' NOT NULL,
	`created_at` integer NOT NULL,
	`last_attempt_at` integer,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_webhook_queue_status` ON `order_webhook_queue` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_webhook_queue_order_id` ON `order_webhook_queue` (`order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_webhook_queue_created_at` ON `order_webhook_queue` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profile_isolation_violations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempted_profile` text NOT NULL,
	`actual_profile` text NOT NULL,
	`query_text` text NOT NULL,
	`route_path` text NOT NULL,
	`method` text NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_piv_actual_profile` ON `profile_isolation_violations` (`actual_profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_piv_attempted_profile` ON `profile_isolation_violations` (`attempted_profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_piv_created_at` ON `profile_isolation_violations` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `prompt_injection_events` (
	`id` text PRIMARY KEY NOT NULL,
	`jid` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`original_message_text` text NOT NULL,
	`matched_pattern` text NOT NULL,
	`action_taken` text DEFAULT 'blocked' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_injection_events_jid` ON `prompt_injection_events` (`jid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_injection_events_profile` ON `prompt_injection_events` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_injection_events_created_at` ON `prompt_injection_events` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rainbow_conversation_state` (
	`phone` text PRIMARY KEY NOT NULL,
	`push_name` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`booking_state_json` text,
	`workflow_state_json` text,
	`active_flow_json` text,
	`unknown_count` integer DEFAULT 0 NOT NULL,
	`last_intent` text,
	`last_intent_confidence` real,
	`last_intent_timestamp` integer,
	`slots_json` text,
	`repeat_count` integer DEFAULT 0 NOT NULL,
	`profile_id` text DEFAULT 'pelangi',
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`last_user_message_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rainbow_conversations` (
	`phone` text PRIMARY KEY NOT NULL,
	`bsuid` text,
	`push_name` text DEFAULT '' NOT NULL,
	`instance_id` text,
	`profile_id` text DEFAULT 'pelangi',
	`pinned` integer DEFAULT false NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`last_read_at` integer,
	`response_mode` text,
	`status` text DEFAULT 'active' NOT NULL,
	`contact_details_json` text,
	`context_summary` text,
	`context_summary_at` integer,
	`referral_ctwa_clid` text,
	`referral_source_id` text,
	`referral_source_type` text,
	`referral_headline` text,
	`referral_body` text,
	`referral_json` text,
	`opt_in_method` text,
	`opt_in_at` integer,
	`opt_in_channel` text,
	`whatsapp_opted_in` integer DEFAULT false NOT NULL,
	`whatsapp_opted_in_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rainbow_conversations_bsuid` ON `rainbow_conversations` (`bsuid`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rainbow_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`phone_number` text NOT NULL,
	`intent` text,
	`confidence` real,
	`rating` integer NOT NULL,
	`feedback_text` text,
	`response_model` text,
	`response_time_ms` integer,
	`tier` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_conversation_id` ON `rainbow_feedback` (`conversation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_phone_number` ON `rainbow_feedback` (`phone_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_intent` ON `rainbow_feedback` (`intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_rating` ON `rainbow_feedback` (`rating`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_created_at` ON `rainbow_feedback` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_feedback_created_intent` ON `rainbow_feedback` (`created_at`,`intent`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rainbow_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` integer NOT NULL,
	`intent` text,
	`confidence` real,
	`action` text,
	`manual` integer,
	`source` text,
	`model` text,
	`response_time_ms` integer,
	`kb_files_json` text,
	`message_type` text,
	`routed_action` text,
	`workflow_id` text,
	`step_id` text,
	`usage_json` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`staff_name` text,
	`transcribed` integer,
	`media_url` text,
	`local_media_url` text,
	`faithfulness_score` real,
	`profile_id` text DEFAULT 'pelangi',
	`deleted_at` integer,
	CONSTRAINT "chk_rainbow_messages_profile_not_empty" CHECK(profile_id IS NOT NULL AND profile_id <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_messages_phone` ON `rainbow_messages` (`phone`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_messages_phone_timestamp` ON `rainbow_messages` (`phone`,`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_messages_role` ON `rainbow_messages` (`role`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_messages_timestamp` ON `rainbow_messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rainbow_messages_phone_role_ts` ON `rainbow_messages` (`phone`,`role`,`timestamp`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `regression_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`intent_type` text NOT NULL,
	`baseline_accuracy` real NOT NULL,
	`current_accuracy` real NOT NULL,
	`accuracy_drop` real NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`detected_at` integer NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_regression_alerts_profile_id` ON `regression_alerts` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_regression_alerts_intent_type` ON `regression_alerts` (`intent_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_regression_alerts_status` ON `regression_alerts` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_regression_alerts_detected_at` ON `regression_alerts` (`detected_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `room_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`guest_phone` text NOT NULL,
	`guest_name` text NOT NULL,
	`check_in_date` integer NOT NULL,
	`check_out_date` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_room_reservations_check_in` ON `room_reservations` (`check_in_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_room_reservations_check_out` ON `room_reservations` (`check_out_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_room_reservations_profile` ON `room_reservations` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_room_reservations_status` ON `room_reservations` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_room_reservations_room_id` ON `room_reservations` (`room_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scheduled_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`jid` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`send_at` integer NOT NULL,
	`template_key` text NOT NULL,
	`variables` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`booking_id` text,
	`sequence_step` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scheduled_messages_status_send_at` ON `scheduled_messages` (`status`,`send_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scheduled_messages_booking_id` ON `scheduled_messages` (`booking_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scheduled_messages_jid` ON `scheduled_messages` (`jid`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `service_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`jid` text NOT NULL,
	`profile` text DEFAULT 'pelangi' NOT NULL,
	`room_number` text,
	`request_type` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`staff_notified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_requests_jid` ON `service_requests` (`jid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_requests_profile` ON `service_requests` (`profile`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_requests_status` ON `service_requests` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_requests_created_at` ON `service_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sticker_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`intent` text NOT NULL,
	`sticker_id` text NOT NULL,
	`greeting_text` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sticker_id`) REFERENCES `festive_stickers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sticker_intents_profile_intent` ON `sticker_intents` (`profile_id`,`intent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sticker_intents_enabled` ON `sticker_intents` (`is_enabled`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sticker_intents_sticker_id` ON `sticker_intents` (`sticker_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `template_quality_events` (
	`id` text PRIMARY KEY NOT NULL,
	`template_name` text NOT NULL,
	`old_status` text,
	`new_status` text NOT NULL,
	`reason` text,
	`profile_id` text DEFAULT 'pelangi',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_template_quality_events_name` ON `template_quality_events` (`template_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_template_quality_events_created` ON `template_quality_events` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tia_records` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`ai_provider` text NOT NULL,
	`destination_jurisdiction` text NOT NULL,
	`equivalence_level` text NOT NULL,
	`api_endpoint` text NOT NULL,
	`transfer_mechanism` text NOT NULL,
	`document_json` text NOT NULL,
	`data_transferred` text NOT NULL,
	`risk_assessment` text NOT NULL,
	`controls` text NOT NULL,
	`last_reviewed_at` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`reviewed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tia_profile_provider` ON `tia_records` (`profile_id`,`ai_provider`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tia_valid_until` ON `tia_records` (`valid_until`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tia_created_at` ON `tia_records` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `utterance_gaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`utterance_sample` text NOT NULL,
	`normalized_key` text NOT NULL,
	`tier_reached` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_utterance_gaps_profile_id` ON `utterance_gaps` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_utterance_gaps_count` ON `utterance_gaps` (`count`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_utterance_gaps_last_seen` ON `utterance_gaps` (`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_utterance_gaps_profile_normalized` ON `utterance_gaps` (`profile_id`,`normalized_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vector_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`query_hash` text NOT NULL,
	`chunks_returned` integer DEFAULT 0 NOT NULL,
	`retrieved_sources` text DEFAULT '[]' NOT NULL,
	`top_score` real,
	`cross_namespace_detected` integer DEFAULT false NOT NULL,
	`similarity_attack_suspected` integer DEFAULT false NOT NULL,
	`latency_ms` integer,
	`service_identity` text DEFAULT 'rainbow-ai' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_val_property_created` ON `vector_access_logs` (`property_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_val_cross_namespace` ON `vector_access_logs` (`cross_namespace_detected`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_val_attack_suspected` ON `vector_access_logs` (`similarity_attack_suspected`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_val_created_at` ON `vector_access_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webchat_consent_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id_hash` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`user_agent_hash` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webchat_consent_log_profile` ON `webchat_consent_log` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webchat_consent_log_accepted_at` ON `webchat_consent_log` (`accepted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_raw_events` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`payload` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_raw_events_received_at` ON `webhook_raw_events` (`received_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_raw_events_processed` ON `webhook_raw_events` (`processed`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_raw_events_profile` ON `webhook_raw_events` (`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whatsapp_cost_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`template_type` text NOT NULL,
	`country_code` text DEFAULT 'MY' NOT NULL,
	`total_messages` integer DEFAULT 0 NOT NULL,
	`billable_messages` integer DEFAULT 0 NOT NULL,
	`csw_free_messages` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wa_cost_daily_date_profile_type_country` ON `whatsapp_cost_daily` (`date`,`profile_id`,`template_type`,`country_code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wa_cost_daily_date` ON `whatsapp_cost_daily` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wa_cost_daily_profile` ON `whatsapp_cost_daily` (`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whatsapp_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_name` text NOT NULL,
	`status` text NOT NULL,
	`previous_status` text,
	`rejected_reason` text,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`last_checked_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_whatsapp_templates_name_profile` ON `whatsapp_templates` (`template_name`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_whatsapp_templates_status` ON `whatsapp_templates` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_whatsapp_templates_profile` ON `whatsapp_templates` (`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workflow_step_validation_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`step_id` text NOT NULL,
	`profile_id` text DEFAULT 'pelangi' NOT NULL,
	`expected_schema` text NOT NULL,
	`actual_output` text NOT NULL,
	`error_messages` text NOT NULL,
	`workflow_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wf_step_validation_step_id` ON `workflow_step_validation_errors` (`step_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wf_step_validation_profile_id` ON `workflow_step_validation_errors` (`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wf_step_validation_created_at` ON `workflow_step_validation_errors` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wf_step_validation_step_profile` ON `workflow_step_validation_errors` (`step_id`,`profile_id`);