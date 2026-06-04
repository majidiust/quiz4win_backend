/**
 * Quiz4Win Database Migration Runner
 * Runs SQL migrations against the Supabase database using Node.js
 * 
 * Usage: node scripts/run-migration.js <migration-file-path>
 */

import { postgres } from 'postgres';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

// Get PostgreSQL connection URL from environment
const connectionString = process.env.SUPABASE_DB_URL || 
                         process.env.NEXT_PUBLIC_SUPABASE_POSTGRESQLURL;

if (!connectionString) {
  console.error('Error: SUPABASE_DB_URL or NEXT_PUBLIC_SUPABASE_POSTGRESQLURL not found in environment');
  process.exit(1);
}

// Get migration file from command line argument
const migrationFilePath = process.argv[2];
if (!migrationFilePath) {
  console.error('Usage: node scripts/run-migration.js <migration-file-path>');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationPath = resolve(__dirname, '..', migrationFilePath);

async function runMigration() {
  let sql;
  let client;
  
  try {
    // Read the SQL migration file
    console.log(`Reading migration file: ${migrationPath}`);
    sql = await readFile(migrationPath, 'utf8');
    
    // Create PostgreSQL client
    console.log('Connecting to database...');
    client = postgres(connectionString);
    
    // Execute the migration
    console.log('Executing migration...');
    await client.sql(sql);
    
    console.log('Migration executed successfully!');
    
  } catch (error) {
    console.error('Error executing migration:', error);
    process.exit(1);
  } finally {
    // Clean up
    if (client) {
      await client.end();
    }
  }
}

runMigration();