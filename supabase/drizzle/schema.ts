import { pgTable, type AnyPgColumn, index, foreignKey, unique, check, uuid, text, numeric, boolean, integer, timestamp, jsonb, primaryKey, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	full_name: text(),
	avatar_url: text(),
	wallet_balance: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	kyc_status: text().default('pending').notNull(),
	language: text().default('en').notNull(),
	referral_code: text(),
	status: text().default('active').notNull(),
	suspension_reason: text(),
	email_verified: boolean().default(false).notNull(),
	total_deposited: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	total_withdrawn: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	total_games_played: integer().default(0).notNull(),
	total_prizes_won: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	country: text(),
	aml_flagged: boolean().default(false).notNull(),
	fraud_suspected: boolean().default(false).notNull(),
	last_seen_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_profiles_aml_flagged").using("btree", table.aml_flagged.asc().nullsLast().op("bool_ops")),
	index("idx_profiles_country").using("btree", table.country.asc().nullsLast().op("text_ops")),
	index("idx_profiles_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_profiles_fraud_suspected").using("btree", table.fraud_suspected.asc().nullsLast().op("bool_ops")),
	index("idx_profiles_kyc_status").using("btree", table.kyc_status.asc().nullsLast().op("text_ops")),
	index("idx_profiles_last_seen_at").using("btree", table.last_seen_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_profiles_referral_code").using("btree", table.referral_code.asc().nullsLast().op("text_ops")),
	index("idx_profiles_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.referral_code],
			foreignColumns: [referral_codes.code],
			name: "profiles_referral_code_fkey"
		}),
	unique("profiles_email_key").on(table.email),
	unique("profiles_referral_code_key").on(table.referral_code),
	check("profiles_kyc_status_check", sql`kyc_status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])`),
	check("profiles_language_check", sql`language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text])`),
	check("profiles_status_check", sql`status = ANY (ARRAY['active'::text, 'suspended'::text, 'banned'::text])`),
]);

export const user_settings = pgTable("user_settings", {
	user_id: uuid().primaryKey().notNull(),
	theme: text().default('dark').notNull(),
	sound_enabled: boolean().default(true).notNull(),
	haptics_enabled: boolean().default(true).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "user_settings_user_id_fkey"
		}).onDelete("cascade"),
	check("user_settings_theme_check", sql`theme = ANY (ARRAY['dark'::text, 'light'::text, 'system'::text])`),
]);

export const push_tokens = pgTable("push_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	token: text().notNull(),
	platform: text().notNull(),
	device_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_push_tokens_device_id").using("btree", table.device_id.asc().nullsLast().op("text_ops")),
	index("idx_push_tokens_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "push_tokens_user_id_fkey"
		}).onDelete("cascade"),
	unique("push_tokens_device_id_key").on(table.device_id),
	check("push_tokens_platform_check", sql`platform = ANY (ARRAY['ios'::text, 'android'::text])`),
]);

export const notification_preferences = pgTable("notification_preferences", {
	user_id: uuid().primaryKey().notNull(),
	game_reminders: boolean().default(true).notNull(),
	promotions: boolean().default(false).notNull(),
	kyc_updates: boolean().default(true).notNull(),
	system: boolean().default(true).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "notification_preferences_user_id_fkey"
		}).onDelete("cascade"),
]);

export const admin_users = pgTable("admin_users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	name: text().notNull(),
	role: text().notNull(),
	status: text().default('active').notNull(),
	mfa_enabled: boolean().default(false).notNull(),
	mfa_secret: text(),
	last_login_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_login_ip: text(),
	invited_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_admin_users_role").using("btree", table.role.asc().nullsLast().op("text_ops")),
	index("idx_admin_users_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.invited_by],
			foreignColumns: [table.id],
			name: "admin_users_invited_by_fkey"
		}),
	unique("admin_users_email_key").on(table.email),
	check("admin_users_role_check", sql`role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'moderator'::text, 'finance'::text, 'support'::text])`),
	check("admin_users_status_check", sql`status = ANY (ARRAY['active'::text, 'disabled'::text])`),
]);

