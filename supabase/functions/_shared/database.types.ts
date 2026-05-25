// =============================================================================
// Quiz4Win Backend — Database Type Definitions
// Generated:  2026-05-22
// Author:     A-01 (Augment Code Agent)
// Source:     Google Sheet "Data Schema" + migrations/20260522120000_initial_schema.sql
// =============================================================================
// NOTE: Monetary fields are typed as `number` to match the underlying
//   NUMERIC(10,2) / (12,2) columns in the database. This conflicts with Rule
//   R-02 (integer cents). The conflict is logged in Change_Log_AI.md and is
//   pending human resolution. Until then, callers MUST treat money values as
//   dollar amounts (e.g. 5.00), not cents (e.g. 500).
// =============================================================================

// ---------- Enum-like string unions ------------------------------------------

export type KycStatus           = 'pending' | 'verified' | 'rejected';
export type Language            = 'en' | 'ar' | 'fa' | 'tr';
export type ProfileStatus       = 'active' | 'suspended' | 'banned';
export type AdminRole           = 'super_admin' | 'admin' | 'moderator' | 'finance' | 'support';
export type AdminStatus         = 'active' | 'disabled';
export type GameMode            = 'timed' | 'battle' | 'daily' | 'tournament' | 'live';
export type GameDifficulty      = 'Easy' | 'Medium' | 'Hard';
export type GameStatus          = 'upcoming' | 'open' | 'live' | 'completed' | 'cancelled';
export type ParticipantRole     = 'player' | 'viewer' | 'host';
export type ParticipantStatus   = 'active' | 'completed' | 'disqualified';
export type TransactionType     =
  | 'topup' | 'withdrawal' | 'game_entry_fee' | 'prize'
  | 'referral_bonus' | 'refund' | 'admin_adjustment';
export type TransactionStatus   = 'pending' | 'completed' | 'failed';
export type WithdrawalMethod    = 'bank_transfer' | 'crypto' | 'paypal';
export type WithdrawalStatus    = 'pending' | 'processing' | 'completed' | 'rejected';
export type KycDocType          = 'national_id' | 'passport' | 'drivers_license';
export type AmlStatus           = 'open' | 'cleared' | 'escalated';
export type ReferralCodeType    = 'user' | 'promo' | 'campaign';
export type VoucherType         = 'platform' | 'affiliate';
export type VoucherRewardType   =
  | 'topup_bonus_pct' | 'topup_bonus_fixed' | 'free_entry'
  | 'wallet_credit'   | 'affiliate_redirect';
export type VoucherUsageType    =
  | 'single_use_single_user' | 'multi_user_single_use'
  | 'multi_user_multi_use'   | 'unlimited';
export type VoucherStatus       = 'active' | 'paused' | 'exhausted' | 'expired' | 'cancelled';
export type VoucherExpiryReason = 'time_expired' | 'max_reached' | 'admin_cancelled';
export type VoucherAttemptResult =
  | 'success' | 'not_found' | 'expired' | 'exhausted' | 'already_redeemed'
  | 'per_user_limit_reached' | 'not_eligible' | 'rate_limited'
  | 'invalid_user' | 'kyc_required' | 'country_restricted';
export type NotificationType    =
  | 'prize' | 'game_invite' | 'show_reminder' | 'kyc_update'
  | 'withdrawal' | 'system' | 'promotion';
export type BroadcastType       = 'system' | 'promotion';
export type SupportCategory     = 'payment' | 'kyc' | 'game' | 'account' | 'other';
export type SupportStatus       = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportSenderType   = 'user' | 'admin';
export type Theme               = 'dark' | 'light' | 'system';
export type Platform            = 'ios' | 'android';
export type HostStatus          = 'active' | 'inactive';
export type AppConfigValueType  = 'string' | 'number' | 'boolean' | 'json';
export type HelpCategory        = 'payments' | 'kyc' | 'games' | 'account' | 'general';
export type TosDocType          = 'tos' | 'privacy';

