/**
 * US-653: Knowledge Base Schema Validator — Pure Logic Module
 *
 * Detects cross-profile content contamination in KB markdown files.
 * Each profile has a keyword blacklist; files scoring above 0 are flagged.
 *
 * Pure logic — no CLI concerns here. All functions accept data as parameters
 * for straightforward unit testing.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileType = 'pelangi' | 'makan' | 'southern';

export interface ContaminationKeyword {
  phrase: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
}

export interface FlaggedPhrase {
  phrase: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
  occurrences: number;
  context: string[];
}

export interface FileValidationResult {
  file: string;
  profile: ProfileType;
  contamination_score: number; // 0-100
  flagged_phrases: FlaggedPhrase[];
  profile_type_valid: boolean;
}

export interface ProfileSummary {
  profile: ProfileType;
  total_files: number;
  contaminated_files: number;
  avg_contamination_score: number;
  recommendations: string[];
}

export interface ValidationReport {
  generated_at: string;
  profiles: ProfileType[];
  results: FileValidationResult[];
  summary: ProfileSummary[];
}

// ---------------------------------------------------------------------------
// Contamination keyword blacklists per profile
// ---------------------------------------------------------------------------

export const CONTAMINATION_BLACKLISTS: Record<ProfileType, ContaminationKeyword[]> = {
  makan: [
    // Hostel-specific terms — should NOT appear in a cafe profile
    { phrase: 'room availability', severity: 'high', category: 'hostel' },
    { phrase: 'check-in', severity: 'high', category: 'hostel' },
    { phrase: 'check in', severity: 'high', category: 'hostel' },
    { phrase: 'hostel', severity: 'high', category: 'hostel' },
    { phrase: 'check-out', severity: 'high', category: 'hostel' },
    { phrase: 'checkout', severity: 'high', category: 'hostel' },
    { phrase: 'capsule', severity: 'high', category: 'hostel' },
    { phrase: 'dormitory', severity: 'high', category: 'hostel' },
    { phrase: 'dorm', severity: 'medium', category: 'hostel' },
    { phrase: 'bunk', severity: 'medium', category: 'hostel' },
    { phrase: 'overnight stay', severity: 'high', category: 'hostel' },
    { phrase: 'room rate', severity: 'high', category: 'hostel' },
    { phrase: 'pelangi capsule', severity: 'high', category: 'hostel' },
    { phrase: 'room type', severity: 'high', category: 'hostel' },
    { phrase: 'night stay', severity: 'high', category: 'hostel' },
    { phrase: 'accommodation', severity: 'medium', category: 'hostel' },
  ],
  southern: [
    // Cafe-specific terms — should NOT appear in a homestay profile
    { phrase: 'cafe', severity: 'high', category: 'cafe' },
    { phrase: 'menu', severity: 'high', category: 'cafe' },
    { phrase: 'table reservation', severity: 'high', category: 'cafe' },
    { phrase: 'dine-in', severity: 'high', category: 'cafe' },
    { phrase: 'dine in', severity: 'high', category: 'cafe' },
    { phrase: 'food order', severity: 'medium', category: 'cafe' },
    { phrase: 'restaurant', severity: 'medium', category: 'cafe' },
    { phrase: 'takeaway', severity: 'medium', category: 'cafe' },
    { phrase: 'makan moments', severity: 'high', category: 'cafe' },
    { phrase: 'best sellers', severity: 'medium', category: 'cafe' },
    { phrase: 'halal', severity: 'low', category: 'cafe' },
    { phrase: 'dish', severity: 'low', category: 'cafe' },
  ],
  pelangi: [
    // Content from other profiles that shouldn't bleed into pelangi hostel
    { phrase: 'makan moments', severity: 'high', category: 'cafe' },
    { phrase: 'table reservation', severity: 'medium', category: 'cafe' },
    { phrase: 'southern homestay', severity: 'high', category: 'southern' },
    { phrase: 'sky88', severity: 'high', category: 'southern' },
    { phrase: "ksl d'esplanade", severity: 'high', category: 'southern' },
  ],
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = {
  high: 30,
  medium: 15,
  low: 5,
};

/**
 * Score a single file's content against a contamination blacklist.
 * Returns a 0-100 score (higher = more contaminated) and flagged phrases.
 */
export function scoreFile(
  content: string,
  blacklist: ContaminationKeyword[]
): { score: number; flagged: FlaggedPhrase[] } {
  const lowerContent = content.toLowerCase();
  const flagged: FlaggedPhrase[] = [];
  let totalScore = 0;

  for (const keyword of blacklist) {
    const lowerPhrase = keyword.phrase.toLowerCase();
    let count = 0;
    const contexts: string[] = [];
    let searchFrom = 0;

    while (true) {
      const idx = lowerContent.indexOf(lowerPhrase, searchFrom);
      if (idx === -1) break;
      count++;
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + lowerPhrase.length + 30);
      const snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
      if (!contexts.includes(snippet)) contexts.push(snippet);
      searchFrom = idx + lowerPhrase.length;
    }

    if (count > 0) {
      const weight = SEVERITY_WEIGHTS[keyword.severity] ?? 5;
      // Cap each phrase's contribution to avoid runaway scores from repetition
      totalScore += weight * Math.min(count, 3);
      flagged.push({
        phrase: keyword.phrase,
        severity: keyword.severity,
        category: keyword.category,
        occurrences: count,
        context: contexts.slice(0, 3),
      });
    }
  }

  return {
    score: Math.min(100, totalScore),
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

/**
 * Scan all .md files in profileDir recursively and score each for contamination.
 */
export function detectContamination(
  profileDir: string,
  profileType: ProfileType
): FileValidationResult[] {
  const blacklist = CONTAMINATION_BLACKLISTS[profileType];
  const results: FileValidationResult[] = [];

  if (!fs.existsSync(profileDir)) return results;

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const { score, flagged } = scoreFile(content, blacklist);
        results.push({
          file: fullPath,
          profile: profileType,
          contamination_score: score,
          flagged_phrases: flagged,
          profile_type_valid: score < 30,
        });
      }
    }
  }

  scanDir(profileDir);
  return results;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

export function buildSummary(results: FileValidationResult[], profile: ProfileType): ProfileSummary {
  const contaminated = results.filter(r => r.contamination_score > 0);
  const avg =
    results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.contamination_score, 0) / results.length)
      : 0;

  const recommendations: string[] = [];

  if (contaminated.length === 0) {
    recommendations.push(`No contamination detected in ${profile} profile — profile is clean.`);
  } else {
    recommendations.push(
      `Review ${contaminated.length} file(s) with contamination detected in the ${profile} profile.`
    );
    const critical = results.filter(r => r.contamination_score >= 60);
    if (critical.length > 0) {
      recommendations.push(
        `${critical.length} file(s) have critical contamination (score ≥ 60) — remove or rewrite content.`
      );
    }
    const categories = new Set(contaminated.flatMap(r => r.flagged_phrases.map(f => f.category)));
    for (const cat of categories) {
      recommendations.push(
        `Remove all ${cat}-specific content from the ${profile} profile KB files.`
      );
    }
  }

  return {
    profile,
    total_files: results.length,
    contaminated_files: contaminated.length,
    avg_contamination_score: avg,
    recommendations,
  };
}