export const admin_audit_log = pgTable("admin_audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	admin_id: uuid().notNull(),
	action: text().notNull(),
	entity_type: text(),
	entity_id: text(),
	details: jsonb(),
	ip_address: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_admin_audit_log_action").using("btree", table.action.asc().nullsLast().op("text_ops")),
	index("idx_admin_audit_log_admin_id").using("btree", table.admin_id.asc().nullsLast().op("uuid_ops")),
	index("idx_admin_audit_log_created_at").using("btree", table.created_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_admin_audit_log_entity_id").using("btree", table.entity_id.asc().nullsLast().op("text_ops")),
	index("idx_admin_audit_log_entity_type").using("btree", table.entity_type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.admin_id],
			foreignColumns: [admin_users.id],
			name: "admin_audit_log_admin_id_fkey"
		}),
]);

export const show_hosts = pgTable("show_hosts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	bio: text(),
	avatar_url: text(),
	social_links: jsonb(),
	shows_hosted: integer().default(0).notNull(),
	avg_rating: numeric({ precision: 3, scale:  2 }),
	status: text().default('active').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_show_hosts_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("show_hosts_name_key").on(table.name),
	check("show_hosts_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const games = pgTable("games", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	show_id: text(),
	title: text().notNull(),
	subtitle: text(),
	mode: text().notNull(),
	category: text(),
	difficulty: text(),
	entry_fee: numeric({ precision: 10, scale:  2 }).default('0.00').notNull(),
	prize_pool: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	max_players: integer(),
	questions_count: integer().default(0).notNull(),
	time_per_question: integer().default(15).notNull(),
	scheduled_at: timestamp({ withTimezone: true, mode: 'string' }),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	ended_at: timestamp({ withTimezone: true, mode: 'string' }),
	status: text().default('upcoming').notNull(),
	prize_breakdown: jsonb(),
	prize_distribution: jsonb(),
	rules: text().array(),
	icon: text(),
	thumbnail_url: text(),
	description: text(),
	cancelled_reason: text(),
	host_id: uuid(),
	host_name: text(),
	host_avatar_url: text(),
	host_title: text(),
	allowed_wrong_answers: integer(),
	livekit_room_name: text(),
	livekit_egress_id: text(),
	stream_url: text(),
	hls_url: text(),
	recording_url: text(),
	viewer_count: integer().default(0).notNull(),
	sponsor: text(),
	accent_color: text(),
	glow_color: text(),
	gradient_colors: text().array(),
	tags: text().array(),
	live_audience: integer(),
	total_winners: integer(),
	total_participants: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_games_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_games_host_id").using("btree", table.host_id.asc().nullsLast().op("uuid_ops")),
	index("idx_games_livekit_room_name").using("btree", table.livekit_room_name.asc().nullsLast().op("text_ops")),
	index("idx_games_mode").using("btree", table.mode.asc().nullsLast().op("text_ops")),
	index("idx_games_scheduled_at").using("btree", table.scheduled_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_games_show_id").using("btree", table.show_id.asc().nullsLast().op("text_ops")),
	index("idx_games_started_at").using("btree", table.started_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_games_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.host_id],
			foreignColumns: [show_hosts.id],
			name: "games_host_id_fkey"
		}),
	check("games_difficulty_check", sql`(difficulty = ANY (ARRAY['Easy'::text, 'Medium'::text, 'Hard'::text])) OR (difficulty IS NULL)`),
	check("games_mode_check", sql`mode = ANY (ARRAY['timed'::text, 'battle'::text, 'daily'::text, 'tournament'::text, 'live'::text])`),
	check("games_status_check", sql`status = ANY (ARRAY['upcoming'::text, 'open'::text, 'live'::text, 'completed'::text, 'cancelled'::text])`),
]);

