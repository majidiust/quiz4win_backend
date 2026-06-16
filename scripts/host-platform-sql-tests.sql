-- =============================================================================
-- Quiz4Win — Host Platform SQL fixture tests
-- File: scripts/host-platform-sql-tests.sql
-- =============================================================================
-- Run from the host:
--   docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/host-platform-sql-tests.sql
--
-- (or mount the file via `docker compose cp` first; this repo does not run psql
--  directly on the production DB per R-12, so use the local Compose stack.)
--
-- Each test is wrapped in BEGIN/ROLLBACK so the production schema is never
-- mutated.  Failures cause psql to exit non-zero thanks to ASSERT + ON_ERROR_STOP.
-- =============================================================================

\set ON_ERROR_STOP on

-- ─── Test 1: check_host_schedule_conflict — overlap returns TRUE ────────────
BEGIN;
DO $$
DECLARE
    v_host UUID := gen_random_uuid();
    v_game_a UUID := gen_random_uuid();
    v_game_b UUID := gen_random_uuid();
    v_conflict BOOLEAN;
BEGIN
    INSERT INTO public.show_hosts (id, name, application_status, status, auth_user_id)
    VALUES (v_host, 'sql-test-host-' || v_host::text, 'approved', 'active', NULL);

    -- Two games 30 minutes apart for the same host — within the 90-min window.
    INSERT INTO public.games (id, title, mode, status, host_id, scheduled_at, created_at, updated_at)
    VALUES (v_game_a, 'Test Game A', 'live', 'upcoming', v_host, NOW() + INTERVAL '1 hour', NOW(), NOW()),
           (v_game_b, 'Test Game B', 'live', 'upcoming', NULL,   NOW() + INTERVAL '1 hour 30 minutes', NOW(), NOW());

    SELECT public.check_host_schedule_conflict(v_host, v_game_b) INTO v_conflict;
    ASSERT v_conflict = TRUE, format('overlap case: expected TRUE, got %L', v_conflict);
    RAISE NOTICE '✓ Test 1 PASS — overlap returns TRUE';
END $$;
ROLLBACK;

-- ─── Test 2: check_host_schedule_conflict — disjoint returns FALSE ──────────
BEGIN;
DO $$
DECLARE
    v_host UUID := gen_random_uuid();
    v_game_a UUID := gen_random_uuid();
    v_game_b UUID := gen_random_uuid();
    v_conflict BOOLEAN;
BEGIN
    INSERT INTO public.show_hosts (id, name, application_status, status, auth_user_id)
    VALUES (v_host, 'sql-test-host-' || v_host::text, 'approved', 'active', NULL);

    -- Two games 3 hours apart — well outside the 90-minute conflict window.
    INSERT INTO public.games (id, title, mode, status, host_id, scheduled_at, created_at, updated_at)
    VALUES (v_game_a, 'Test Game A', 'live', 'upcoming', v_host, NOW() + INTERVAL '1 hour', NOW(), NOW()),
           (v_game_b, 'Test Game B', 'live', 'upcoming', NULL,   NOW() + INTERVAL '4 hours',  NOW(), NOW());

    SELECT public.check_host_schedule_conflict(v_host, v_game_b) INTO v_conflict;
    ASSERT v_conflict = FALSE, format('disjoint case: expected FALSE, got %L', v_conflict);
    RAISE NOTICE '✓ Test 2 PASS — disjoint returns FALSE';
END $$;
ROLLBACK;

-- ─── Test 3: trigger auto-cancels other pending requests on assign ──────────
BEGIN;
DO $$
DECLARE
    v_host_a UUID := gen_random_uuid();
    v_host_b UUID := gen_random_uuid();
    v_game   UUID := gen_random_uuid();
    v_req_b_status TEXT;
BEGIN
    INSERT INTO public.show_hosts (id, name, application_status, status, auth_user_id) VALUES
        (v_host_a, 'sql-test-host-a-' || v_host_a::text, 'approved', 'active', NULL),
        (v_host_b, 'sql-test-host-b-' || v_host_b::text, 'approved', 'active', NULL);

    INSERT INTO public.games (id, title, mode, status, host_id, scheduled_at, created_at, updated_at)
    VALUES (v_game, 'Test Game', 'live', 'upcoming', NULL, NOW() + INTERVAL '2 hours', NOW(), NOW());

    INSERT INTO public.host_game_requests (host_id, game_id, status, created_at, updated_at) VALUES
        (v_host_a, v_game, 'pending', NOW(), NOW()),
        (v_host_b, v_game, 'pending', NOW(), NOW());

    -- Simulate the request-approve flow: assign host_a.
    UPDATE public.games SET host_id = v_host_a WHERE id = v_game;

    -- The trigger must have cancelled host_b's request.
    SELECT status INTO v_req_b_status
      FROM public.host_game_requests
     WHERE game_id = v_game AND host_id = v_host_b;
    ASSERT v_req_b_status = 'cancelled',
        format('stale request: expected cancelled, got %L', v_req_b_status);
    RAISE NOTICE '✓ Test 3 PASS — losing request auto-cancelled by trigger';
END $$;
ROLLBACK;

-- ─── Test 4: trigger auto-expires other sent invitations on assign ──────────
BEGIN;
DO $$
DECLARE
    v_host_a UUID := gen_random_uuid();
    v_host_b UUID := gen_random_uuid();
    v_admin  UUID;
    v_game   UUID := gen_random_uuid();
    v_inv_b_status TEXT;
BEGIN
    SELECT id INTO v_admin FROM public.admin_users LIMIT 1;
    IF v_admin IS NULL THEN
        RAISE NOTICE '⊘ Test 4 SKIP — no admin_users rows available';
        RETURN;
    END IF;

    INSERT INTO public.show_hosts (id, name, application_status, status, auth_user_id) VALUES
        (v_host_a, 'sql-test-host-a-' || v_host_a::text, 'approved', 'active', NULL),
        (v_host_b, 'sql-test-host-b-' || v_host_b::text, 'approved', 'active', NULL);

    INSERT INTO public.games (id, title, mode, status, host_id, scheduled_at, created_at, updated_at)
    VALUES (v_game, 'Test Game', 'live', 'upcoming', NULL, NOW() + INTERVAL '2 hours', NOW(), NOW());

    INSERT INTO public.host_invitations (host_id, game_id, invited_by, status, created_at, updated_at) VALUES
        (v_host_a, v_game, v_admin, 'sent', NOW(), NOW()),
        (v_host_b, v_game, v_admin, 'sent', NOW(), NOW());

    UPDATE public.games SET host_id = v_host_a WHERE id = v_game;

    SELECT status INTO v_inv_b_status
      FROM public.host_invitations
     WHERE game_id = v_game AND host_id = v_host_b;
    ASSERT v_inv_b_status = 'expired',
        format('stale invitation: expected expired, got %L', v_inv_b_status);
    RAISE NOTICE '✓ Test 4 PASS — losing invitation auto-expired by trigger';
END $$;
ROLLBACK;

\echo ''
\echo '────────────────────────────────────────────────────────────────'
\echo '  host-platform-sql-tests.sql complete — all assertions passed.'
\echo '────────────────────────────────────────────────────────────────'
