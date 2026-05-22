import { relations } from "drizzle-orm/relations";
import { referral_codes, profiles, user_settings, push_tokens, notification_preferences, admin_users, admin_audit_log, show_hosts, games, game_participants, game_answers, questions, show_host_ratings, transactions, withdrawals, kyc_requests, aml_flags, referral_uses, vouchers, voucher_announcements, voucher_redemptions, voucher_attempt_log, notification_broadcasts, notifications, support_tickets, support_ticket_messages, app_config, help_articles, tos_acceptances, game_questions, tos_versions } from "./schema";

export const profilesRelations = relations(profiles, ({one, many}) => ({
	referral_code: one(referral_codes, {
		fields: [profiles.referral_code],
		references: [referral_codes.code],
		relationName: "profiles_referral_code_referral_codes_code"
	}),
	user_settings: many(user_settings),
	push_tokens: many(push_tokens),
	notification_preferences: many(notification_preferences),
	game_participants: many(game_participants),
	show_host_ratings: many(show_host_ratings),
	transactions: many(transactions),
	withdrawals: many(withdrawals),
	kyc_requests: many(kyc_requests),
	aml_flags: many(aml_flags),
	referral_codes: many(referral_codes, {
		relationName: "referral_codes_owner_id_profiles_id"
	}),
	referral_uses_referred_user_id: many(referral_uses, {
		relationName: "referral_uses_referred_user_id_profiles_id"
	}),
	referral_uses_referrer_user_id: many(referral_uses, {
		relationName: "referral_uses_referrer_user_id_profiles_id"
	}),
	vouchers: many(vouchers),
	voucher_redemptions: many(voucher_redemptions),
	voucher_attempt_logs: many(voucher_attempt_log),
	notifications: many(notifications),
	support_tickets: many(support_tickets),
	tos_acceptances: many(tos_acceptances),
}));

export const referral_codesRelations = relations(referral_codes, ({one, many}) => ({
	profiles: many(profiles, {
		relationName: "profiles_referral_code_referral_codes_code"
	}),
	profile: one(profiles, {
		fields: [referral_codes.owner_id],
		references: [profiles.id],
		relationName: "referral_codes_owner_id_profiles_id"
	}),
	referral_uses: many(referral_uses),
}));

export const user_settingsRelations = relations(user_settings, ({one}) => ({
	profile: one(profiles, {
		fields: [user_settings.user_id],
		references: [profiles.id]
	}),
}));

export const push_tokensRelations = relations(push_tokens, ({one}) => ({
	profile: one(profiles, {
		fields: [push_tokens.user_id],
		references: [profiles.id]
	}),
}));

export const notification_preferencesRelations = relations(notification_preferences, ({one}) => ({
	profile: one(profiles, {
		fields: [notification_preferences.user_id],
		references: [profiles.id]
	}),
}));

export const admin_usersRelations = relations(admin_users, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [admin_users.invited_by],
		references: [admin_users.id],
		relationName: "admin_users_invited_by_admin_users_id"
	}),
	admin_users: many(admin_users, {
		relationName: "admin_users_invited_by_admin_users_id"
	}),
	admin_audit_logs: many(admin_audit_log),
	transactions: many(transactions),
	withdrawals: many(withdrawals),
	kyc_requests: many(kyc_requests),
	aml_flags: many(aml_flags),
	vouchers_created_by: many(vouchers, {
		relationName: "vouchers_created_by_admin_users_id"
	}),
	vouchers_updated_by: many(vouchers, {
		relationName: "vouchers_updated_by_admin_users_id"
	}),
	voucher_announcements: many(voucher_announcements),
	notification_broadcasts: many(notification_broadcasts),
	support_tickets: many(support_tickets),
	app_configs: many(app_config),
	help_articles_created_by: many(help_articles, {
		relationName: "help_articles_created_by_admin_users_id"
	}),
	help_articles_updated_by: many(help_articles, {
		relationName: "help_articles_updated_by_admin_users_id"
	}),
	tos_versions: many(tos_versions),
}));

export const admin_audit_logRelations = relations(admin_audit_log, ({one}) => ({
	admin_user: one(admin_users, {
		fields: [admin_audit_log.admin_id],
		references: [admin_users.id]
	}),
}));

