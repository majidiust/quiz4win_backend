# Quiz4Win — Host Logic

Last updated: 2026-06-17
Reference: INV-16, INV-17, INV-18 in `project-brain/Domain_Knowledge.md`

---

## 1. Overview

A **host** (`show_hosts` row) is a human presenter assigned to a `mode = 'live'` game. Hosts manage their own profile via `host.quiz4win.com`, which is backed by the `/host/*` Edge Function (`supabase/functions/host/index.ts`).

---

## 2. Host Lifecycle (Application → Active)

```
[no row]
   │  POST /host/apply
   ▼
application_status = 'pending'  (status = 'inactive')
   │  Admin approves in panel
   ▼
application_status = 'approved'  (status = 'active')
   │  Admin suspends
   ▼
application_status = 'suspended'  ─── read-only, no new writes
   │  Admin rejects
   ▼
application_status = 'rejected'  ─── terminal; host may re-apply → back to 'pending'
```

**Gates enforced by `requireApproved(host)`** (checked before every write action):
- `application_status === 'approved'`
- `status !== 'suspended'`

---

## 3. Game Visibility — `requires_host` Flag

Each `games` and `game_templates` row has:

| Column | Default | Meaning |
|--------|---------|---------|
| `requires_host` | `TRUE` | When `FALSE`, the game is excluded from the host-app available list entirely (AI-run or automated shows). |

- **Available list** (`GET /host/games/available`) filters `.eq("requires_host", true)`.
- Admin controls the flag per-template (propagates to generated games) or per-game via the edit form.
- Existing games are unaffected (default `TRUE`).

---

## 4. Assignment Flows

There are three ways a host gets assigned to a game. Each lands on a different `host_assignment_status`:

### 4a. Host Self-Request (host initiates)
```
Host → POST /host/games/:id/request  →  host_game_requests row (status='pending')
Admin → approve in panel             →  claimGameHost()
                                         games.host_id = host.id
                                         games.host_assignment_status = 'accepted'
                                     →  Host sees: Start Hosting immediately
```
The host already opted in by requesting — no redundant accept step.

### 4b. Admin Direct Assignment (admin initiates)
```
Admin → edit-game or create-game form (HostPickerDialog)
      → updateGame() / createGame()
           games.host_id = host.id
           games.host_assignment_status = 'pending'
      → notifyHostAssigned() sends in-app + email
Host  → sees: Accept / Reject buttons
      → POST /host/games/:id/accept  → status = 'accepted'  → Start Hosting
      → POST /host/games/:id/reject  → host_id = NULL, status = 'unassigned', game back to pool
```

### 4c. Invitation (admin-sent formal invite — `host_invitations` table)
```
Admin → creates host_invitation row
Host  → GET /host/invitations
      → POST /host/invitations/:id/accept  (INV-17 conflict check runs here)
           games.host_id = host.id
           games.host_assignment_status = 'accepted'
      → POST /host/invitations/:id/reject
```

### 4d. Admin Unassignment (admin removes the host)
```
Admin → HostPickerDialog (assignGameHost null) OR edit-game (updateGame host_id=null)
      → games.host_id = NULL, host_name = NULL, host_assignment_status = 'unassigned'
      → trg_close_stale_host_offers_on_assign fires (host_id NOT NULL → NULL):
           that host's host_game_requests row  → status = 'cancelled'
           that host's host_invitations row     → status = 'expired'
      → game reappears in /host/games/available with NO stale "Approved" badge
```
The DB trigger is the single source of truth, so **every** unassign path (direct
unassign, edit-form clear, or switch to a different host) resets the prior host's
offer automatically. This also clears the `approved` request that
`check_host_schedule_conflict` (INV-17) would otherwise keep counting.

---

## 5. `host_assignment_status` State Machine

```
unassigned ──(admin assigns)──► pending ──(host accepts)──► accepted ──► [go live] ──(game ends)──► completed
                                   │
                                   └──(host rejects)──► unassigned
```

| Value | Who sets it | Host CTA |
|-------|-------------|----------|
| `unassigned` | Default / after rejection / admin unassigns | Game in pool (no host) |
| `pending` | Admin directly assigns | **Accept / Reject** |
| `accepted` | Host accepts, or request approved, or invitation accepted | **Start Hosting** |
| `rejected` | Host rejects (status immediately clears to `unassigned`) | — |
| `completed` | `trg_complete_host_assignment_on_game_end` when the game reaches a terminal status (`completed`/`cancelled`) | — (host freed for new assignments) |

