-- =============================================================================
-- Quiz4Win — Public Leaderboard RPC
-- 2026-05-28 — A-01
--
-- Adds `public.get_public_leaderboard(p_from, p_to, p_limit, p_language)` —
-- SECURITY DEFINER function that aggregates per-player results across
-- completed games in a time window and returns ranked rows plus totals as a
-- single JSONB payload.
--
-- The function is granted to `anon` so the unauthenticated public-leaderboard
-- Edge Function can call it via the anon client (R-04: no service-role bypass
-- in app code — the function itself defines exactly what is exposed).
--
-- R-01: no email/wallet/KYC/PII exposed. Player names are rendered as
--       "<first> <last-initial>." (e.g. "Aram K.") inside the function.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_leaderboard(
    p_from     TIMESTAMPTZ,
    p_to       TIMESTAMPTZ,
    p_limit    INT,
    p_language TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_limit              INT := GREATEST(1, LEAST(100, COALESCE(p_limit, 20)));
    v_to                 TIMESTAMPTZ := COALESCE(p_to, NOW());
    v_players_json       JSONB;
    v_credits_total      NUMERIC := 0;
    v_players_count      INT := 0;
BEGIN
    -- Window participation rows joined to their parent game.
    WITH window_rows AS (
        SELECT
            gp.user_id,
            gp.prize_earned,
            gp.eliminated,
            gp.status,
            g.title    AS game_title,
            g.language AS game_language
        FROM public.game_participants gp
        JOIN public.games g ON g.id = gp.game_id
        WHERE gp.role = 'player'
          AND gp.completed_at IS NOT NULL
          AND gp.completed_at <= v_to
          AND (p_from IS NULL OR gp.completed_at >= p_from)
          AND (p_language IS NULL OR g.language = p_language)
          AND g.status = 'completed'
    ),
    -- Per-player aggregates.
    agg AS (
        SELECT
            user_id,
            COUNT(*) FILTER (
                WHERE eliminated = FALSE AND status = 'completed'
            )                                  AS games_won,
            COUNT(*)                            AS games_played,
            COALESCE(SUM(prize_earned), 0)      AS total_credits
        FROM window_rows
        GROUP BY user_id
    ),
    -- Most-frequently played show title per player.
    fav AS (
        SELECT user_id, game_title,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id
                   ORDER BY COUNT(*) DESC, game_title ASC
               ) AS rn
        FROM window_rows
        GROUP BY user_id, game_title
    ),
    -- Ranked, capped result set.
    ranked AS (
        SELECT
            a.user_id,
            a.games_won,
            a.games_played,
            a.total_credits,
            f.game_title AS favourite_show,
            ROW_NUMBER() OVER (
                ORDER BY a.games_won DESC, a.total_credits DESC, a.user_id::text ASC
            ) AS rnk
        FROM agg a
        LEFT JOIN fav f ON f.user_id = a.user_id AND f.rn = 1
        WHERE a.games_played > 0
        ORDER BY a.games_won DESC, a.total_credits DESC, a.user_id::text ASC
        LIMIT v_limit
    )
    SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
            'rank',           r.rnk,
            'player_name',    CASE
                WHEN p.full_name IS NULL OR length(trim(p.full_name)) = 0 THEN 'Player'
                WHEN position(' ' in trim(p.full_name)) = 0 THEN initcap(trim(p.full_name))
                ELSE initcap(split_part(trim(p.full_name), ' ', 1))
                     || ' '
                     || upper(left(
                            split_part(
                                trim(p.full_name),
                                ' ',
                                array_length(string_to_array(trim(p.full_name), ' '), 1)
                            ), 1))
                     || '.'
            END,
            'avatar_url',     p.avatar_url,
            'games_won',      r.games_won,
            'games_played',   r.games_played,
            'total_credits',  ROUND(r.total_credits)::BIGINT,
            'favourite_show', r.favourite_show
        ) ORDER BY r.rnk), '[]'::jsonb),
        COUNT(*)
    INTO v_players_json, v_players_count
    FROM ranked r
    JOIN public.profiles p ON p.id = r.user_id;

    -- Window-wide credits distributed (NOT capped by p_limit).
    SELECT COALESCE(ROUND(SUM(gp.prize_earned))::BIGINT, 0)
      INTO v_credits_total
      FROM public.game_participants gp
      JOIN public.games g ON g.id = gp.game_id
     WHERE gp.role = 'player'
       AND gp.completed_at IS NOT NULL
       AND gp.completed_at <= v_to
       AND (p_from IS NULL OR gp.completed_at >= p_from)
       AND (p_language IS NULL OR g.language = p_language)
       AND g.status = 'completed';

    RETURN jsonb_build_object(
        'players', v_players_json,
        'totals',  jsonb_build_object(
            'players_listed',                v_players_count,
            'credits_distributed_in_window', v_credits_total
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT) TO anon, authenticated;

COMMIT;