export const questions = pgTable("questions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	text: text().notNull(),
	options: text().array().notNull(),
	correct_index: integer().notNull(),
	category: text().notNull(),
	difficulty: text().notNull(),
	language: text().default('en').notNull(),
	media_url: text(),
	explanation: text(),
	source: text(),
	used_count: integer().default(0).notNull(),
	active: boolean().default(true).notNull(),
	deleted_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_questions_active").using("btree", table.active.asc().nullsLast().op("bool_ops")),
	index("idx_questions_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_questions_deleted_at").using("btree", table.deleted_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_questions_difficulty").using("btree", table.difficulty.asc().nullsLast().op("text_ops")),
	index("idx_questions_language").using("btree", table.language.asc().nullsLast().op("text_ops")),
	check("questions_correct_index_check", sql`(correct_index >= 0) AND (correct_index <= 3)`),
	check("questions_difficulty_check", sql`difficulty = ANY (ARRAY['Easy'::text, 'Medium'::text, 'Hard'::text])`),
	check("questions_language_check", sql`language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text])`),
	check("questions_options_check", sql`array_length(options, 1) = 4`),
]);

export const game_participants = pgTable("game_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	game_id: uuid().notNull(),
	user_id: uuid().notNull(),
	role: text().default('player').notNull(),
	livekit_identity: text(),
	score: integer().default(0).notNull(),
	rank: integer(),
	correct_answers: integer().default(0).notNull(),
	wrong_answers: integer().default(0).notNull(),
	entry_fee_paid: numeric({ precision: 10, scale:  2 }).default('0.00').notNull(),
	prize_earned: numeric({ precision: 10, scale:  2 }).default('0.00').notNull(),
	lives_remaining: integer(),
	eliminated: boolean().default(false).notNull(),
	status: text().default('active').notNull(),
	joined_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_game_participants_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_game_participants_livekit_identity").using("btree", table.livekit_identity.asc().nullsLast().op("text_ops")),
	index("idx_game_participants_rank").using("btree", table.rank.asc().nullsLast().op("int4_ops")),
	index("idx_game_participants_role").using("btree", table.role.asc().nullsLast().op("text_ops")),
	index("idx_game_participants_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_game_participants_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "game_participants_game_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "game_participants_user_id_fkey"
		}),
	unique("game_participants_game_id_user_id_key").on(table.game_id, table.user_id),
	check("game_participants_role_check", sql`role = ANY (ARRAY['player'::text, 'viewer'::text, 'host'::text])`),
	check("game_participants_status_check", sql`status = ANY (ARRAY['active'::text, 'completed'::text, 'disqualified'::text])`),
]);

export const game_answers = pgTable("game_answers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	game_id: uuid().notNull(),
	participant_id: uuid().notNull(),
	question_id: uuid().notNull(),
	round_number: integer(),
	answer_index: integer(),
	is_correct: boolean().default(false).notNull(),
	response_time_ms: integer(),
	points_earned: integer().default(0).notNull(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_game_answers_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_game_answers_is_correct").using("btree", table.is_correct.asc().nullsLast().op("bool_ops")),
	index("idx_game_answers_participant_id").using("btree", table.participant_id.asc().nullsLast().op("uuid_ops")),
	index("idx_game_answers_question_id").using("btree", table.question_id.asc().nullsLast().op("uuid_ops")),
	index("idx_game_answers_round_number").using("btree", table.round_number.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "game_answers_game_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.participant_id],
			foreignColumns: [game_participants.id],
			name: "game_answers_participant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.question_id],
			foreignColumns: [questions.id],
			name: "game_answers_question_id_fkey"
		}),
	unique("game_answers_participant_id_question_id_key").on(table.participant_id, table.question_id),
]);

export const show_host_ratings = pgTable("show_host_ratings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	host_id: uuid().notNull(),
	game_id: uuid(),
	user_id: uuid().notNull(),
	rating: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_show_host_ratings_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_show_host_ratings_host_id").using("btree", table.host_id.asc().nullsLast().op("uuid_ops")),
	index("idx_show_host_ratings_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "show_host_ratings_game_id_fkey"
		}),
	foreignKey({
			columns: [table.host_id],
			foreignColumns: [show_hosts.id],
			name: "show_host_ratings_host_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "show_host_ratings_user_id_fkey"
		}),
	unique("show_host_ratings_host_id_game_id_user_id_key").on(table.host_id, table.game_id, table.user_id),
	check("show_host_ratings_rating_check", sql`(rating >= 1) AND (rating <= 5)`),
]);