> **Note:** Games assigned before this feature shipped were backfilled to `'accepted'` by migration `20260617000000`. To test the accept/reject flow on such a game, unassign then re-assign the host.

---

## 6. Compensation — Fee & Commission

Each game carries:

| Column | Type | Description |
|--------|------|-------------|
| `host_fee` | `NUMERIC(12,2)` | Fixed fee paid to host on game completion |
| `host_commission_pct` | `NUMERIC(5,2)` | % of total entry-fee income paid to host |
| `show_host_fee` | `BOOLEAN` | Admin toggle — reveal `host_fee` to host-app |
| `show_host_commission` | `BOOLEAN` | Admin toggle — reveal `host_commission_pct` to host-app |

`maskFeeFields()` (Edge Function) strips hidden fields before sending game data to the host-app.

**Payout trigger** (`trg_record_host_earning`): fires when `games.prizes_distributed_at` transitions `NULL → value`. Calls `record_host_earning(game_id)` which inserts a `host_earnings` row (`status='pending'`). Admin reviews and approves → atomic DB transaction credits `profiles.wallet_balance` (see INV-16).

---

## 7. Stream Session Flow

```
host_assignment_status = 'accepted'
   │  GET /host/games/:id/stream-session   (stream page loads)
   ▼
[optional] camera/mic/connection readiness wizard
   │  POST /host/games/:id/stream-session  (status='testing' → 'ready')
   ▼
   │  POST /host/games/:id/stream-session/live
   ▼
LiveKit token minted → host goes live
   │  POST /host/games/:id/stream-session/end
   ▼
Stream session ended
```

Guards:
- `host_assignment_status === 'pending'` → `assignment_not_accepted` (403)
- `host_id !== caller` → `not_assigned_to_this_game` (403)
- `g.status ∉ {upcoming, open, live}` → `game_not_live_able` (409)

---

## 8. Host-App UI Decision Tree (game detail page)

```
game.host_id === host.id  →  isAssigned = true
  ├─ host_assignment_status = 'pending'  →  Show: Accept / Reject
  └─ host_assignment_status = 'accepted' →  Show: Start Hosting button

game.host_id === null AND game.status = 'upcoming'  →  isAvailable = true
  └─ Show: Apply form (request to host)

otherwise  →  Read-only view
```

---

## 9. Schedule Conflict Check (INV-17)

`check_host_schedule_conflict(p_host_id, p_game_id)` — a `SECURITY DEFINER` PostgreSQL function — returns `true` if the host already has an **active** assignment whose live window overlaps the target game's window (`scheduled_at + 90 min` default). Called before every assignment operation.

"Active" means the other commitment's game is still `upcoming`/`open`/`live`. All three branches (assigned `games.host_id`, accepted `host_invitations`, approved `host_game_requests`) filter `g.status IN ('upcoming','open','live')`, so **completed or cancelled games never block a new assignment**.

When a game reaches a terminal status the assigned host is freed automatically by the `complete_host_assignment_on_game_end` trigger (`BEFORE UPDATE OF status ON public.games`): it transitions the host's non-terminal `host_game_requests`/`host_invitations` to `completed` (or `cancelled` if the game was cancelled) and sets `games.host_assignment_status = 'completed'`. This is what makes the host eligible to request/accept the next slot immediately after a show ends — no cache or scheduled cleanup is involved.

---

## 10. Relevant Files

| File | Purpose |
|------|---------|
| `supabase/functions/host/index.ts` | All `/host/*` Edge Function routes |
| `supabase/functions/_shared/host_notifications.ts` | `notifyHost()` helper |
| `admin/src/lib/actions/hosts.ts` | `assignGameHost`, `claimGameHost`, `reviewHostRequest` |
| `admin/src/lib/actions/games.ts` | `createGame`, `updateGame` (set `host_assignment_status`) |
| `host-app/src/app/(app)/games/[id]/page.tsx` | Host game detail UI + CTA logic |
| `host-app/src/app/(app)/games/actions.ts` | `acceptGameAction`, `rejectGameAction` |
| `supabase/migrations/20260617000000_host_fee_commission_assignment.sql` | Fee columns, `host_assignment_status`, payout trigger |
| `supabase/migrations/20260617010000_game_requires_host.sql` | `requires_host` column |
| `supabase/migrations/20260609000300_host_platform_followup_fixes.sql` | `close_stale_host_offers_on_assign` trigger (assignment direction) |
| `supabase/migrations/20260617020000_close_host_offers_on_unassign.sql` | Extends trigger to the unassign/replace direction (clears stale "Approved" badge) |