export const gamesRelations = relations(games, ({one, many}) => ({
	show_host: one(show_hosts, {
		fields: [games.host_id],
		references: [show_hosts.id]
	}),
	game_participants: many(game_participants),
	game_answers: many(game_answers),
	show_host_ratings: many(show_host_ratings),
	transactions: many(transactions),
	voucher_announcements: many(voucher_announcements),
	voucher_redemptions: many(voucher_redemptions),
	game_questions: many(game_questions),
}));

export const show_hostsRelations = relations(show_hosts, ({many}) => ({
	games: many(games),
	show_host_ratings: many(show_host_ratings),
}));

export const game_participantsRelations = relations(game_participants, ({one, many}) => ({
	game: one(games, {
		fields: [game_participants.game_id],
		references: [games.id]
	}),
	profile: one(profiles, {
		fields: [game_participants.user_id],
		references: [profiles.id]
	}),
	game_answers: many(game_answers),
}));

export const game_answersRelations = relations(game_answers, ({one}) => ({
	game: one(games, {
		fields: [game_answers.game_id],
		references: [games.id]
	}),
	game_participant: one(game_participants, {
		fields: [game_answers.participant_id],
		references: [game_participants.id]
	}),
	question: one(questions, {
		fields: [game_answers.question_id],
		references: [questions.id]
	}),
}));

export const questionsRelations = relations(questions, ({many}) => ({
	game_answers: many(game_answers),
	game_questions: many(game_questions),
}));

export const show_host_ratingsRelations = relations(show_host_ratings, ({one}) => ({
	game: one(games, {
		fields: [show_host_ratings.game_id],
		references: [games.id]
	}),
	show_host: one(show_hosts, {
		fields: [show_host_ratings.host_id],
		references: [show_hosts.id]
	}),
	profile: one(profiles, {
		fields: [show_host_ratings.user_id],
		references: [profiles.id]
	}),
}));

export const transactionsRelations = relations(transactions, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [transactions.admin_id],
		references: [admin_users.id]
	}),
	game: one(games, {
		fields: [transactions.game_id],
		references: [games.id]
	}),
	profile: one(profiles, {
		fields: [transactions.user_id],
		references: [profiles.id]
	}),
	withdrawals: many(withdrawals),
	voucher_redemptions: many(voucher_redemptions),
	support_tickets: many(support_tickets),
}));

export const withdrawalsRelations = relations(withdrawals, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [withdrawals.reviewed_by],
		references: [admin_users.id]
	}),
	transaction: one(transactions, {
		fields: [withdrawals.transaction_id],
		references: [transactions.id]
	}),
	profile: one(profiles, {
		fields: [withdrawals.user_id],
		references: [profiles.id]
	}),
	aml_flags: many(aml_flags),
}));

export const kyc_requestsRelations = relations(kyc_requests, ({one}) => ({
	admin_user: one(admin_users, {
		fields: [kyc_requests.reviewed_by],
		references: [admin_users.id]
	}),
	profile: one(profiles, {
		fields: [kyc_requests.user_id],
		references: [profiles.id]
	}),
}));

export const aml_flagsRelations = relations(aml_flags, ({one}) => ({
	admin_user: one(admin_users, {
		fields: [aml_flags.reviewed_by],
		references: [admin_users.id]
	}),
	profile: one(profiles, {
		fields: [aml_flags.user_id],
		references: [profiles.id]
	}),
	withdrawal: one(withdrawals, {
		fields: [aml_flags.withdrawal_id],
		references: [withdrawals.id]
	}),
}));

export const referral_usesRelations = relations(referral_uses, ({one}) => ({
	referral_code: one(referral_codes, {
		fields: [referral_uses.code],
		references: [referral_codes.code]
	}),
	profile_referred_user_id: one(profiles, {
		fields: [referral_uses.referred_user_id],
		references: [profiles.id],
		relationName: "referral_uses_referred_user_id_profiles_id"
	}),
	profile_referrer_user_id: one(profiles, {
		fields: [referral_uses.referrer_user_id],
		references: [profiles.id],
		relationName: "referral_uses_referrer_user_id_profiles_id"
	}),
}));

