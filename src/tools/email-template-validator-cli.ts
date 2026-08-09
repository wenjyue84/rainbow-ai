#!/usr/bin/env tsx
/**
 * US-388: Booking Confirmation Email Template Profile Validator CLI
 *
 * Scans email templates for hardcoded profile-specific content (business names,
 * amenities, policies). Ensures templates use {{PROFILE_NAME}} variables instead
 * of hardcoded values to prevent cross-profile contamination.
 *
 * Usage:
 *   npx tsx src/tools/email-template-validator-cli.ts --profile=makan-moments --template=booking-confirmation
 *   npx tsx src/tools/email-template-validator-cli.ts --profile=pelangi-capsule --template=booking-confirmation
 *
 * Exit codes:
 *   0 — Template is valid
 *   1 — Validation failed (violations found or error)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateTemplate,
  formatValidationResult,
  normalizeProfileName,
} from './email-template-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const templatesDir = path.join(
  rootDir,
  'src/assistant/data/email-templates',
);

const VALID_PROFILES = ['pelangi-capsule', 'makan-moments', 'southern-homestay'];

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(): {
  profile: string;
  template: string;
  json?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      parsed[key] = value || 'true';
    }
  }

  const profile = parsed['profile'];
  const template = parsed['template'];
  const json = parsed['json'] === 'true' || parsed['json'] === '1';

  if (!profile) {
    throw new Error('--profile is required');
  }

  if (!template) {
    throw new Error('--template is required');
  }

  const normalizedProfile = normalizeProfileName(profile);
  if (!VALID_PROFILES.includes(normalizedProfile)) {
    throw new Error(
      `--profile must be one of: ${VALID_PROFILES.join(', ')} (got: ${profile})`,
    );
  }

  return { profile: normalizedProfile, template, json };
}

// ---------------------------------------------------------------------------
// Template loader
// ---------------------------------------------------------------------------

function loadTemplate(
  templateName: string,
  profile: string,
): { path: string; content: string } {
  const templatePath = path.join(
    templatesDir,
    `${templateName}.${profile}.html`,
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Template file not found: ${templatePath}\n\nLooking in: ${templatesDir}`,
    );
  }

  const content = fs.readFileSync(templatePath, 'utf-8');
  return { path: templatePath, content };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    const args = parseArgs();
    const { path: templatePath, content } = loadTemplate(
      args.template,
      args.profile,
    );

    const result = validateTemplate(content, args.profile, templatePath);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(formatValidationResult(result));
    }

    process.exit(result.isValid ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error:', message);
    process.exit(1);
  }
}

main();