export const transactions = pgTable("transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	type: text().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	status: text().default('pending').notNull(),
	reference: text(),
	description: text(),
	game_id: uuid(),
	admin_id: uuid(),
	metadata: jsonb(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_transactions_admin_id").using("btree", table.admin_id.asc().nullsLast().op("uuid_ops")),
	index("idx_transactions_created_at").using("btree", table.created_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_transactions_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_transactions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_transactions_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("idx_transactions_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.admin_id],
			foreignColumns: [admin_users.id],
			name: "transactions_admin_id_fkey"
		}),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "transactions_game_id_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "transactions_user_id_fkey"
		}),
	check("transactions_status_check", sql`status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])`),
	check("transactions_type_check", sql`type = ANY (ARRAY['topup'::text, 'withdrawal'::text, 'game_entry_fee'::text, 'prize'::text, 'referral_bonus'::text, 'refund'::text, 'admin_adjustment'::text])`),
]);

export const withdrawals = pgTable("withdrawals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	method: text().notNull(),
	account_details: jsonb().notNull(),
	status: text().default('pending').notNull(),
	rejection_reason: text(),
	transaction_id: uuid(),
	transaction_reference: text(),
	aml_flagged: boolean().default(false).notNull(),
	reviewed_by: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	internal_note: text(),
	requested_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_withdrawals_aml_flagged").using("btree", table.aml_flagged.asc().nullsLast().op("bool_ops")),
	index("idx_withdrawals_requested_at").using("btree", table.requested_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_withdrawals_reviewed_by").using("btree", table.reviewed_by.asc().nullsLast().op("uuid_ops")),
	index("idx_withdrawals_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_withdrawals_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewed_by],
			foreignColumns: [admin_users.id],
			name: "withdrawals_reviewed_by_fkey"
		}),
	foreignKey({
			columns: [table.transaction_id],
			foreignColumns: [transactions.id],
			name: "withdrawals_transaction_id_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "withdrawals_user_id_fkey"
		}),
	check("withdrawals_method_check", sql`method = ANY (ARRAY['bank_transfer'::text, 'crypto'::text, 'paypal'::text])`),
	check("withdrawals_status_check", sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'rejected'::text])`),
]);

export const kyc_requests = pgTable("kyc_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	doc_type: text().notNull(),
	front_image_url: text().notNull(),
	back_image_url: text(),
	selfie_url: text().notNull(),
	status: text().default('pending').notNull(),
	rejection_reason: text(),
	attempt_number: integer().default(1).notNull(),
	reviewed_by: uuid(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_kyc_requests_reviewed_by").using("btree", table.reviewed_by.asc().nullsLast().op("uuid_ops")),
	index("idx_kyc_requests_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_kyc_requests_submitted_at").using("btree", table.submitted_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_kyc_requests_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewed_by],
			foreignColumns: [admin_users.id],
			name: "kyc_requests_reviewed_by_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "kyc_requests_user_id_fkey"
		}).onDelete("cascade"),
	check("kyc_requests_attempt_number_check", sql`(attempt_number >= 1) AND (attempt_number <= 3)`),
	check("kyc_requests_doc_type_check", sql`doc_type = ANY (ARRAY['national_id'::text, 'passport'::text, 'drivers_license'::text])`),
	check("kyc_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])`),
]);

export const aml_flags = pgTable("aml_flags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	withdrawal_id: uuid(),
	total_24h_usd: numeric({ precision: 12, scale:  2 }).notNull(),
	status: text().default('open').notNull(),
	reviewed_by: uuid(),
	review_note: text(),
	flagged_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_aml_flags_flagged_at").using("btree", table.flagged_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_aml_flags_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_aml_flags_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	index("idx_aml_flags_withdrawal_id").using("btree", table.withdrawal_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewed_by],
			foreignColumns: [admin_users.id],
			name: "aml_flags_reviewed_by_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "aml_flags_user_id_fkey"
		}),
	foreignKey({
			columns: [table.withdrawal_id],
			foreignColumns: [withdrawals.id],
			name: "aml_flags_withdrawal_id_fkey"
		}),
	check("aml_flags_status_check", sql`status = ANY (ARRAY['open'::text, 'cleared'::text, 'escalated'::text])`),
]);

