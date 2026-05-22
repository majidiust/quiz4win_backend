-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"wallet_balance" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"referral_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"suspension_reason" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"total_deposited" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total_withdrawn" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total_games_played" integer DEFAULT 0 NOT NULL,
	"total_prizes_won" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"country" text,
	"aml_flagged" boolean DEFAULT false NOT NULL,
	"fraud_suspected" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_key" UNIQUE("email"),
	CONSTRAINT "profiles_referral_code_key" UNIQUE("referral_code"),
	CONSTRAINT "profiles_kyc_status_check" CHECK (kyc_status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])),
	CONSTRAINT "profiles_language_check" CHECK (language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text])),
	CONSTRAINT "profiles_status_check" CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'banned'::text]))
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"haptics_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_theme_check" CHECK (theme = ANY (ARRAY['dark'::text, 'light'::text, 'system'::text]))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_device_id_key" UNIQUE("device_id"),
	CONSTRAINT "push_tokens_platform_check" CHECK (platform = ANY (ARRAY['ios'::text, 'android'::text]))
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"game_reminders" boolean DEFAULT true NOT NULL,
	"promotions" boolean DEFAULT false NOT NULL,
	"kyc_updates" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_key" UNIQUE("email"),
	CONSTRAINT "admin_users_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'moderator'::text, 'finance'::text, 'support'::text])),
	CONSTRAINT "admin_users_status_check" CHECK (status = ANY (ARRAY['active'::text, 'disabled'::text]))
);
--> statement-breakpoint
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "show_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"social_links" jsonb,
	"shows_hosted" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(3, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_hosts_name_key" UNIQUE("name"),
	CONSTRAINT "show_hosts_status_check" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]))
);
--> statement-breakpoint
ALTER TABLE "show_hosts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" text,
	"title" text NOT NULL,
	"subtitle" text,
	"mode" text NOT NULL,
	"category" text,
	"difficulty" text,
	"entry_fee" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"prize_pool" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"max_players" integer,
	"questions_count" integer DEFAULT 0 NOT NULL,
	"time_per_question" integer DEFAULT 15 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"prize_breakdown" jsonb,
	"prize_distribution" jsonb,
	"rules" text[],
	"icon" text,
	"thumbnail_url" text,
	"description" text,
	"cancelled_reason" text,
	"host_id" uuid,
	"host_name" text,
	"host_avatar_url" text,
	"host_title" text,
	"allowed_wrong_answers" integer,
	"livekit_room_name" text,
	"livekit_egress_id" text,
	"stream_url" text,
	"hls_url" text,
	"recording_url" text,
	"viewer_count" integer DEFAULT 0 NOT NULL,
	"sponsor" text,
	"accent_color" text,
	"glow_color" text,
	"gradient_colors" text[],
	"tags" text[],
	"live_audience" integer,
	"total_winners" integer,
	"total_participants" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_difficulty_check" CHECK ((difficulty = ANY (ARRAY['Easy'::text, 'Medium'::text, 'Hard'::text])) OR (difficulty IS NULL)),
	CONSTRAINT "games_mode_check" CHECK (mode = ANY (ARRAY['timed'::text, 'battle'::text, 'daily'::text, 'tournament'::text, 'live'::text])),
	CONSTRAINT "games_status_check" CHECK (status = ANY (ARRAY['upcoming'::text, 'open'::text, 'live'::text, 'completed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "games" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"options" text[] NOT NULL,
	"correct_index" integer NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"media_url" text,
	"explanation" text,
	"source" text,
	"used_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_correct_index_check" CHECK ((correct_index >= 0) AND (correct_index <= 3)),
	CONSTRAINT "questions_difficulty_check" CHECK (difficulty = ANY (ARRAY['Easy'::text, 'Medium'::text, 'Hard'::text])),
	CONSTRAINT "questions_language_check" CHECK (language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text])),
	CONSTRAINT "questions_options_check" CHECK (array_length(options, 1) = 4)
);
--> statement-breakpoint
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"livekit_identity" text,
	"score" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"wrong_answers" integer DEFAULT 0 NOT NULL,
	"entry_fee_paid" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"prize_earned" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"lives_remaining" integer,
	"eliminated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "game_participants_game_id_user_id_key" UNIQUE("game_id","user_id"),
	CONSTRAINT "game_participants_role_check" CHECK (role = ANY (ARRAY['player'::text, 'viewer'::text, 'host'::text])),
	CONSTRAINT "game_participants_status_check" CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'disqualified'::text]))
);
--> statement-breakpoint
ALTER TABLE "game_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"round_number" integer,
	"answer_index" integer,
	"is_correct" boolean DEFAULT false NOT NULL,
	"response_time_ms" integer,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_answers_participant_id_question_id_key" UNIQUE("participant_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "game_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "show_host_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"game_id" uuid,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_host_ratings_host_id_game_id_user_id_key" UNIQUE("host_id","game_id","user_id"),
	CONSTRAINT "show_host_ratings_rating_check" CHECK ((rating >= 1) AND (rating <= 5))
);
--> statement-breakpoint
ALTER TABLE "show_host_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"description" text,
	"game_id" uuid,
	"admin_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])),
	CONSTRAINT "transactions_type_check" CHECK (type = ANY (ARRAY['topup'::text, 'withdrawal'::text, 'game_entry_fee'::text, 'prize'::text, 'referral_bonus'::text, 'refund'::text, 'admin_adjustment'::text]))
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"account_details" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"transaction_id" uuid,
	"transaction_reference" text,
	"aml_flagged" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"internal_note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "withdrawals_method_check" CHECK (method = ANY (ARRAY['bank_transfer'::text, 'crypto'::text, 'paypal'::text])),
	CONSTRAINT "withdrawals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "withdrawals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kyc_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"front_image_url" text NOT NULL,
	"back_image_url" text,
	"selfie_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"reviewed_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "kyc_requests_attempt_number_check" CHECK ((attempt_number >= 1) AND (attempt_number <= 3)),
	CONSTRAINT "kyc_requests_doc_type_check" CHECK (doc_type = ANY (ARRAY['national_id'::text, 'passport'::text, 'drivers_license'::text])),
	CONSTRAINT "kyc_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "kyc_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aml_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"withdrawal_id" uuid,
	"total_24h_usd" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "aml_flags_status_check" CHECK (status = ANY (ARRAY['open'::text, 'cleared'::text, 'escalated'::text]))
);
--> statement-breakpoint
ALTER TABLE "aml_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text DEFAULT 'user' NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"bonus_amount" numeric(10, 2) DEFAULT '5.00' NOT NULL,
	"campaign_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_type_check" CHECK (type = ANY (ARRAY['user'::text, 'promo'::text, 'campaign'::text]))
);
--> statement-breakpoint
ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "referral_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"bonus_paid" boolean DEFAULT false NOT NULL,
	"bonus_paid_at" timestamp with time zone,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_uses_referred_user_id_key" UNIQUE("referred_user_id")
);
--> statement-breakpoint
ALTER TABLE "referral_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"reward_type" text,
	"reward_value" numeric(10, 2),
	"reward_description" text NOT NULL,
	"display_text" text NOT NULL,
	"usage_type" text DEFAULT 'multi_user_single_use' NOT NULL,
	"user_id_restriction" uuid,
	"per_user_limit" integer,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"min_wallet_balance_usd" numeric(10, 2),
	"kyc_required" boolean DEFAULT false NOT NULL,
	"eligible_countries" text[],
	"partner_name" text,
	"partner_logo_url" text,
	"partner_url" text,
	"show_duration_sec" integer DEFAULT 30 NOT NULL,
	"is_case_sensitive" boolean DEFAULT false NOT NULL,
	"rate_limit_per_ip" integer,
	"rate_limit_per_user" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"cancellation_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_code_key" UNIQUE("code"),
	CONSTRAINT "vouchers_reward_type_check" CHECK ((reward_type = ANY (ARRAY['topup_bonus_pct'::text, 'topup_bonus_fixed'::text, 'free_entry'::text, 'wallet_credit'::text, 'affiliate_redirect'::text])) OR (reward_type IS NULL)),
	CONSTRAINT "vouchers_show_duration_sec_check" CHECK ((show_duration_sec >= 10) AND (show_duration_sec <= 120)),
	CONSTRAINT "vouchers_status_check" CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'exhausted'::text, 'expired'::text, 'cancelled'::text])),
	CONSTRAINT "vouchers_type_check" CHECK (type = ANY (ARRAY['platform'::text, 'affiliate'::text])),
	CONSTRAINT "vouchers_usage_type_check" CHECK (usage_type = ANY (ARRAY['single_use_single_user'::text, 'multi_user_single_use'::text, 'multi_user_multi_use'::text, 'unlimited'::text]))
);
--> statement-breakpoint
ALTER TABLE "vouchers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "voucher_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"announced_by" uuid NOT NULL,
	"announced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"round_number" integer,
	"expired_at" timestamp with time zone,
	"expiry_reason" text,
	"redemptions_during_show" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "voucher_announcements_expiry_reason_check" CHECK ((expiry_reason = ANY (ARRAY['time_expired'::text, 'max_reached'::text, 'admin_cancelled'::text])) OR (expiry_reason IS NULL))
);
--> statement-breakpoint
ALTER TABLE "voucher_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "voucher_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid,
	"announcement_id" uuid,
	"attempt_ip" text,
	"user_agent" text,
	"reward_applied" boolean DEFAULT false NOT NULL,
	"reward_value_applied_usd" numeric(10, 2),
	"transaction_id" uuid,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "voucher_attempt_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_attempted" text NOT NULL,
	"user_id" uuid,
	"ip_address" text NOT NULL,
	"result" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_attempt_log_result_check" CHECK (result = ANY (ARRAY['success'::text, 'not_found'::text, 'expired'::text, 'exhausted'::text, 'already_redeemed'::text, 'per_user_limit_reached'::text, 'not_eligible'::text, 'rate_limited'::text, 'invalid_user'::text, 'kyc_required'::text, 'country_restricted'::text]))
);
--> statement-breakpoint
ALTER TABLE "voucher_attempt_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"type" text NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"sent_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_broadcasts_type_check" CHECK (type = ANY (ARRAY['system'::text, 'promotion'::text]))
);
--> statement-breakpoint
ALTER TABLE "notification_broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"data" jsonb,
	"sent_via_push" boolean DEFAULT false NOT NULL,
	"broadcast_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK (type = ANY (ARRAY['prize'::text, 'game_invite'::text, 'show_reminder'::text, 'kyc_update'::text, 'withdrawal'::text, 'system'::text, 'promotion'::text]))
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"transaction_id" uuid,
	"assigned_to" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_ticket_number_key" UNIQUE("ticket_number"),
	CONSTRAINT "support_tickets_category_check" CHECK (category = ANY (ARRAY['payment'::text, 'kyc'::text, 'game'::text, 'account'::text, 'other'::text])),
	CONSTRAINT "support_tickets_status_check" CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text]))
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_ticket_messages_sender_type_check" CHECK (sender_type = ANY (ARRAY['user'::text, 'admin'::text]))
);
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_config_value_type_check" CHECK (value_type = ANY (ARRAY['string'::text, 'number'::text, 'boolean'::text, 'json'::text]))
);
--> statement-breakpoint
ALTER TABLE "app_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_articles_category_check" CHECK (category = ANY (ARRAY['payments'::text, 'kyc'::text, 'games'::text, 'account'::text, 'general'::text])),
	CONSTRAINT "help_articles_language_check" CHECK (language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text]))
);
--> statement-breakpoint
ALTER TABLE "help_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tos_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tos_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tos_acceptances_user_id_tos_version_key" UNIQUE("user_id","tos_version")
);
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_questions" (
	"game_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"order" integer NOT NULL,
	CONSTRAINT "game_questions_pkey" PRIMARY KEY("game_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "game_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tos_versions" (
	"version" text NOT NULL,
	"type" text NOT NULL,
	"content_en" text NOT NULL,
	"content_ar" text,
	"content_fa" text,
	"content_tr" text,
	"effective_date" date NOT NULL,
	"require_re_acceptance" boolean DEFAULT false NOT NULL,
	"published_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tos_versions_pkey" PRIMARY KEY("version","type"),
	CONSTRAINT "tos_versions_type_check" CHECK (type = ANY (ARRAY['tos'::text, 'privacy'::text]))
);
--> statement-breakpoint
ALTER TABLE "tos_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_referral_code_fkey" FOREIGN KEY ("referral_code") REFERENCES "public"."referral_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."show_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."game_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_host_ratings" ADD CONSTRAINT "show_host_ratings_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_host_ratings" ADD CONSTRAINT "show_host_ratings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."show_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_host_ratings" ADD CONSTRAINT "show_host_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_requests" ADD CONSTRAINT "kyc_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_requests" ADD CONSTRAINT "kyc_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_flags" ADD CONSTRAINT "aml_flags_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_flags" ADD CONSTRAINT "aml_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_flags" ADD CONSTRAINT "aml_flags_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_code_fkey" FOREIGN KEY ("code") REFERENCES "public"."referral_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_user_id_restriction_fkey" FOREIGN KEY ("user_id_restriction") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_announcements" ADD CONSTRAINT "voucher_announcements_announced_by_fkey" FOREIGN KEY ("announced_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_announcements" ADD CONSTRAINT "voucher_announcements_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_announcements" ADD CONSTRAINT "voucher_announcements_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."voucher_announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_attempt_log" ADD CONSTRAINT "voucher_attempt_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_broadcasts" ADD CONSTRAINT "notification_broadcasts_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."notification_broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_questions" ADD CONSTRAINT "game_questions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_questions" ADD CONSTRAINT "game_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_versions" ADD CONSTRAINT "tos_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_profiles_aml_flagged" ON "profiles" USING btree ("aml_flagged" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_country" ON "profiles" USING btree ("country" text_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_email" ON "profiles" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_fraud_suspected" ON "profiles" USING btree ("fraud_suspected" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_kyc_status" ON "profiles" USING btree ("kyc_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_last_seen_at" ON "profiles" USING btree ("last_seen_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_referral_code" ON "profiles" USING btree ("referral_code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_status" ON "profiles" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_push_tokens_device_id" ON "push_tokens" USING btree ("device_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_push_tokens_user_id" ON "push_tokens" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_users_role" ON "admin_users" USING btree ("role" text_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_users_status" ON "admin_users" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_action" ON "admin_audit_log" USING btree ("action" text_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_admin_id" ON "admin_audit_log" USING btree ("admin_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_created_at" ON "admin_audit_log" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_entity_id" ON "admin_audit_log" USING btree ("entity_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_log_entity_type" ON "admin_audit_log" USING btree ("entity_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_show_hosts_status" ON "show_hosts" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_games_category" ON "games" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_games_host_id" ON "games" USING btree ("host_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_games_livekit_room_name" ON "games" USING btree ("livekit_room_name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_games_mode" ON "games" USING btree ("mode" text_ops);--> statement-breakpoint
CREATE INDEX "idx_games_scheduled_at" ON "games" USING btree ("scheduled_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_games_show_id" ON "games" USING btree ("show_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_games_started_at" ON "games" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_games_status" ON "games" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_questions_active" ON "questions" USING btree ("active" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_questions_category" ON "questions" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_questions_deleted_at" ON "questions" USING btree ("deleted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_questions_difficulty" ON "questions" USING btree ("difficulty" text_ops);--> statement-breakpoint
CREATE INDEX "idx_questions_language" ON "questions" USING btree ("language" text_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_game_id" ON "game_participants" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_livekit_identity" ON "game_participants" USING btree ("livekit_identity" text_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_rank" ON "game_participants" USING btree ("rank" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_role" ON "game_participants" USING btree ("role" text_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_status" ON "game_participants" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_game_participants_user_id" ON "game_participants" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_answers_game_id" ON "game_answers" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_answers_is_correct" ON "game_answers" USING btree ("is_correct" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_game_answers_participant_id" ON "game_answers" USING btree ("participant_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_answers_question_id" ON "game_answers" USING btree ("question_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_answers_round_number" ON "game_answers" USING btree ("round_number" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_show_host_ratings_game_id" ON "show_host_ratings" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_show_host_ratings_host_id" ON "show_host_ratings" USING btree ("host_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_show_host_ratings_user_id" ON "show_host_ratings" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_admin_id" ON "transactions" USING btree ("admin_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_created_at" ON "transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_game_id" ON "transactions" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_status" ON "transactions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_type" ON "transactions" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_transactions_user_id" ON "transactions" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_withdrawals_aml_flagged" ON "withdrawals" USING btree ("aml_flagged" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_withdrawals_requested_at" ON "withdrawals" USING btree ("requested_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_withdrawals_reviewed_by" ON "withdrawals" USING btree ("reviewed_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_withdrawals_status" ON "withdrawals" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_withdrawals_user_id" ON "withdrawals" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_kyc_requests_reviewed_by" ON "kyc_requests" USING btree ("reviewed_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_kyc_requests_status" ON "kyc_requests" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_kyc_requests_submitted_at" ON "kyc_requests" USING btree ("submitted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_kyc_requests_user_id" ON "kyc_requests" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_aml_flags_flagged_at" ON "aml_flags" USING btree ("flagged_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_aml_flags_status" ON "aml_flags" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_aml_flags_user_id" ON "aml_flags" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_aml_flags_withdrawal_id" ON "aml_flags" USING btree ("withdrawal_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_referral_codes_owner_id" ON "referral_codes" USING btree ("owner_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_referral_codes_type" ON "referral_codes" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_referral_uses_code" ON "referral_uses" USING btree ("code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_referral_uses_referred_user_id" ON "referral_uses" USING btree ("referred_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_referral_uses_referrer_user_id" ON "referral_uses" USING btree ("referrer_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_code" ON "vouchers" USING btree ("code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_created_by" ON "vouchers" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_max_redemptions" ON "vouchers" USING btree ("max_redemptions" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_redemption_count" ON "vouchers" USING btree ("redemption_count" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_reward_type" ON "vouchers" USING btree ("reward_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_status" ON "vouchers" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_type" ON "vouchers" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_usage_type" ON "vouchers" USING btree ("usage_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_user_id_restriction" ON "vouchers" USING btree ("user_id_restriction" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_valid_from" ON "vouchers" USING btree ("valid_from" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_vouchers_valid_until" ON "vouchers" USING btree ("valid_until" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_announcements_announced_at" ON "voucher_announcements" USING btree ("announced_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_announcements_game_id" ON "voucher_announcements" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_announcements_voucher_id" ON "voucher_announcements" USING btree ("voucher_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_announcement_id" ON "voucher_redemptions" USING btree ("announcement_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_game_id" ON "voucher_redemptions" USING btree ("game_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_redeemed_at" ON "voucher_redemptions" USING btree ("redeemed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_reward_applied" ON "voucher_redemptions" USING btree ("reward_applied" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_user_id" ON "voucher_redemptions" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_redemptions_voucher_id" ON "voucher_redemptions" USING btree ("voucher_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_attempt_log_attempted_at" ON "voucher_attempt_log" USING btree ("attempted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_attempt_log_code_attempted" ON "voucher_attempt_log" USING btree ("code_attempted" text_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_attempt_log_ip_address" ON "voucher_attempt_log" USING btree ("ip_address" text_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_attempt_log_result" ON "voucher_attempt_log" USING btree ("result" text_ops);--> statement-breakpoint
CREATE INDEX "idx_voucher_attempt_log_user_id" ON "voucher_attempt_log" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_broadcasts_scheduled_at" ON "notification_broadcasts" USING btree ("scheduled_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_broadcasts_sent_at" ON "notification_broadcasts" USING btree ("sent_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_broadcasts_sent_by" ON "notification_broadcasts" USING btree ("sent_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_broadcasts_type" ON "notification_broadcasts" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_broadcast_id" ON "notifications" USING btree ("broadcast_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_created_at" ON "notifications" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_read" ON "notifications" USING btree ("read" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_type" ON "notifications" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id" ON "notifications" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_assigned_to" ON "support_tickets" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_category" ON "support_tickets" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_created_at" ON "support_tickets" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_status" ON "support_tickets" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_ticket_number" ON "support_tickets" USING btree ("ticket_number" text_ops);--> statement-breakpoint
CREATE INDEX "idx_support_tickets_user_id" ON "support_tickets" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_support_ticket_messages_created_at" ON "support_ticket_messages" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_support_ticket_messages_sender_id" ON "support_ticket_messages" USING btree ("sender_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_support_ticket_messages_sender_type" ON "support_ticket_messages" USING btree ("sender_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_support_ticket_messages_ticket_id" ON "support_ticket_messages" USING btree ("ticket_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_help_articles_category" ON "help_articles" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_help_articles_is_published" ON "help_articles" USING btree ("is_published" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_help_articles_language" ON "help_articles" USING btree ("language" text_ops);--> statement-breakpoint
CREATE INDEX "idx_tos_acceptances_user_id" ON "tos_acceptances" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_game_questions_game_id" ON "game_questions" USING btree ("game_id" uuid_ops);
*/