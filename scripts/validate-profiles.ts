#!/usr/bin/env tsx
/**
 * US-196: Profile Data Contamination Scanner CLI with Pre-Deploy Report
 *
 * Scans all profile-specific data files (routing.json, workflows.json, knowledge.json, intent-keywords.json)
 * and reports cross-profile contamination with actionable fix instructions.
 *
 * Usage:
 *   npm run validate:profiles                    # Report mode (exit 1 if contamination)
 *   npm run validate:profiles -- --strict        # CI mode (fail build if contamination detected)
 *   npm run validate:profiles -- --fix           # Auto-fix mode (removes flagged terms with manual review)
 *
 * Exit codes:
 *   0 — All profiles clean
 *   1 — Contamination detected (or --strict mode with contamination)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

interface ProfileConfig {
  label: string;
  dataDir: string;
  keywords: string[];
  forbiddenKeywords: string[];
}

interface Finding {
  profileId: string;
  profileLabel: string;
  file: string;
  term: string;
  occurrences: number;
}

/**
 * Load profile keywords configuration
 */
function loadProfileKeywords(): Record<string, ProfileConfig> {
  const configPath = join(projectRoot, 'src/assistant/validators/profile-keywords.json');
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content);
  return config.profiles;
}

/**
 * Count occurrences of a term in a string (case-insensitive)
 */
function countOccurrences(text: string, term: string): number {
  const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Recursively search for forbidden keywords in JSON structure
 */
function findKeywordsInJson(
  obj: unknown,
  forbiddenKeywords: string[],
  findings: Finding[],
  file: string,
  profileId: string,
  profileLabel: string,
): void {
  if (typeof obj === 'string') {
    for (const keyword of forbiddenKeywords) {
      const count = countOccurrences(obj, keyword);
      if (count > 0) {
        findings.push({
          profileId,
          profileLabel,
          file,
          term: keyword,
          occurrences: count,
        });
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      findKeywordsInJson(item, forbiddenKeywords, findings, file, profileId, profileLabel);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      findKeywordsInJson(value, forbiddenKeywords, findings, file, profileId, profileLabel);
    }
  }
}

/**
 * Recursively remove forbidden keywords from JSON object
 */
function removeForbiddenKeywords(obj: unknown, keywords: string[]): [unknown, number] {
  let removalCount = 0;

  if (typeof obj === 'string') {
    let result = obj;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const before = result;
      result = result.replace(regex, '');
      if (before !== result) {
        removalCount += countOccurrences(before, keyword);
      }
    }
    return [result, removalCount];
  }

  if (Array.isArray(obj)) {
    const cleaned = [];
    for (const item of obj) {
      const [cleanedItem, count] = removeForbiddenKeywords(item, keywords);
      removalCount += count;
      cleaned.push(cleanedItem);
    }
    return [cleaned, removalCount];
  }

  if (obj !== null && typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const [cleanedValue, count] = removeForbiddenKeywords(value, keywords);
      removalCount += count;
      cleaned[key] = cleanedValue;
    }
    return [cleaned, removalCount];
  }

  return [obj, removalCount];
}

/**
 * Scan a profile directory for contamination
 */
function scanProfile(
  profileId: string,
  config: ProfileConfig,
  filesToScan: string[],
): Finding[] {
  const findings: Finding[] = [];
  const dataDir = join(projectRoot, config.dataDir);

  if (!fs.existsSync(dataDir)) {
    return findings;
  }

  for (const fileName of filesToScan) {
    const filePath = join(dataDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }

    findKeywordsInJson(data, config.forbiddenKeywords, findings, fileName, profileId, config.label);
  }

  return findings;
}

/**
 * Auto-fix contamination by removing forbidden keywords
 */
function fixProfile(
  profileId: string,
  config: ProfileConfig,
  filesToScan: string[],
): number {
  let totalRemoved = 0;
  const dataDir = join(projectRoot, config.dataDir);

  if (!fs.existsSync(dataDir)) {
    return 0;
  }

  for (const fileName of filesToScan) {
    const filePath = join(dataDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }

    const [cleanedData, count] = removeForbiddenKeywords(data, config.forbiddenKeywords);
    if (count > 0) {
      fs.writeFileSync(filePath, JSON.stringify(cleanedData, null, 2) + '\n');
      console.log(`   ✏️  ${fileName}: removed ${count} contaminated term(s)`);
      totalRemoved += count;
    }
  }

  return totalRemoved;
}

/**
 * Main validation logic
 */
async function main() {
  const args = process.argv.slice(2);
  const isStrict = args.includes('--strict');
  const isFix = args.includes('--fix');

  const profiles = loadProfileKeywords();
  const filesToScan = [
    'routing.json',
    'workflows.json',
    'knowledge.json',
    'intent-keywords.json',
  ];

  const allFindings: Finding[] = [];
  let hasContamination = false;

  console.log('🔍 Scanning profile data files for cross-contamination...\n');

  for (const [profileId, config] of Object.entries(profiles)) {
    const dataDir = join(projectRoot, config.dataDir);
    if (!fs.existsSync(dataDir)) {
      continue;
    }

    console.log(`📁 ${config.label}`);

    if (isFix) {
      const removed = fixProfile(profileId, config, filesToScan);
      if (removed > 0) {
        console.log(`   ✅ Fixed ${removed} contamination(s)\n`);
      } else {
        console.log(`   ✅ No contamination found\n`);
      }
    } else {
      const findings = scanProfile(profileId, config, filesToScan);

      if (findings.length > 0) {
        hasContamination = true;
        allFindings.push(...findings);

        console.log(`   ⚠️  Found ${findings.length} contamination(s):`);
        const byFile = new Map<string, Finding[]>();
        for (const finding of findings) {
          if (!byFile.has(finding.file)) {
            byFile.set(finding.file, []);
          }
          byFile.get(finding.file)!.push(finding);
        }

        for (const [file, fileFindings] of byFile) {
          const unique = new Map<string, number>();
          for (const finding of fileFindings) {
            const count = unique.get(finding.term) || 0;
            unique.set(finding.term, count + finding.occurrences);
          }

          console.log(`     📄 ${file} contains cross-profile content:`);
          for (const [term, count] of unique) {
            console.log(
              `        "${term}" (${count} occurrence(s)) - remove or relocate to shared profile`,
            );
          }
        }
        console.log();
      } else {
        console.log(`   ✅ No contamination found\n`);
      }
    }
  }

  // Summary report
  console.log('📊 === Contamination Report ===\n');
  if (isFix) {
    console.log('✅ Flagged terms have been automatically removed.');
    console.log('⚠️  Please review the changes before committing!\n');
  } else if (hasContamination) {
    console.log(`❌ Found ${allFindings.length} contamination(s)\n`);
    console.log('Fix instructions:');
    console.log('  1. Run with --fix flag to auto-remove flagged terms: npm run validate:profiles -- --fix');
    console.log('  2. Manually review the removed content');
    console.log('  3. Verify changes do not break functionality before committing\n');

    if (isStrict) {
      console.error('❌ Build failed: Profile contamination detected (--strict mode)');
      process.exit(1);
    } else {
      process.exit(1);
    }
  } else {
    console.log('✅ All profiles are clean! No cross-contamination detected.\n');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