export const referral_codes = pgTable("referral_codes", {
	code: text().primaryKey().notNull(),
	owner_id: uuid().notNull(),
	type: text().default('user').notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	max_uses: integer(),
	use_count: integer().default(0).notNull(),
	bonus_amount: numeric({ precision: 10, scale:  2 }).default('5.00').notNull(),
	campaign_name: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_referral_codes_owner_id").using("btree", table.owner_id.asc().nullsLast().op("uuid_ops")),
	index("idx_referral_codes_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [profiles.id],
			name: "referral_codes_owner_id_fkey"
		}),
	check("referral_codes_type_check", sql`type = ANY (ARRAY['user'::text, 'promo'::text, 'campaign'::text])`),
]);

export const referral_uses = pgTable("referral_uses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	referred_user_id: uuid().notNull(),
	referrer_user_id: uuid().notNull(),
	bonus_paid: boolean().default(false).notNull(),
	bonus_paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	used_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_referral_uses_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_referral_uses_referred_user_id").using("btree", table.referred_user_id.asc().nullsLast().op("uuid_ops")),
	index("idx_referral_uses_referrer_user_id").using("btree", table.referrer_user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.code],
			foreignColumns: [referral_codes.code],
			name: "referral_uses_code_fkey"
		}),
	foreignKey({
			columns: [table.referred_user_id],
			foreignColumns: [profiles.id],
			name: "referral_uses_referred_user_id_fkey"
		}),
	foreignKey({
			columns: [table.referrer_user_id],
			foreignColumns: [profiles.id],
			name: "referral_uses_referrer_user_id_fkey"
		}),
	unique("referral_uses_referred_user_id_key").on(table.referred_user_id),
]);

