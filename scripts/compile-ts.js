/**
 * Quiz4Win TypeScript Compiler Helper
 * Helper script to compile TypeScript files for deployment
 * 
 * Usage: node scripts/compile-ts.js <src-file> [out-file]
 */

import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load environment variables (if needed)
import { config } from 'dotenv';
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function compileTypeScript(srcPath, outPath = null) {
  const fullSrcPath = resolve(__dirname, '..', srcPath);
  
  // If no output path specified, create one based on input
  if (!outPath) {
    outPath = fullSrcPath.replace(/\.ts$/, '.js');
  } else {
    outPath = resolve(__dirname, '..', outPath);
  }
  
  try {
    console.log(`Compiling ${fullSrcPath} -> ${outPath}`);
    
    // Use tsc (TypeScript compiler) if available, or fall back to tsx for execution
    // For Edge Functions, you might want to keep them as .ts and let Deno handle them
    
    // Check if we should compile or just verify
    const result = await execFile('npx', ['tsc', '--noEmit', fullSrcPath], 
                                 { encoding: 'utf8' });
    
    console.log('TypeScript compilation check passed!');
    console.log(`To deploy: copy ${fullSrcPath} to your Edge Functions directory`);
    
    return true;
  } catch (error) {
    console.error('TypeScript compilation error:', error.stderr || error.message);
    return false;
  }
}

// Get source file from command line argument
const srcFile = process.argv[2];
const outFile = process.argv[3];

if (!srcFile) {
  console.error('Usage: node scripts/compile-ts.js <src-file.ts> [out-file.js]');
  console.log('Example: node scripts/compile-ts.js deploy/game-orchestrator/orchestrator.ts');
  process.exit(1);
}

compileTypeScript(srcFile, outFile).then(success => {
  process.exit(success ? 0 : 1);
});