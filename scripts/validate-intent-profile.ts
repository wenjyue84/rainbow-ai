#!/usr/bin/env node

/**
 * CLI script to validate profile-specific intent whitelists.
 * Usage:
 *   npm run validate:intent-profile -- --profile makan
 *   npm run validate:intent-profile -- --profile makan --fix
 *   npm run validate:intent-profile -- --all
 *   npm run validate:intent-profile -- --all --fix
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateProfileIntents,
  validateAllProfiles,
  fixProfileIntents,
  getViolationsSummary
} from '../src/assistant/validators/profile-intent-whitelist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    profile: args.includes('--profile') ? args[args.indexOf('--profile') + 1] : null,
    all: args.includes('--all'),
    fix: args.includes('--fix')
  };
}

async function main() {
  const { profile, all, fix } = parseArgs();

  try {
    if (!profile && !all) {
      console.log('Usage:');
      console.log('  npm run validate:intent-profile -- --profile <profile-name> [--fix]');
      console.log('  npm run validate:intent-profile -- --all [--fix]');
      console.log('');
      console.log('Examples:');
      console.log('  npm run validate:intent-profile -- --profile makan');
      console.log('  npm run validate:intent-profile -- --profile makan --fix');
      console.log('  npm run validate:intent-profile -- --all');
      process.exit(1);
    }

    if (profile) {
      // Single profile validation
      if (fix) {
        console.log(`Fixing profile '${profile}'...\n`);
        const result = fixProfileIntents(profile);
        console.log(result.message);
        if (result.removed.length > 0) {
          console.log('✓ Fixed successfully');
          process.exit(0);
        } else {
          console.log('✓ No changes needed');
          process.exit(0);
        }
      } else {
        // Report only
        console.log(`Validating profile '${profile}'...\n`);
        const violations = validateProfileIntents(profile);
        if (violations.length > 0) {
          console.log(`Found ${violations.length} violation(s):`);
          violations.forEach(v => console.log(`  - ${v}`));
          console.log('\nRun with --fix to remove violating intents');
          process.exit(1);
        } else {
          console.log('✓ Profile is valid!');
          process.exit(0);
        }
      }
    }

    if (all) {
      // All profiles validation
      console.log('Validating all profiles...\n');

      if (fix) {
        const whitelistPath = path.join(__dirname, '../src/assistant/data/intent-whitelists.json');
        const content = fs.readFileSync(whitelistPath, 'utf-8');
        const whitelists = JSON.parse(content);

        for (const profileName of Object.keys(whitelists)) {
          try {
            const result = fixProfileIntents(profileName);
            if (result.removed.length > 0) {
              console.log(`${profileName}: Fixed (removed ${result.removed.length} intents)`);
            } else {
              console.log(`${profileName}: OK`);
            }
          } catch (e) {
            console.log(`${profileName}: Error - ${(e as Error).message}`);
          }
        }
        console.log('\n✓ All profiles fixed');
        process.exit(0);
      } else {
        // Report mode
        const violations = validateAllProfiles();
        const summary = getViolationsSummary(violations);
        console.log(summary);

        let hasViolations = false;
        for (const [, v] of violations) {
          if (v.length > 0) {
            hasViolations = true;
            break;
          }
        }

        if (hasViolations) {
          console.log('\nRun with --fix to remove violating intents');
          process.exit(1);
        } else {
          process.exit(0);
        }
      }
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
