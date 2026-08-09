#!/usr/bin/env tsx
/**
 * CLI: Mine Keyword Suggestions from Production Misclassifications (US-323)
 *
 * Usage:
 *   npm run mine-keyword-suggestions -- --profile=makan --window=7d
 *   npm run mine-keyword-suggestions -- --profile=pelangi --window=30d
 */

import { mineKeywordSuggestions } from '../src/tools/keyword-miner.js';

interface Args {
  profile: string;
  window: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const params: Args = { profile: 'pelangi', window: '7d' };

  for (const arg of args) {
    if (arg.startsWith('--profile=')) {
      params.profile = arg.split('=')[1];
    } else if (arg.startsWith('--window=')) {
      params.window = arg.split('=')[1];
    }
  }

  return params;
}

function parseWindowToDays(window: string): number {
  const match = window.match(/^(\d+)(d|h)$/);
  if (!match) throw new Error(`Invalid window format: ${window}. Use "7d" or "24h"`);
  const [, value, unit] = match;
  const num = parseInt(value, 10);
  return unit === 'd' ? num : num / 24;
}

async function main() {
  try {
    const { profile, window } = parseArgs();
    const windowDays = parseWindowToDays(window);
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      console.error('ERROR: DATABASE_URL environment variable is not set');
      process.exit(1);
    }

    const output = await mineKeywordSuggestions(profile, windowDays, dbUrl);
    
    // Output JSON to stdout
    console.log(JSON.stringify(output.suggestions, null, 2));
  } catch (err) {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