export const vouchers = pgTable("vouchers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	description: text(),
	type: text().notNull(),
	reward_type: text(),
	reward_value: numeric({ precision: 10, scale:  2 }),
	reward_description: text().notNull(),
	display_text: text().notNull(),
	usage_type: text().default('multi_user_single_use').notNull(),
	user_id_restriction: uuid(),
	per_user_limit: integer(),
	max_redemptions: integer(),
	redemption_count: integer().default(0).notNull(),
	valid_from: timestamp({ withTimezone: true, mode: 'string' }),
	valid_until: timestamp({ withTimezone: true, mode: 'string' }),
	min_wallet_balance_usd: numeric({ precision: 10, scale:  2 }),
	kyc_required: boolean().default(false).notNull(),
	eligible_countries: text().array(),
	partner_name: text(),
	partner_logo_url: text(),
	partner_url: text(),
	show_duration_sec: integer().default(30).notNull(),
	is_case_sensitive: boolean().default(false).notNull(),
	rate_limit_per_ip: integer(),
	rate_limit_per_user: integer(),
	status: text().default('active').notNull(),
	cancellation_reason: text(),
	created_by: uuid().notNull(),
	updated_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_vouchers_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_vouchers_created_by").using("btree", table.created_by.asc().nullsLast().op("uuid_ops")),
	index("idx_vouchers_max_redemptions").using("btree", table.max_redemptions.asc().nullsLast().op("int4_ops")),
	index("idx_vouchers_redemption_count").using("btree", table.redemption_count.asc().nullsLast().op("int4_ops")),
	index("idx_vouchers_reward_type").using("btree", table.reward_type.asc().nullsLast().op("text_ops")),
	index("idx_vouchers_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_vouchers_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("idx_vouchers_usage_type").using("btree", table.usage_type.asc().nullsLast().op("text_ops")),
	index("idx_vouchers_user_id_restriction").using("btree", table.user_id_restriction.asc().nullsLast().op("uuid_ops")),
	index("idx_vouchers_valid_from").using("btree", table.valid_from.asc().nullsLast().op("timestamptz_ops")),
	index("idx_vouchers_valid_until").using("btree", table.valid_until.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.created_by],
			foreignColumns: [admin_users.id],
			name: "vouchers_created_by_fkey"
		}),
	foreignKey({
			columns: [table.updated_by],
			foreignColumns: [admin_users.id],
			name: "vouchers_updated_by_fkey"
		}),
	foreignKey({
			columns: [table.user_id_restriction],
			foreignColumns: [profiles.id],
			name: "vouchers_user_id_restriction_fkey"
		}),
	unique("vouchers_code_key").on(table.code),
	check("vouchers_reward_type_check", sql`(reward_type = ANY (ARRAY['topup_bonus_pct'::text, 'topup_bonus_fixed'::text, 'free_entry'::text, 'wallet_credit'::text, 'affiliate_redirect'::text])) OR (reward_type IS NULL)`),
	check("vouchers_show_duration_sec_check", sql`(show_duration_sec >= 10) AND (show_duration_sec <= 120)`),
	check("vouchers_status_check", sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'exhausted'::text, 'expired'::text, 'cancelled'::text])`),
	check("vouchers_type_check", sql`type = ANY (ARRAY['platform'::text, 'affiliate'::text])`),
	check("vouchers_usage_type_check", sql`usage_type = ANY (ARRAY['single_use_single_user'::text, 'multi_user_single_use'::text, 'multi_user_multi_use'::text, 'unlimited'::text])`),
]);

export const voucher_announcements = pgTable("voucher_announcements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	voucher_id: uuid().notNull(),
	game_id: uuid().notNull(),
	announced_by: uuid().notNull(),
	announced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	round_number: integer(),
	expired_at: timestamp({ withTimezone: true, mode: 'string' }),
	expiry_reason: text(),
	redemptions_during_show: integer().default(0).notNull(),
}, (table) => [
	index("idx_voucher_announcements_announced_at").using("btree", table.announced_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_voucher_announcements_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_voucher_announcements_voucher_id").using("btree", table.voucher_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.announced_by],
			foreignColumns: [admin_users.id],
			name: "voucher_announcements_announced_by_fkey"
		}),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "voucher_announcements_game_id_fkey"
		}),
	foreignKey({
			columns: [table.voucher_id],
			foreignColumns: [vouchers.id],
			name: "voucher_announcements_voucher_id_fkey"
		}).onDelete("cascade"),
	check("voucher_announcements_expiry_reason_check", sql`(expiry_reason = ANY (ARRAY['time_expired'::text, 'max_reached'::text, 'admin_cancelled'::text])) OR (expiry_reason IS NULL)`),
]);

export const voucher_redemptions = pgTable("voucher_redemptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	voucher_id: uuid().notNull(),
	user_id: uuid().notNull(),
	game_id: uuid(),
	announcement_id: uuid(),
	attempt_ip: text(),
	user_agent: text(),
	reward_applied: boolean().default(false).notNull(),
	reward_value_applied_usd: numeric({ precision: 10, scale:  2 }),
	transaction_id: uuid(),
	redeemed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_voucher_redemptions_announcement_id").using("btree", table.announcement_id.asc().nullsLast().op("uuid_ops")),
	index("idx_voucher_redemptions_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	index("idx_voucher_redemptions_redeemed_at").using("btree", table.redeemed_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_voucher_redemptions_reward_applied").using("btree", table.reward_applied.asc().nullsLast().op("bool_ops")),
	index("idx_voucher_redemptions_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	index("idx_voucher_redemptions_voucher_id").using("btree", table.voucher_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.announcement_id],
			foreignColumns: [voucher_announcements.id],
			name: "voucher_redemptions_announcement_id_fkey"
		}),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "voucher_redemptions_game_id_fkey"
		}),
	foreignKey({
			columns: [table.transaction_id],
			foreignColumns: [transactions.id],
			name: "voucher_redemptions_transaction_id_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "voucher_redemptions_user_id_fkey"
		}),
	foreignKey({
			columns: [table.voucher_id],
			foreignColumns: [vouchers.id],
			name: "voucher_redemptions_voucher_id_fkey"
		}),
]);

export const voucher_attempt_log = pgTable("voucher_attempt_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code_attempted: text().notNull(),
	user_id: uuid(),
	ip_address: text().notNull(),
	result: text().notNull(),
	attempted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_voucher_attempt_log_attempted_at").using("btree", table.attempted_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_voucher_attempt_log_code_attempted").using("btree", table.code_attempted.asc().nullsLast().op("text_ops")),
	index("idx_voucher_attempt_log_ip_address").using("btree", table.ip_address.asc().nullsLast().op("text_ops")),
	index("idx_voucher_attempt_log_result").using("btree", table.result.asc().nullsLast().op("text_ops")),
	index("idx_voucher_attempt_log_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "voucher_attempt_log_user_id_fkey"
		}),
	check("voucher_attempt_log_result_check", sql`result = ANY (ARRAY['success'::text, 'not_found'::text, 'expired'::text, 'exhausted'::text, 'already_redeemed'::text, 'per_user_limit_reached'::text, 'not_eligible'::text, 'rate_limited'::text, 'invalid_user'::text, 'kyc_required'::text, 'country_restricted'::text])`),
]);

export const notification_broadcasts = pgTable("notification_broadcasts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	type: text().notNull(),
	segment: jsonb().default({}).notNull(),
	data: jsonb(),
	scheduled_at: timestamp({ withTimezone: true, mode: 'string' }),
	sent_at: timestamp({ withTimezone: true, mode: 'string' }),
	recipients_count: integer().default(0).notNull(),
	delivered_count: integer().default(0).notNull(),
	failed_count: integer().default(0).notNull(),
	sent_by: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notification_broadcasts_scheduled_at").using("btree", table.scheduled_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_notification_broadcasts_sent_at").using("btree", table.sent_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_notification_broadcasts_sent_by").using("btree", table.sent_by.asc().nullsLast().op("uuid_ops")),
	index("idx_notification_broadcasts_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.sent_by],
			foreignColumns: [admin_users.id],
			name: "notification_broadcasts_sent_by_fkey"
		}),
	check("notification_broadcasts_type_check", sql`type = ANY (ARRAY['system'::text, 'promotion'::text])`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	read: boolean().default(false).notNull(),
	data: jsonb(),
	sent_via_push: boolean().default(false).notNull(),
	broadcast_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_broadcast_id").using("btree", table.broadcast_id.asc().nullsLast().op("uuid_ops")),
	index("idx_notifications_created_at").using("btree", table.created_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_notifications_read").using("btree", table.read.asc().nullsLast().op("bool_ops")),
	index("idx_notifications_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("idx_notifications_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.broadcast_id],
			foreignColumns: [notification_broadcasts.id],
			name: "notifications_broadcast_id_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
	check("notifications_type_check", sql`type = ANY (ARRAY['prize'::text, 'game_invite'::text, 'show_reminder'::text, 'kyc_update'::text, 'withdrawal'::text, 'system'::text, 'promotion'::text])`),
]);

export const support_tickets = pgTable("support_tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	ticket_number: text().notNull(),
	category: text().notNull(),
	subject: text().notNull(),
	description: text().notNull(),
	transaction_id: uuid(),
	assigned_to: uuid(),
	status: text().default('open').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_support_tickets_assigned_to").using("btree", table.assigned_to.asc().nullsLast().op("uuid_ops")),
	index("idx_support_tickets_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_support_tickets_created_at").using("btree", table.created_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_support_tickets_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_support_tickets_ticket_number").using("btree", table.ticket_number.asc().nullsLast().op("text_ops")),
	index("idx_support_tickets_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assigned_to],
			foreignColumns: [admin_users.id],
			name: "support_tickets_assigned_to_fkey"
		}),
	foreignKey({
			columns: [table.transaction_id],
			foreignColumns: [transactions.id],
			name: "support_tickets_transaction_id_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "support_tickets_user_id_fkey"
		}),
	unique("support_tickets_ticket_number_key").on(table.ticket_number),
	check("support_tickets_category_check", sql`category = ANY (ARRAY['payment'::text, 'kyc'::text, 'game'::text, 'account'::text, 'other'::text])`),
	check("support_tickets_status_check", sql`status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])`),
]);

export const support_ticket_messages = pgTable("support_ticket_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticket_id: uuid().notNull(),
	sender_type: text().notNull(),
	sender_id: uuid().notNull(),
	content: text().notNull(),
	attachments: jsonb(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_support_ticket_messages_created_at").using("btree", table.created_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_support_ticket_messages_sender_id").using("btree", table.sender_id.asc().nullsLast().op("uuid_ops")),
	index("idx_support_ticket_messages_sender_type").using("btree", table.sender_type.asc().nullsLast().op("text_ops")),
	index("idx_support_ticket_messages_ticket_id").using("btree", table.ticket_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ticket_id],
			foreignColumns: [support_tickets.id],
			name: "support_ticket_messages_ticket_id_fkey"
		}).onDelete("cascade"),
	check("support_ticket_messages_sender_type_check", sql`sender_type = ANY (ARRAY['user'::text, 'admin'::text])`),
]);

export const app_config = pgTable("app_config", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	value_type: text().default('string').notNull(),
	updated_by: uuid(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updated_by],
			foreignColumns: [admin_users.id],
			name: "app_config_updated_by_fkey"
		}),
	check("app_config_value_type_check", sql`value_type = ANY (ARRAY['string'::text, 'number'::text, 'boolean'::text, 'json'::text])`),
]);

export const help_articles = pgTable("help_articles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	content: text().notNull(),
	category: text().notNull(),
	language: text().default('en').notNull(),
	is_published: boolean().default(false).notNull(),
	created_by: uuid().notNull(),
	updated_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_help_articles_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_help_articles_is_published").using("btree", table.is_published.asc().nullsLast().op("bool_ops")),
	index("idx_help_articles_language").using("btree", table.language.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.created_by],
			foreignColumns: [admin_users.id],
			name: "help_articles_created_by_fkey"
		}),
	foreignKey({
			columns: [table.updated_by],
			foreignColumns: [admin_users.id],
			name: "help_articles_updated_by_fkey"
		}),
	check("help_articles_category_check", sql`category = ANY (ARRAY['payments'::text, 'kyc'::text, 'games'::text, 'account'::text, 'general'::text])`),
	check("help_articles_language_check", sql`language = ANY (ARRAY['en'::text, 'ar'::text, 'fa'::text, 'tr'::text])`),
]);

export const tos_acceptances = pgTable("tos_acceptances", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	tos_version: text().notNull(),
	accepted_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_tos_acceptances_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [profiles.id],
			name: "tos_acceptances_user_id_fkey"
		}).onDelete("cascade"),
	unique("tos_acceptances_user_id_tos_version_key").on(table.user_id, table.tos_version),
]);

export const game_questions = pgTable("game_questions", {
	game_id: uuid().notNull(),
	question_id: uuid().notNull(),
	order: integer().notNull(),
}, (table) => [
	index("idx_game_questions_game_id").using("btree", table.game_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.game_id],
			foreignColumns: [games.id],
			name: "game_questions_game_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.question_id],
			foreignColumns: [questions.id],
			name: "game_questions_question_id_fkey"
		}),
	primaryKey({ columns: [table.game_id, table.question_id], name: "game_questions_pkey"}),
]);

export const tos_versions = pgTable("tos_versions", {
	version: text().notNull(),
	type: text().notNull(),
	content_en: text().notNull(),
	content_ar: text(),
	content_fa: text(),
	content_tr: text(),
	effective_date: date().notNull(),
	require_re_acceptance: boolean().default(false).notNull(),
	published_by: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.published_by],
			foreignColumns: [admin_users.id],
			name: "tos_versions_published_by_fkey"
		}),
	primaryKey({ columns: [table.version, table.type], name: "tos_versions_pkey"}),
	check("tos_versions_type_check", sql`type = ANY (ARRAY['tos'::text, 'privacy'::text])`),
]);
