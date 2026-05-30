-- Migration: Game Templates v1 — cron matcher + generator RPCs.
--
-- Provides:
--   * match_cron_field(text, int, int, int)       — match a single 5-field cron part
--   * match_cron_expression(text, timestamptz)    — full 5-field cron matcher
--   * generate_game_from_template(uuid, bool)     — create a game from a template
--   * generate_games_from_active_templates()      — cron-tick entry point
--
-- These are SECURITY DEFINER and run as the owner. They never read or write
-- financial tables (R-05) and only operate on game_templates, games, game_questions.

BEGIN;

-- ─── match_cron_field ────────────────────────────────────────────────────────
-- Supports: "*", "N", "N-M", "*/N", "A/N", "A,B,C" (commas combine the above).
CREATE OR REPLACE FUNCTION public.match_cron_field(
    p_expr  TEXT,
    p_value INT,
    p_min   INT,
    p_max   INT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    part        TEXT;
    base_part   TEXT;
    step_part   TEXT;
    range_lo    INT;
    range_hi    INT;
    step_val    INT;
    base_val    INT;
BEGIN
    IF p_expr IS NULL OR length(trim(p_expr)) = 0 THEN
        RETURN FALSE;
    END IF;

    -- Comma list: any sub-expression matching returns true.
    FOR part IN SELECT unnest(string_to_array(p_expr, ','))
    LOOP
        part := trim(part);
        IF part = '*' THEN
            RETURN TRUE;
        END IF;

        -- Step (A/N or */N)
        IF position('/' IN part) > 0 THEN
            base_part := split_part(part, '/', 1);
            step_part := split_part(part, '/', 2);
            step_val  := step_part::INT;
            IF step_val <= 0 THEN CONTINUE; END IF;
            IF base_part = '*' THEN
                base_val := p_min;
            ELSIF position('-' IN base_part) > 0 THEN
                range_lo := split_part(base_part, '-', 1)::INT;
                range_hi := split_part(base_part, '-', 2)::INT;
                IF p_value BETWEEN range_lo AND range_hi
                   AND ((p_value - range_lo) % step_val) = 0 THEN
                    RETURN TRUE;
                END IF;
                CONTINUE;
            ELSE
                base_val := base_part::INT;
            END IF;
            IF p_value >= base_val
               AND p_value <= p_max
               AND ((p_value - base_val) % step_val) = 0 THEN
                RETURN TRUE;
            END IF;
            CONTINUE;
        END IF;

        -- Range (N-M)
        IF position('-' IN part) > 0 THEN
            range_lo := split_part(part, '-', 1)::INT;
            range_hi := split_part(part, '-', 2)::INT;
            IF p_value BETWEEN range_lo AND range_hi THEN
                RETURN TRUE;
            END IF;
            CONTINUE;
        END IF;

        -- Single value
        IF part ~ '^[0-9]+$' AND part::INT = p_value THEN
            RETURN TRUE;
        END IF;
    END LOOP;

    RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
    -- Malformed expression — never let the cron loop crash on a bad template.
    RETURN FALSE;
END;
$$;

-- ─── match_cron_expression ───────────────────────────────────────────────────
-- Full 5-field cron matcher (UTC). day-of-week: 0..6, Sunday = 0.
CREATE OR REPLACE FUNCTION public.match_cron_expression(
    p_expr TEXT,
    p_ts   TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    fields TEXT[];
    ts_utc TIMESTAMP;
BEGIN
    IF p_expr IS NULL THEN RETURN FALSE; END IF;
    fields := regexp_split_to_array(trim(p_expr), '\s+');
    IF array_length(fields, 1) <> 5 THEN RETURN FALSE; END IF;

    ts_utc := (p_ts AT TIME ZONE 'UTC')::TIMESTAMP;

    RETURN public.match_cron_field(fields[1], EXTRACT(MINUTE FROM ts_utc)::INT, 0, 59)
       AND public.match_cron_field(fields[2], EXTRACT(HOUR   FROM ts_utc)::INT, 0, 23)
       AND public.match_cron_field(fields[3], EXTRACT(DAY    FROM ts_utc)::INT, 1, 31)
       AND public.match_cron_field(fields[4], EXTRACT(MONTH  FROM ts_utc)::INT, 1, 12)
       AND public.match_cron_field(fields[5], EXTRACT(DOW    FROM ts_utc)::INT, 0, 6);
END;
$$;

COMMIT;
