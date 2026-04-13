#!/usr/bin/env tsx
/**
 * US-561: Profile-Specific Data Contamination Detection CLI
 *
 * Scans knowledge base files and workflows.json across all profiles
 * for cross-profile keywords defined in contamination-keywords.json.
 *
 * Usage:
 *   npm run audit:contamination
 *   npx tsx scripts/auditContamination.ts
 *
 * Exit codes:
 *   0 — All profiles clean, no contamination detected
 *   1 — Contamination detected in one or more profiles
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Load contamination keywords configuration
function loadContaminationKeywords(): Record<string, string[]> {
  const keywordsPath = path.join(projectRoot, 'src', 'assistant', 'data', 'contamination-keywords.json');

  if (!fs.existsSync(keywordsPath)) {
    console.error(`ERROR: contamination-keywords.json not found at ${keywordsPath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(keywordsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`ERROR: Failed to parse contamination-keywords.json: ${error}`);
    process.exit(1);
  }
}

// Get all profile data directories
function getProfileDirectories(): string[] {
  const dataDir = path.join(projectRoot, 'src', 'assistant');
  const dirs = fs.readdirSync(dataDir).filter(d => {
    const fullPath = path.join(dataDir, d);
    return fs.statSync(fullPath).isDirectory() && (d === 'data' || d.startsWith('data-'));
  });
  return dirs;
}

// Scan a file for contamination keywords
interface ContaminationResult {
  file: string;
  profile: string;
  contaminations: Array<{
    keyword: string;
    fromProfile: string;
    lineNumber: number;
    lineContent: string;
  }>;
}

function scanFileForContamination(
  filePath: string,
  profile: string,
  keywords: Record<string, string[]>
): ContaminationResult | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const contaminations: ContaminationResult['contaminations'] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check each profile's keywords (excluding the current profile)
  for (const [sourceProfile, sourceKeywords] of Object.entries(keywords)) {
    if (sourceProfile === profile) {
      continue; // Skip checking profile against its own keywords
    }

    for (const keyword of sourceKeywords) {
      const lowerKeyword = keyword.toLowerCase();

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(lowerKeyword)) {
          contaminations.push({
            keyword,
            fromProfile: sourceProfile,
            lineNumber: index + 1,
            lineContent: line.trim().substring(0, 80),
          });
        }
      });
    }
  }

  if (contaminations.length === 0) {
    return null;
  }

  return {
    file: filePath,
    profile,
    contaminations,
  };
}

// Main audit function
function runAudit(): boolean {
  const keywords = loadContaminationKeywords();
  const profileDirs = getProfileDirectories();
  const results: ContaminationResult[] = [];
  let hasContamination = false;

  console.log('='.repeat(80));
  console.log('Profile Data Contamination Audit Report');
  console.log('='.repeat(80));
  console.log('');

  for (const profileDir of profileDirs) {
    const fullProfilePath = path.join(projectRoot, 'src', 'assistant', profileDir);
    const profileName = profileDir === 'data' ? 'default' : profileDir.replace('data-', '');

    // Scan for knowledge.json and workflows.json files
    const filesToScan = [
      path.join(fullProfilePath, 'knowledge.json'),
      path.join(fullProfilePath, 'workflows.json'),
    ];

    for (const filePath of filesToScan) {
      const result = scanFileForContamination(filePath, profileName, keywords);
      if (result) {
        results.push(result);
        hasContamination = true;
      }
    }
  }

  if (results.length === 0) {
    console.log('✓ All profiles are clean - no data contamination detected.');
    console.log('');
    console.log('='.repeat(80));
    return false;
  }

  // Report contaminations
  for (const result of results) {
    console.log(`❌ CONTAMINATION DETECTED: ${result.profile}`);
    console.log(`   File: ${result.file}`);
    console.log('');

    for (const contamination of result.contaminations) {
      console.log(`   • Line ${contamination.lineNumber}: Found '${contamination.keyword}' from profile '${contamination.fromProfile}'`);
      console.log(`     Content: ${contamination.lineContent}`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`Total contaminations found: ${results.reduce((sum, r) => sum + r.contaminations.length, 0)}`);
  console.log('');

  return true;
}

const hasContamination = runAudit();
process.exit(hasContamination ? 1 : 0);