// ---------- Identity ---------------------------------------------------------

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  wallet_balance: number;
  kyc_status: KycStatus;
  language: Language;
  referral_code: string | null;
  status: ProfileStatus;
  suspension_reason: string | null;
  email_verified: boolean;
  total_deposited: number;
  total_withdrawn: number;
  total_games_played: number;
  total_prizes_won: number;
  country: string | null;
  aml_flagged: boolean;
  fraud_suspected: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  theme: Theme;
  sound_enabled: boolean;
  haptics_enabled: boolean;
  updated_at: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: Platform;
  device_id: string;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  game_reminders: boolean;
  promotions: boolean;
  kyc_updates: boolean;
  system: boolean;
  updated_at: string;
}

export interface UserSecurity {
  user_id: string;
  email_2fa_enabled: boolean;
  totp_enabled: boolean;
  totp_secret: string | null;
  email_code_hash: string | null;
  email_code_expires_at: string | null;
  email_code_attempts: number;
  created_at: string;
  updated_at: string;
}

// ---------- Admin ------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: AdminStatus;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAuditLog {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ---------- Games & Content --------------------------------------------------

export interface Question {
  id: string;
  text: string;
  choices: string[];
  correct_index: number;
  category: string;
  difficulty: GameDifficulty;
  language: Language;
  explanation: string | null;
  source: string | null;
  active: boolean;
  times_used: number;
  times_correct: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShowHost {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  livekit_identity: string;
  rating_avg: number;
  rating_count: number;
  total_shows: number;
  status: HostStatus;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  mode: GameMode;
  title: string;
  description: string | null;
  difficulty: GameDifficulty;
  category: string | null;
  language: Language;
  entry_fee: number;
  max_players: number;
  player_count: number;
  prize_pool: number;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: GameStatus;
  questions_count: number;
  time_per_question_sec: number;
  livekit_room_name: string | null;
  show_host_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameQuestion {
  id: string;
  game_id: string;
  question_id: string;
  order_index: number;
  round_number: number | null;
}

export interface GameParticipant {
  id: string;
  game_id: string;
  user_id: string;
  role: ParticipantRole;
  livekit_identity: string | null;
  score: number;
  rank: number | null;
  correct_answers: number;
  wrong_answers: number;
  entry_fee_paid: number;
  prize_earned: number;
  lives_remaining: number | null;
  eliminated: boolean;
  status: ParticipantStatus;
  joined_at: string;
  completed_at: string | null;
}

export interface GameAnswer {
  id: string;
  game_id: string;
  participant_id: string;
  question_id: string;
  round_number: number | null;
  answer_index: number | null;
  is_correct: boolean;
  response_time_ms: number | null;
  points_earned: number;
  submitted_at: string;
}

export interface ShowHostRating {
  id: string;
  host_id: string;
  game_id: string | null;
  user_id: string;
  rating: number;
  created_at: string;
}


// ---------- Finance ----------------------------------------------------------

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  reference: string | null;
  description: string | null;
  game_id: string | null;
  admin_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  method: WithdrawalMethod;
  account_details: Record<string, unknown>;
  status: WithdrawalStatus;
  rejection_reason: string | null;
  transaction_id: string | null;
  transaction_reference: string | null;
  aml_flagged: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  internal_note: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface KycRequest {
  id: string;
  user_id: string;
  doc_type: KycDocType;
  front_image_url: string;
  back_image_url: string | null;
  selfie_url: string;
  status: KycStatus;
  rejection_reason: string | null;
  attempt_number: number;
  reviewed_by: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface AmlFlag {
  id: string;
  user_id: string;
  withdrawal_id: string | null;
  total_24h_usd: number;
  status: AmlStatus;
  reviewed_by: string | null;
  review_note: string | null;
  flagged_at: string;
  reviewed_at: string | null;
}

// ---------- Referrals -------------------------------------------------------

export interface ReferralCode {
  code: string;
  owner_id: string;
  type: ReferralCodeType;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  bonus_amount: number;
  campaign_name: string | null;
  created_at: string;
}

export interface ReferralUse {
  id: string;
  code: string;
  referred_user_id: string;
  referrer_user_id: string;
  bonus_paid: boolean;
  bonus_paid_at: string | null;
  used_at: string;
}

// ---------- Vouchers --------------------------------------------------------

export interface Voucher {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: VoucherType;
  reward_type: VoucherRewardType | null;
  reward_value: number | null;
  reward_description: string;
  display_text: string;
  usage_type: VoucherUsageType;
  user_id_restriction: string | null;
  per_user_limit: number | null;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: string | null;
  valid_until: string | null;
  min_wallet_balance_usd: number | null;
  kyc_required: boolean;
  eligible_countries: string[] | null;
  partner_name: string | null;
  partner_logo_url: string | null;
  partner_url: string | null;
  show_duration_sec: number;
  is_case_sensitive: boolean;
  rate_limit_per_ip: number | null;
  rate_limit_per_user: number | null;
  status: VoucherStatus;
  cancellation_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherAnnouncement {
  id: string;
  voucher_id: string;
  game_id: string;
  announced_by: string;
  announced_at: string;
  round_number: number | null;
  expired_at: string | null;
  expiry_reason: VoucherExpiryReason | null;
  redemptions_during_show: number;
}

export interface VoucherRedemption {
  id: string;
  voucher_id: string;
  user_id: string;
  game_id: string | null;
  announcement_id: string | null;
  attempt_ip: string | null;
  user_agent: string | null;
  reward_applied: boolean;
  reward_value_applied_usd: number | null;
  transaction_id: string | null;
  redeemed_at: string;
}

export interface VoucherAttemptLog {
  id: string;
  code_attempted: string;
  user_id: string | null;
  ip_address: string;
  result: VoucherAttemptResult;
  attempted_at: string;
}


// ---------- Communications --------------------------------------------------

export interface NotificationBroadcast {
  id: string;
  title: string;
  body: string;
  type: BroadcastType;
  segment: Record<string, unknown>;
  data: Record<string, unknown> | null;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number;
  delivered_count: number;
  failed_count: number;
  sent_by: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  data: Record<string, unknown> | null;
  sent_via_push: boolean;
  broadcast_id: string | null;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  ticket_number: string;
  category: SupportCategory;
  subject: string;
  description: string;
  transaction_id: string | null;
  assigned_to: string | null;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender_type: SupportSenderType;
  sender_id: string;
  content: string;
  attachments: Record<string, unknown> | null;
  created_at: string;
}

// ---------- Content & Config -------------------------------------------------

export interface AppConfig {
  key: string;
  value: string;
  value_type: AppConfigValueType;
  updated_by: string | null;
  updated_at: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  content: string;
  category: HelpCategory;
  language: Language;
  is_published: boolean;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TosVersion {
  version: string;
  type: TosDocType;
  content_en: string;
  content_ar: string | null;
  content_fa: string | null;
  content_tr: string | null;
  effective_date: string;
  require_re_acceptance: boolean;
  published_by: string;
  created_at: string;
}

export interface TosAcceptance {
  id: string;
  user_id: string;
  tos_version: string;
  accepted_at: string;
}

// =============================================================================
// Aggregate `Database` type (Supabase-style) ----------------------------------
// =============================================================================

export interface Database {
  public: {
    Tables: {
      profiles:                 { Row: Profile };
      user_settings:            { Row: UserSettings };
      push_tokens:              { Row: PushToken };
      notification_preferences: { Row: NotificationPreferences };
      user_security:            { Row: UserSecurity };
      admin_users:              { Row: AdminUser };
      admin_audit_log:          { Row: AdminAuditLog };
      questions:                { Row: Question };
      show_hosts:               { Row: ShowHost };
      games:                    { Row: Game };
      game_questions:           { Row: GameQuestion };
      game_participants:        { Row: GameParticipant };
      game_answers:             { Row: GameAnswer };
      show_host_ratings:        { Row: ShowHostRating };
      transactions:             { Row: Transaction };
      withdrawals:              { Row: Withdrawal };
      kyc_requests:             { Row: KycRequest };
      aml_flags:                { Row: AmlFlag };
      referral_codes:           { Row: ReferralCode };
      referral_uses:            { Row: ReferralUse };
      vouchers:                 { Row: Voucher };
      voucher_announcements:    { Row: VoucherAnnouncement };
      voucher_redemptions:      { Row: VoucherRedemption };
      voucher_attempt_log:      { Row: VoucherAttemptLog };
      notification_broadcasts:  { Row: NotificationBroadcast };
      notifications:            { Row: Notification };
      support_tickets:          { Row: SupportTicket };
      support_ticket_messages:  { Row: SupportTicketMessage };
      app_config:               { Row: AppConfig };
      help_articles:            { Row: HelpArticle };
      tos_versions:             { Row: TosVersion };
      tos_acceptances:          { Row: TosAcceptance };
    };
  };
}