export const vouchersRelations = relations(vouchers, ({one, many}) => ({
	admin_user_created_by: one(admin_users, {
		fields: [vouchers.created_by],
		references: [admin_users.id],
		relationName: "vouchers_created_by_admin_users_id"
	}),
	admin_user_updated_by: one(admin_users, {
		fields: [vouchers.updated_by],
		references: [admin_users.id],
		relationName: "vouchers_updated_by_admin_users_id"
	}),
	profile: one(profiles, {
		fields: [vouchers.user_id_restriction],
		references: [profiles.id]
	}),
	voucher_announcements: many(voucher_announcements),
	voucher_redemptions: many(voucher_redemptions),
}));

export const voucher_announcementsRelations = relations(voucher_announcements, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [voucher_announcements.announced_by],
		references: [admin_users.id]
	}),
	game: one(games, {
		fields: [voucher_announcements.game_id],
		references: [games.id]
	}),
	voucher: one(vouchers, {
		fields: [voucher_announcements.voucher_id],
		references: [vouchers.id]
	}),
	voucher_redemptions: many(voucher_redemptions),
}));

export const voucher_redemptionsRelations = relations(voucher_redemptions, ({one}) => ({
	voucher_announcement: one(voucher_announcements, {
		fields: [voucher_redemptions.announcement_id],
		references: [voucher_announcements.id]
	}),
	game: one(games, {
		fields: [voucher_redemptions.game_id],
		references: [games.id]
	}),
	transaction: one(transactions, {
		fields: [voucher_redemptions.transaction_id],
		references: [transactions.id]
	}),
	profile: one(profiles, {
		fields: [voucher_redemptions.user_id],
		references: [profiles.id]
	}),
	voucher: one(vouchers, {
		fields: [voucher_redemptions.voucher_id],
		references: [vouchers.id]
	}),
}));

export const voucher_attempt_logRelations = relations(voucher_attempt_log, ({one}) => ({
	profile: one(profiles, {
		fields: [voucher_attempt_log.user_id],
		references: [profiles.id]
	}),
}));

export const notification_broadcastsRelations = relations(notification_broadcasts, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [notification_broadcasts.sent_by],
		references: [admin_users.id]
	}),
	notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	notification_broadcast: one(notification_broadcasts, {
		fields: [notifications.broadcast_id],
		references: [notification_broadcasts.id]
	}),
	profile: one(profiles, {
		fields: [notifications.user_id],
		references: [profiles.id]
	}),
}));

export const support_ticketsRelations = relations(support_tickets, ({one, many}) => ({
	admin_user: one(admin_users, {
		fields: [support_tickets.assigned_to],
		references: [admin_users.id]
	}),
	transaction: one(transactions, {
		fields: [support_tickets.transaction_id],
		references: [transactions.id]
	}),
	profile: one(profiles, {
		fields: [support_tickets.user_id],
		references: [profiles.id]
	}),
	support_ticket_messages: many(support_ticket_messages),
}));

export const support_ticket_messagesRelations = relations(support_ticket_messages, ({one}) => ({
	support_ticket: one(support_tickets, {
		fields: [support_ticket_messages.ticket_id],
		references: [support_tickets.id]
	}),
}));

export const app_configRelations = relations(app_config, ({one}) => ({
	admin_user: one(admin_users, {
		fields: [app_config.updated_by],
		references: [admin_users.id]
	}),
}));

export const help_articlesRelations = relations(help_articles, ({one}) => ({
	admin_user_created_by: one(admin_users, {
		fields: [help_articles.created_by],
		references: [admin_users.id],
		relationName: "help_articles_created_by_admin_users_id"
	}),
	admin_user_updated_by: one(admin_users, {
		fields: [help_articles.updated_by],
		references: [admin_users.id],
		relationName: "help_articles_updated_by_admin_users_id"
	}),
}));

export const tos_acceptancesRelations = relations(tos_acceptances, ({one}) => ({
	profile: one(profiles, {
		fields: [tos_acceptances.user_id],
		references: [profiles.id]
	}),
}));

export const game_questionsRelations = relations(game_questions, ({one}) => ({
	game: one(games, {
		fields: [game_questions.game_id],
		references: [games.id]
	}),
	question: one(questions, {
		fields: [game_questions.question_id],
		references: [questions.id]
	}),
}));

export const tos_versionsRelations = relations(tos_versions, ({one}) => ({
	admin_user: one(admin_users, {
		fields: [tos_versions.published_by],
		references: [admin_users.id]
	}),
}));