# Quiz4Win Backend Deployment Guide (Node.js Only)

This guide explains how to deploy the recent changes using only Node.js and approved scripts, without Docker.

## Changes Made

1. **deploy/game-orchestrator/orchestrator.ts** - Added 2-minute delay before question generation in auto mode
2. **deploy/template-generator/generator.ts** - Added mid-game participant notifications (every 5 minutes during live games)
3. **supabase/migrations/20260604000000_mid_game_notifications.sql** - Database migration for notifications feature

## Deployment Steps

### 1. Apply Database Migration

Use the provided Node.js migration runner:

```bash
# Install dependencies if needed
npm install

# Run the migration
node scripts/run-migration.js supabase/migrations/20260604000000_mid_game_notifications.sql
```

This script:
- Reads the SQL migration file
- Connects to your Supabase database using the connection string from `.env`
- Executes the migration safely
- Reports success or failure

### 2. Deploy TypeScript Changes

The Edge Functions are written in TypeScript and can be deployed directly as `.ts` files to your Supabase Edge Functions environment, or compiled to JavaScript if preferred.

#### Option A: Deploy as TypeScript (Recommended for Deno)
If your Edge Functions runtime supports TypeScript (like Deno):

```bash
# Simply copy the files to your Edge Functions directory
cp deploy/game-orchestrator/orchestrator.ts /path/to/your/supabase/functions/game-orchestrator/index.ts
cp deploy/template-generator/generator.ts /path/to/your/template-generator/generator.ts
cp deploy/template-generator/fcm.ts /path/to/your/template-generator/fcm.ts
```

#### Option B: Compile to JavaScript First
If you need to compile to JavaScript:

```bash
# Check TypeScript syntax (doesn't emit files)
node scripts/compile-ts.js deploy/game-orchestrator/orchestrator.ts

# If syntax is clean, copy the .ts files as above, or compile them:
# npx tsc deploy/game-orchestrator/orchestrator.ts --outDir ./dist
```

### 3. Verify Deployment

After deploying:

1. **Check that services are running** - Verify your Edge Functions and template-generator service are active
2. **Test the 2-minute delay** - Create a test auto-mode game and verify it waits 2 minutes before generating questions
3. **Test mid-game notifications** - Join a live game and verify you receive notifications every 5 minutes

## Scripts Provided

### `scripts/run-migration.js`
- Runs SQL migrations against Supabase database using Node.js
- Uses the `postgres` library from your dependencies
- Requires `SUPABASE_DB_URL` or `NEXT_PUBLIC_SUPABASE_POSTGRESQLURL` in `.env`

### `scripts/compile-ts.js`
- Helper to verify TypeScript syntax using `tsc`
- Uses `tsx` from your devDependencies
- Does not emit files by default (use `--noEmit` flag for checking)

## Environment Variables Required

Ensure these are set in your `.env` file:
- `SUPABASE_DB_URL` or `NEXT_PUBLIC_SUPABASE_POSTGRESQLURL` - Database connection
- `SUPABASE_SERVICE_ROLE_KEY` - For Edge Functions to access Supabase
- Other service-specific keys (FCM, OpenAI, etc.) as needed

## Troubleshooting

### Migration fails with "column does not exist"
- Ensure you're using the updated migration file that checks for column existence
- The script now conditionally adds the `game_notifications` column to `notification_preferences` if missing

### TypeScript compilation errors
- Run `node scripts/compile-ts.js <file>` to check syntax first
- Ensure all imports are correct and dependencies are available

### Service doesn't start after deployment
- Check service logs for specific error messages
- Verify all required environment variables are set
- Ensure file permissions are correct for the runtime environment

## Notes

- These changes are backward compatible and won't break existing functionality
- The mid-game notification feature sends FCM pushes to all participants in live games every 5 minutes
- The 2-minute delay applies only to automatic games at startup (recovery scenarios skip the delay)
- All code follows existing project patterns for security (R-01), idempotency, and error handling